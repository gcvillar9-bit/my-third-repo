/**
 * Dynamic resolution (P4-P): scales the internal render resolution between per-preset bounds to
 * hold ~55-60 fps on slow GPUs. Pure and clock-free (feed it frame intervals); the app ticks it
 * from the rAF loop outside test mode only.
 *
 * Anti-pumping rules:
 * - decisions use the mean of a 1 s window of frame intervals with the slowest 5% dropped (single
 *   hitches are ignored, while vsync-quantised 16.7/33.3 ms mixes still average correctly);
 * - one step of 0.05 at a time, at most one change per `cooldownMs` (each change resizes targets);
 * - downscale when the median frame interval is above `slowMs` (about 52 fps);
 * - upscale only after `upHoldMs` of frames at or below `fastMs` (vsync 60 Hz or better);
 * - an upscale that is followed by a downscale within `oscillationMs` doubles the upscale hold
 *   (up to 60 s), so a scene that cannot sustain the higher step settles instead of oscillating;
 * - intervals above `stallMs` (tab hidden, GC, asset upload) reset the window.
 */
export interface DynamicResOptions {
  min: number;
  max: number;
  step: number;
  slowMs: number;
  fastMs: number;
  windowMs: number;
  cooldownMs: number;
  upHoldMs: number;
  oscillationMs: number;
  stallMs: number;
}

export const DYNAMIC_RES_DEFAULTS: DynamicResOptions = {
  min: 0.5,
  max: 1,
  step: 0.05,
  slowMs: 1000 / 52,
  fastMs: 1000 / 57,
  windowMs: 1000,
  cooldownMs: 1200,
  upHoldMs: 4000,
  oscillationMs: 6000,
  stallMs: 250,
};

const MAX_HOLD_MS = 60_000;
const WINDOW_CAP = 256;

export class DynamicResolution {
  readonly opts: DynamicResOptions;
  private _scale: number;
  private readonly win = new Float32Array(WINDOW_CAP);
  private readonly sorted = new Float32Array(WINDOW_CAP);
  private n = 0;
  private winMs = 0;
  private time = 0;
  private lastChange = -Infinity;
  private lastUp = -Infinity;
  private fastFor = 0;
  private upHold: number;
  private _mean = 0;

  constructor(opts: Partial<DynamicResOptions> = {}, initial = 1) {
    this.opts = { ...DYNAMIC_RES_DEFAULTS, ...opts };
    this._scale = this.clamp(initial);
    this.upHold = this.opts.upHoldMs;
  }

  get scale(): number {
    return this._scale;
  }

  /** Trimmed-mean frame interval of the last full window, ms (0 before the first window). */
  get meanMs(): number {
    return this._mean;
  }

  /** New bounds (preset change); the scale is clamped into them. */
  setBounds(min: number, max: number): void {
    this.opts.min = min;
    this.opts.max = max;
    this._scale = this.clamp(this._scale);
  }

  /** Forget history (after a resize, a teleport or re-enabling). */
  reset(scale = this._scale): void {
    this._scale = this.clamp(scale);
    this.n = 0;
    this.winMs = 0;
    this.fastFor = 0;
    this.upHold = this.opts.upHoldMs;
  }

  /**
   * Feeds one frame interval (ms). Returns the new scale when it changed, otherwise null.
   */
  sample(dtMs: number): number | null {
    const o = this.opts;
    if (!(dtMs > 0)) return null;
    this.time += dtMs;
    if (dtMs > o.stallMs) {
      this.n = 0;
      this.winMs = 0;
      this.fastFor = 0;
      return null;
    }
    if (this.n < WINDOW_CAP) this.win[this.n++] = dtMs;
    this.winMs += dtMs;
    if (this.winMs < o.windowMs) return null;
    const med = this.trimmedMean();
    this._mean = med;
    const span = this.winMs;
    this.n = 0;
    this.winMs = 0;
    if (med <= o.fastMs) this.fastFor += span;
    else this.fastFor = 0;
    if (this.time - this.lastChange < o.cooldownMs) return null;
    let next = this._scale;
    if (med > o.slowMs && this._scale > o.min) {
      // Bigger steps when far too slow (e.g. 20 fps): still one change per cooldown.
      const k = med > 2 * o.slowMs ? 2 : 1;
      next = this.clamp(this._scale - k * o.step);
      if (this.time - this.lastUp < o.oscillationMs) this.upHold = Math.min(MAX_HOLD_MS, this.upHold * 2);
    } else if (this.fastFor >= this.upHold && this._scale < o.max) {
      next = this.clamp(this._scale + o.step);
      this.lastUp = this.time;
      this.fastFor = 0;
    }
    if (next === this._scale) return null;
    this._scale = next;
    this.lastChange = this.time;
    return next;
  }

  private trimmedMean(): number {
    const a = this.sorted.subarray(0, this.n);
    a.set(this.win.subarray(0, this.n));
    a.sort();
    const keep = Math.max(1, Math.ceil(this.n * 0.95));
    let sum = 0;
    for (let i = 0; i < keep; i++) sum += a[i];
    return this.n ? sum / keep : 0;
  }

  private clamp(s: number): number {
    const { min, max, step } = this.opts;
    // Quantised to the step so the render targets only take a few distinct sizes.
    const q = Math.round(s / step) * step;
    return Math.min(max, Math.max(min, Math.round(q * 1000) / 1000));
  }
}
