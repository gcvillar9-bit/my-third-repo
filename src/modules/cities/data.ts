/**
 * Cities at a date from public/data/cities/cities.json (tools/build-cities.mjs): which existed, their
 * name then, population (log-linear between estimates), architectural style and built-up radius.
 * Years are astronomical (1 BC = 0, 2 BC = -1). All values approximate.
 */
import { JD_J2000 } from '../../core/units';

export type CityStyle =
  | 'mesopotamian'
  | 'egyptian'
  | 'indus'
  | 'chinese'
  | 'classical'
  | 'persian'
  | 'medieval-european'
  | 'islamic'
  | 'indian'
  | 'japanese'
  | 'southeast-asian'
  | 'mesoamerican'
  | 'andean'
  | 'african'
  | 'colonial'
  | 'industrial'
  | 'modern';

/** [name, lat, lon, styles [[year, styleIndex]], pop [[year, pop]], endYear | null, names?] */
export type CityRow = [
  string,
  number,
  number,
  [number, number][],
  [number, number][],
  number | null,
  [number, string][]?,
];

export interface CityData {
  styles: CityStyle[];
  cities: CityRow[];
}

export interface City {
  id: string;
  name: string;
  lat: number;
  lon: number;
  pop: number;
  style: CityStyle;
  /** Built-up radius, m. */
  radiusM: number;
  founded: number;
}

/** Astronomical calendar year (fractional) of a JD (TT); 365.25-day years from J2000. */
export function yearOfJd(jd: number): number {
  return 2000 + (jd - JD_J2000) / 365.25;
}

/** People per km2 of built-up land by period (dense walled towns, then industrial, then metro areas). */
export function densityPerKm2(year: number): number {
  if (year < 1800) return 25_000;
  if (year < 1950) return 12_000;
  return 5_000;
}

export function radiusFor(pop: number, year: number): number {
  return Math.max(250, 1000 * Math.sqrt(pop / densityPerKm2(year) / Math.PI));
}

/** Population at a year (log-linear between estimates; ramps up from 1000 people at founding). */
export function populationAt(row: CityRow, year: number): number | null {
  const founded = row[3][0][0];
  const end = row[5];
  if (year < founded || (end !== null && year > end)) return null;
  const pts = row[4];
  if (year <= pts[0][0]) {
    const span = pts[0][0] - founded;
    if (span <= 0) return pts[0][1];
    const t = (year - founded) / span;
    return Math.exp(Math.log(1000) + t * (Math.log(Math.max(1000, pts[0][1])) - Math.log(1000)));
  }
  for (let i = 1; i < pts.length; i++) {
    if (year <= pts[i][0]) {
      const [y0, p0] = pts[i - 1];
      const [y1, p1] = pts[i];
      const t = (year - y0) / (y1 - y0);
      return Math.exp(Math.log(p0) + t * (Math.log(p1) - Math.log(p0)));
    }
  }
  return pts[pts.length - 1][1];
}

function lastAtOrBefore<T>(rows: [number, T][], year: number, fallback: T): T {
  let v = fallback;
  for (const [y, x] of rows) if (y <= year) v = x;
  return v;
}

export function cityAt(data: CityData, row: CityRow, year: number): City | null {
  const pop = populationAt(row, year);
  if (pop === null) return null;
  const style = data.styles[lastAtOrBefore(row[3], year, row[3][0][1])];
  const name = row[6] ? lastAtOrBefore(row[6], year, row[0]) : row[0];
  return {
    id: row[0],
    name,
    lat: row[1],
    lon: row[2],
    pop,
    style,
    radiusM: radiusFor(pop, year),
    founded: row[3][0][0],
  };
}

/** Cities at a year, largest first. */
export function citiesAt(data: CityData, year: number): City[] {
  const out: City[] = [];
  for (const row of data.cities) {
    const c = cityAt(data, row, year);
    if (c) out.push(c);
  }
  return out.sort((a, b) => b.pop - a.pop);
}

/** "Rome ≈450k", "Tokyo ≈37M". */
export function formatPop(pop: number): string {
  if (pop >= 1e6) return `${(pop / 1e6).toFixed(pop >= 1e7 ? 0 : 1)}M`;
  if (pop >= 1e3) return `${Math.round(pop / 1e3)}k`;
  return String(Math.round(pop));
}
