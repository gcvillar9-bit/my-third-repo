/**
 * Who stands where: plants in small cells and herds in larger cells around the camera, generated
 * deterministically from a hash of the cell and the era (the same place and date always shows the same
 * scene), and creature motion along smooth loops around their homes (real time, so warping the clock
 * does not make animals race). Positions are in the anchor's local frame: east and north in metres
 * from the anchor's ground point; the ground height comes from an injected function.
 */
import { hash01 } from './kit/mesh';
import { MODELS } from './kit/models';
import { PLANTS, type PlantKind } from './kit/plants';
import {
  SPECIES,
  biomeOf,
  candidates,
  floraFor,
  pick,
  type Biome,
  type Candidate,
  type Occurrences,
  type SpeciesRow,
} from './ecology';

/** Metres per degree of latitude (spherical Earth, enough for placement). */
export const M_PER_DEG = 111_195;

export interface Climate {
  /** Surface kind, temperature, moisture at a point (paleo sampleClimate). */
  at(latDeg: number, lonDeg: number): { kind: number; tempC: number; moisture: number };
}

export interface LifeLimits {
  /** Radius of trees (taller than 3 m), m. */
  treeRadius: number;
  /** Radius of small plants, m. */
  tuftRadius: number;
  /** Radius of herds, m. */
  herdRadius: number;
  maxPlants: number;
  maxCreatures: number;
}

export const PLANT_CELL_M = 24;
export const HERD_CELL_M = 240;

export interface Plant {
  kind: PlantKind;
  lat: number;
  lon: number;
  heading: number;
  scale: number;
  tint: number;
}

export interface Member {
  /** Home of the member's loop: lat/lon of the herd centre plus an offset, m (east, north). */
  homeE: number;
  homeN: number;
  radius: number;
  omega: number;
  phi: number;
  /** Speed modulation: amplitude, rate, phase. */
  modA: number;
  modB: number;
  modP: number;
  scale: number;
  tint: number;
  /** Gait phase (cycles), integrated each frame. */
  gait: number;
  heading: number;
  /** Height above ground (flyers), m. */
  fly: number;
}

export interface Herd {
  key: string;
  species: SpeciesRow;
  lat: number;
  lon: number;
  members: Member[];
}

/** Lat/lon cell grid of `cellM` metres: rows by latitude, columns by longitude scaled per row. */
function cellsAround(
  lat: number,
  lon: number,
  radiusM: number,
  cellM: number,
  visit: (row: number, col: number, cLat: number, cLon: number) => void,
) {
  const dLat = cellM / M_PER_DEG;
  const r0 = Math.floor((lat - radiusM / M_PER_DEG) / dLat);
  const r1 = Math.floor((lat + radiusM / M_PER_DEG) / dLat);
  for (let row = r0; row <= r1; row++) {
    const cLat = (row + 0.5) * dLat;
    const dLon = dLat / Math.max(0.05, Math.cos((cLat * Math.PI) / 180));
    const spanLon = radiusM / (M_PER_DEG * Math.max(0.05, Math.cos((cLat * Math.PI) / 180)));
    const c0 = Math.floor((lon - spanLon) / dLon);
    const c1 = Math.floor((lon + spanLon) / dLon);
    for (let col = c0; col <= c1; col++) visit(row, col, cLat, (col + 0.5) * dLon);
  }
}

/** Local east/north metres of (lat, lon) from (lat0, lon0). */
export function localEN(lat0: number, lon0: number, lat: number, lon: number): [number, number] {
  let dl = lon - lon0;
  if (dl > 180) dl -= 360;
  if (dl < -180) dl += 360;
  return [dl * M_PER_DEG * Math.cos((lat0 * Math.PI) / 180), (lat - lat0) * M_PER_DEG];
}

/** Biome at a point, or null (sea, ice). */
export function biomeAt(climate: Climate, lat: number, lon: number): Biome | null {
  const c = climate.at(lat, lon);
  return biomeOf(c.kind, c.tempC, c.moisture);
}

