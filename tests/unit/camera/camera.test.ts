import { describe, expect, it } from 'vitest';
import { SPEED_MAX, SPEED_MIN, SSB_FRAME } from '../../../src/core/contracts';
import { addStandardFrames, FrameTreeImpl } from '../../../src/core/frames';
import { quat, v3len, v3set, v3sub, vec3 } from '../../../src/core/math64';
import { RegistryImpl } from '../../../src/core/registry';
import { AU } from '../../../src/core/units';
import {
  Flight,
  GOTO_MAX_S,
  GOTO_MIN_S,
  planVwn,
  vwnRemaining,
  vwnU,
  vwnW,
} from '../../../src/camera/autopilot';
import { CameraController } from '../../../src/camera/controller';
import { applyFree, emptyInput } from '../../../src/camera/free';
import { applyOrbit } from '../../../src/camera/orbit';
import { criticallyDamped, SpeedController, targetSpeed } from '../../../src/camera/speed';

const R_EARTH = 6.371e6;

describe('van Wijk-Nuij goto', () => {
  const cases: [string, number, number, number][] = [
    ['Earth to Saturn', 1.3e12, 2e7, 1.8e8],
    ['Earth to Moon', 3.84e8, 2e7, 5.2e6],
    ['cosmic', 1e26, 1e7, 1e21],
    ['hop', 1e3, 50, 10],
  ];
  for (const [name, u1, w0, w1] of cases) {
    it(`reaches the end exactly and moves monotonically (${name})`, () => {
      const p = planVwn(w0, w1, u1);
      expect(p.S).toBeGreaterThan(0);
      expect(Math.abs(vwnU(p, p.S * (1 - 1e-12)) - u1) / u1).toBeLessThan(1e-6);
      expect(Math.abs(vwnU(p, p.S / 3) + vwnRemaining(p, p.S / 3) - u1) / u1).toBeLessThan(1e-9);
      expect(vwnW(p, 0)).toBeCloseTo(w0, 6);
      expect(vwnW(p, p.S) / w1).toBeCloseTo(1, 6);
    });
  }

  it('flies with distance to the target monotonic in log space, in 3-12 s', () => {
    for (const [, u1, w0, w1] of cases) {
      const target = vec3(0, 0, 0);
      const p1 = vec3(0, 0, w1 + 1);
      const p0 = vec3(u1 * 0.6, -u1 * 0.8, w1 + 1);
      const f = new Flight({ p0, p1, q0: quat(), q1: quat(), look: target, w0, w1 });
      expect(f.duration).toBeGreaterThanOrEqual(GOTO_MIN_S);
      expect(f.duration).toBeLessThanOrEqual(GOTO_MAX_S);
      const pose = { local: vec3(), quat: quat() };
      let prev = Infinity;
      let done = false;
      for (let i = 0; i <= 400 && !done; i++) {
        done = f.sample((i / 400) * f.duration, pose);
        const d = Math.log(v3len(v3sub(vec3(), pose.local, target)));
        expect(d).toBeLessThanOrEqual(prev + 1e-12);
        prev = d;
      }
      expect(done).toBe(true);
      expect(v3len(v3sub(vec3(), pose.local, p1))).toBeLessThan(1e-6 * (w1 + 1));
    }
  });
});

describe('speed', () => {
  it('scales with distance, clamps and settles critically damped', () => {
    expect(targetSpeed(1, 1e7)).toBe(1e7);
    expect(targetSpeed(10, 1e7)).toBe(5e7); // k clamped to 5
    expect(targetSpeed(1, 0)).toBe(SPEED_MIN);
    expect(targetSpeed(5, 1e30)).toBe(SPEED_MAX);
    let [x, v] = [0, 0];
    let overshoot = false;
    for (let i = 0; i < 120; i++) {
      [x, v] = criticallyDamped(x, v, 1, 8, 1 / 60);
      if (x > 1 + 1e-9) overshoot = true;
    }
    expect(overshoot).toBe(false);
    expect(x).toBeCloseTo(1, 3);
    const s = new SpeedController(1);
    for (let i = 0; i < 120; i++) s.update(1e6, 1 / 60);
    expect(s.speed / 1e6).toBeCloseTo(1, 1);
  });
});

