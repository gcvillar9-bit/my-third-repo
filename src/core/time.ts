/**
 * Simulation clock (DESIGN 3.2 Time): JD in TT as float64. UTC ↔ TT uses astronomy-engine's
 * ΔT model (Espenak-Meeus polynomials, parabolic extrapolation outside -500..2150).
 */
import { AstroTime } from 'astronomy-engine';
import { WARP_LADDER, type JD, type SimClock, type ValidityRange, type ValidityStatus } from './contracts';
import { DAY, JD_J2000, JD_UNIX_EPOCH, JULIAN_YEAR } from './units';

const MS_PER_DAY = 86_400_000;
/** Largest |ms| a JS Date can hold. */
const DATE_LIMIT_MS = 8.64e15;
/** Clock range: J2000 ± 1e9 Julian years (beyond that the clock pauses at the bound). */
export const JD_LIMIT = (1e9 * JULIAN_YEAR) / DAY;

/**
 * Cap on the fixed-point passes in astroTimeFromTt. astronomy-engine's AstroTime.FromTerrestrialTime
 * loops until |err| < 1e-12 d with no cap, which float64 cannot always reach (whole bands of deep
 * time and a day near 3743 BCE never converge, hanging the tab). Each pass shrinks the error by
 * dΔT/dt (below 0.2 inside the clock range), so 50 passes reach float64 resolution everywhere.
 */
const TT_TO_UT_PASSES = 50;

/** astronomy-engine time for a TT offset from J2000 in days (bounded FromTerrestrialTime). */
export function astroTimeFromTt(ttDays: number): AstroTime {
  let time = new AstroTime(ttDays);
  for (let i = 0; i < TT_TO_UT_PASSES; i++) {
    const err = ttDays - time.tt;
    if (Math.abs(err) < 1e-12) break;
    time = time.AddDays(err);
  }
  return time;
}

/** UTC JD → TT JD. */
export function utcToTt(jdUtc: JD): JD {
  return new AstroTime(jdUtc - JD_J2000).tt + JD_J2000;
}
/** TT JD → UTC JD. */
export function ttToUtc(jdTt: JD): JD {
  return astroTimeFromTt(jdTt - JD_J2000).ut + JD_J2000;
}
/** ΔT = TT − UT in seconds at a UTC JD. */
export function deltaT(jdUtc: JD): number {
  return (utcToTt(jdUtc) - jdUtc) * DAY;
}
export const dateToJdUtc = (d: Date): JD => d.getTime() / MS_PER_DAY + JD_UNIX_EPOCH;
export const jdUtcToMs = (jdUtc: JD): number => (jdUtc - JD_UNIX_EPOCH) * MS_PER_DAY;

/** Parses an ISO-8601 instant (UTC when no zone is given) or a bare JD (TT) number. */
export function parseInstant(t: string): JD | null {
  const s = t.trim();
  if (/^-?\d+(\.\d+)?$/.test(s) && Number(s) > 1e5) return Number(s);
  const iso = /T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s) ? `${s}Z` : s;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? utcToTt(ms / MS_PER_DAY + JD_UNIX_EPOCH) : null;
}

/** Days from the Unix epoch a JS Date can reach, plus a margin for ΔT (about 8 yr at the limit). */
const DATE_RANGE_TT_DAYS = DATE_LIMIT_MS / MS_PER_DAY + 10 * 366;
/** False when a TT JD is certainly outside the JS Date range (skips the TT → UT solve there). */
const nearDateRange = (jdTt: JD): boolean => Math.abs(jdTt - JD_UNIX_EPOCH) < DATE_RANGE_TT_DAYS;

/** ISO-8601 UTC text for a TT JD (null outside the Date range). */
export function jdToIso(jdTt: JD): string | null {
  if (!nearDateRange(jdTt)) return null;
  const ms = jdUtcToMs(ttToUtc(jdTt));
  return Math.abs(ms) < DATE_LIMIT_MS ? new Date(ms).toISOString() : null;
}

const YEARS = (y: number) => (y * JULIAN_YEAR) / DAY;

/** Model validity ranges from DESIGN 3.2 (registered by boot). */
export const STANDARD_VALIDITY: readonly ValidityRange[] = [
  {
    id: 'core.planets',
    appliesTo: 'planets',
    model: 'astronomy-engine (VSOP87 / ELP)',
    jdMin: JD_J2000 - YEARS(1e4),
    jdMax: JD_J2000 + YEARS(1e4),
    beyond: 'frozen',
    source: 'astronomy-engine documented accuracy window; planets freeze beyond ±10 kyr',
  },
  {
    id: 'core.stars.proper-motion',
    appliesTo: 'stars',
    model: 'linear proper motion',
    jdMin: JD_J2000 - YEARS(1e6),
    jdMax: JD_J2000 + YEARS(1e6),
    beyond: 'approximate',
    source: 'DESIGN 3.2: linear proper motion up to ±1 Myr, galactic rotation beyond',
  },
  {
    id: 'core.galactic-rotation',
    appliesTo: 'galaxy',
    model: 'galactic rotation',
    jdMin: JD_J2000 - YEARS(1e9),
    jdMax: JD_J2000 + YEARS(1e9),
    beyond: 'approximate',
    source: 'DESIGN 3.2',
  },
];

