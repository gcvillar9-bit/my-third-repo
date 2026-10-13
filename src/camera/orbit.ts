/**
 * Orbit mode: the camera circles the target body (drag or A/D, R/F), always looking at its
 * centre; the wheel or W/S zooms the altitude multiplicatively. Pose is in the target's frame.
 */
import type { Quatd, Vec3d } from '../core/contracts';
import { qfromAxisAngle, qlookRotation, qmul, qrotate, quat, v3len, v3scale, vec3 } from '../core/math64';

export const MIN_ORBIT_ALTITUDE = 1;

/**
 * Rotates `rel` (camera minus target centre) by yaw about the camera's up axis and pitch about
 * its right axis, scales the altitude by `zoom`, then re-aims the camera at the centre.
 */
export function applyOrbit(
  pose: { local: Vec3d; quat: Quatd },
  yaw: number,
  pitch: number,
  zoom: number,
  radius: number,
): void {
  const up = qrotate(vec3(), pose.quat, vec3(0, 1, 0));
  const right = qrotate(vec3(), pose.quat, vec3(1, 0, 0));
  const q = quat();
  qmul(q, qfromAxisAngle(quat(), up, -yaw), qfromAxisAngle(quat(), right, -pitch));
  qrotate(pose.local, q, pose.local);
  const d = v3len(pose.local);
  if (d > 0 && zoom !== 1) {
    const alt = Math.max(MIN_ORBIT_ALTITUDE, (d - radius) * zoom);
    v3scale(pose.local, pose.local, (radius + alt) / d);
  }
  const newUp = qrotate(vec3(), q, up);
  qlookRotation(pose.quat, v3scale(vec3(), pose.local, -1), newUp);
}
