/**
 * City lights through time: the night map is today's, so it fades out going back to the first
 * electric street lighting (~1880) and is off before it. Piecewise linear in city-lights.json
 * (approximate; world electricity generation as the proxy). Futures keep today's map.
 */
import { JD_J2000 } from '../../core/units';
import table from './city-lights.json';

const ROWS = table.rows;

/** Decimal (Julian) year of a JD TT. */
export const yearOfJd = (jd: number): number => 2000 + (jd - JD_J2000) / 365.25;

/** Fraction of the night map's city light at a decimal year (0 before ~1880, 1 from 2012). */
export function cityLightFraction(year: number): number {
  if (!(year > ROWS[0].year)) return 0;
  for (let i = 1; i < ROWS.length; i++) {
    const a = ROWS[i - 1];
    const b = ROWS[i];
    if (year < b.year) return a.fraction + ((b.fraction - a.fraction) * (year - a.year)) / (b.year - a.year);
  }
  return 1;
}