/** Plants of one cell (deterministic). */
export function plantsInCell(
  row: number,
  col: number,
  cLat: number,
  cLon: number,
  era: number,
  ageMa: number,
  climate: Climate,
): Plant[] {
  const biome = biomeAt(climate, cLat, cLon);
  if (!biome) return [];
  const mix = floraFor(ageMa, biome);
  if (!mix) return [];
  const area = PLANT_CELL_M * PLANT_CELL_M;
  // Patchiness: a slowly varying factor so forests have glades and deserts have oases of shrubs.
  const patch = 0.35 + 1.3 * hash01(Math.floor(row / 6), Math.floor(col / 6), era, 7);
  const n = Math.floor((mix.density * area * patch) / 100 + hash01(row, col, era, 1));
  const dLat = PLANT_CELL_M / M_PER_DEG;
  const dLon = dLat / Math.max(0.05, Math.cos((cLat * Math.PI) / 180));
  const out: Plant[] = [];
  for (let i = 0; i < n; i++) {
    const kind = mix.kinds[pick(mix.cumulative, hash01(row, col, era, i, 2))];
    out.push({
      kind,
      lat: cLat + (hash01(row, col, i, 3) - 0.5) * dLat,
      lon: cLon + (hash01(row, col, i, 4) - 0.5) * dLon,
      heading: 2 * Math.PI * hash01(row, col, i, 5),
      scale: 0.6 + 0.7 * hash01(row, col, i, 6),
      tint: hash01(row, col, i, 8),
    });
  }
  return out;
}

/** Plants within the limits around (lat, lon), nearest first, capped. */
export function plantsAround(
  lat: number,
  lon: number,
  era: number,
  ageMa: number,
  climate: Climate,
  lim: LifeLimits,
  cache: Map<string, Plant[]>,
): Plant[] {
  const out: { p: Plant; d: number }[] = [];
  cellsAround(lat, lon, lim.treeRadius, PLANT_CELL_M, (row, col, cLat, cLon) => {
    const key = `${row},${col},${era}`;
    let list = cache.get(key);
    if (!list) {
      list = plantsInCell(row, col, cLat, cLon, era, ageMa, climate);
      cache.set(key, list);
    }
    for (const p of list) {
      const [e, n] = localEN(lat, lon, p.lat, p.lon);
      const d = Math.hypot(e, n);
      const tall = PLANTS[p.kind].height > 3;
      if (d <= (tall ? lim.treeRadius : lim.tuftRadius)) out.push({ p, d });
    }
  });
  if (cache.size > 6000) cache.clear();
  out.sort((a, b) => a.d - b.d);
  return out.slice(0, lim.maxPlants).map((x) => x.p);
}

/** Guild odds of a herd cell holding a herd of that guild. */
const GUILD_ODDS: Record<string, number> = {
  grazer: 0.55,
  predator: 0.18,
  flyer: 0.2,
  ape: 0.35,
  hominin: 0.3,
  domestic: 0.3,
};

/** Members of a herd of `count` around its centre (deterministic in row/col). */
export function makeMembers(
  s: SpeciesRow,
  count: number,
  row: number,
  col: number,
  spreadScale = 1,
  loopScale = 1,
): Member[] {
  const model = MODELS[s.model];
  const size = model.spec.bodyLen + model.spec.tailLen + model.spec.neckLen + model.spec.headLen + 1;
  const spread = Math.max(6, 1.4 * size * Math.sqrt(count)) * spreadScale;
  const fly = model.gait.kind === 'fly';
  const members: Member[] = [];
  for (let i = 0; i < count; i++) {
    const a = 2 * Math.PI * hash01(row, col, i, 17);
    const r = spread * Math.sqrt(hash01(row, col, i, 18));
    const loop = fly
      ? 70 + 120 * hash01(row, col, i, 19)
      : Math.max(3, size * (1 + 2.5 * hash01(row, col, i, 19)) * loopScale);
    const speed = model.gait.speed * (fly ? 1 : 0.55);
    members.push({
      homeE: Math.cos(a) * r,
      homeN: Math.sin(a) * r,
      radius: loop,
      omega: (speed / loop) * (hash01(row, col, i, 20) < 0.5 ? 1 : -1),
      phi: 2 * Math.PI * hash01(row, col, i, 21),
      modA: fly ? 0 : 0.6 + 0.38 * hash01(row, col, i, 22),
      modB: 0.05 + 0.12 * hash01(row, col, i, 23),
      modP: 2 * Math.PI * hash01(row, col, i, 24),
      scale: 0.85 + 0.25 * hash01(row, col, i, 25),
      tint: hash01(row, col, i, 26),
      gait: hash01(row, col, i, 27),
      heading: 0,
      fly: fly ? 25 + 45 * hash01(row, col, i, 28) : 0,
    });
  }
  return members;
}

/** A herd placed by hand (bookmarks): its species at a place and age. */
export interface Featured {
  id: string;
  species: string;
  lat: number;
  lon: number;
  ageMa: number;
  count: number;
  /** Herd spread factor (1 = natural). */
  spread?: number;
}

