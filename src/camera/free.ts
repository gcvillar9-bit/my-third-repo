/**
 * Free 6DOF flight: W/S forward/back, A/D strafe, R/F (or Space/C) up/down, Q/E roll, mouse drag
 * or arrow keys to look. Pure update on a Float64 pose expressed in the anchor frame's axes.
 */
import type { Quatd, Vec3d } from '../core/contracts';
import { qfromAxisAngle, qmul, qnormalize, qrotate, quat, v3addScaled, vec3 } from '../core/math64';

export interface FlightInput {
  /** -1..1 along camera -Z (forward). */
  forward: number;
  /** -1..1 along camera +X. */
  right: number;
  /** -1..1 along camera +Y. */
  up: number;
  /** Roll rate input -1..1 (positive = clockwise). */
  roll: number;
  /** Look deltas this frame, radians (yaw about camera +Y, pitch about camera +X). */
  yaw: number;
  pitch: number;
}

export const emptyInput = (): FlightInput => ({ forward: 0, right: 0, up: 0, roll: 0, yaw: 0, pitch: 0 });
/** Roll speed at full input, rad/s. */
export const ROLL_RATE = 1.2;

const X = vec3(1, 0, 0);
const Y = vec3(0, 1, 0);
const Z = vec3(0, 0, 1);

/** Applies look rotations in camera space: q = q · yaw · pitch · roll. */
export function applyLook(q: Quatd, yaw: number, pitch: number, roll: number): Quatd {
  const t = quat();
  if (yaw) qmul(q, q, qfromAxisAngle(t, Y, yaw));
  if (pitch) qmul(q, q, qfromAxisAngle(t, X, pitch));
  if (roll) qmul(q, q, qfromAxisAngle(t, Z, -roll));
  return qnormalize(q, q);
}

/** Moves and rotates a pose in place. Returns the displacement length, m. */
export function applyFree(
  pose: { local: Vec3d; quat: Quatd },
  input: FlightInput,
  speed: number,
  dt: number,
): number {
  applyLook(pose.quat, input.yaw, input.pitch, input.roll * ROLL_RATE * dt);
  const move = vec3(input.right, input.up, -input.forward);
  const len = Math.hypot(move.x, move.y, move.z);
  if (len === 0) return 0;
  const n = 1 / Math.max(1, len);
  qrotate(move, pose.quat, move);
  v3addScaled(pose.local, pose.local, move, speed * dt * n);
  return speed * dt * Math.min(1, len);
}
