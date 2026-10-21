/**
 * Who stands where: plants in small cells and herds in larger cells around the camera, generated
 * deterministically from a hash of the cell and the era (the same place and date always shows the same
 * scene), and creature motion along smooth loops around their homes (real time, so warping the clock
 * does not make animals race). Positions are in the anchor's local frame: east and north in metres
 * from the anchor's ground point; the ground height comes from an injected function.
 */
import { hash01 } from './kit/mesh';
import { MODELS } from './kit/models';
import { BUILDINGS, type BuildingKind } from './kit/buildings';
import { PLANTS, type PlantKind } from './kit/plants';
import {
  SPECIES,
  biomeOf,
  candidates,
  floraFor,
  livedAt,
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
  /** Radius of town buildings (landmarks 4x), m. */
  buildingRadius: number;
  maxBuildings: number;
}

export const PLANT_CELL_M = 24;
export const HERD_CELL_M = 240;

/**
 * Plant cells kept: about 3 picks at the preset's tree radius (a pick visits at most n x n cells, n the
 * cells across the tree diameter plus 2: 768 kept at potato, 14,283 at ultra), so moving around reuses
 * the cells it passed. The least recently used go first, never the current pick's.
 */
export function plantCacheMax(lim: LifeLimits): number {
  const n = Math.ceil((2 * lim.treeRadius) / PLANT_CELL_M) + 2;
  return 3 * n * n;
}

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

/** Columns of the cell row at latitude cLat: a whole number of about `cellM` metres, so rows wrap. */
function rowCols(cLat: number, cellM: number): number {
  const dLon = cellM / (M_PER_DEG * Math.max(0.05, Math.cos((cLat * Math.PI) / 180)));
  return Math.max(1, Math.round(360 / dLon));
}

/**
 * Lat/lon cell grid of `cellM` metres: rows by latitude, columns by longitude scaled per row. Columns
 * divide each row evenly and wrap at the antimeridian, so both sides of it see the same cells (cell
 * centres in -180..180).
 */
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
    const cols = rowCols(cLat, cellM);
    const dLon = 360 / cols;
    const spanLon = radiusM / (M_PER_DEG * Math.max(0.05, Math.cos((cLat * Math.PI) / 180)));
    const c0 = Math.floor((lon - spanLon) / dLon);
    const c1 = Math.min(Math.floor((lon + spanLon) / dLon), c0 + cols - 1);
    for (let c = c0; c <= c1; c++) {
      const col = ((c % cols) + cols) % cols;
      const cLon = (col + 0.5) * dLon;
      visit(row, col, cLat, cLon < 180 ? cLon : cLon - 360);
    }
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
  const dLon = 360 / rowCols(cLat, PLANT_CELL_M);
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
  // Ground cover: extra small plants of the mix (grass, ferns, mosses, shrubs) at twice the density;
  // they are only drawn near the camera (tuftRadius).
  const tuftIdx = mix.kinds.map((k, i) => (PLANTS[k].height < 2 ? i : -1)).filter((i) => i >= 0);
  if (tuftIdx.length) {
    const nt = Math.floor((2 * mix.density * area * patch) / 100 + hash01(row, col, era, 9));
    for (let i = 0; i < nt; i++) {
      const kind = mix.kinds[tuftIdx[Math.floor(hash01(row, col, era, i, 10) * tuftIdx.length)]];
      out.push({
        kind,
        lat: cLat + (hash01(row, col, i, 11) - 0.5) * dLat,
        lon: cLon + (hash01(row, col, i, 12) - 0.5) * dLon,
        heading: 2 * Math.PI * hash01(row, col, i, 13),
        scale: 0.5 + 0.7 * hash01(row, col, i, 14),
        tint: hash01(row, col, i, 15),
      });
    }
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
  townOf?: TownOf,
): Plant[] {
  const out: { p: Plant; d: number }[] = [];
  cellsAround(lat, lon, lim.treeRadius, PLANT_CELL_M, (row, col, cLat, cLon) => {
    const key = `${row},${col},${era}`;
    let list = cache.get(key);
    // A hit moves the cell to the end of the Map's order, so the order is least recently used first.
    if (list) cache.delete(key);
    else list = plantsInCell(row, col, cLat, cLon, era, ageMa, climate);
    cache.set(key, list);
    for (const p of list) {
      const [e, n] = localEN(lat, lon, p.lat, p.lon);
      const d = Math.hypot(e, n);
      const tall = PLANTS[p.kind].height > 3;
      if (d > (tall ? lim.treeRadius : lim.tuftRadius)) continue;
      // Built-up land has no wild plants (a few trees in courtyards).
      const t = townOf?.(p.lat, p.lon);
      if (t && t.r < 0.95 && (!tall || p.tint > 0.03)) continue;
      out.push({ p, d });
    }
  });
  const max = plantCacheMax(lim);
  for (const k of cache.keys()) {
    if (cache.size <= max) break;
    cache.delete(k);
  }
  out.sort((a, b) => a.d - b.d);
  return out.slice(0, lim.maxPlants).map((x) => x.p);
}

