/**
 * Reference CPU integrator for Schwarzschild null geodesics (units: r_s = 1, c = 1).
 *
 * The spatial photon path obeys Binet's equation u'' + u = 1.5 u² (u = 1/r, r_s = 1). Its
 * Cartesian form, x'' = -1.5 h² x / r⁵ with h = |x × x'| conserved, is what the lensing shader
 * integrates with RK4 (steps ∝ r); this file is the float64 twin the unit tests check against.
 * Directions measured by a static observer are converted to coordinate tangents with
 * `initialVelocity` (radial component scaled by sqrt(1 - 1/r)), which reproduces Synge's
 * shadow formula sin ψ = b_c sqrt(1 - 1/r) / r.
 */

/** Photon-sphere radius, r_s. */
export const PHOTON_SPHERE = 1.5;
/** Critical impact parameter b_c = 3√3/2 r_s ≈ 2.598 r_s (shadow edge seen from infinity). */
export const B_CRIT = (3 * Math.sqrt(3)) / 2;
/** Innermost stable circular orbit, r_s. */
export const R_ISCO = 3;

export type V3 = [number, number, number];

export type RayFate = 'escape' | 'capture' | 'disk' | 'unfinished';

export interface TraceOptions {
  /** Step = stepFactor · r (default 0.02). */
  stepFactor?: number;
  maxSteps?: number;
  /** Escape when r exceeds this while moving outwards (default 1.05 × start radius, at least 50). */
  rEscape?: number;
  /** Optional thin disk: unit normal and radial extent (r_s). */
  diskNormal?: V3;
  diskIn?: number;
  diskOut?: number;
}

export interface TraceResult {
  fate: RayFate;
  /** Final unit direction of travel (escape: direction at the exit radius). */
  dir: V3;
  /** Final position. */
  pos: V3;
  /** Smallest radius reached. */
  rMin: number;
  steps: number;
  /** Disk crossing radius (fate 'disk'). */
  diskR?: number;
}

const len = (v: V3): number => Math.hypot(v[0], v[1], v[2]);
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Coordinate tangent for a ray leaving `pos` along the static-observer unit direction `dir`. */
export function initialVelocity(pos: V3, dir: V3): V3 {
  const r = len(pos);
  const rh: V3 = [pos[0] / r, pos[1] / r, pos[2] / r];
  const dr = dot(dir, rh);
  const k = (Math.sqrt(Math.max(1 - 1 / r, 0)) - 1) * dr;
  return [dir[0] + k * rh[0], dir[1] + k * rh[1], dir[2] + k * rh[2]];
}

/** Impact parameter of a ray seen by a static observer at radius r under angle ψ from the hole. */
export const impactFromAngle = (r: number, psi: number): number => (r * Math.sin(psi)) / Math.sqrt(1 - 1 / r);

/** Apparent angular radius of the shadow for a static observer at radius r (Synge). */
export function shadowAngle(r: number): number {
  if (r <= 1) return Math.PI;
  const s = (B_CRIT * Math.sqrt(1 - 1 / r)) / r;
  // Only inside the photon sphere (r < 1.5 r_s = 3M) does the shadow cover more than a hemisphere:
  // there a tangential ray falls in, so the escape cone is the one around the outward radial.
  const a = Math.asin(Math.min(1, s));
  return r < PHOTON_SPHERE ? Math.PI - a : a;
}

/** One RK4 step of x'' = -1.5 h² x / r⁵ on state [x, v] (6 numbers), in place. */
export function rk4Step(s: Float64Array, h2: number, dt: number): void {
  const k = -1.5 * h2;
  const ax = (x: number, y: number, z: number, out: Float64Array, o: number) => {
    const r2 = x * x + y * y + z * z;
    const f = k / (r2 * r2 * Math.sqrt(r2));
    out[o] = f * x;
    out[o + 1] = f * y;
    out[o + 2] = f * z;
  };
  const a = scratch;
  const [x, y, z, vx, vy, vz] = s;
  ax(x, y, z, a, 0);
  const x2 = x + 0.5 * dt * vx,
    y2 = y + 0.5 * dt * vy,
    z2 = z + 0.5 * dt * vz;
  const vx2 = vx + 0.5 * dt * a[0],
    vy2 = vy + 0.5 * dt * a[1],
    vz2 = vz + 0.5 * dt * a[2];
  ax(x2, y2, z2, a, 3);
  const x3 = x + 0.5 * dt * vx2,
    y3 = y + 0.5 * dt * vy2,
    z3 = z + 0.5 * dt * vz2;
  const vx3 = vx + 0.5 * dt * a[3],
    vy3 = vy + 0.5 * dt * a[4],
    vz3 = vz + 0.5 * dt * a[5];
  ax(x3, y3, z3, a, 6);
  const x4 = x + dt * vx3,
    y4 = y + dt * vy3,
    z4 = z + dt * vz3;
  const vx4 = vx + dt * a[6],
    vy4 = vy + dt * a[7],
    vz4 = vz + dt * a[8];
  ax(x4, y4, z4, a, 9);
  s[0] = x + (dt / 6) * (vx + 2 * vx2 + 2 * vx3 + vx4);
  s[1] = y + (dt / 6) * (vy + 2 * vy2 + 2 * vy3 + vy4);
  s[2] = z + (dt / 6) * (vz + 2 * vz2 + 2 * vz3 + vz4);
  s[3] = vx + (dt / 6) * (a[0] + 2 * a[3] + 2 * a[6] + a[9]);
  s[4] = vy + (dt / 6) * (a[1] + 2 * a[4] + 2 * a[7] + a[10]);
  s[5] = vz + (dt / 6) * (a[2] + 2 * a[5] + 2 * a[8] + a[11]);
}
const scratch = new Float64Array(12);

