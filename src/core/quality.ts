/**
 * Quality presets (DESIGN 3.3). `?q=<preset>` selects one at boot; medium is the default.
 */
import { QUALITY_PRESETS, type QualityKnobs, type QualityPreset, type QualityState } from './contracts';

export const DEFAULT_PRESET: QualityPreset = 'medium';

export const PRESET_KNOBS: Readonly<Record<QualityPreset, Readonly<QualityKnobs>>> = {
  potato: {
    preset: 'potato',
    renderScale: 1,
    maxPixelRatio: 1,
    atmosphereSteps: 8,
    lensingSteps: 64,
    volumeSteps: 24,
    pointBudget: 100_000,
    terrainSse: 8,
    terrainTileCap: 64,
    maxTextureSize: 2048,
    gpuBudgetMB: 128,
    bloom: true,
    smaa: false,
    temporal: false,
  },
  low: {
    preset: 'low',
    renderScale: 0.75,
    maxPixelRatio: 1,
    atmosphereSteps: 16,
    lensingSteps: 64,
    volumeSteps: 24,
    pointBudget: 300_000,
    terrainSse: 6,
    terrainTileCap: 192,
    maxTextureSize: 2048,
    gpuBudgetMB: 128,
    bloom: true,
    smaa: true,
    temporal: false,
  },
  medium: {
    preset: 'medium',
    renderScale: 1,
    maxPixelRatio: 1.5,
    atmosphereSteps: 32,
    lensingSteps: 128,
    volumeSteps: 48,
    pointBudget: 1_000_000,
    terrainSse: 4,
    terrainTileCap: 384,
    maxTextureSize: 4096,
    gpuBudgetMB: 256,
    bloom: true,
    smaa: true,
    temporal: true,
  },
  high: {
    preset: 'high',
    renderScale: 1,
    maxPixelRatio: 2,
    atmosphereSteps: 48,
    lensingSteps: 256,
    volumeSteps: 96,
    pointBudget: 2_000_000,
    terrainSse: 3,
    terrainTileCap: 768,
    maxTextureSize: 4096,
    gpuBudgetMB: 512,
    bloom: true,
    smaa: true,
    temporal: true,
  },
  ultra: {
    preset: 'ultra',
    renderScale: 1,
    maxPixelRatio: 2,
    atmosphereSteps: 64,
    lensingSteps: 256,
    volumeSteps: 160,
    pointBudget: 4_000_000,
    terrainSse: 2,
    terrainTileCap: 1024,
    maxTextureSize: 8192,
    gpuBudgetMB: 512,
    bloom: true,
    smaa: true,
    temporal: true,
  },
};

export function isQualityPreset(v: unknown): v is QualityPreset {
  return typeof v === 'string' && (QUALITY_PRESETS as readonly string[]).includes(v);
}

/** Preset from a `q` URL parameter (unknown or missing → medium). */
export function parseQuality(q: string | null | undefined): QualityPreset {
  return isQualityPreset(q) ? q : DEFAULT_PRESET;
}

export class QualityStateImpl implements QualityState {
  private _preset: QualityPreset;
  private _knobs: QualityKnobs;
  private _dynamic = 1;
  private listeners = new Set<(k: Readonly<QualityKnobs>) => void>();

  /** `test` forces temporal accumulation off (DESIGN 7). */
  constructor(
    preset: QualityPreset = DEFAULT_PRESET,
    private readonly test = false,
  ) {
    this._preset = preset;
    this._knobs = this.knobsFor(preset);
  }

  private knobsFor(p: QualityPreset): QualityKnobs {
    const k = { ...PRESET_KNOBS[p] };
    if (this.test) k.temporal = false;
    return k;
  }

  get preset(): QualityPreset {
    return this._preset;
  }
  get knobs(): Readonly<QualityKnobs> {
    return this._knobs;
  }
  get dynamicScale(): number {
    return this._dynamic;
  }

  set(preset: QualityPreset): void {
    if (!isQualityPreset(preset)) throw new Error(`quality: unknown preset '${String(preset)}'`);
    this._preset = preset;
    this._knobs = this.knobsFor(preset);
    this.emit();
  }

  setDynamicScale(s: number): void {
    const v = this.test ? 1 : Math.min(1, Math.max(0.5, s));
    if (v === this._dynamic) return;
    this._dynamic = v;
    this.emit();
  }

  subscribe(listener: (knobs: Readonly<QualityKnobs>) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const l of this.listeners) l(this._knobs);
  }
}
