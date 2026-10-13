import { describe, expect, it } from 'vitest';
import { SSB_FRAME } from '../../../src/core/contracts';
import { addStandardFrames, FrameTreeImpl } from '../../../src/core/frames';
import {
  qfromAxisAngle,
  qrotate,
  quat,
  v3dot,
  v3len,
  v3normalize,
  v3set,
  vec3,
} from '../../../src/core/math64';
import { RegistryImpl } from '../../../src/core/registry';
import { CameraController } from '../../../src/camera/controller';
import {
  EYE_HEIGHT,
  JUMP_SPEED,
  jumpApex,
  RUN_SPEED,
  surfaceGravity,
  WALK_SPEED,
  Walker,
  type WalkInput,
} from '../../../src/camera/walk';

const MOON = { radius: 1738.1e3, gm: 4902.800118e9 };
const DT = 1 / 60;
const none = (): WalkInput => ({ forward: 0, right: 0, yaw: 0, pitch: 0, run: false, jump: false });

function standing(ground: (d: { x: number; y: number; z: number }) => number) {
  const w = new Walker(surfaceGravity(MOON));
  const pose = { local: vec3(MOON.radius + 5, 0, 0), quat: quat() };
  w.enter(pose, ground);
  return { w, pose };
}

describe('walk physics', () => {
  it('uses g = GM/R² (Moon 1.62 m/s²)', () => {
    expect(surfaceGravity(MOON)).toBeCloseTo(1.623, 3);
    expect(surfaceGravity({ radius: 1e5 })).toBeGreaterThan(0);
  });

  it('jumps on a ballistic arc: apex v²/2g ≈ 1.23 m at 2 m/s on the Moon, airtime 2v/g', () => {
    const g = surfaceGravity(MOON);
    expect(jumpApex(JUMP_SPEED, g)).toBeCloseTo(1.232, 3);
    const flat = () => MOON.radius;
    const { w, pose } = standing(flat);
    expect(v3len(pose.local) - MOON.radius).toBeCloseTo(EYE_HEIGHT, 9);
    let apex = 0;
    let t = 0;
    w.step(pose, { ...none(), jump: true }, DT, flat);
    t += DT;
    while (!w.grounded && t < 10) {
      apex = Math.max(apex, v3len(pose.local) - MOON.radius - EYE_HEIGHT);
      w.step(pose, none(), DT, flat);
      t += DT;
    }
    expect(Math.abs(apex - jumpApex(JUMP_SPEED, g))).toBeLessThan(1e-3);
    expect(Math.abs(t - (2 * JUMP_SPEED) / g)).toBeLessThanOrEqual(DT + 1e-9);
    expect(v3len(pose.local) - MOON.radius).toBeCloseTo(EYE_HEIGHT, 9);
  });

  it('walks at 1.4 m/s and runs with Shift, keeping the eye height', () => {
    for (const [run, v] of [
      [false, WALK_SPEED],
      [true, RUN_SPEED],
    ] as const) {
      const flat = () => MOON.radius;
      const { w, pose } = standing(flat);
      const p0 = { ...pose.local };
      for (let i = 0; i < 60; i++) w.step(pose, { ...none(), forward: 1, run }, DT, flat);
      const d = Math.hypot(pose.local.x - p0.x, pose.local.y - p0.y, pose.local.z - p0.z);
      expect(d).toBeCloseTo(v, 2);
      expect(v3len(pose.local) - MOON.radius).toBeCloseTo(EYE_HEIGHT, 6);
    }
  });

  it('follows a slope with the eye 1.7 m above the ground and stays level', () => {
    // Ground rising 20 cm per metre along +y.
    const slope = (d: { x: number; y: number; z: number }) =>
      MOON.radius + 0.2 * MOON.radius * Math.atan2(d.y, d.x);
    const { w, pose } = standing(slope);
    // Face +y (the default camera looks down -Z; turn it to look along +y with up +x).
    pose.quat = qfromAxisAngle(quat(), vec3(0, 0, 1), -Math.PI / 2);
    for (let i = 0; i < 120; i++) w.step(pose, { ...none(), forward: 1, yaw: 0.002 }, DT, slope);
    const up = v3normalize(vec3(), pose.local);
    expect(v3len(pose.local) - slope(up)).toBeCloseTo(EYE_HEIGHT, 3);
    const camUp = qrotate(vec3(), pose.quat, vec3(0, 1, 0));
    const right = qrotate(vec3(), pose.quat, vec3(1, 0, 0));
    expect(Math.abs(v3dot(right, up))).toBeLessThan(1e-9); // no roll
    expect(v3dot(camUp, up)).toBeGreaterThan(0.9);
  });

  it('clamps pitch below ±89°', () => {
    const flat = () => MOON.radius;
    const { w, pose } = standing(flat);
    for (let i = 0; i < 20; i++) w.step(pose, { ...none(), pitch: 0.3 }, DT, flat);
    const f = qrotate(vec3(), pose.quat, vec3(0, 0, -1));
    const up = v3normalize(vec3(), pose.local);
    expect(Math.asin(v3dot(f, up))).toBeLessThanOrEqual((89 * Math.PI) / 180 + 1e-9);
  });
});

