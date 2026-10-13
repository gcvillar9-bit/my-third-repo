/**
 * Default SurfaceShading per body (priority 0): generic albedo map (Lommel-Seeliger or Lambert),
 * Earth v1 (day/night, clouds, glint) and Sun v1 (emissive limb darkening). Textures load lazily
 * the first time the body is bigger than a point on screen, at the preset's texture tier.
 */
import { Texture, Vector3, type IUniform } from 'three';
import type {
  AssetLoader,
  QualityState,
  SurfaceShading,
  TextureOptions,
  ViewState,
} from '../../../core/contracts';
import { SUN_DISK_LUMINANCE, SUN_RGB } from '../../../core/photometry';
import { PHASE_GLSL } from '../../../render/chunks/index';
import { ATMOSPHERE_BODIES, texturePath, type BodyRow, type TexturePath } from '../data';
import equirectGlsl from '../glsl/equirect.glsl?raw';
import defaultGlsl from '../glsl/shading-default.glsl?raw';
import earthGlsl from '../glsl/shading-earth.glsl?raw';
import sunGlsl from '../glsl/shading-sun.glsl?raw';
import { POINT_MAX_PX, type SceneState } from './scene-state';

export const MODULE_ID = 'solar-system';
/** Luminance of a white night-map texel, cd/m² (VIIRS city cores are ~0.1-0.5 cd/m²). */
export const CITY_LUMINANCE = 0.3;
const ONE_PIXEL = new Texture();

export interface ShadingDeps {
  assets: AssetLoader;
  quality: QualityState;
  scene: SceneState;
  /** Called with the mean linear colour (luminance 1) of a body's albedo map once it is known. */
  onTint?(bodyId: string, rgb: [number, number, number]): void;
}

export interface MapStats {
  /** Mean linear luminance (area-weighted on the sphere). */
  mean: number;
  /** Mean linear colour normalised to luminance 1. */
  tint: [number, number, number];
}

const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** Mean linear colour of an equirectangular image (64×32 downsample, cos(latitude) weights). */
export function equirectStats(pixels: Uint8ClampedArray, w: number, h: number, srgb = true): MapStats {
  let r = 0;
  let g = 0;
  let b = 0;
  let wsum = 0;
  for (let y = 0; y < h; y++) {
    const wt = Math.cos(((y + 0.5) / h - 0.5) * Math.PI);
    for (let x = 0; x < w; x++) {
      const i = 4 * (y * w + x);
      const f = srgb ? srgbToLinear : (c: number) => c;
      r += wt * f(pixels[i] / 255);
      g += wt * f(pixels[i + 1] / 255);
      b += wt * f(pixels[i + 2] / 255);
      wsum += wt;
    }
  }
  [r, g, b] = [r / wsum, g / wsum, b / wsum];
  const mean = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const tint: [number, number, number] = mean > 0 ? [r / mean, g / mean, b / mean] : [1, 1, 1];
  return { mean: Math.max(mean, 1e-3), tint };
}

function imageStats(tex: Texture): MapStats | null {
  try {
    const img = tex.image as CanvasImageSource | undefined;
    if (!img || typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 32;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, 64, 32);
    return equirectStats(ctx.getImageData(0, 0, 64, 32).data, 64, 32);
  } catch {
    return null;
  }
}

/** Shading GLSL prelude: helper chunks the shading code relies on (include-guarded). */
const PRELUDE = `${PHASE_GLSL}\n${equirectGlsl}\n`;

type MapSpec = { uniform: string; path: TexturePath | undefined; linear?: boolean; stats?: boolean };

export function createShading(row: BodyRow, deps: ShadingDeps): SurfaceShading {
  const tex = row.textures ?? {};
  const uniforms: Record<string, IUniform> = {};
  let glsl: string;
  let maps: MapSpec[];
  let flag: string;
  const defines: Record<string, string | number | boolean> = {};
  if (row.id === 'earth') {
    glsl = earthGlsl;
    flag = 'uHasMaps';
    maps = [
      { uniform: 'uDayMap', path: tex.diffuse, stats: true },
      { uniform: 'uNightMap', path: tex.night },
      { uniform: 'uBrcMap', path: tex.brc, linear: true },
      { uniform: 'uSpecMap', path: tex.specular, linear: true },
    ];
    uniforms.uCityLuminance = { value: CITY_LUMINANCE };
  } else if (row.id === 'sun') {
    glsl = sunGlsl;
    flag = 'uHasMap';
    maps = [{ uniform: 'uSunMap', path: tex.diffuse, stats: true }];
    uniforms.uMapScale = { value: 1 };
    uniforms.uDiskLuminance = { value: SUN_DISK_LUMINANCE };
    uniforms.uSunColor = { value: new Vector3(...SUN_RGB) };
  } else {
    glsl = defaultGlsl;
    flag = 'uHasMap';
    maps = [{ uniform: 'uAlbedoMap', path: tex.diffuse, stats: true }];
    uniforms.uMapScale = { value: 1 };
    uniforms.uAlbedo = { value: Math.min(1, row.albedoGeometric ?? 0.3) };
    uniforms.uTint = { value: new Vector3(1, 1, 1) };
    if (!ATMOSPHERE_BODIES.has(row.id)) defines.AIRLESS = 1;
  }
  uniforms[flag] = { value: 0 };
  for (const m of maps) uniforms[m.uniform] = { value: ONE_PIXEL };
  maps = maps.filter((m) => m.path);

  let state: 'idle' | 'loading' | 'ready' = maps.length ? 'idle' : 'ready';
  const load = () => {
    state = 'loading';
    const max = deps.quality.knobs.maxTextureSize;
    const work = Promise.all(
      maps.map((m) => {
        const opts: TextureOptions = {
          colorSpace: m.linear ? 'linear' : 'srgb',
          wrap: 'repeat',
          owner: MODULE_ID,
        };
        return deps.assets.texture(texturePath(m.path, max)!, opts).then((t) => ({ m, t }));
      }),
    ).then(
      (loaded) => {
        for (const { m, t } of loaded) {
          uniforms[m.uniform].value = t;
          if (m.stats && uniforms.uMapScale) {
            const st = imageStats(t);
            if (st) {
              uniforms.uMapScale.value = 1 / st.mean;
              if (row.id !== 'sun') deps.onTint?.(row.id, st.tint);
            }
          }
        }
        uniforms[flag].value = 1;
        state = 'ready';
      },
      () => {
        state = 'ready'; // keep the untextured fallback; the loader already reported the error
      },
    );
    void deps.assets.track(work, `solar-system:${row.id}`);
  };

  return {
    bodyId: row.id,
    priority: 0,
    glsl: PRELUDE + glsl,
    uniforms,
    defines,
    update(_view: ViewState) {
      if (state !== 'idle') return;
      const bv = deps.scene.get(row.id);
      if (bv && bv.pxDiam > POINT_MAX_PX) load();
    },
  };
}
