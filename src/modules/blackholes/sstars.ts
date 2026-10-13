/**
 * S-star orbits around Sgr A*: Keplerian elements (visual-binary convention: Ω = position angle of
 * the ascending node east of north, ω from the node, i > 90° = clockwise on the sky) propagated
 * with the secular Schwarzschild periapse advance Δω = 3π r_s / (a (1 - e²)) per orbit.
 *
 * Positions are metres relative to Sgr A*, in world (ICRF) axes: x_N·ê_N + x_E·ê_E + z·û with û
 * the line of sight from the Sun to Sgr A*. The period is the published element; the physical
 * semi-major axis follows from Kepler's law with the catalogue mass, so P is exact.
 */
import type { Vec3d } from '../../core/contracts';
import { GM_SUN, JD_J2000, JULIAN_YEAR } from '../../core/units';

export interface SStarRow {
  id: string;
  name: string;
  /** Angular semi-major axis, arcsec (as published). */
  aArcsec: number;
  e: number;
  iDeg: number;
  OmegaDeg: number;
  omegaDeg: number;
  /** Pericentre epoch, decimal (Julian) year. */
  tpYear: number;
  periodYr: number;
  /** Absolute V magnitude (approximate, from K-band photometry and spectral type). */
  absMagV: number;
  teffK: number;
  approximate?: boolean;
  source: string;
}

export interface SStarOrbit {
  row: SStarRow;
  /** Semi-major axis, m (Kepler's third law with the catalogue mass). */
  a: number;
  /** Period, s. */
  period: number;
  /** Pericentre JD (TT). */
  tpJd: number;
  /** Periapse advance per orbit, rad. */
  dOmega: number;
}

/** Sky basis at Sgr A*: north, east and line of sight (Sun → Sgr A*), world axes. */
export interface SkyBasis {
  n: Vec3d;
  e: Vec3d;
  los: Vec3d;
}

const D2R = Math.PI / 180;

export const yearToJd = (y: number): number => JD_J2000 + (y - 2000) * 365.25;
export const jdToYear = (jd: number): number => 2000 + (jd - JD_J2000) / 365.25;

export function skyBasis(raDeg: number, decDeg: number): SkyBasis {
  const a = raDeg * D2R;
  const d = decDeg * D2R;
  return {
    los: { x: Math.cos(d) * Math.cos(a), y: Math.cos(d) * Math.sin(a), z: Math.sin(d) },
    e: { x: -Math.sin(a), y: Math.cos(a), z: 0 },
    n: { x: -Math.sin(d) * Math.cos(a), y: -Math.sin(d) * Math.sin(a), z: Math.cos(d) },
  };
}

export function makeOrbit(row: SStarRow, massMsun: number, rs: number): SStarOrbit {
  const period = row.periodYr * JULIAN_YEAR;
  const gm = GM_SUN * massMsun;
  const a = Math.cbrt((gm * period * period) / (4 * Math.PI * Math.PI));
  return {
    row,
    a,
    period,
    tpJd: yearToJd(row.tpYear),
    dOmega: (3 * Math.PI * rs) / (a * (1 - row.e * row.e)),
  };
}

/** Solves Kepler's equation M = E - e sin E (Newton, robust for e → 1). */
export function eccentricAnomaly(M: number, e: number): number {
  let m = M % (2 * Math.PI);
  if (m > Math.PI) m -= 2 * Math.PI;
  if (m < -Math.PI) m += 2 * Math.PI;
  // Danby's starting value: Newton converges for every e < 1.
  let E = m + 0.85 * e * Math.sign(Math.sin(m));
  for (let i = 0; i < 50; i++) {
    const f = E - e * Math.sin(E) - m;
    const d = f / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-14) break;
  }
  return E;
}

/** Argument of pericentre (rad) at jd including the secular Schwarzschild advance. */
export const omegaAt = (o: SStarOrbit, jd: number): number =>
  o.row.omegaDeg * D2R + (o.dOmega * ((jd - o.tpJd) * 86400)) / o.period;

/**
 * Position relative to Sgr A* at `jd`, world axes, m. `omegaOverride` draws the osculating
 * ellipse at a fixed ω (orbit lines).
 */
export function sstarPosition(
  o: SStarOrbit,
  basis: SkyBasis,
  jd: number,
  out: Vec3d,
  eAnomaly?: number,
  omegaOverride?: number,
): Vec3d {
  const { e } = o.row;
  const E = eAnomaly ?? eccentricAnomaly((2 * Math.PI * ((jd - o.tpJd) * 86400)) / o.period, e);
  const X = Math.cos(E) - e;
  const Y = Math.sqrt(1 - e * e) * Math.sin(E);
  const w = omegaOverride ?? omegaAt(o, jd);
  const W = o.row.OmegaDeg * D2R;
  const i = o.row.iDeg * D2R;
  const cw = Math.cos(w),
    sw = Math.sin(w),
    cW = Math.cos(W),
    sW = Math.sin(W),
    ci = Math.cos(i),
    si = Math.sin(i);
  // Thiele-Innes constants (north, east, along the line of sight away from the observer).
  const A = cw * cW - sw * sW * ci;
  const B = cw * sW + sw * cW * ci;
  const F = -sw * cW - cw * sW * ci;
  const G = -sw * sW + cw * cW * ci;
  const C = sw * si;
  const H = cw * si;
  const xN = o.a * (A * X + F * Y);
  const xE = o.a * (B * X + G * Y);
  const z = o.a * (C * X + H * Y);
  out.x = xN * basis.n.x + xE * basis.e.x + z * basis.los.x;
  out.y = xN * basis.n.y + xE * basis.e.y + z * basis.los.y;
  out.z = xN * basis.n.z + xE * basis.e.z + z * basis.los.z;
  return out;
}

/** Pericentre and apocentre distances, m. */
export const periapsis = (o: SStarOrbit): number => o.a * (1 - o.row.e);
export const apoapsis = (o: SStarOrbit): number => o.a * (1 + o.row.e);