describe('controller walk mode', () => {
  const setup = () => {
    const frames = new FrameTreeImpl();
    addStandardFrames(frames);
    const registry = new RegistryImpl(frames);
    registry.addFrame({
      id: 'moon',
      parent: SSB_FRAME,
      influenceRadius: 6e7,
      positionAt: (_j, o) => v3set(o, 1e11, 0, 0),
    });
    registry.addFrame({
      id: 'moon.fixed',
      parent: 'moon',
      influenceRadius: 1.5 * MOON.radius,
      positionAt: (_j, o) => v3set(o, 0, 0, 0),
      orientationAt: (jd, o) => qfromAxisAngle(o, vec3(0, 0, 1), (jd - 2451545) * 0.23),
    });
    registry.addBody({
      id: 'moon',
      name: 'Moon',
      kind: 'moon',
      frame: 'moon',
      fixedFrame: 'moon.fixed',
      radius: MOON.radius,
      gm: MOON.gm,
      influenceRadius: 6e7,
    });
    let jd = 2451545.1;
    const camera = new CameraController({ frames, registry, jd: () => jd });
    return { camera, frames, setJd: (j: number) => (jd = j) };
  };

  it('enters walk within 10 km of the surface, anchored to the .fixed frame, and refuses beyond', () => {
    const { camera } = setup();
    camera.setState({ frame: 'moon', local: vec3(MOON.radius + 20e3, 0, 0) });
    camera.setMode('walk');
    expect(camera.mode).toBe('free');
    camera.setState({ frame: 'moon', local: vec3(MOON.radius + 5e3, 0, 0) });
    camera.setMode('walk');
    expect(camera.mode).toBe('walk');
    const s = camera.getState();
    expect(s.frame).toBe('moon.fixed');
    expect(v3len(s.local) - MOON.radius).toBeCloseTo(EYE_HEIGHT, 6);
    camera.update(DT);
    expect(camera.getState().frame).toBe('moon.fixed');
    expect(camera.nearestSurface()!.altitude).toBeCloseTo(EYE_HEIGHT, 6);
    camera.setMode('free');
    expect(camera.mode).toBe('free');
  });

  it('rotates with the body while walking', () => {
    const { camera, frames, setJd } = setup();
    camera.setState({ frame: 'moon', local: vec3(MOON.radius + 1, 0, 0) });
    camera.setMode('walk');
    const a = frames.convertPoint('moon.fixed', camera.getState().local, 'moon', 2451545.1, vec3());
    setJd(2451545.2);
    camera.update(DT);
    const b = frames.convertPoint('moon.fixed', camera.getState().local, 'moon', 2451545.2, vec3());
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(1e3);
    expect(v3len(camera.getState().local) - MOON.radius).toBeCloseTo(EYE_HEIGHT, 6);
  });
});
