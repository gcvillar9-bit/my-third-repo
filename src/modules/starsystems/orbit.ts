/**
 * Pure orbit and star helpers for star promotion, binaries and exoplanets (unit-tested in Node).
 * Sky basis at a direction: radial (away from the Sun), east and north, in ICRS world axes.
 */
import type { Vec3d } from '../../core/contracts';
import { SUN_ABS_MAG_V, SUN_TEFF } from '../../core/photometry';
import { JD_J2000 } from '../../core/units';

const DEG = Math.PI / 180;

export interface SkyBasis {
  radial: Vec3d;
  east: Vec3d;
  north: Vec3d;
}

/** Unit vectors at a unit direction `r` (pointing away from the observer). */
export function skyBasis(r: Vec3d): SkyBasis {
  const ra = Math.atan2(r.y, r.x);
  const dec = Math.asin(Math.max(-1, Math.min(1, r.z)));
  const sa = Math.sin(ra);
  const ca = Math.cos(ra);
  const sd = Math.sin(dec);
  const cd = Math.cos(dec);
  return {
    radial: { x: cd * ca, y: cd * sa, z: sd },
    east: { x: -sa, y: ca, z: 0 },
    north: { x: -sd * ca, y: -sd * sa, z: cd },
  };
}

/** Solves Kepler's equation E - e sin E = M (radians), Newton iterations. */
export function solveKepler(M: number, e: number): number {
  const m = M - 2 * Math.PI * Math.floor(M / (2 * Math.PI));
  let E = e < 0.8 ? m : Math.PI;
  for (let k = 0; k < 30; k++) {
    const d = (E - e * Math.sin(E) - m) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-14) break;
  }
  return E;
}

/** Campbell elements of a relative (secondary about primary) or planetary orbit. */
export interface Elements {
  /** Semi-major axis, any length unit (the result uses the same unit). */
  a: number;
  e: number;
  /** Inclination to the sky plane, rad. */
  i: number;
  /** Position angle of the ascending node, rad (from north through east). */
  node: number;
  /** Argument of periastron, rad. */
  peri: number;
  /** Period, years. */
  periodYr: number;
  /** Mean anomaly at J2000, rad. */
  m0: number;
}

/** Decimal Julian years since J2000 for a JD. */
export const yearsSinceJ2000 = (jd: number): number => (jd - JD_J2000) / 365.25;

/**
 * Offset of the orbiting body at `jd` (Thiele-Innes): north and east in the sky plane, radial positive
 * away from the observer, rotated into world axes with `basis`. Units of `el.a`.
 */
export function orbitOffset(el: Elements, basis: SkyBasis, jd: number, out: Vec3d): Vec3d {
  const M = el.m0 + (2 * Math.PI * yearsSinceJ2000(jd)) / el.periodYr;
  const E = solveKepler(M, el.e);
  const r = el.a * (1 - el.e * Math.cos(E));
  const nu = 2 * Math.atan2(Math.sqrt(1 + el.e) * Math.sin(E / 2), Math.sqrt(1 - el.e) * Math.cos(E / 2));
  const u = nu + el.peri;
  const cu = Math.cos(u);
  const su = Math.sin(u);
  const cn = Math.cos(el.node);
  const sn = Math.sin(el.node);
  const ci = Math.cos(el.i);
  const n = r * (cu * cn - su * sn * ci);
  const ea = r * (cu * sn + su * cn * ci);
  const z = r * su * Math.sin(el.i);
  out.x = n * basis.north.x + ea * basis.east.x + z * basis.radial.x;
  out.y = n * basis.north.y + ea * basis.east.y + z * basis.radial.y;
  out.z = n * basis.north.z + ea * basis.east.z + z * basis.radial.z;
  return out;
}

/** Mean anomaly at J2000 from a periastron epoch (decimal year). */
export const meanAnomalyJ2000 = (periastronYr: number, periodYr: number): number =>
  (2 * Math.PI * (2000 - periastronYr)) / periodYr;

/** Unit normal of the orbital plane (the same rotation as orbitOffset), world axes. */
export function orbitNormal(el: Pick<Elements, 'i' | 'node'>, basis: SkyBasis, out: Vec3d): Vec3d {
  // Plane spanned by u = 0 and u = 90 deg directions; normal = their cross product.
  const cn = Math.cos(el.node);
  const sn = Math.sin(el.node);
  const ci = Math.cos(el.i);
  const si = Math.sin(el.i);
  const p = { n: cn, e: sn, z: 0 };
  const q = { n: -sn * ci, e: cn * ci, z: si };
  const nn = p.e * q.z - p.z * q.e;
  const ne = p.z * q.n - p.n * q.z;
  const nz = p.n * q.e - p.e * q.n;
  out.x = nn * basis.north.x + ne * basis.east.x + nz * basis.radial.x;
  out.y = nn * basis.north.y + ne * basis.east.y + nz * basis.radial.y;
  out.z = nn * basis.north.z + ne * basis.east.z + nz * basis.radial.z;
  return out;
}

/** Bolometric-free radius estimate (R_sun) from M_V and Teff: L_V = 10^(-0.4 (M_V - 4.83)), R = sqrt(L) (T_sun/T)^2. */
export function estimateRadiusRsun(absMagV: number, teff: number): number {
  const l = 10 ** (-0.4 * (absMagV - SUN_ABS_MAG_V));
  return Math.max(0.008, Math.min(1500, Math.sqrt(l) * (SUN_TEFF / teff) ** 2));
}

/** Bolometric luminance (L_sun) from radius (R_sun) and Teff. */
export const luminosityLsun = (radiusRsun: number, teff: number): number =>
  radiusRsun * radiusRsun * (teff / SUN_TEFF) ** 4;

/** Deterministic phase in [0, 2 pi) from a string id (illustrative orbital phases). */
export function hashPhase(id: string): number {
  let h = 2166136261;
  for (let k = 0; k < id.length; k++) h = Math.imul(h ^ id.charCodeAt(k), 16777619);
  return ((h >>> 0) / 4294967296) * 2 * Math.PI;
}

export const deg = (d: number): number => d * DEG;
