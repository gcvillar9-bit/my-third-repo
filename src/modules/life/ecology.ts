/**
 * Ecology of the life module, pure functions: biome from the paleo climate map, plant mixes by era
 * (flora.json), and where and when a species lived (species.json with PBDB occurrences or hand-entered
 * regions). All approximate by design.
 */
import flora from './flora.json';
import speciesData from './species.json';
import type { PlantKind } from './kit/plants';
import { SURFACE } from '../paleo/public';

export type Biome =
  'rainforest' | 'forest' | 'taiga' | 'savanna' | 'grassland' | 'steppe' | 'desert' | 'tundra';
export type Guild = 'grazer' | 'predator' | 'flyer' | 'ape' | 'hominin' | 'domestic';

export interface SpeciesRow {
  id: string;
  name: string;
  model: string;
  guild: Guild | string;
  firstMa: number;
  lastMa: number;
  habitats: string[];
  herd: number[];
  weight: number;
  pbdb?: string;
  regions?: number[][];
  source: string;
}

export const SPECIES: SpeciesRow[] = speciesData.species as SpeciesRow[];

/** occurrences.json (tools/build-life.mjs): per species [lat, lon, paleoLat, paleoLon, maxMa, minMa]. */
export interface Occurrences {
  species: Record<string, number[][]>;
}

/** Biome of a land (or exposed shelf) cell from the paleo climate map, or null for sea and ice. */
export function biomeOf(kind: number, tempC: number, moisture: number): Biome | null {
  if (kind !== SURFACE.land && kind !== SURFACE.shelf) return null;
  if (tempC < -3) return 'tundra';
  if (moisture < 0.14) return 'desert';
  if (moisture < 0.26) return tempC < 2 ? 'tundra' : 'steppe';
  if (moisture < 0.4) return tempC > 17 ? 'savanna' : 'grassland';
  if (tempC > 19) return 'rainforest';
  if (tempC < 4) return 'taiga';
  return 'forest';
}

export interface FloraMix {
  /** Plants per 100 m2. */
  density: number;
  kinds: PlantKind[];
  /** Cumulative weights 0..1, same order as kinds. */
  cumulative: number[];
}

/** Plant mix at an age and biome; null before land plants (older than 470 Ma) or for no plants. */
export function floraFor(ageMa: number, biome: Biome): FloraMix | null {
  const era = flora.eras.find((e) => ageMa <= e.fromMa && ageMa >= e.toMa);
  if (!era) return null;
  const mix = (era.mix as unknown as Record<string, [string, number][]>)[biome];
  if (!mix?.length) return null;
  const total = mix.reduce((s, [, w]) => s + w, 0);
  let acc = 0;
  const cumulative = mix.map(([, w]) => (acc += w / total));
  return {
    density: (flora.density as Record<string, number>)[biome] ?? 1,
    kinds: mix.map(([k]) => k as PlantKind),
    cumulative,
  };
}

/** Index into a cumulative weight list for u in [0, 1). */
export function pick(cumulative: readonly number[], u: number): number {
  for (let i = 0; i < cumulative.length; i++) if (u < cumulative[i]) return i;
  return cumulative.length - 1;
}

const DEG = Math.PI / 180;
/** Great-circle distance, km. */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const s1 = Math.sin(((lat2 - lat1) * DEG) / 2);
  const s2 = Math.sin(((lon2 - lon1) * DEG) / 2);
  const h = s1 * s1 + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * s2 * s2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The visual surface is today's map below this age (paleo SYNTHETIC_FROM_YEARS). */
export const MODERN_BELOW_MA = 2.6;
/** A species ranges this far from a find of its time (fossil sites are sparse). */
export const RANGE_KM = 1800;

/**
 * Time slack of a find: its interval is widened by 15% of the age below 2.6 Ma (at least 2 kyr) and by
 * 10% in deep time (at least 1 Myr). It only matches finds; a species' own range is never widened.
 */
function slackMa(ageMa: number): number {
  return ageMa < MODERN_BELOW_MA ? Math.max(0.002, 0.15 * ageMa) : Math.max(1, 0.1 * ageMa);
}

/**
 * Presence weight 0..1 of a species at a place (latitude/longitude on the globe as drawn: paleo-
 * coordinates from 2.6 Ma, modern below) and age: 0 outside its own time range (lastMa..firstMa, never
 * widened); 1 inside a hand-entered region; else falls off with the distance to the nearest find of
 * about that age.
 */
export function presence(
  s: SpeciesRow,
  occ: Occurrences | null,
  latDeg: number,
  lonDeg: number,
  ageMa: number,
): number {
  if (ageMa > s.firstMa || ageMa < s.lastMa) return 0;
  if (s.regions) {
    for (const [la0, la1, lo0, lo1, from, to] of s.regions)
      if (ageMa <= from && ageMa >= to && latDeg >= la0 && latDeg <= la1 && lonDeg >= lo0 && lonDeg <= lo1)
        return 1;
    return 0;
  }
  const cells = occ?.species[s.id];
  if (!cells) return 0;
  const slack = slackMa(ageMa);
  const modern = ageMa < MODERN_BELOW_MA;
  let best = Infinity;
  for (const c of cells) {
    if (ageMa > c[4] + slack || ageMa < c[5] - slack) continue;
    const d = modern ? distanceKm(latDeg, lonDeg, c[0], c[1]) : distanceKm(latDeg, lonDeg, c[2], c[3]);
    if (d < best) best = d;
  }
  if (best > RANGE_KM) return 0;
  return Math.exp(-((best / (0.6 * RANGE_KM)) ** 2));
}

/** Habitat match 0..1. */
export function habitat(s: SpeciesRow, biome: Biome): number {
  return s.habitats.includes(biome) ? 1 : 0;
}

export interface Candidate {
  species: SpeciesRow;
  weight: number;
}

/** Species that can live here and now, with selection weights (presence x habitat x abundance). */
export function candidates(
  occ: Occurrences | null,
  latDeg: number,
  lonDeg: number,
  ageMa: number,
  biome: Biome,
): Candidate[] {
  const out: Candidate[] = [];
  for (const s of SPECIES) {
    const h = habitat(s, biome);
    if (!h) continue;
    const p = presence(s, occ, latDeg, lonDeg, ageMa);
    if (p > 0.02) out.push({ species: s, weight: p * h * s.weight });
  }
  return out;
}
