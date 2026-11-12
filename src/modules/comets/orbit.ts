/**
 * Two-body propagation of comet orbits from perihelion-based elements (three-free, float64).
 *
 * Kepler's equation is solved in universal variables measured from perihelion, where the radial velocity
 * is zero:
 *   sqrt(mu) dt = e chi^3 S(z) + q chi,   z = alpha chi^2,   alpha = (1 - e) / q
 * with the Stumpff functions C and S. The same formula covers ellipses, parabolas and hyperbolas and has
 * no cancellation as e approaches 1 (the eccentric-anomaly form subtracts nearly equal numbers there). The
 * left side is increasing and convex in chi over half a revolution, so Newton's iteration from an upper
 * bound converges monotonically.
 *   x = q - chi^2 C(z)                               (towards perihelion, P)
 *   y = chi sqrt((1 + e) / q) (q - (1 - e) chi^2 S(z))   (90 degrees ahead in the orbit, Q)
 *   r = q + e chi^2 C(z)
 */
import type { Vec3d } from '../../core/contracts';
import { v3cross, v3set, vec3 } from '../../core/math64';
import { AU, DAY, GM_SUN } from '../../core/units';
import { OBLIQUITY_J2000 } from '../solar-system/public';
import type { CometElements } from './data';

const DEG = Math.PI / 180;
const TWO_PI = 2 * Math.PI;

/** Stumpff C(z) = (1 - cos sqrt z) / z, continued through z = 0 and to z < 0 (cosh). */
export function stumpffC(z: number): number {
  if (Math.abs(z) < 0.5) {
    // 1/2! - z/4! + z^2/6! - ...
    let term = 0.5;
    let sum = term;
    for (let k = 1; k < 12; k++) {
      term *= -z / ((2 * k + 1) * (2 * k + 2));
      sum += term;
    }
    return sum;
  }
  if (z > 0) return (1 - Math.cos(Math.sqrt(z))) / z;
  return (Math.cosh(Math.sqrt(-z)) - 1) / -z;
}

/** Stumpff S(z) = (sqrt z - sin sqrt z) / z^(3/2), continued through z = 0 and to z < 0 (sinh). */
export function stumpffS(z: number): number {
  if (Math.abs(z) < 0.5) {
    // 1/3! - z/5! + z^2/7! - ...
    let term = 1 / 6;
    let sum = term;
    for (let k = 1; k < 12; k++) {
      term *= -z / ((2 * k + 2) * (2 * k + 3));
      sum += term;
    }
    return sum;
  }
  if (z > 0) {
    const s = Math.sqrt(z);
    return (s - Math.sin(s)) / (z * s);
  }
  const s = Math.sqrt(-z);
  return (Math.sinh(s) - s) / (-z * s);
}

export interface UniversalSolution {
  /** Universal anomaly, sqrt(m); signed like dt. */
  chi: number;
  /** alpha chi^2. */
  z: number;
  iterations: number;
}

/**
 * Solves the universal Kepler equation from perihelion for the time `dt` (s, any sign) since perihelion.
 * `q` in m, `mu` in m^3/s^2. For ellipses `dt` must lie within half a period of perihelion.
 */
export function solveUniversal(
  q: number,
  e: number,
  mu: number,
  dt: number,
  out?: UniversalSolution,
): UniversalSolution {
  const sol = out ?? { chi: 0, z: 0, iterations: 0 };
  const T = Math.sqrt(mu) * Math.abs(dt);
  const alpha = (1 - e) / q;
  if (T === 0) {
    sol.chi = sol.z = sol.iterations = 0;
    return sol;
  }
  // Upper bounds of the root: the q chi term alone, and (hyperbola / parabola) the cubic term alone.
  let chi = T / q;
  if (e > 0) chi = Math.min(chi, Math.cbrt((6 * T) / e));
  // Hyperbola: chi = H / sqrt(-alpha) in the hyperbolic anomaly H, and e sinh H - H = M >= (e - 1) sinh H
  // bounds H by asinh(M / (e - 1)). The root grows only logarithmically with dt, so the power-law bounds
  // above sit far above it far from perihelion: Newton then crawls down the exponential about one unit of H
  // per step and ran out of iterations (unconverged positions of 1e37 AU 100,000 years out). This bound is
  // within ln(e / (e - 1)) of the root, so a few steps suffice at any dt.
  if (alpha < 0) {
    const sa = Math.sqrt(-alpha);
    chi = Math.min(chi, Math.asinh((T * sa * sa * sa) / (e - 1)) / sa);
  }
  // Ellipse: the root lies within half a revolution, E <= pi.
  const chiMax = alpha > 0 ? Math.PI / Math.sqrt(alpha) : Infinity;
  if (chi > chiMax) chi = chiMax;
  let k = 0;
  for (; k < 80; k++) {
    const z = alpha * chi * chi;
    const c2 = chi * chi;
    const f = e * c2 * chi * stumpffS(z) + q * chi - T;
    const r = q + e * c2 * stumpffC(z);
    let next = chi - f / r;
    if (!(next > 0)) next = 0.5 * chi;
    if (next > chiMax) next = chiMax;
    const d = Math.abs(next - chi);
    chi = next;
    if (d <= 2e-14 * chi) break;
  }
  sol.chi = dt < 0 ? -chi : chi;
  sol.z = alpha * chi * chi;
  sol.iterations = k + 1;
  return sol;
}

