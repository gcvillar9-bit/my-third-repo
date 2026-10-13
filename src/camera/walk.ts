/**
 * Walk mode (P2): a pure walker on a body's surface. The pose lives in the body's `.fixed` frame
 * (origin at the body centre), so the walker rotates with the planet. Gravity g = GM/R² from the
 * Body; vertical motion integrates the ballistic arc exactly (r += v·dt − ½g·dt²), so a jump at
 * v reaches v²/2g whatever the frame rate. W/S/A/D walk (Shift runs), Space jumps, mouse/arrows
 * look with yaw about the local vertical and pitch clamped to ±89°.
 */
import type { Body, Quatd, Vec3d } from '../core/contracts';
import {
  qfromAxisAngle,
  qlookRotation,
  qmul,
  qnormalize,
  qrotate,
  quat,
  v3addScaled,
  v3dot,
  v3len,
  v3normalize,
  v3scale,
  vec3,
} from '../core/math64';
import { EYE_HEIGHT } from './collision-hook';

export { EYE_HEIGHT };
/** Walking speed, m/s. */
export const WALK_SPEED = 1.4;
/** Running speed (Shift), m/s. */
export const RUN_SPEED = 4.2;
/** Vertical take-off speed of a jump, m/s. */
export const JUMP_SPEED = 2;
/** Walk mode can be entered within this altitude of a surface, m. */
export const WALK_RANGE = 10_000;
/** Entering above eye height but below this altitude falls under gravity instead of snapping, m. */
export const SEAT_MAX = 3;
const PITCH_LIMIT = (89 * Math.PI) / 180;
const G = 6.6743e-11;

export interface WalkInput {
  /** −1..1 forward/back. */
  forward: number;
  /** −1..1 right/left. */
  right: number;
  /** Look deltas this frame, radians (yaw about the local up, pitch about camera +X). */
  yaw: number;
  pitch: number;
  run: boolean;
  jump: boolean;
}

export interface WalkPose {
  /** Eye position relative to the body centre, body-fixed axes, m. */
  local: Vec3d;
  /** Camera orientation relative to body-fixed axes. */
  quat: Quatd;
}

/** Ground distance from the body centre along a unit body-fixed direction, m. */
export type GroundFn = (dir: Vec3d) => number;

/** Surface gravity g = GM/R² (falls back to a rocky density of 2500 kg/m³ without GM). */
export function surfaceGravity(b: Pick<Body, 'gm' | 'radius'>): number {
  if (b.gm && b.gm > 0) return b.gm / (b.radius * b.radius);
  return (4 / 3) * Math.PI * G * 2500 * b.radius;
}

/** Apex height of a jump at take-off speed v under gravity g, m. */
export const jumpApex = (v: number, g: number): number => (v * v) / (2 * g);

export class Walker {
  /** Radial (vertical) speed, m/s, positive up. */
  vr = 0;
  /** Horizontal velocity kept while airborne, body-fixed, m/s. */
  readonly vh = vec3();
  grounded = true;

  constructor(readonly g: number) {}

  /** Places the eye at a valid height and levels the camera. */
  enter(pose: WalkPose, ground: GroundFn): void {
    const r = v3len(pose.local);
    const up = v3scale(vec3(), pose.local, 1 / r);
    const gr = ground(up);
    const alt = r - gr;
    this.vr = 0;
    this.vh.x = this.vh.y = this.vh.z = 0;
    if (alt > EYE_HEIGHT && alt <= SEAT_MAX) {
      this.grounded = false;
    } else {
      this.grounded = true;
      v3scale(pose.local, up, gr + EYE_HEIGHT);
    }
    this.level(pose, up, 0, 0);
  }

  /** Applies yaw about `up`, pitch about camera X, clamps pitch and removes roll. */
  private level(pose: WalkPose, up: Vec3d, yaw: number, pitch: number): void {
    const t = quat();
    if (yaw) qmul(pose.quat, qfromAxisAngle(t, up, yaw), pose.quat);
    if (pitch) qmul(pose.quat, pose.quat, qfromAxisAngle(t, vec3(1, 0, 0), pitch));
    qnormalize(pose.quat, pose.quat);
    const f = qrotate(vec3(), pose.quat, vec3(0, 0, -1));
    let el = Math.asin(Math.max(-1, Math.min(1, v3dot(f, up))));
    let h = v3addScaled(vec3(), f, up, -v3dot(f, up));
    if (v3len(h) < 1e-9) h = qrotate(vec3(), pose.quat, vec3(0, -Math.sign(el) || 1, 0));
    h = v3addScaled(h, h, up, -v3dot(h, up));
    v3normalize(h, h);
    el = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, el));
    const fw = v3addScaled(vec3(), v3scale(vec3(), h, Math.cos(el)), up, Math.sin(el));
    qlookRotation(pose.quat, fw, up);
  }

  /** Advances the walker by dt seconds. */
  step(pose: WalkPose, input: WalkInput, dt: number, ground: GroundFn): void {
    let r = v3len(pose.local);
    const up = v3scale(vec3(), pose.local, 1 / r);
    this.level(pose, up, input.yaw, input.pitch);
    // Horizontal heading from the camera, projected on the local horizontal plane.
    const f = qrotate(vec3(), pose.quat, vec3(0, 0, -1));
    const rt = qrotate(vec3(), pose.quat, vec3(1, 0, 0));
    v3normalize(f, v3addScaled(f, f, up, -v3dot(f, up)));
    v3normalize(rt, v3addScaled(rt, rt, up, -v3dot(rt, up)));
    if (this.grounded) {
      const len = Math.hypot(input.forward, input.right);
      const speed = (input.run ? RUN_SPEED : WALK_SPEED) / Math.max(1, len);
      this.vh.x = (f.x * input.forward + rt.x * input.right) * speed;
      this.vh.y = (f.y * input.forward + rt.y * input.right) * speed;
      this.vh.z = (f.z * input.forward + rt.z * input.right) * speed;
      if (input.jump) {
        this.grounded = false;
        this.vr = JUMP_SPEED;
      }
    }
    // Horizontal move, then back to the same radius along the new vertical.
    const p = v3addScaled(vec3(), pose.local, this.vh, dt);
    const dir = v3normalize(vec3(), p);
    const gr = ground(dir);
    const hs = v3len(this.vh);
    if (this.grounded) {
      const target = gr + EYE_HEIGHT;
      const snap = Math.max(0.05, 2 * hs * dt);
      if (r - target > snap) {
        // Walked off a ledge: start falling.
        this.grounded = false;
        this.vr = 0;
      } else r = target;
    }
    if (!this.grounded) {
      r += this.vr * dt - 0.5 * this.g * dt * dt;
      this.vr -= this.g * dt;
      if (r - EYE_HEIGHT <= gr) {
        r = gr + EYE_HEIGHT;
        this.vr = 0;
        this.grounded = true;
      }
    }
    v3scale(pose.local, dir, r);
    // Keep the camera level relative to the new vertical (the up vector turned by the move).
    this.level(pose, dir, 0, 0);
  }
}