/** People in the streets of a town (not a range species: placed by the cities module's towns). */
export const TOWNSFOLK: SpeciesRow = {
  id: 'townsfolk',
  name: 'Townspeople',
  model: 'townsfolk',
  guild: 'people',
  firstMa: 0.0092,
  lastMa: 0,
  habitats: [],
  herd: [3, 9],
  weight: 1,
  source: 'Towns from the cities module',
};
export const MODERN_PEOPLE: SpeciesRow = {
  ...TOWNSFOLK,
  id: 'people',
  name: 'People',
  model: 'modernPerson',
};
/** Farmers and herders: Homo sapiens after the spread of farming wear the townsfolk's clothes. */
export const RURAL_PEOPLE: SpeciesRow = { ...TOWNSFOLK, id: 'rural', name: 'People (farmers and herders)' };
/** Hunter-gatherer dress until about 6000 BC (approximate; farming spread unevenly). */
export const FARMING_FROM_MA = 0.008;

/** Town lookup: the nearest town and the distance in town radii. */
export type TownOf = (lat: number, lon: number) => { town: Town; r: number } | null;

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
  townOf?: TownOf,
): Herd | null {
  const dLat = HERD_CELL_M / M_PER_DEG;
  const dLon = 360 / rowCols(cLat, HERD_CELL_M);
  const lat = cLat + (hash01(row, col, era, 11) - 0.5) * 0.6 * dLat;
  const lon = cLon + (hash01(row, col, era, 12) - 0.5) * 0.6 * dLon;
  const biome = biomeAt(climate, lat, lon);
  if (!biome) return null;
  const town = townOf?.(lat, lon);
  if (town && town.r < 1) {
    // Streets: people instead of wild animals.
    const modern = town.town.style === 'modern' || town.town.style === 'industrial';
    const s = modern ? MODERN_PEOPLE : TOWNSFOLK;
    const count = 3 + Math.floor(hash01(row, col, era, 16) * 7);
    return {
      key: `${row},${col},${era}`,
      species: s,
      lat,
      lon,
      members: makeMembers(s, count, row, col, 1.5, 0.6),
    };
  }
  let list = cands(lat, lon, biome);
  // Farmland around towns: livestock where it lived then, and no wild herds.
  if (town) list = list.filter((c) => c.species.guild === 'domestic' || c.species.guild === 'flyer');
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
  townOf?: TownOf,
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
      h = herdInCell(row, col, cLat, cLon, era, climate, cands, townOf);
      if (h && h.species.id === 'sapiens' && ageMa < FARMING_FROM_MA) h = { ...h, species: RURAL_PEOPLE };
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
    // Only while the species lived (the era window reaches about 5% of the age either side): a bookmark
    // set just before the K-Pg or the end-Permian loses the herds of the species that died out there.
    if (!livedAt(h.species, ageMa)) continue;
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

// ---------------------------------------------------------------------------------------------
// Settlements (cities module data): buildings by style, walls, monuments; townsfolk in the streets.
// ---------------------------------------------------------------------------------------------

/** A city as the cities module reports it (cities/public.ts City). */
export interface Town {
  id: string;
  name: string;
  lat: number;
  lon: number;
  pop: number;
  style: string;
  radiusM: number;
}

export interface Landmark {
  name: string;
  kind: string;
  lat: number;
  lon: number;
  scale: number;
}

export interface Building {
  kind: BuildingKind;
  lat: number;
  lon: number;
  heading: number;
  scale: number;
  seed: number;
}

export const BUILDING_CELL_M = 22;

/** House mixes [kind, weight] per style. */
const HOUSES: Record<string, [BuildingKind, number][]> = {
  mesopotamian: [
    ['mudHouse', 3],
    ['mudHouse2', 2],
  ],
  egyptian: [
    ['mudHouse', 3],
    ['flatHouse', 2],
    ['mudHouse2', 1],
  ],
  indus: [
    ['brickHouse', 4],
    ['mudHouse2', 1],
  ],
  chinese: [
    ['courtyardHouse', 4],
    ['woodHouse', 2],
  ],
  classical: [
    ['stoneHouse', 4],
    ['insula', 2],
  ],
  persian: [
    ['mudHouse', 2],
    ['flatHouse', 2],
    ['mudHouse2', 1],
  ],
  'medieval-european': [
    ['timberHouse', 4],
    ['stoneHouseMed', 2],
  ],
  islamic: [
    ['flatHouse', 5],
    ['mudHouse2', 1],
  ],
  indian: [
    ['flatHouse', 3],
    ['brickHouse', 2],
  ],
  japanese: [['woodHouse', 5]],
  'southeast-asian': [
    ['stiltHouse', 4],
    ['woodHouse', 1],
  ],
  mesoamerican: [
    ['hut', 3],
    ['flatHouse', 2],
  ],
  andean: [
    ['andeanHouse', 4],
    ['hut', 1],
  ],
  african: [
    ['roundHut', 4],
    ['mudHouse', 2],
  ],
  colonial: [
    ['colonialHouse', 4],
    ['flatHouse', 1],
  ],
  industrial: [
    ['terrace', 5],
    ['colonialHouse', 1],
  ],
  modern: [
    ['apartment', 3],
    ['suburbanHouse', 4],
  ],
};

/** Landmarks at the centre per style (in order, the first at the centre). */
const LANDMARKS: Record<string, BuildingKind[]> = {
  mesopotamian: ['ziggurat'],
  egyptian: ['pylonTemple'],
  indus: [],
  chinese: ['palaceHall', 'pagoda'],
  classical: ['temple'],
  persian: ['palaceHall'],
  'medieval-european': ['cathedral', 'keep'],
  islamic: ['mosque'],
  indian: ['shikhara'],
  japanese: ['pagoda', 'castleTiers'],
  'southeast-asian': ['prang'],
  mesoamerican: ['stepPyramid'],
  andean: ['stepPyramid'],
  african: ['mudMosque'],
  colonial: ['baroqueChurch'],
  industrial: ['cathedral', 'factory'],
  modern: ['tower', 'tower', 'tower'],
};

/** Cells per block side (the fifth is the street). */
const BLOCK_CELLS = 5;
/** Buildings wider than a cell: placed on 2 x 2 cell lots. */
const BIG = new Set<BuildingKind>(['tower', 'apartment', 'insula', 'terrace', 'factory']);
/** Open ground between a landmark or monument and the nearest house, m. */
const LANE_M = 6;

/** Radius of a building's footprint at a scale (the circle through its corners), m. */
function reach(kind: BuildingKind, scale = 1): number {
  const [hx, hz] = BUILDINGS[kind].half;
  return Math.hypot(hx, hz) * scale;
}

/** Odds of a tower on a big lot: the core of big modern cities, business districts in megacities. */
function towerOdds(t: Town, r: number): number {
  if (t.style !== 'modern' || t.pop < 1e6) return 0;
  return r < 0.12 ? 0.9 : t.pop > 5e6 && r < 0.4 ? 0.35 : 0;
}

/** The big-lot kind of a block (null: small lots), from the style and distance from the centre. */
function bigLot(t: Town, r: number, u: number): BuildingKind | null {
  switch (t.style) {
    case 'modern':
      return r < 0.55 ? 'tower' : null;
    case 'industrial':
      return r > 0.6 && u < 0.12 ? 'factory' : u < 0.8 ? 'terrace' : null;
    case 'classical':
      return t.pop > 1e5 && r < 0.7 && u < 0.45 ? 'insula' : null;
    default:
      return null;
  }
}

/** Walled towns: styles and periods with city walls. */
const WALLED = new Set([
  'mesopotamian',
  'indus',
  'chinese',
  'classical',
  'persian',
  'medieval-european',
  'islamic',
  'japanese',
]);

const cumul = (mix: [BuildingKind, number][]) => {
  const total = mix.reduce((s, [, w]) => s + w, 0);
  let a = 0;
  return mix.map(([, w]) => (a += w / total));
};

/** Is (lat, lon) inside a town's built-up area (fraction of the radius, < 1 inside)? */
export function townAt(towns: readonly Town[], lat: number, lon: number): { town: Town; r: number } | null {
  let best: { town: Town; r: number } | null = null;
  for (const t of towns) {
    const [e, n] = localEN(t.lat, t.lon, lat, lon);
    const r = Math.hypot(e, n) / t.radiusM;
    if (r < 1.6 && (!best || r < best.r)) best = { town: t, r };
  }
  return best;
}

/** Buildings of the towns and monuments around (lat, lon) (deterministic per town and year). */
export function buildingsAround(
  lat: number,
  lon: number,
  towns: readonly Town[],
  landmarks: readonly Landmark[],
  year: number,
  radiusM: number,
  max: number,
): Building[] {
  const out: { b: Building; d: number }[] = [];
  const push = (b: Building, far = 1) => {
    const d = Math.hypot(...localEN(lat, lon, b.lat, b.lon));
    if (d <= radiusM * far) out.push({ b, d: d / far });
  };
  const cell = BUILDING_CELL_M;
  for (const t of towns) {
    const mix = HOUSES[t.style] ?? HOUSES.modern;
    const cosLat = Math.cos((t.lat * Math.PI) / 180);
    const toLatLon = (e: number, n: number): [number, number] => [
      t.lat + n / M_PER_DEG,
      t.lon + e / (M_PER_DEG * cosLat),
    ];
    const seedT = Math.round(t.lat * 1000) * 7 + Math.round(t.lon * 1000);
    const planned =
      t.style === 'modern' ||
      t.style === 'industrial' ||
      t.style === 'colonial' ||
      t.style === 'classical' ||
      t.style === 'chinese';
    const twist = planned ? 0 : 0.26;
    // Footprints kept clear of houses (east, north, radius with a lane around it): first the monuments
    // in or near the town, which also stand in for the style landmark of their kind.
    const clear: [number, number, number][] = [];
    const real = new Map<string, number>();
    for (const m of landmarks) {
      if (!BUILDINGS[m.kind as BuildingKind]) continue;
      const [e, n] = localEN(t.lat, t.lon, m.lat, m.lon);
      const rr = reach(m.kind as BuildingKind, m.scale) + LANE_M;
      const d = Math.hypot(e, n);
      if (d > t.radiusM + rr) continue;
      clear.push([e, n, rr]);
      if (d <= t.radiusM) real.set(m.kind, (real.get(m.kind) ?? 0) + 1);
    }
    const monuments = clear.length;
    // Landmarks at the centre, unless a monument of that kind stands in town or one is in the way.
    const lms = LANDMARKS[t.style] ?? [];
    lms.forEach((k, i) => {
      if (k === 'tower' && t.pop < 1e6) return;
      const m = BUILDINGS[k];
      const e = i === 0 ? 0 : (i % 2 ? 1 : -1) * (m.half[1] + 40) * Math.ceil(i / 2);
      const n = i === 0 ? 0 : 30 * (i % 3);
      const left = real.get(k) ?? 0;
      if (left > 0) {
        real.set(k, left - 1);
        return;
      }
      const r = reach(k);
      if (clear.some(([x, y, rr], j) => j < monuments && Math.hypot(e - x, n - y) < rr + r)) return;
      const [la, lo] = toLatLon(e, n);
      push({ kind: k, lat: la, lon: lo, heading: Math.PI, scale: 1, seed: seedT + i }, 4);
      clear.push([e, n, r + LANE_M]);
    });
    // Blocks of 4 x 4 cells between streets (every fifth row and column): either 16 small lots or,
    // for apartment blocks, towers, insulae and terraces, 4 big lots of 2 x 2 cells.
    const [ce, cn] = localEN(t.lat, t.lon, lat, lon);
    const span = radiusM + 2 * BLOCK_CELLS * cell;
    const blk = BLOCK_CELLS * cell;
    const b0 = Math.max(Math.floor((ce - span) / blk), Math.floor(-t.radiusM / blk));
    const b1 = Math.min(Math.floor((ce + span) / blk), Math.floor(t.radiusM / blk));
    const c0 = Math.max(Math.floor((cn - span) / blk), Math.floor(-t.radiusM / blk));
    const c1 = Math.min(Math.floor((cn + span) / blk), Math.floor(t.radiusM / blk));
    const small = mix.filter(([k]) => !BIG.has(k));
    const smallCum = cumul(small.length ? small : mix);
    const smallMix = small.length ? small : mix;
    const lot = (i: number, j: number, e: number, n: number, kind: BuildingKind, k: number) => {
      const r = Math.hypot(e, n) / t.radiusM;
      if (r > 1) return;
      if (hash01(seedT, i, j, 3 + k) > 0.92 - 0.5 * r) return;
      const big = BIG.has(kind);
      const scale = big ? 0.9 + 0.1 * hash01(seedT, i, j, 8) : 0.85 + 0.3 * hash01(seedT, i, j, 8);
      const own = reach(kind, scale);
      if (clear.some(([x, y, rr]) => Math.hypot(e - x, n - y) < rr + own)) return;
      const [la, lo] = toLatLon(e, n);
      const quarter = (Math.PI / 2) * Math.floor(hash01(seedT, i, j, 6) * 4);
      push({
        kind,
        lat: la,
        lon: lo,
        heading: big ? quarter - (quarter % Math.PI) : quarter + (hash01(seedT, i, j, 7) - 0.5) * twist,
        scale,
        seed: Math.floor(hash01(seedT, i, j, 9) * 4),
      });
    };
    for (let bi = b0; bi <= b1; bi++)
      for (let bj = c0; bj <= c1; bj++) {
        const ex = (bi * BLOCK_CELLS + 1) * cell; // first lot's west edge (the street is cell 0)
        const nx = (bj * BLOCK_CELLS + 1) * cell;
        const mid = Math.hypot(ex + 2 * cell, nx + 2 * cell) / t.radiusM;
        const bigKind = bigLot(t, mid, hash01(seedT, bi, bj, 11));
        if (bigKind) {
          for (let a = 0; a < 2; a++)
            for (let b = 0; b < 2; b++) {
              const i = bi * BLOCK_CELLS + 1 + 2 * a;
              const j = bj * BLOCK_CELLS + 1 + 2 * b;
              const e = ex + (2 * a + 1) * cell;
              const n = nx + (2 * b + 1) * cell;
              const r = Math.hypot(e, n) / t.radiusM;
              let kind = bigLot(t, r, hash01(seedT, i, j, 12)) ?? bigKind;
              if (kind === 'tower' && hash01(seedT, i, j, 10) > towerOdds(t, r)) kind = 'apartment';
              lot(i, j, e, n, kind, 0);
            }
          continue;
        }
        for (let a = 0; a < 4; a++)
          for (let b = 0; b < 4; b++) {
            const i = bi * BLOCK_CELLS + 1 + a;
            const j = bj * BLOCK_CELLS + 1 + b;
            const e = ex + (a + 0.5) * cell + (planned ? 0 : (hash01(seedT, i, j, 1) - 0.5) * 5);
            const n = nx + (b + 0.5) * cell + (planned ? 0 : (hash01(seedT, i, j, 2) - 0.5) * 5);
            let kind = smallMix[pick(smallCum, hash01(seedT, i, j, 4))][0];
            if (t.style === 'modern') kind = 'suburbanHouse';
            lot(i, j, e, n, kind, 0);
          }
      }
    // Walls on a ring at the edge (pre-modern towns of more than 3000 people), with a gate on each of
    // the four main streets (the cells at 0..22 m east and north). The ring is centred where those
    // streets cross and pushed out by as much, so it keeps 2% of the radius clear of the lots.
    if (WALLED.has(t.style) && year < 1800 && t.pop > 3000) {
      const mid = cell / 2;
      const R = t.radiusM * 1.02 + mid * Math.SQRT2;
      // Segments are 24 m with a tower 4 m past their clockwise end. A multiple of 4 segments 25-27 m
      // apart puts one on each street; leaving it out opens 2 x step - 28 m (22-26 m), and turning the
      // ring back 2 m centres that opening on the street.
      const n = 4 * Math.max(3, Math.round((2 * Math.PI * R) / 104));
      for (let k = 0; k < n; k++) {
        if (k % (n / 4) === 0) continue;
        const a = (2 * Math.PI * k) / n - 2 / R;
        const [la, lo] = toLatLon(mid + Math.sin(a) * R, mid + Math.cos(a) * R);
        push({ kind: 'wall', lat: la, lon: lo, heading: a, scale: 1, seed: k });
      }
    }
  }
  // Monuments are always kept (they are few and large).
  for (const m of landmarks)
    out.push({
      b: { kind: m.kind as BuildingKind, lat: m.lat, lon: m.lon, heading: Math.PI, scale: m.scale, seed: 0 },
      d: 0,
    });
  out.sort((a, b) => a.d - b.d);
  return out.slice(0, max).map((x) => x.b);
}
