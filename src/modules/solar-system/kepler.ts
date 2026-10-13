/**
 * Two-body Kepler propagation for bodies.json `elements` (Celestia osculating elements) and
 * osculating conics from state vectors (orbit lines). Pure float64, no three.js.
 */
import type { Vec3d } from '../../core/contracts';
import { v3cross, v3dot, v3len, v3normalize, v3set, vec3 } from '../../core/math64';
import { DAY } from '../../core/units';
import type { ElementsRow, RotationRow } from './data';
import { KM } from './data';

const DEG = Math.PI / 180;
const TWO_PI = 2 * Math.PI;
/** Mean obliquity of the ecliptic at J2000 (IAU 2006), radians. */
export const OBLIQUITY_J2000 = (84381.406 / 3600) * DEG;

/** Row-major 3×3 matrix taking reference-frame vectors into ICRF. */
export type Mat3 = readonly [number, number, number, number, number, number, number, number, number];

export const IDENTITY3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
/** Ecliptic J2000 → ICRF (rotation about x by +ε). */
export const ECLIPTIC_TO_ICRF: Mat3 = (() => {
  const c = Math.cos(OBLIQUITY_J2000);
  const s = Math.sin(OBLIQUITY_J2000);
  return [1, 0, 0, 0, c, -s, 0, s, c] as const;
})();
/** ICRF unit vector of the ecliptic north pole. */
export const ECLIPTIC_POLE: Readonly<Vec3d> = vec3(0, -Math.sin(OBLIQUITY_J2000), Math.cos(OBLIQUITY_J2000));

export function mat3Apply(m: Mat3, v: Vec3d, out: Vec3d): Vec3d {
  return v3set(
    out,
    m[0] * v.x + m[1] * v.y + m[2] * v.z,
    m[3] * v.x + m[4] * v.y + m[5] * v.z,
    m[6] * v.x + m[7] * v.y + m[8] * v.z,
  );
}

/** Matrix with the given ICRF unit vectors as columns. */
export const mat3FromColumns = (x: Vec3d, y: Vec3d, z: Vec3d): Mat3 => [
  x.x,
  y.x,
  z.x,
  x.y,
  y.y,
  z.y,
  x.z,
  y.z,
  z.z,
];

/** Reference-frame → ICRF matrix for an elements row (`parentRotation` for 'parent-equator'). */
export function elementsFrameMatrix(el: ElementsRow, parentRotation?: RotationRow): Mat3 {
  switch (el.frame) {
    case 'ecliptic-j2000':
      return ECLIPTIC_TO_ICRF;
    case 'equator-j2000':
      return IDENTITY3;
    case 'icrf-axes': {
      const a = el.axes;
      if (!a) throw new Error('kepler: icrf-axes frame without axes');
      const [x, y, z] = [a.x, a.y, a.z].map((c) => v3normalize(vec3(), vec3(c[0], c[1], c[2])));
      return mat3FromColumns(x, y, z);
    }
    case 'parent-equator': {
      const ra = (parentRotation?.ra0 ?? 0) * DEG;
      const dec = (parentRotation?.dec0 ?? 90) * DEG;
      const z = vec3(Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec));
      const x = vec3(-Math.sin(ra), Math.cos(ra), 0);
      const y = v3cross(vec3(), z, x);
      return mat3FromColumns(x, y, z);
    }
  }
}

/**
 * Solves Kepler's equation E − e·sin E = M (elliptic, 0 ≤ e < 1) by Newton iteration with a
 * cubic-safe starting guess. Returns E in radians in the same 2π branch as M.
 */
export function solveKepler(M: number, e: number): number {
  const m = M - TWO_PI * Math.floor(M / TWO_PI + 0.5); // −π..π
  let E = e < 0.8 ? m : Math.sign(m || 1) * Math.PI;
  for (let k = 0; k < 50; k++) {
    const f = E - e * Math.sin(E) - m;
    const fp = 1 - e * Math.cos(E);
    const dE = f / fp;
    E -= dE;
    if (Math.abs(dE) < 1e-15) break;
  }
  return E + (M - m);
}

/** Perifocal basis and size of an ellipse, ICRF axes (shared by Kepler rows and osculating orbits). */
export interface Conic {
  /** Semi-major axis, m. */
  a: number;
  e: number;
  /** Unit vector to pericentre, ICRF. */
  P: Vec3d;
  /** Unit vector 90° ahead of P in the orbital plane, ICRF. */
  Q: Vec3d;
}

