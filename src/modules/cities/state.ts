/**
 * Shared state of the cities module: the data (loaded lazily the first time Earth is near) and queries
 * by date. Kept apart from index.ts so public.ts can serve other modules (life draws the buildings).
 */
import type { AssetLoader } from '../../core/contracts';
import { citiesAt, yearOfJd, type City, type CityData } from './data';
import monumentsData from './monuments.json';

export const CITIES_PATH = 'data/cities/cities.json';

let data: CityData | null = null;
let loading: Promise<void> | null = null;
let assets: AssetLoader | null = null;
let cache: { key: number; list: City[] } | null = null;

/** @internal Set by the module's init. */
export function setAssets(a: AssetLoader | null): void {
  assets = a;
  if (!a) {
    data = null;
    loading = null;
    cache = null;
  }
}

/** Has the city table loaded (settlementsNear answers)? */
export function citiesLoaded(): boolean {
  return data !== null;
}

/** Starts loading the city table (tracked: ready() waits). */
export function loadCities(): Promise<void> {
  if (!loading && assets) {
    const a = assets;
    loading = a.track(
      a
        .json<CityData>(CITIES_PATH)
        .then((d) => {
          data = d;
        })
        .catch((e) => console.warn('[cities] city table unavailable', e)),
      'cities',
    );
  }
  return loading ?? Promise.resolve();
}

/** Cities that existed at `jd`, largest first (cached per year), or [] before the table loads. */
export function citiesAtJd(jd: number): City[] {
  if (!data) return [];
  const year = yearOfJd(jd);
  // Steps: 10 years before 1800, 1 year after.
  const key = year < 1800 ? Math.round(year / 10) * 10 : Math.round(year);
  if (cache?.key !== key) cache = { key, list: citiesAt(data, key) };
  return cache.list;
}

const DEG = Math.PI / 180;
const M_PER_DEG = 111_195;

/** Cities whose built-up area comes within `rangeM` of (lat, lon) at `jd`. */
export function settlementsNear(latDeg: number, lonDeg: number, jd: number, rangeM: number): City[] {
  loadCities();
  const out: City[] = [];
  const cl = Math.cos(latDeg * DEG);
  for (const c of citiesAtJd(jd)) {
    const dn = (c.lat - latDeg) * M_PER_DEG;
    let dl = c.lon - lonDeg;
    if (dl > 180) dl -= 360;
    if (dl < -180) dl += 360;
    const de = dl * M_PER_DEG * cl;
    if (Math.hypot(de, dn) < c.radiusM + rangeM) out.push(c);
  }
  return out;
}

export interface Monument {
  name: string;
  kind: string;
  lat: number;
  lon: number;
  scale: number;
}

/**
 * Monuments standing at `jd` within `rangeM` of (lat, lon): from their `from` year until their `end`
 * year (excluded, so a later row of the same building, such as Hagia Sophia as a mosque, takes over).
 */
export function monumentsNear(latDeg: number, lonDeg: number, jd: number, rangeM: number): Monument[] {
  const year = yearOfJd(jd);
  const out: Monument[] = [];
  const cl = Math.cos(latDeg * DEG);
  for (const m of monumentsData.monuments as (Monument & { from: number; end?: number })[]) {
    // Historical years in the table (negative = BC): to astronomical.
    const from = m.from < 0 ? m.from + 1 : m.from;
    const end = m.end === undefined ? Infinity : m.end < 0 ? m.end + 1 : m.end;
    if (year < from || year >= end) continue;
    const dn = (m.lat - latDeg) * M_PER_DEG;
    const de = (m.lon - lonDeg) * M_PER_DEG * cl;
    if (Math.hypot(de, dn) < rangeM)
      out.push({ name: m.name, kind: m.kind, lat: m.lat, lon: m.lon, scale: m.scale ?? 1 });
  }
  return out;
}