/** What the time bar shows for one validity status. */
export interface ValidityBadge {
  id: string;
  label: string;
  state: 'ok' | ValidityRange['beyond'];
  title: string;
}

export function validityBadges(statuses: readonly ValidityStatus[]): ValidityBadge[] {
  return statuses.map(({ range, inside }) => ({
    id: range.id,
    label: inside ? `${range.appliesTo}: ${range.model}` : `${range.appliesTo}: ${range.beyond}`,
    state: inside ? 'ok' : range.beyond,
    title: range.source ?? range.model,
  }));
}

/** Signed warp ladder: -1e13 … -1, 0, 1 … 1e13. */
export const SIGNED_LADDER: readonly number[] = [
  ...WARP_LADDER.slice(1)
    .map((r) => -r)
    .reverse(),
  ...WARP_LADDER,
];

export interface SimClockOptions {
  jd?: JD;
  rate?: number;
  /** Ranges source for validity(); defaults to STANDARD_VALIDITY. */
  ranges?: () => readonly ValidityRange[];
  /** Wall clock in ms (tests). */
  now?: () => number;
}

export class SimClockImpl implements SimClock {
  readonly warpLadder = WARP_LADDER;
  private _jd: JD;
  /** Days lost to float64 rounding in tick, carried into the next one (deep time: 0.33 s steps at 66 Ma). */
  private _carry = 0;
  private _rate: number;
  private _paused = false;
  private listeners = new Set<() => void>();
  private ranges: () => readonly ValidityRange[];
  private now: () => number;

  constructor(opts: SimClockOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.ranges = opts.ranges ?? (() => STANDARD_VALIDITY);
    this._jd = opts.jd ?? utcToTt(this.now() / MS_PER_DAY + JD_UNIX_EPOCH);
    this._rate = opts.rate ?? 1;
  }

  get jd(): JD {
    return this._jd;
  }
  get rate(): number {
    return this._paused ? 0 : this._rate;
  }
  get paused(): boolean {
    return this._paused;
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  setRate(rate: number): void {
    if (rate === 0) {
      this._paused = true;
    } else {
      this._rate = rate;
      this._paused = false;
    }
    this.emit();
  }

  warpStep(direction: 1 | -1): void {
    const r = this.rate;
    let idx = 0;
    for (let i = 1; i < SIGNED_LADDER.length; i++) {
      if (Math.abs(SIGNED_LADDER[i] - r) < Math.abs(SIGNED_LADDER[idx] - r)) idx = i;
    }
    const next = Math.min(SIGNED_LADDER.length - 1, Math.max(0, idx + direction));
    this.setRate(SIGNED_LADDER[next]);
  }

  pause(): void {
    this._paused = true;
    this.emit();
  }
  resume(): void {
    this._paused = false;
    this.emit();
  }

  setTime(t: JD | Date | string): void {
    let jd: JD | null;
    if (typeof t === 'number') jd = t;
    else if (t instanceof Date) jd = utcToTt(dateToJdUtc(t));
    else jd = parseInstant(t);
    if (jd === null || !Number.isFinite(jd)) throw new Error(`clock: cannot parse time '${String(t)}'`);
    this._jd = Math.min(JD_J2000 + JD_LIMIT, Math.max(JD_J2000 - JD_LIMIT, jd));
    this._carry = 0;
    this.emit();
  }

  setNow(): void {
    this.setTime(new Date(this.now()));
  }

  tick(dtReal: number): number {
    if (this._paused || !(dtReal > 0)) return 0;
    const dtSim = this._rate * dtReal;
    const step = dtSim / DAY + this._carry;
    const next = this._jd + step;
    if (Math.abs(next - JD_J2000) > JD_LIMIT) {
      this._jd = JD_J2000 + Math.sign(next - JD_J2000) * JD_LIMIT;
      this._carry = 0;
      this.pause();
      return 0;
    }
    this._carry = step - (next - this._jd);
    this._jd = next;
    return dtSim;
  }

  toDate(jd: JD = this._jd): Date | null {
    if (!nearDateRange(jd)) return null;
    const ms = jdUtcToMs(ttToUtc(jd));
    return Math.abs(ms) < DATE_LIMIT_MS ? new Date(ms) : null;
  }

  utcToTt(jdUtc: JD): JD {
    return utcToTt(jdUtc);
  }
  ttToUtc(jdTt: JD): JD {
    return ttToUtc(jdTt);
  }

  validity(jd: JD = this._jd): readonly ValidityStatus[] {
    return this.ranges().map((range) => ({ range, inside: jd >= range.jdMin && jd <= range.jdMax }));
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