/** Point on a conic at eccentric anomaly E (relative to the focus), m. */
export function conicPoint(c: Conic, E: number, out: Vec3d): Vec3d {
  const x = c.a * (Math.cos(E) - c.e);
  const y = c.a * Math.sqrt(1 - c.e * c.e) * Math.sin(E);
  return v3set(out, x * c.P.x + y * c.Q.x, x * c.P.y + y * c.Q.y, x * c.P.z + y * c.Q.z);
}

/** Kepler orbit of one bodies.json row. Positions are relative to `elements.center`, ICRF axes, m. */
export class KeplerOrbit implements Conic {
  readonly a: number;
  readonly e: number;
  readonly P: Vec3d;
  readonly Q: Vec3d;
  /** Mean motion, rad/day. */
  readonly n: number;
  readonly epoch: number;
  readonly M0: number;
  readonly periodDays: number;

  constructor(el: ElementsRow, frame: Mat3) {
    this.a = el.a * KM;
    this.e = el.e;
    this.epoch = el.epoch;
    this.periodDays = el.period;
    this.n = TWO_PI / el.period;
    this.M0 = el.meanAnomaly * DEG;
    // Rz(node)·Rx(i)·Rz(argPeri) applied to x̂ and ŷ, then into ICRF.
    const O = el.node * DEG;
    const i = el.i * DEG;
    const w = el.argPeri * DEG;
    const [cO, sO, ci, si, cw, sw] = [
      Math.cos(O),
      Math.sin(O),
      Math.cos(i),
      Math.sin(i),
      Math.cos(w),
      Math.sin(w),
    ];
    const p = vec3(cO * cw - sO * ci * sw, sO * cw + cO * ci * sw, si * sw);
    const q = vec3(-cO * sw - sO * ci * cw, -sO * sw + cO * ci * cw, si * cw);
    this.P = mat3Apply(frame, p, vec3());
    this.Q = mat3Apply(frame, q, vec3());
  }

  meanAnomaly(jd: number): number {
    return this.M0 + this.n * (jd - this.epoch);
  }

  positionAt(jd: number, out: Vec3d): Vec3d {
    return conicPoint(this, solveKepler(this.meanAnomaly(jd), this.e), out);
  }

  /** Velocity, m/s, ICRF axes. */
  velocityAt(jd: number, out: Vec3d): Vec3d {
    const E = solveKepler(this.meanAnomaly(jd), this.e);
    const nSec = this.n / DAY;
    const k = (this.a * nSec) / (1 - this.e * Math.cos(E));
    const vx = -Math.sin(E) * k;
    const vy = Math.sqrt(1 - this.e * this.e) * Math.cos(E) * k;
    const { P, Q } = this;
    return v3set(out, vx * P.x + vy * Q.x, vx * P.y + vy * Q.y, vx * P.z + vy * Q.z);
  }
}

/**
 * Osculating ellipse from a relative state (m, m/s) and μ = G(M + m) (m³/s²). Returns null for
 * unbound or degenerate states.
 */
export function conicFromState(r: Vec3d, v: Vec3d, mu: number, out?: Conic): Conic | null {
  const rl = v3len(r);
  if (!(rl > 0) || !(mu > 0)) return null;
  const v2 = v3dot(v, v);
  const inv = 2 / rl - v2 / mu;
  if (!(inv > 0)) return null;
  const h = v3cross(vec3(), r, v);
  if (!(v3len(h) > 0)) return null;
  const vxh = v3cross(vec3(), v, h);
  const ev = v3set(vec3(), vxh.x / mu - r.x / rl, vxh.y / mu - r.y / rl, vxh.z / mu - r.z / rl);
  const e = v3len(ev);
  const c = out ?? { a: 0, e: 0, P: vec3(), Q: vec3() };
  c.a = 1 / inv;
  c.e = Math.min(e, 0.999999);
  if (e > 1e-9) v3normalize(c.P, ev);
  else v3normalize(c.P, r);
  v3normalize(h, h);
  v3cross(c.Q, h, c.P);
  return c;
}

/** Orbital period from Kepler's third law, days. */
export const keplerPeriodDays = (aMetres: number, mu: number): number =>
  (TWO_PI * Math.sqrt(aMetres ** 3 / mu)) / DAY;
