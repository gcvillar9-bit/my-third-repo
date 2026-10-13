/**
 * Distance-scaled flight speed (DESIGN 3.2 Speed): v = k · d_nearest, k ∈ [0.1, 5] /s,
 * clamped to [SPEED_MIN, SPEED_MAX], smoothed by a critically damped spring in log space
 * (speeds span ~27 orders of magnitude, so linear smoothing would be meaningless).
 */
import { SPEED_MAX, SPEED_MIN } from '../core/contracts';

export const K_MIN = 0.1;
export const K_MAX = 5;
export const K_DEFAULT = 1;
/** Spring angular frequency, rad/s (settles in about 0.6 s). */
export const SPEED_OMEGA = 8;

export const clampK = (k: number): number => Math.min(K_MAX, Math.max(K_MIN, k));

export function targetSpeed(k: number, dNearest: number): number {
  const v = clampK(k) * Math.max(0, dNearest);
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, Number.isFinite(v) ? v : SPEED_MAX));
}

/** One exact step of a critically damped spring: returns [x, v] after dt towards target. */
export function criticallyDamped(
  x: number,
  v: number,
  target: number,
  omega: number,
  dt: number,
): [number, number] {
  const x0 = x - target;
  const e = Math.exp(-omega * dt);
  const k = v + omega * x0;
  return [target + (x0 + k * dt) * e, (v - omega * k * dt) * e];
}

export class SpeedController {
  private logV: number;
  private vel = 0;

  constructor(initial = SPEED_MIN) {
    this.logV = Math.log(initial);
  }

  get speed(): number {
    return Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.exp(this.logV)));
  }

  update(target: number, dt: number): number {
    [this.logV, this.vel] = criticallyDamped(this.logV, this.vel, Math.log(target), SPEED_OMEGA, dt);
    return this.speed;
  }

  reset(speed: number): void {
    this.logV = Math.log(Math.min(SPEED_MAX, Math.max(SPEED_MIN, speed)));
    this.vel = 0;
  }
}