describe('free and orbit control', () => {
  it('moves along the view direction and looks around', () => {
    const pose = { local: vec3(), quat: quat() };
    const input = { ...emptyInput(), forward: 1 };
    expect(applyFree(pose, input, 10, 0.5)).toBe(5);
    expect(pose.local.z).toBeCloseTo(-5, 12);
    applyFree(pose, { ...emptyInput(), yaw: Math.PI / 2 }, 10, 0.1);
    applyFree(pose, { ...emptyInput(), forward: 1 }, 10, 0.1);
    expect(pose.local.x).toBeCloseTo(-1, 9);
  });

  it('orbits at constant distance and zooms altitude multiplicatively', () => {
    const pose = { local: vec3(0, 0, 4 * R_EARTH), quat: quat() };
    applyOrbit(pose, 0.3, 0.2, 1, R_EARTH);
    expect(v3len(pose.local)).toBeCloseTo(4 * R_EARTH, 3);
    applyOrbit(pose, 0, 0, 0.5, R_EARTH);
    expect(v3len(pose.local)).toBeCloseTo(2.5 * R_EARTH, 3);
  });
});

describe('CameraController', () => {
  const setup = () => {
    const frames = new FrameTreeImpl();
    addStandardFrames(frames);
    const registry = new RegistryImpl(frames);
    registry.addFrame({
      id: 'earth',
      parent: SSB_FRAME,
      influenceRadius: 1e9,
      positionAt: (_j, o) => v3set(o, AU, 0, 0),
    });
    registry.addBody({
      id: 'earth',
      name: 'Earth',
      kind: 'planet',
      frame: 'earth',
      radius: R_EARTH,
      influenceRadius: 1e9,
    });
    const camera = new CameraController({ frames, registry, jd: () => 2451545 });
    return { frames, registry, camera };
  };

  it('teleports to a body and re-anchors into its frame', async () => {
    const { camera } = setup();
    camera.setState({ frame: SSB_FRAME, local: vec3(0, 0, 2 * AU) });
    expect(camera.getState().frame).toBe(SSB_FRAME);
    expect(await camera.goto('earth', { instant: true })).toBe(true);
    const s = camera.getState();
    expect(s.frame).toBe('earth');
    expect(v3len(s.local) / R_EARTH).toBeCloseTo(4, 9);
    expect(camera.target).toBe('earth');
    expect(camera.nearestSurface()!.altitude / R_EARTH).toBeCloseTo(3, 9);
    expect(await camera.goto('nowhere')).toBe(false);
    camera.setState({ frame: SSB_FRAME, local: vec3(AU + 2e9, 0, 0) });
    expect(camera.getState().frame).toBe(SSB_FRAME);
    camera.setState({ frame: SSB_FRAME, local: vec3(AU + 5e8, 0, 0) });
    expect(camera.getState().frame).toBe('earth');
  });

  it('flies a goto that resolves on arrival with monotonic distance', async () => {
    const { camera, frames } = setup();
    camera.setState({ frame: SSB_FRAME, local: vec3(0, 3 * AU, 0) });
    let resolved: boolean | null = null;
    void camera.goto('earth').then((ok) => (resolved = ok));
    expect(camera.traveling).toBe(true);
    let prev = Infinity;
    let t = 0;
    for (; t < 20 && camera.traveling; t += 0.05) {
      camera.update(0.05);
      const s = camera.getState();
      const d = v3len(frames.delta(s.frame, s.local, 'earth', vec3(), 2451545, vec3()));
      expect(d).toBeLessThanOrEqual(prev * (1 + 1e-12));
      prev = d;
    }
    await Promise.resolve();
    expect(resolved).toBe(true);
    expect(t).toBeGreaterThanOrEqual(3 - 1e-9);
    expect(t).toBeLessThanOrEqual(12.1);
    expect(prev / R_EARTH).toBeCloseTo(4, 6);
  });

  it('keeps the camera above the surface', () => {
    const { camera } = setup();
    camera.setState({ frame: 'earth', local: vec3(R_EARTH * 0.5, 0, 0) });
    camera.update(1 / 60);
    expect(camera.nearestSurface()!.altitude).toBeGreaterThanOrEqual(0.999);
    camera.speedFactor = 100;
    expect(camera.speedFactor).toBe(5);
  });
});
