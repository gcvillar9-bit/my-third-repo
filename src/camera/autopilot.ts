/**
 * Goto flights (DESIGN P1-A): van Wijk & Nuij "smooth and efficient zooming and panning" with
 * ρ = 1.4. The camera moves on a straight line from start to end; u(s) of the optimal pan-zoom
 * path (w = altitude/zoom) gives the progress, so speed ∝ zoom and the flight is uniform in log
 * space. Duration 3-12 s, proportional to the path length S.
 */
import type { Quatd, Vec3d } from '../core/contracts';
import {
  qlookRotation,
  qrotate,
  qslerp,
  quat,
  v3addScaled,
  v3len,
  v3scale,
  v3sub,
  vec3,
} from '../core/math64';

export const RHO = 1.4;
export const GOTO_MIN_S = 3;
export const GOTO_MAX_S = 12;
/** Seconds per unit of vWN path length. */
export const GOTO_SECONDS_PER_S = 0.45;

export interface VwnPath {
  rho: number;
  w0: number;
  w1: number;
  u1: number;
  r0: number;
  r1: number;
  /** Path length in vWN units. */
  S: number;
}

export function planVwn(w0: number, w1: number, u1: number, rho = RHO): VwnPath {
  w0 = Math.max(w0, 1e-6);
  w1 = Math.max(w1, 1e-6);
  if (!(u1 > 1e-9 * Math.max(w0, w1))) {
    return { rho, w0, w1, u1: 0, r0: 0, r1: 0, S: Math.abs(Math.log(w1 / w0)) / rho };
  }
  const r2 = rho * rho;
  const r4u = r2 * r2 * u1 * u1;
  const b0 = (w1 * w1 - w0 * w0 + r4u) / (2 * w0 * r2 * u1);
  const b1 = (w1 * w1 - w0 * w0 - r4u) / (2 * w1 * r2 * u1);
  // r = ln(-b + sqrt(b² + 1)) = -asinh(b), without cancellation for large b.
  const r0 = -Math.asinh(b0);
  const r1 = -Math.asinh(b1);
  return { rho, w0, w1, u1, r0, r1, S: (r1 - r0) / rho };
}

/** Distance travelled along the line at path parameter s ∈ [0, S]. */
export function vwnU(p: VwnPath, s: number): number {
  if (p.u1 === 0) return 0;
  if (s >= p.S) return p.u1;
  // u(s) = w0/ρ² (cosh r0 tanh(ρs + r0) − sinh r0) = w0/ρ² · sinh(ρs) / cosh(ρs + r0)
  return Math.min(p.u1, ((p.w0 / (p.rho * p.rho)) * Math.sinh(p.rho * s)) / Math.cosh(p.rho * s + p.r0));
}

/** Remaining distance u1 − u(s), computed on the reversed path for precision near the end. */
export function vwnRemaining(p: VwnPath, s: number): number {
  if (p.u1 === 0) return 0;
  const t = Math.max(0, p.S - s);
  return Math.min(p.u1, ((p.w1 / (p.rho * p.rho)) * Math.sinh(p.rho * t)) / Math.cosh(p.rho * t - p.r1));
}

/** Zoom level w(s). */
export function vwnW(p: VwnPath, s: number): number {
  if (p.u1 === 0) return p.w0 * Math.exp((Math.sign(Math.log(p.w1 / p.w0)) || 0) * p.rho * s);
  return (p.w0 * Math.cosh(p.r0)) / Math.cosh(p.rho * s + p.r0);
}

export const gotoDuration = (S: number): number =>
  Math.min(GOTO_MAX_S, Math.max(GOTO_MIN_S, S * GOTO_SECONDS_PER_S));

/** Eased path parameter: monotonic, zero start/end acceleration bias, s(0) = 0, s(1) = S. */
export function easePath(tau: number, S: number): number {
  const t = Math.min(1, Math.max(0, tau));
  return S * (0.7 * t + 0.3 * (t - Math.sin(2 * Math.PI * t) / (2 * Math.PI)));
}

const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

export interface FlightSpec {
  /** Start and end positions in the flight frame (the target's frame). */
  p0: Vec3d;
  p1: Vec3d;
  q0: Quatd;
  /** Final orientation (flight-frame axes). */
  q1: Quatd;
  /** Point to look at during the flight (flight frame), usually the target centre. */
  look: Vec3d;
  /** Zoom at start/end: altitude above the nearest/target surface, m. */
  w0: number;
  w1: number;
  /** Seconds; default from the path length. */
  duration?: number;
}

/** A planned flight; sample(t) gives the pose at real time t since the start. */
export class Flight {
  readonly path: VwnPath;
  readonly duration: number;
  private dir: Vec3d;
  private up: Vec3d;

  constructor(readonly spec: FlightSpec) {
    const d = v3sub(vec3(), spec.p1, spec.p0);
    const u1 = v3len(d);
    this.dir = u1 > 0 ? v3scale(d, d, 1 / u1) : vec3();
    this.path = planVwn(spec.w0, spec.w1, u1);
    this.duration = spec.duration ?? gotoDuration(this.path.S);
    this.up = qrotate(vec3(), spec.q0, vec3(0, 1, 0));
  }

  /** Writes the pose at time t (s) into pose; returns true when finished. */
  sample(t: number, pose: { local: Vec3d; quat: Quatd }): boolean {
    const tau = this.duration > 0 ? t / this.duration : 1;
    const done = tau >= 1;
    const s = done ? this.path.S : easePath(tau, this.path.S);
    const u = vwnU(this.path, s);
    if (done) pose.local = { ...this.spec.p1 };
    else if (u < this.path.u1 / 2) v3addScaled(pose.local, this.spec.p0, this.dir, u);
    else v3addScaled(pose.local, this.spec.p1, this.dir, -vwnRemaining(this.path, s));
    const toLook = v3sub(vec3(), this.spec.look, pose.local);
    const qLook = v3len(toLook) > 0 ? qlookRotation(quat(), toLook, this.up) : { ...this.spec.q1 };
    const q = quat();
    qslerp(q, this.spec.q0, qLook, smooth(tau / 0.3));
    qslerp(q, q, this.spec.q1, smooth((tau - 0.7) / 0.3));
    pose.quat = done ? { ...this.spec.q1 } : q;
    return done;
  }
}
