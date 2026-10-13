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

/** Earth's apparent diameter (px) above which the 4k maps load, and below which they are released. */
export const HI_RES_PX = 1200;
export const LO_RES_PX = 600;

export type EarthTier = '2k' | '4k';
/** GPU budget (MB) a preset needs before the 4k Earth maps may load. */
export const HI_RES_MIN_BUDGET_MB = 512;

/** Public path of a map at a tier (maps without a 4k version stay at 2k). */
export function earthMapPath(spec: EarthMapSpec, maxTextureSize: number, tier: EarthTier = '4k'): string {
  const t = tier === '4k' && maxTextureSize >= 4096 && spec.has4k ? '4k' : '2k';
  return `${DIR}/${spec.base}_${t}.webp`;
}

/**
 * Tier wanted for an apparent diameter, with hysteresis: 2k first, 4k only when Earth is large on
 * screen (and the preset allows 4096 px textures), back to 2k once it is small again.
 */
export function earthTierFor(px: number, current: EarthTier, maxTextureSize: number): EarthTier {
  if (maxTextureSize < 4096) return '2k';
  if (px > HI_RES_PX) return '4k';
  if (px < LO_RES_PX) return '2k';
  return current;
}

const ONE_PIXEL = new Texture();

interface TierState {
  state: 'idle' | 'loading' | 'done';
  maps: Map<EarthMapSpec['uniform'], Texture>;
  /** Bumped on release so a load finishing after it is discarded. */
  gen: number;
}

export class EarthTextures {
  readonly uniforms: Record<string, IUniform> = {
    uEarthDay: { value: ONE_PIXEL },
    uEarthNight: { value: ONE_PIXEL },
    uEarthBrc: { value: ONE_PIXEL },
    uEarthSpec: { value: ONE_PIXEL },
    uEarthHasMaps: { value: 0 },
  };
  private readonly tiers: Record<EarthTier, TierState> = {
    '2k': { state: 'idle', maps: new Map(), gen: 0 },
    '4k': { state: 'idle', maps: new Map(), gen: 0 },
  };
  /** Tier currently wanted (hysteresis state). */
  tier: EarthTier = '2k';

  constructor(
    private readonly assets: AssetLoader,
    private readonly quality: QualityState,
  ) {}

  /**
   * Called every frame while Earth is larger than a point: loads the 2k maps (once), and the 4k
   * maps only while Earth's apparent diameter exceeds HI_RES_PX (released below LO_RES_PX).
   */
  ensure(px = 0): void {
    const k = this.quality.knobs;
    const max = k.maxTextureSize;
    this.load('2k', max);
    // The 4k set adds ~134 MB of GPU memory: only presets with a 512 MB budget (high, ultra) use it.
    this.tier = earthTierFor(px, this.tier, k.gpuBudgetMB >= HI_RES_MIN_BUDGET_MB ? max : 2048);
    if (this.tier === '4k') this.load('4k', max);
    else if (this.tiers['4k'].state !== 'idle') this.release4k();
  }

  private load(tier: EarthTier, max: number): void {
    const ts = this.tiers[tier];
    if (ts.state !== 'idle') return;
    ts.state = 'loading';
    const gen = ts.gen;
    const specs = tier === '2k' ? EARTH_MAPS : EARTH_MAPS.filter((m) => m.has4k);
    const work = Promise.all(
      specs.map((m) => {
        const opts: TextureOptions = {
          colorSpace: m.linear ? 'linear' : 'srgb',
          wrap: 'repeat',
          owner: EARTH_MODULE_ID,
        };
        return this.assets.texture(earthMapPath(m, max, tier), opts).then((t) => ({ m, t }));
      }),
    ).then(
      (list) => {
        if (gen !== ts.gen) {
          for (const { t } of list) t.dispose();
          return;
        }
        for (const { m, t } of list) ts.maps.set(m.uniform, t);
        ts.state = 'done';
        this.apply();
      },
      () => {
        ts.state = 'done'; // keep the untextured (or 2k) fallback; the loader reported the error
      },
    );
    void this.assets.track(work, `earth:maps-${tier}`);
  }

  /** Points the uniforms at the best loaded tier. */
  private apply(): void {
    const lo = this.tiers['2k'].maps;
    const hi = this.tier === '4k' ? this.tiers['4k'].maps : undefined;
    for (const m of EARTH_MAPS) {
      const t = hi?.get(m.uniform) ?? lo.get(m.uniform);
      if (t) this.uniforms[m.uniform].value = t;
    }
    if (lo.size) this.uniforms.uEarthHasMaps.value = 1;
  }

  private release4k(): void {
    const ts = this.tiers['4k'];
    ts.gen++;
    ts.state = 'idle';
    const old = [...ts.maps.values()];
    ts.maps.clear();
    this.apply();
    for (const t of old) t.dispose(); // frees GPU memory and the budget entries
  }

  dispose(): void {
    for (const ts of Object.values(this.tiers)) {
      ts.gen++;
      ts.state = 'idle';
      for (const t of ts.maps.values()) t.dispose();
      ts.maps.clear();
    }
  }
}
