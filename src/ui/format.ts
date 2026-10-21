/** Pure HUD / time-bar formatting (unit-tested). */
import { formatAge, geologicPlace, isDeepPast, yearsBeforePresent } from '../core/geotime';
import { AU, C, DAY, formatDistance, formatSpeed, JD_J2000, JULIAN_YEAR, KPC, LY, MPC } from '../core/units';

export { formatDistance, formatSpeed };

/** Light travel time for a distance: ns … s, min, h, d, yr, kyr, Myr, Gyr. */
export function formatLightTime(d: number): string {
  const t = Math.abs(d) / C;
  const f = (x: number) => (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2));
  if (t < 1e-6) return `${f(t * 1e9)} ns`;
  if (t < 1e-3) return `${f(t * 1e6)} µs`;
  if (t < 1) return `${f(t * 1e3)} ms`;
  if (t < 60) return `${f(t)} s`;
  if (t < 3600) return `${f(t / 60)} min`;
  if (t < DAY) return `${f(t / 3600)} h`;
  if (t < JULIAN_YEAR) return `${f(t / DAY)} d`;
  const y = t / JULIAN_YEAR;
  if (y < 1e3) return `${f(y)} yr`;
  if (y < 1e6) return `${f(y / 1e3)} kyr`;
  if (y < 1e9) return `${f(y / 1e6)} Myr`;
  return `${f(y / 1e9)} Gyr`;
}

/** Time rate (sim s per real s) as text: 'paused', '1 s/s', '1 h/s', '1 day/s', '317 kyr/s', '10 Myr/s'. */
export function formatRate(rate: number): string {
  if (rate === 0) return 'paused';
  const a = Math.abs(rate);
  const sign = rate < 0 ? '−' : '';
  const f = (x: number) => (Math.abs(x - Math.round(x)) < 0.05 ? String(Math.round(x)) : x.toFixed(1));
  let s: string;
  if (a < 60) s = `${f(a)} s/s`;
  else if (a < 3600) s = `${f(a / 60)} min/s`;
  else if (a < DAY) s = `${f(a / 3600)} h/s`;
  else if (a < 2.5e6) s = `${f(a / DAY)} day/s`;
  else if (a < 3e7) s = `${f(a / 2.6e6)} month/s`;
  else if (a < 3e10) s = `${f(a / JULIAN_YEAR)} yr/s`;
  else if (a < 3e13) s = `${f(a / JULIAN_YEAR / 1e3)} kyr/s`;
  else s = `${f(a / JULIAN_YEAR / 1e6)} Myr/s`;
  return sign + s;
}

/**
 * UTC text for a Date ('2026-01-01 12:34:56 UTC', '500 BC 03-15 12:00 UTC'); the deep past (before
 * J2000 − 10 kyr, where the scene shows folded time) as an age and geologic unit from TT
 * ('≈ 66.0 Ma · Late Cretaceous'); far future as a year.
 */
export function formatInstant(date: Date | null, jdTt: number): string {
  if (isDeepPast(jdTt)) {
    const bp = yearsBeforePresent(jdTt);
    const place = geologicPlace(bp);
    return `≈ ${formatAge(bp)}${place ? ` · ${place.label}` : ''}`;
  }
  if (date && Number.isFinite(date.getTime())) {
    const iso = date.toISOString();
    const y = date.getUTCFullYear();
    if (y >= 1 && y <= 9999) return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
    if (y < 1) {
      const t = iso.indexOf('T');
      return `${1 - y} BC ${iso.slice(t - 5, t)} ${iso.slice(t + 1, t + 6)} UTC`;
    }
    return `${iso.slice(0, iso.indexOf('T'))} UTC`;
  }
  const year = 2000 + ((jdTt - JD_J2000) * DAY) / JULIAN_YEAR;
  return `year ${Math.abs(year) >= 1e6 ? year.toExponential(2).replace('e+', 'e') : Math.round(year)}`;
}

/** Decades shown by the log scale bar: 1 m … 1e27 m. */
export const LOG_SCALE_MIN = 0;
export const LOG_SCALE_MAX = 27;

/** Position of a distance on the log scale bar, 0..1. */
export function logScaleFraction(d: number): number {
  if (!(d > 0)) return 0;
  return Math.min(1, Math.max(0, (Math.log10(d) - LOG_SCALE_MIN) / (LOG_SCALE_MAX - LOG_SCALE_MIN)));
}

/** Landmarks on the log scale bar. */
export const LOG_SCALE_TICKS: readonly { label: string; d: number }[] = [
  { label: 'm', d: 1 },
  { label: 'km', d: 1e3 },
  { label: 'R⊕', d: 6.371e6 },
  { label: 'AU', d: AU },
  { label: 'ly', d: LY },
  { label: 'kpc', d: KPC },
  { label: 'Mpc', d: MPC },
  { label: 'Gpc', d: 1e3 * MPC },
];

const FRAME_NAMES: Record<string, string> = { universe: 'Universe', mw: 'Milky Way', ssb: 'Solar System' };

/** Display name of a frame for the breadcrumbs. */
export function frameLabel(id: string, bodyName: (id: string) => string | undefined): string {
  return FRAME_NAMES[id] ?? bodyName(id) ?? bodyName(id.replace(/\.fixed$/, '')) ?? id;
}
