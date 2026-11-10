/**
 * Two-body mechanics in universal variables (three-free, unit-tested): one propagator and one
 * Lambert solver that work for ellipses, parabolas and hyperbolas alike. The probes need both:
 * every leg between two encounters is the conic through two known points in a known time
 * (Lambert), and the coast after the last flyby is the conic through one published state.
 *
 * Units: metres, seconds, m³/s². Vectors are plain Vec3d in any inertial axes.
 */
import type { Vec3d } from '../../core/contracts';
import { v3cross, v3dot, v3len, v3set, vec3 } from '../../core/math64';

/** Stumpff function C(z) = (1 − cos √z) / z (cosh for z < 0). */
export function stumpffC(z: number): number {
  if (z > 1e-6) return (1 - Math.cos(Math.sqrt(z))) / z;
  if (z < -1e-6) return (Math.cosh(Math.sqrt(-z)) - 1) / -z;
  return 0.5 - z / 24 + (z * z) / 720;
}

/** Stumpff function S(z) = (√z − sin √z) / √z³ (sinh for z < 0). */
export function stumpffS(z: number): number {
  if (z > 1e-6) {
    const s = Math.sqrt(z);
    return (s - Math.sin(s)) / (s * s * s);
  }
  if (z < -1e-6) {
    const s = Math.sqrt(-z);
    return (Math.sinh(s) - s) / (s * s * s);
  }
  return 1 / 6 - z / 120 + (z * z) / 5040;
}

/** A position and velocity at one instant. */
export interface State {
  r: Vec3d;
  v: Vec3d;
}

/**
 * Propagates the state (r0, v0) by `dt` seconds (either sign) around a point mass `mu`.
 * Solves the universal Kepler equation for χ with a bracketed Newton iteration: the equation is
 * monotonic in χ, so a step that leaves the bracket (or stalls) falls back to bisection and the
 * iteration always converges.
 */
export function propagate(r0: Vec3d, v0: Vec3d, dt: number, mu: number, outR: Vec3d, outV?: Vec3d): Vec3d {
  const r0n = v3len(r0);
  if (dt === 0 || r0n === 0) {
    if (outV) v3set(outV, v0.x, v0.y, v0.z);
    return v3set(outR, r0.x, r0.y, r0.z);
  }
  const sqrtMu = Math.sqrt(mu);
  const vr0 = v3dot(r0, v0) / r0n;
  const alpha = 2 / r0n - v3dot(v0, v0) / mu; // 1/a: > 0 ellipse, < 0 hyperbola
  const k1 = (r0n * vr0) / sqrtMu;
  const k2 = 1 - alpha * r0n;
  const target = sqrtMu * dt;
  // F(χ) = k1 χ² C + k2 χ³ S + r0 χ − √μ dt, increasing in χ (dF/dχ = r > 0).
  // Far beyond the root of a hyperbola cosh and sinh overflow: there F has the sign of χ.
  const F = (x: number): number => {
    const z = alpha * x * x;
    const f = k1 * x * x * stumpffC(z) + k2 * x * x * x * stumpffS(z) + r0n * x - target;
    return Number.isFinite(f) ? f : x > 0 ? Infinity : -Infinity;
  };
  const dF = (x: number): number => {
    const z = alpha * x * x;
    return k1 * x * (1 - z * stumpffS(z)) + k2 * x * x * stumpffC(z) + r0n;
  };
  // Bracket the root: χ has the sign of dt.
  const sign = dt > 0 ? 1 : -1;
  let lo = 0;
  let hi = sign * Math.max(Math.abs(target) / r0n, 1);
  for (let i = 0; i < 200 && sign * F(hi) < 0; i++) {
    lo = hi;
    hi *= 2;
  }
  if (sign < 0) [lo, hi] = [hi, lo];
  // Newton, falling back to bisection whenever a step leaves the bracket or stops halving it
  // (far from the root of a hyperbola F is exponential and plain Newton only creeps).
  let x = 0.5 * (lo + hi);
  let fx = F(x);
  let df = dF(x);
  let dxOld = hi - lo;
  let dx = dxOld;
  for (let i = 0; i < 200; i++) {
    const newtonOut = ((x - hi) * df - fx) * ((x - lo) * df - fx) > 0;
    if (
      newtonOut ||
      !Number.isFinite(df) ||
      !Number.isFinite(fx) ||
      Math.abs(2 * fx) > Math.abs(dxOld * df)
    ) {
      dxOld = dx;
      dx = 0.5 * (hi - lo);
      x = lo + dx;
    } else {
      dxOld = dx;
      dx = fx / df;
      x -= dx;
    }
    if (Math.abs(dx) <= 4e-16 * Math.abs(x)) break;
    fx = F(x);
    df = dF(x);
    if (fx < 0) lo = x;
    else hi = x;
  }
  const z = alpha * x * x;
  const C = stumpffC(z);
  const S = stumpffS(z);
  const f = 1 - ((x * x) / r0n) * C;
  const g = dt - ((x * x * x) / sqrtMu) * S;
  const rx = f * r0.x + g * v0.x;
  const ry = f * r0.y + g * v0.y;
  const rz = f * r0.z + g * v0.z;
  const rn = Math.hypot(rx, ry, rz);
  if (outV) {
    const fd = (sqrtMu / (rn * r0n)) * (z * S - 1) * x;
    const gd = 1 - ((x * x) / rn) * C;
    v3set(outV, fd * r0.x + gd * v0.x, fd * r0.y + gd * v0.y, fd * r0.z + gd * v0.z);
  }
  return v3set(outR, rx, ry, rz);
}

