/**
 * Gas-giant SurfaceShading (priority 10) for Jupiter, Saturn, Uranus and Neptune: the solar-system
 * albedo maps advected by zonal jets and curl-noise eddies, a Great Red Spot vortex, Minnaert limb
 * darkening and, for ringed planets, the ring shadow on the globe. One pass, two map samples.
 */
import { Texture, Vector3, Vector4, type IUniform } from 'three';
import type { AssetLoader, Body, QualityState, SurfaceShading, ViewState } from '../../core/contracts';
import { vec3 } from '../../core/math64';
import { NOISE_GLSL } from '../../render/chunks/index';
import { RING_SHADOW_GLSL, ringShadowUniforms } from '../rings/public';
import { texturePath, type BodyRow } from '../solar-system/public';
import giantGlsl from './glsl/giant.glsl?raw';
import { MAX_JETS, flowState, findRedSpot, type GiantSpec } from './model';

export const MODULE_ID = 'giants';
export const GIANT_PRIORITY = 10;
/** Load the map once the body spans this many pixels (solar-system's point/sphere threshold). */
const LOAD_PX = 1.5;
const DEG = Math.PI / 180;

const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** 256x128 RGBA downsample of a loaded texture image (null without a DOM). */
function downsample(tex: Texture): Uint8ClampedArray | null {
  try {
    const img = tex.image as CanvasImageSource | undefined;
    if (!img || typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, 256, 128);
    return ctx.getImageData(0, 0, 256, 128).data;
  } catch {
    return null;
  }
}

/** Area-weighted mean linear luminance of an sRGB equirectangular RGBA image. */
export function meanLuminance(px: ArrayLike<number>, w: number, h: number): number {
  let sum = 0;
  let wsum = 0;
  for (let y = 0; y < h; y++) {
    const wt = Math.cos(((y + 0.5) / h - 0.5) * Math.PI);
    for (let x = 0; x < w; x++) {
      const i = 4 * (y * w + x);
      const l =
        0.2126 * srgbToLinear(px[i] / 255) +
        0.7152 * srgbToLinear(px[i + 1] / 255) +
        0.0722 * srgbToLinear(px[i + 2] / 255);
      sum += wt * l;
      wsum += wt;
    }
  }
  return Math.max(sum / wsum, 1e-3);
}

export interface GiantDeps {
  assets: AssetLoader;
  quality: QualityState;
}

export function createGiantShading(
  spec: GiantSpec,
  body: Body,
  row: BodyRow,
  deps: GiantDeps,
): SurfaceShading {
  const jets = Array.from({ length: MAX_JETS }, (_, i) => {
    const j = spec.jets[i];
    return j ? new Vector4(j[0] * DEG, j[1], j[2] * DEG, 0) : new Vector4();
  });
  const uniforms: Record<string, IUniform> = {
    uGiantMap: { value: new Texture() },
    uHasMap: { value: 0 },
    uMapScale: { value: 1 },
    uAlbedo: { value: Math.min(1, row.albedoGeometric ?? 0.5) },
    uMinnaertK: { value: spec.minnaertK },
    uTint: { value: new Vector3(1, 1, 1) },
    uRadius: { value: body.radius },
    uJets: { value: jets },
    uTurbSpeed: { value: spec.turbulence },
    uFlow: { value: new Vector4(0, 0, 0, 0) },
    uGrs: { value: new Vector4(0, 0, 1, 1) },
    uGrsOmega: { value: 0 },
  };
  const defines: Record<string, string | number | boolean> = {};
  let glsl = `${NOISE_GLSL}\n${giantGlsl}`;
  const ring = ringShadowUniforms(body.id);
  if (ring) {
    Object.assign(uniforms, ring);
    defines.RING_SHADOW = 1;
    glsl = `${NOISE_GLSL}\n${RING_SHADOW_GLSL}\n${giantGlsl}`;
  }

  const path = texturePath(row.textures?.diffuse, deps.quality.knobs.maxTextureSize);
  let state: 'idle' | 'loading' | 'ready' = path ? 'idle' : 'ready';
  const load = () => {
    state = 'loading';
    const work = deps.assets
      .texture(path!, { colorSpace: 'srgb', wrap: 'repeat', owner: MODULE_ID })
      .then((t) => {
        uniforms.uGiantMap.value = t;
        const px = downsample(t);
        if (px) {
          uniforms.uMapScale.value = 1 / meanLuminance(px, 256, 128);
          const g = spec.grs;
          const spot = g ? findRedSpot(px, 256, 128, g.latDeg, g.searchHalfWidthDeg) : null;
          if (g && spot) {
            (uniforms.uGrs.value as Vector4).set(
              (spot.u - 0.5) * 2 * Math.PI,
              spot.latDeg * DEG,
              g.semiMajorKm * 1e3,
              g.semiMinorKm * 1e3,
            );
            // Southern-hemisphere anticyclone: counter-clockwise seen from outside (east -> north).
            uniforms.uGrsOmega.value = (2 * Math.PI) / (g.periodDays * 86400);
          }
        }
        uniforms.uHasMap.value = 1;
        state = 'ready';
      })
      .catch(() => {
        state = 'ready'; // untextured fallback; the loader already reported the error
      });
    void deps.assets.track(work, `giants:${body.id}`);
  };

  const rel = vec3();
  const zero = vec3();
  let lastJd = NaN;
  return {
    bodyId: body.id,
    priority: GIANT_PRIORITY,
    glsl,
    uniforms,
    defines,
    update(view: ViewState) {
      if (state === 'idle') {
        view.toCamera(body.frame, zero, rel);
        const d = Math.hypot(rel.x, rel.y, rel.z);
        const px = d > body.radius ? (2 * Math.asin(body.radius / d)) / view.pixelAngle : Infinity;
        if (px > LOAD_PX) load();
      }
      const step = Number.isFinite(lastJd) ? (view.jd - lastJd) * 86400 : 0;
      lastJd = view.jd;
      const f = flowState(view.jd, step);
      (uniforms.uFlow.value as Vector4).set(f.tA, f.tB, f.wB, f.amp);
    },
  };
}