/**
 * Traces a ray backwards from `pos` along the static-observer direction `dir` (unit) until it
 * escapes, crosses the horizon (r < 1) or hits the optional thin disk.
 */
export function traceRay(pos: V3, dir: V3, opts: TraceOptions = {}): TraceResult {
  const k = opts.stepFactor ?? 0.02;
  const maxSteps = opts.maxSteps ?? 20000;
  const r0 = len(pos);
  const rEsc = opts.rEscape ?? Math.max(50, 1.05 * r0);
  const v = initialVelocity(pos, dir);
  const s = new Float64Array([pos[0], pos[1], pos[2], v[0], v[1], v[2]]);
  const hv = cross(pos, v);
  const h2 = dot(hv, hv);
  const n = opts.diskNormal;
  let rMin = r0;
  let steps = 0;
  let fate: RayFate = 'unfinished';
  let diskR: number | undefined;
  for (; steps < maxSteps; steps++) {
    const r = Math.hypot(s[0], s[1], s[2]);
    const sd0 = n ? s[0] * n[0] + s[1] * n[1] + s[2] * n[2] : 0;
    const p0: V3 = [s[0], s[1], s[2]];
    rk4Step(s, h2, k * r);
    const r1 = Math.hypot(s[0], s[1], s[2]);
    rMin = Math.min(rMin, r1);
    if (n) {
      const sd1 = s[0] * n[0] + s[1] * n[1] + s[2] * n[2];
      if (sd0 * sd1 < 0) {
        const t = sd0 / (sd0 - sd1);
        const c: V3 = [p0[0] + t * (s[0] - p0[0]), p0[1] + t * (s[1] - p0[1]), p0[2] + t * (s[2] - p0[2])];
        const rc = len(c);
        if (rc >= (opts.diskIn ?? R_ISCO) && rc <= (opts.diskOut ?? 20)) {
          fate = 'disk';
          diskR = rc;
          steps++;
          break;
        }
      }
    }
    if (r1 < 1) {
      fate = 'capture';
      steps++;
      break;
    }
    if (r1 > rEsc && s[0] * s[3] + s[1] * s[4] + s[2] * s[5] > 0) {
      fate = 'escape';
      steps++;
      break;
    }
  }
  const vl = Math.hypot(s[3], s[4], s[5]);
  return {
    fate,
    dir: [s[3] / vl, s[4] / vl, s[5] / vl],
    pos: [s[0], s[1], s[2]],
    rMin,
    steps,
    diskR,
  };
}

/** Ray from radius r0 on the +x axis heading back towards the hole with impact parameter b. */
export function rayWithImpact(b: number, r0: number): { pos: V3; dir: V3 } {
  const s = Math.min(1, (b * Math.sqrt(1 - 1 / r0)) / r0);
  const c = Math.sqrt(1 - s * s);
  return { pos: [r0, 0, 0], dir: [-c, s, 0] };
}

/** Total bending of a ray from infinity to infinity, rad (closed-form quadrature; b > b_c). */
export function deflectionExact(b: number, n = 400): number {
  if (b <= B_CRIT) return Infinity;
  // Turning point u0 = 1/r_min: smallest positive root of u³ - u² + 1/b² = 0 (Newton from 1/b).
  let u0 = 1 / b;
  for (let i = 0; i < 60; i++) {
    const f = u0 * u0 * u0 - u0 * u0 + 1 / (b * b);
    const df = 3 * u0 * u0 - 2 * u0;
    const du = f / df;
    u0 -= du;
    if (Math.abs(du) < 1e-15) break;
  }
  // φ = 2 ∫0^u0 du / sqrt(1/b² - u² + u³); substitute u = u0 (1 - t²) to remove the endpoint singularity.
  const g = (t: number): number => {
    const u = u0 * (1 - t * t);
    const p = 1 / (b * b) - u * u + u * u * u;
    if (t === 0) {
      const dp = -2 * u0 + 3 * u0 * u0; // dP/du at u0 (negative)
      return (2 * u0) / Math.sqrt(-dp * u0);
    }
    return (2 * u0 * t) / Math.sqrt(Math.max(p, 1e-300));
  };
  // Simpson on t ∈ [0, 1].
  let sum = g(0) + g(1);
  for (let i = 1; i < n; i++) sum += (i % 2 ? 4 : 2) * g(i / n);
  const half = sum / (3 * n);
  return 2 * half - Math.PI;
}

/** Weak-field series α ≈ 2/b + 15π/(16 b²) + 16/(3 b³) (r_s = 1). */
export const deflectionSeries = (b: number): number =>
  2 / b + (15 * Math.PI) / (16 * b * b) + 16 / (3 * b * b * b);

/** Samples f(b) = α(b) · b / 2 on a log grid for the shader LUT (b from bMin to bMax). */
export function deflectionLut(size: number, bMin: number, bMax: number): Float32Array {
  const out = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const b = bMin * (bMax / bMin) ** (i / (size - 1));
    out[i] = (deflectionExact(b) * b) / 2;
  }
  return out;
}
