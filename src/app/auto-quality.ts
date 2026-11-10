/**
 * Automatic quality (real sessions only). The preset is remembered between visits: an explicit
 * choice from the settings panel wins; without one the app picks a starting preset for the device
 * and steps it down when the frame rate stays poor even at the lowest dynamic resolution. It
 * never steps up by itself (a preset change reloads textures and terrain), and `?q=` overrides
 * everything for one session without being stored.
 *
 * Pure logic, storage injected, so it is unit-tested without a browser.
 */
import { QUALITY_PRESETS, type QualityPreset } from '../core/contracts';
import { DEFAULT_PRESET, isQualityPreset } from '../core/quality';

export const QUALITY_KEY = 'cosmos.quality';
export const QUALITY_AUTO_KEY = 'cosmos.quality.auto';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface DeviceHints {
  /** Primary pointer is coarse (phones, tablets). */
  coarsePointer: boolean;
  /** navigator.deviceMemory in GB when the browser reports it. */
  memoryGb?: number;
}

/** Starting preset on a device that has no stored choice. */
export function devicePreset(h: DeviceHints): QualityPreset {
  if (h.coarsePointer || (h.memoryGb !== undefined && h.memoryGb <= 2)) return 'low';
  return DEFAULT_PRESET;
}

export interface QualityChoice {
  preset: QualityPreset;
  /** True when the preset may be lowered automatically (no explicit choice). */
  auto: boolean;
}

const read = (s: Store | null, key: string): string | null => {
  try {
    return s?.getItem(key) ?? null;
  } catch {
    return null;
  }
};

/** Preset at boot: `?q=` > stored explicit choice > last automatic level > device default. */
export function initialQuality(param: string | null, store: Store | null, hints: DeviceHints): QualityChoice {
  if (isQualityPreset(param)) return { preset: param, auto: false };
  const chosen = read(store, QUALITY_KEY);
  if (isQualityPreset(chosen)) return { preset: chosen, auto: false };
  const auto = read(store, QUALITY_AUTO_KEY);
  const start = devicePreset(hints);
  if (isQualityPreset(auto) && QUALITY_PRESETS.indexOf(auto) < QUALITY_PRESETS.indexOf(start))
    return { preset: auto, auto: true };
  return { preset: start, auto: true };
}

/** Remembers an explicit choice (null: back to automatic). */
export function storeQualityChoice(store: Store | null, preset: QualityPreset | null): void {
  try {
    if (preset) store?.setItem(QUALITY_KEY, preset);
    else {
      store?.removeItem(QUALITY_KEY);
      store?.removeItem(QUALITY_AUTO_KEY);
    }
  } catch {
    // Storage full or blocked: the choice lasts for this visit.
  }
}

export function storeAutoLevel(store: Store | null, preset: QualityPreset): void {
  try {
    store?.setItem(QUALITY_AUTO_KEY, preset);
  } catch {
    // As above.
  }
}

export interface AutoQualityOptions {
  /** Frame time above which the session counts as struggling, ms (about 24 fps). */
  slowMs: number;
  /** Time the session must struggle at the lowest resolution before a step down, ms. */
  holdMs: number;
  /** Quiet time after a step (new preset loading), ms. */
  settleMs: number;
}

export const AUTO_QUALITY_DEFAULTS: AutoQualityOptions = { slowMs: 1000 / 24, holdMs: 6000, settleMs: 8000 };

/**
 * Feed it once per frame with the frame interval, the smoothed frame time (DynamicResolution
 * meanMs) and whether dynamic resolution is already at its lower bound; it returns the preset to
 * switch to when the session has been too slow for too long, else null.
 */
export class AutoQuality {
  private slowFor = 0;
  private quiet = 0;

  constructor(private readonly opts: AutoQualityOptions = AUTO_QUALITY_DEFAULTS) {}

  reset(): void {
    this.slowFor = 0;
    this.quiet = this.opts.settleMs;
  }

  sample(dtMs: number, meanMs: number, atMinScale: boolean, preset: QualityPreset): QualityPreset | null {
    if (!(dtMs > 0)) return null;
    // A hidden tab or a long stall is not evidence of a slow machine.
    const dt = Math.min(dtMs, 1000);
    if (this.quiet > 0) {
      this.quiet -= dt;
      return null;
    }
    if (atMinScale && meanMs > this.opts.slowMs) this.slowFor += dt;
    else this.slowFor = 0;
    if (this.slowFor < this.opts.holdMs) return null;
    const i = QUALITY_PRESETS.indexOf(preset);
    this.reset();
    return i > 0 ? QUALITY_PRESETS[i - 1] : null;
  }
}

/**
 * Session-wide quality choice shared by boot (which binds it) and the settings panel (which
 * shows "Automatic" plus the presets). Before boot binds it, it reports a fixed preset.
 */
export interface QualityControl {
  /** True while the preset is managed automatically. */
  readonly auto: boolean;
  /** 'auto' hands the preset back to the app; a preset pins it. Both are remembered. */
  choose(mode: QualityPreset | 'auto'): void;
}

let control: QualityControl = { auto: false, choose: () => {} };

export function bindQualityControl(c: QualityControl): void {
  control = c;
}

export const qualityControl: QualityControl = {
  get auto() {
    return control.auto;
  },
  choose: (mode) => control.choose(mode),
};