/** The herd of one cell, or null (deterministic). */
export function herdInCell(
  row: number,
  col: number,
  cLat: number,
  cLon: number,
  era: number,
  climate: Climate,
  cands: (lat: number, lon: number, biome: Biome) => Candidate[],
): Herd | null {
  const dLat = HERD_CELL_M / M_PER_DEG;
  const dLon = dLat / Math.max(0.05, Math.cos((cLat * Math.PI) / 180));
  const lat = cLat + (hash01(row, col, era, 11) - 0.5) * 0.6 * dLat;
  const lon = cLon + (hash01(row, col, era, 12) - 0.5) * 0.6 * dLon;
  const biome = biomeAt(climate, lat, lon);
  if (!biome) return null;
  const list = cands(lat, lon, biome);
  if (!list.length) return null;
  // Pick a guild present here, then a species of that guild by weight.
  const guilds = [...new Set(list.map((c) => c.species.guild))];
  const g = guilds[Math.floor(hash01(row, col, era, 13) * guilds.length)];
  if (hash01(row, col, era, 14) > (GUILD_ODDS[g] ?? 0.3)) return null;
  const inGuild = list.filter((c) => c.species.guild === g);
  const total = inGuild.reduce((s, c) => s + c.weight, 0);
  let u = hash01(row, col, era, 15) * total;
  let chosen = inGuild[0];
  for (const c of inGuild) {
    if ((u -= c.weight) <= 0) {
      chosen = c;
      break;
    }
  }
  const s = chosen.species;
  if (!MODELS[s.model]) return null;
  const [lo, hi] = s.herd;
  const count = lo + Math.floor(hash01(row, col, era, 16) * (hi - lo + 1));
  const members = makeMembers(s, count, row, col);
  return { key: `${row},${col},${era}`, species: s, lat, lon, members };
}

/** Herds within the herd radius (cached per cell). */
export function herdsAround(
  lat: number,
  lon: number,
  era: number,
  ageMa: number,
  climate: Climate,
  occ: Occurrences | null,
  lim: LifeLimits,
  cache: Map<string, Herd | null>,
  candCache: Map<string, Candidate[]>,
  featured: readonly Featured[] = [],
  eraOf: (ageMa: number) => number = () => era,
): Herd[] {
  const cands = (la: number, lo: number, biome: Biome) => {
    // Candidates change slowly in space: cache them per 0.25 degree and biome.
    const key = `${Math.round(la * 4)},${Math.round(lo * 4)},${biome},${era}`;
    let c = candCache.get(key);
    if (!c) {
      c = candidates(occ, la, lo, ageMa, biome);
      candCache.set(key, c);
      if (candCache.size > 200) candCache.delete(candCache.keys().next().value!);
    }
    return c;
  };
  const out: Herd[] = [];
  cellsAround(lat, lon, lim.herdRadius, HERD_CELL_M, (row, col, cLat, cLon) => {
    const key = `${row},${col},${era}`;
    let h = cache.get(key);
    if (h === undefined) {
      h = herdInCell(row, col, cLat, cLon, era, climate, cands);
      cache.set(key, h);
    }
    if (h) out.push(h);
  });
  if (cache.size > 2000) cache.clear();
  for (const f of featured) {
    if (Math.abs(eraOf(f.ageMa) - era) > 2) continue;
    const [e, n] = localEN(lat, lon, f.lat, f.lon);
    if (Math.hypot(e, n) > lim.herdRadius) continue;
    const key = `featured:${f.id}`;
    let h = cache.get(key);
    if (!h) {
      const sp = SPECIES.find((x) => x.id === f.species);
      if (!sp || !MODELS[sp.model]) continue;
      h = {
        key,
        species: sp,
        lat: f.lat,
        lon: f.lon,
        members: makeMembers(sp, f.count, 7919, f.id.length * 31, f.spread ?? 0.6, 0.3),
      };
      cache.set(key, h);
    }
    out.push(h);
  }
  return out;
}

/** Position (east, north from the herd centre, m), velocity (m/s) of a member at real time t. */
export function memberAt(m: Member, t: number, out: { e: number; n: number; ve: number; vn: number }) {
  const s = 1 + m.modA * Math.cos(m.modB * t + m.modP);
  const theta =
    m.phi + m.omega * (t + (m.modA / m.modB) * (Math.sin(m.modB * t + m.modP) - Math.sin(m.modP)));
  const dTheta = m.omega * s;
  // An ellipse (0.6 aspect) so paths are not perfect circles.
  out.e = m.homeE + m.radius * Math.cos(theta);
  out.n = m.homeN + 0.6 * m.radius * Math.sin(theta);
  out.ve = -m.radius * Math.sin(theta) * dTheta;
  out.vn = 0.6 * m.radius * Math.cos(theta) * dTheta;
  return out;
}
