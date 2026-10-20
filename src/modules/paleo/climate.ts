/**
 * Time-dependent inputs of the deep-time Earth (pure, three-free): which PaleoDEM maps bracket an
 * age, global sea level in the ice ages, global mean temperature, vegetation stage, and how much of
 * each look (modern imagery, ice-age overlay, synthetic paleo surface) applies. Numbers come from
 * public/data/paleo/index.json (sources there); approximate.
 */

export interface BiomeRow {
  id: string;
  /** sRGB 0-255 sampled from the Blue Marble day map. */
  srgb: [number, number, number];
  source: string;
}

export interface PaleoIndex {
  dem: {
    path: string;
    width: number;
    height: number;
    ages: number[];
    elevationScaleM: number;
    source: string;
  };
  quaternary: { path: string; landFill: string; width: number; height: number; source: string };
  biomes: BiomeRow[];
  /** Today's effective moisture per land cell (the moisture fit's target). */
  moisture: { path: string; classes: Record<string, number>; source: string };
  climate: { rows: { ageMa: number; gmstC: number; stage: string }[]; source: string };
  vegetation: { id: string; ageMa: number; source: string }[];
  seaLevel: { stepKa: number; metres: number[]; source: string };
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Ice-age overlay (sea level, ice sheets) fades in from the Holocene sea-level rise on. */
export const QUATERNARY_START_YEARS = 7000;
/** The synthetic paleo surface replaces modern imagery between these ages (years BP). */
export const SYNTHETIC_FROM_YEARS = 2.6e6;
export const SYNTHETIC_FULL_YEARS = 5e6;

export interface Regime {
  /** 0 modern imagery .. 1 synthetic paleo surface. */
  synthetic: number;
  /** Global sea-level drop below today, m (>= 0); drives exposed shelves and ice-age ice. */
  seaDropM: number;
  /** Weight of the ice-age overlay (0 outside 7 ka - 3 Ma). */
  quaternary: number;
}

/** Look at an age in years before 1950. */
export function regimeAt(index: Pick<PaleoIndex, 'seaLevel'>, yearsBP: number): Regime {
  if (!(yearsBP > 0)) return { synthetic: 0, seaDropM: 0, quaternary: 0 };
  const synthetic = smooth(SYNTHETIC_FROM_YEARS, SYNTHETIC_FULL_YEARS, yearsBP);
  const quaternary = smooth(QUATERNARY_START_YEARS * 0.5, QUATERNARY_START_YEARS, yearsBP) * (1 - synthetic);
  return { synthetic, quaternary, seaDropM: quaternary > 0 ? Math.max(0, -seaLevelAt(index, yearsBP)) : 0 };
}

/** Global sea level relative to today, m (0 before 3 Ma and in the future). */
export function seaLevelAt(index: Pick<PaleoIndex, 'seaLevel'>, yearsBP: number): number {
  const { stepKa, metres } = index.seaLevel;
  const f = yearsBP / 1000 / stepKa;
  if (!(f > 0) || f >= metres.length - 1) return 0;
  const i = Math.floor(f);
  return metres[i] + (metres[i + 1] - metres[i]) * (f - i);
}

/** Global mean surface temperature, deg C (stage medians, linear between stage mid-points, held at the ends). */
export function gmstAt(index: Pick<PaleoIndex, 'climate'>, ageMa: number): number {
  const rows = index.climate.rows;
  if (ageMa <= rows[0].ageMa) return rows[0].gmstC;
  for (let i = 1; i < rows.length; i++) {
    const b = rows[i];
    if (ageMa <= b.ageMa) {
      const a = rows[i - 1];
      return a.gmstC + ((b.gmstC - a.gmstC) * (ageMa - a.ageMa)) / (b.ageMa - a.ageMa);
    }
  }
  return rows[rows.length - 1].gmstC;
}

export interface Vegetation {
  /** Any land plants (0 bare rock before ~470 Ma). */
  plants: number;
  /** Forests (from ~385 Ma). */
  forests: number;
  /** Grasslands (from ~20 Ma; before, dry land is shrub). */
  grass: number;
}

/** Vegetation stage at an age, each fading over 10 Myr around its index.json age. */
export function vegetationAt(index: Pick<PaleoIndex, 'vegetation'>, ageMa: number): Vegetation {
  const age = (id: string) => index.vegetation.find((v) => v.id === id)?.ageMa ?? 0;
  const present = (a: number) => 1 - smooth(a - 5, a + 5, ageMa);
  return {
    plants: present(age('land-plants')),
    forests: present(age('forests')),
    grass: present(age('grasslands')),
  };
}

export interface Bracket {
  /** Older and younger map ages around the age (equal beyond the ends). */
  a: number;
  b: number;
  /** Weight of `b` (0..1). */
  w: number;
}

/** PaleoDEM maps around an age (Ma); ages beyond the oldest map hold it. */
export function bracketAges(ages: readonly number[], ageMa: number): Bracket {
  if (ageMa <= ages[0]) return { a: ages[0], b: ages[0], w: 0 };
  for (let i = 1; i < ages.length; i++) {
    if (ageMa <= ages[i]) {
      const a = ages[i - 1];
      return { a, b: ages[i], w: (ageMa - a) / (ages[i] - a) };
    }
  }
  const last = ages[ages.length - 1];
  return { a: last, b: last, w: 0 };
}
