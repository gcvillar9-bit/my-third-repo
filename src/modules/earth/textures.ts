/**
 * Earth maps shared by the shading and the cloud shell. They reuse the solar-system imagery
 * (public/textures/solar-system/earth_*), load once at the preset's tier the first time Earth is
 * larger than a point, are tracked so ready() waits, and are owned by 'earth' in the budget.
 */
import { Texture, type IUniform } from 'three';
import type { AssetLoader, QualityState, TextureOptions } from '../../core/contracts';

export const EARTH_MODULE_ID = 'earth';
const DIR = 'textures/solar-system';

export interface EarthMapSpec {
  uniform: 'uEarthDay' | 'uEarthNight' | 'uEarthBrc' | 'uEarthSpec';
  base: string;
  linear: boolean;
  has4k: boolean;
}

export const EARTH_MAPS: readonly EarthMapSpec[] = [
  { uniform: 'uEarthDay', base: 'earth_day', linear: false, has4k: true },
  { uniform: 'uEarthNight', base: 'earth_night', linear: false, has4k: true },
  { uniform: 'uEarthBrc', base: 'earth_brc', linear: true, has4k: true },
  { uniform: 'uEarthSpec', base: 'earth_spec', linear: true, has4k: false },
];

/** Public path of a map for the preset's largest texture edge. */
export function earthMapPath(spec: EarthMapSpec, maxTextureSize: number): string {
  const tier = maxTextureSize >= 4096 && spec.has4k ? '4k' : '2k';
  return `${DIR}/${spec.base}_${tier}.webp`;
}

const ONE_PIXEL = new Texture();

export class EarthTextures {
  readonly uniforms: Record<string, IUniform> = {
    uEarthDay: { value: ONE_PIXEL },
    uEarthNight: { value: ONE_PIXEL },
    uEarthBrc: { value: ONE_PIXEL },
    uEarthSpec: { value: ONE_PIXEL },
    uEarthHasMaps: { value: 0 },
  };
  private state: 'idle' | 'loading' | 'done' = 'idle';
  private loaded: Texture[] = [];

  constructor(
    private readonly assets: AssetLoader,
    private readonly quality: QualityState,
  ) {}

  /** Starts loading (once). */
  ensure(): void {
    if (this.state !== 'idle') return;
    this.state = 'loading';
    const max = this.quality.knobs.maxTextureSize;
    const work = Promise.all(
      EARTH_MAPS.map((m) => {
        const opts: TextureOptions = {
          colorSpace: m.linear ? 'linear' : 'srgb',
          wrap: 'repeat',
          owner: EARTH_MODULE_ID,
        };
        return this.assets.texture(earthMapPath(m, max), opts).then((t) => ({ m, t }));
      }),
    ).then(
      (list) => {
        for (const { m, t } of list) {
          this.uniforms[m.uniform].value = t;
          this.loaded.push(t);
        }
        this.uniforms.uEarthHasMaps.value = 1;
        this.state = 'done';
      },
      () => {
        this.state = 'done'; // keep the untextured fallback; the loader reported the error
      },
    );
    void this.assets.track(work, 'earth:maps');
  }

  dispose(): void {
    for (const t of this.loaded) t.dispose();
    this.loaded = [];
  }
}