/**
 * Lambert's problem, single revolution: the velocities at r1 and r2 of the conic that joins them
 * in `tof` seconds. The transfer runs prograde about `pole` (default +z: pass the ecliptic pole
 * for heliocentric legs), so angles above 180° are handled. Returns null when the geometry is
 * degenerate (collinear points) or no solution brackets.
 */
export function lambert(
  r1: Vec3d,
  r2: Vec3d,
  tof: number,
  mu: number,
  pole: Vec3d = vec3(0, 0, 1),
): { v1: Vec3d; v2: Vec3d } | null {
  const r1n = v3len(r1);
  const r2n = v3len(r2);
  if (!(tof > 0) || r1n === 0 || r2n === 0) return null;
  const cosT = Math.min(1, Math.max(-1, v3dot(r1, r2) / (r1n * r2n)));
  let theta = Math.acos(cosT);
  if (v3dot(v3cross(vec3(), r1, r2), pole) < 0) theta = 2 * Math.PI - theta;
  const A = Math.sin(theta) * Math.sqrt((r1n * r2n) / (1 - cosT));
  if (!Number.isFinite(A) || Math.abs(A) < 1e-9 * Math.sqrt(r1n * r2n)) return null;
  const sqrtMu = Math.sqrt(mu);
  const y = (z: number): number => r1n + r2n + (A * (z * stumpffS(z) - 1)) / Math.sqrt(stumpffC(z));
  // Time of flight for z (NaN where y < 0: z below the admissible range for A > 0).
  const T = (z: number): number => {
    const yz = y(z);
    if (!(yz > 0)) return NaN;
    return (Math.pow(yz / stumpffC(z), 1.5) * stumpffS(z) + A * Math.sqrt(yz)) / sqrtMu;
  };
  // T increases with z on (zMin, 4π²): bisect.
  let hi = 4 * Math.PI * Math.PI * (1 - 1e-9);
  let lo = -4;
  for (let i = 0; i < 60; i++) {
    const t = T(lo);
    if (Number.isNaN(t)) break; // lo fell below the admissible range: bisection moves it back up
    if (t < tof) break;
    lo *= 2;
  }
  if (!(T(hi) > tof)) return null;
  let z = 0;
  for (let i = 0; i < 200; i++) {
    z = 0.5 * (lo + hi);
    const t = T(z);
    if (Number.isNaN(t) || t < tof) lo = z;
    else hi = z;
    if (hi - lo < 1e-14 * Math.max(1, Math.abs(z))) break;
  }
  const yz = y(z);
  if (!(yz > 0)) return null;
  const f = 1 - yz / r1n;
  const g = A * Math.sqrt(yz / mu);
  const gd = 1 - yz / r2n;
  return {
    v1: vec3((r2.x - f * r1.x) / g, (r2.y - f * r1.y) / g, (r2.z - f * r1.z) / g),
    v2: vec3((gd * r2.x - r1.x) / g, (gd * r2.y - r1.y) / g, (gd * r2.z - r1.z) / g),
  };
}

/** Osculating elements that the info card and tests read: a (negative for hyperbolas), e, i to `pole`. */
export function conicSummary(
  r: Vec3d,
  v: Vec3d,
  mu: number,
  pole: Vec3d = vec3(0, 0, 1),
): { a: number; e: number; inclination: number; vInfinity: number } {
  const rn = v3len(r);
  const v2 = v3dot(v, v);
  const energy = v2 / 2 - mu / rn;
  const h = v3cross(vec3(), r, v);
  const hn = v3len(h);
  const e = Math.sqrt(Math.max(0, 1 + (2 * energy * hn * hn) / (mu * mu)));
  return {
    a: -mu / (2 * energy),
    e,
    inclination: Math.acos(Math.min(1, Math.max(-1, v3dot(h, pole) / (hn * v3len(pole))))),
    vInfinity: energy > 0 ? Math.sqrt(2 * energy) : 0,
  };
}