/** Ecliptic J2000 → ICRF (rotation about x by the obliquity). */
function eclipticToIcrf(x: number, y: number, z: number, out: Vec3d): Vec3d {
  const c = Math.cos(OBLIQUITY_J2000);
  const s = Math.sin(OBLIQUITY_J2000);
  return v3set(out, x, c * y - s * z, s * y + c * z);
}

/** A comet's osculating conic. Positions are relative to the orbit centre, ICRF axes, metres. */
export class CometOrbit {
  /** Perihelion distance, m. */
  readonly q: number;
  readonly e: number;
  /** GM of the centre implied by the elements (period and semi-major axis), m^3/s^2. */
  readonly mu: number;
  /** Perihelion passage nearest the element epoch, JD TT. */
  readonly tp: number;
  readonly epoch: number;
  /** Period in days, or null when unbound. */
  readonly periodDays: number | null;
  /** Unit vector to perihelion, 90 degrees ahead in the orbit, and the orbit normal (P x Q), ICRF. */
  readonly P: Vec3d = vec3();
  readonly Q: Vec3d = vec3();
  readonly W: Vec3d = vec3();
  private readonly sol: UniversalSolution = { chi: 0, z: 0, iterations: 0 };

  constructor(el: CometElements) {
    this.q = el.q * AU;
    this.e = el.e;
    this.tp = el.tp;
    this.epoch = el.epoch;
    this.periodDays = el.e < 1 ? el.periodDays : null;
    if (this.periodDays) {
      const a = this.q / (1 - el.e);
      const n = TWO_PI / (this.periodDays * DAY);
      this.mu = n * n * a * a * a;
    } else this.mu = GM_SUN;
    // Rz(node) Rx(i) Rz(argPeri) applied to x and y (ecliptic), then into ICRF.
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
    eclipticToIcrf(cO * cw - sO * ci * sw, sO * cw + cO * ci * sw, si * sw, this.P);
    eclipticToIcrf(-cO * sw - sO * ci * cw, -sO * sw + cO * ci * cw, si * cw, this.Q);
    v3cross(this.W, this.P, this.Q);
  }

  /** Semi-major axis, m (Infinity for a parabola, negative for a hyperbola). */
  get a(): number {
    return this.e === 1 ? Infinity : this.q / (1 - this.e);
  }

  /** Aphelion distance, m (Infinity when unbound). */
  get aphelion(): number {
    return this.e < 1 ? (this.q * (1 + this.e)) / (1 - this.e) : Infinity;
  }

  /** Seconds since the nearest perihelion passage (bound orbits wrap to within half a period). */
  timeFromPerihelion(jd: number): number {
    let d = jd - this.tp;
    if (this.periodDays) d -= this.periodDays * Math.round(d / this.periodDays);
    return d * DAY;
  }

  /** Perihelion passage nearest `jd`, JD TT. */
  perihelionNear(jd: number): number {
    if (!this.periodDays) return this.tp;
    return this.tp + this.periodDays * Math.round((jd - this.tp) / this.periodDays);
  }

  /** Position (and optionally velocity, m/s) at `jd`. */
  stateAt(jd: number, pos: Vec3d, vel?: Vec3d): Vec3d {
    const { q, e, mu, P, Q } = this;
    const { chi, z } = solveUniversal(q, e, mu, this.timeFromPerihelion(jd), this.sol);
    const c2 = chi * chi;
    const C = stumpffC(z);
    const S = stumpffS(z);
    const k = Math.sqrt((1 + e) / q);
    const x = q - c2 * C;
    const y = chi * k * (q - (1 - e) * c2 * S);
    if (vel) {
      const r = q + e * c2 * C;
      const sm = Math.sqrt(mu);
      const vx = (sm * chi * (z * S - 1)) / r;
      const vy = (1 - (c2 * C) / r) * sm * k;
      v3set(vel, vx * P.x + vy * Q.x, vx * P.y + vy * Q.y, vx * P.z + vy * Q.z);
    }
    return v3set(pos, x * P.x + y * Q.x, x * P.y + y * Q.y, x * P.z + y * Q.z);
  }

  positionAt(jd: number, out: Vec3d): Vec3d {
    return this.stateAt(jd, out);
  }

  /** Distance from the centre at `jd`, m. */
  radiusAt(jd: number): number {
    const { chi, z } = solveUniversal(this.q, this.e, this.mu, this.timeFromPerihelion(jd), this.sol);
    return this.q + this.e * chi * chi * stumpffC(z);
  }

  /** Point at true anomaly `nu` (radians); the caller keeps 1 + e cos(nu) > 0. */
  pointAtTrueAnomaly(nu: number, out: Vec3d): Vec3d {
    const r = (this.q * (1 + this.e)) / (1 + this.e * Math.cos(nu));
    const x = r * Math.cos(nu);
    const y = r * Math.sin(nu);
    const { P, Q } = this;
    return v3set(out, x * P.x + y * Q.x, x * P.y + y * Q.y, x * P.z + y * Q.z);
  }

  /** Largest |true anomaly| (radians) at which the orbit is still within `rMax` (m) of the centre. */
  trueAnomalyWithin(rMax: number): number {
    if (this.aphelion <= rMax) return Math.PI;
    if (this.q >= rMax) return 0;
    const c = ((this.q * (1 + this.e)) / rMax - 1) / this.e;
    return Math.acos(Math.min(1, Math.max(-1, c)));
  }
}
