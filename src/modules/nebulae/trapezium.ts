/**
 * The Trapezium (θ¹ Ori A-E), θ² Ori A and NU Ori as promoted stars at 400 pc (starsystems promoteCustom).
 * HYG has θ¹ Ori A, C and D at its 100 kpc no-parallax placeholder, θ² Ori A at 474 pc and NU Ori at 444 pc, and
 * lacks θ¹ Ori B and E. Every star is placed at the nebula's distance along its catalogue direction with
 * absMag = V - μ(400 pc), so the view from Earth keeps its position and V magnitude; the HYG duplicate is hidden.
 */
import type { Vec3d } from '../../core/contracts';
import { R_SUN } from '../../core/units';
import type { StarCatalog } from '../stars/public';
import type { CustomStar } from '../starsystems/public';
import { D_PC } from './model';
import orion from './orion.json';

export type NebulaStarRow = (typeof orion.stars)[number];
export const NEBULA_STARS: readonly NebulaStarRow[] = orion.stars;

/** Label priorities of the promoted stars (θ¹ Ori C, the others). */
export const LABEL_PRIORITY_MAIN = 19;
export const LABEL_PRIORITY = 17;

/** Distance modulus of the nebula, mag (8.01 at 400 pc). */
export const DISTANCE_MODULUS = 5 * Math.log10(D_PC) - 5;
/** Absolute V magnitude of a star of apparent V at the nebula's distance. */
export const absMagAtNebula = (v: number): number => v - DISTANCE_MODULUS;

const DEG = Math.PI / 180;

/** Sun-centred ICRS unit vector of (ra, dec) in degrees. */
export function unitIcrs(raDeg: number, decDeg: number): Vec3d {
  const a = raDeg * DEG;
  const d = decDeg * DEG;
  return { x: Math.cos(d) * Math.cos(a), y: Math.cos(d) * Math.sin(a), z: Math.sin(d) };
}

/** Body id of a nebula star row. */
export const starBodyId = (row: NebulaStarRow): string => `neb-${row.id}`;

/**
 * HYG index of the catalogue star matching a row: its HIP id if HYG names it, else the brightest star within
 * `tolArcsec` of the position; -1 when none.
 */
export function findHygIndex(cat: StarCatalog, row: NebulaStarRow, tolArcsec = 4): number {
  if (row.hip !== null) {
    const i = cat.findByHip(row.hip);
    if (i >= 0) return i;
  }
  const u = unitIcrs(row.raDeg, row.decDeg);
  const cosTol = Math.cos((tolArcsec / 3600) * DEG);
  const p = { x: 0, y: 0, z: 0 };
  let best = -1;
  let bestMag = Infinity;
  for (let i = 0; i < cat.count; i++) {
    cat.positionPc(i, 0, p);
    const r = Math.hypot(p.x, p.y, p.z);
    if (r <= 0) continue;
    if ((p.x * u.x + p.y * u.y + p.z * u.z) / r < cosTol) continue;
    const m = cat.data.absMag[i] + 5 * Math.log10(r) - 5;
    if (m < bestMag) {
      bestMag = m;
      best = i;
    }
  }
  return best;
}

/** The promoted star of a row at the nebula's distance. */
export function customStar(row: NebulaStarRow, hygIndex: number): CustomStar {
  const u = unitIcrs(row.raDeg, row.decDeg);
  return {
    id: starBodyId(row),
    name: row.name,
    teff: row.teff,
    radius: row.radiusRsun * R_SUN,
    absMag: absMagAtNebula(row.v),
    massMsun: row.massMsun,
    positionPc: { x: u.x * D_PC, y: u.y * D_PC, z: u.z * D_PC },
    source: row.source,
    hygIndex,
    bv: row.bv,
    // Held for the whole session, so seen from Earth these labels must yield to the bright named stars
    // (stars.labels: priority 30 - 4 m, i.e. above 20 down to m 2.5).
    labelPriority: row.id === 'theta1-ori-c' ? LABEL_PRIORITY_MAIN : LABEL_PRIORITY,
    // ui.ts has a sourced card for every nebula star (θ¹ Ori B and E have no HYG row to fall back on).
    ownInfo: true,
  };
}
