import { describe, expect, it } from 'vitest';
import { SSB_FRAME } from '../../../src/core/contracts';
import { addStandardFrames, FrameTreeImpl } from '../../../src/core/frames';
import { quat, qrotate, v3set, vec3 } from '../../../src/core/math64';
import { RegistryImpl } from '../../../src/core/registry';
import { AU } from '../../../src/core/units';
import { CameraController } from '../../../src/camera/controller';
import {
  deadZone,
  PAD_DEAD_ZONE,
  PAD_LOOK_RATE,
  pickPad,
  readPad,
  type PadLike,
} from '../../../src/camera/gamepad';

const R = 6.371e6;
const pad = (axes: number[], pressed: number[] = [], values: Record<number, number> = {}): PadLike => ({
  axes,
  buttons: Array.from({ length: 17 }, (_, i) => ({
    pressed: pressed.includes(i),
    value: values[i] ?? (pressed.includes(i) ? 1 : 0),
  })),
  mapping: 'standard',
});

describe('gamepad mapping', () => {
  it('ignores stick drift and rescales the rest', () => {
    expect(deadZone(0.1)).toBe(0);
    expect(deadZone(-PAD_DEAD_ZONE)).toBe(0);
    expect(deadZone(1)).toBe(1);
    expect(deadZone(-1)).toBe(-1);
    expect(deadZone(0.575)).toBeCloseTo(0.5, 6);
    expect(deadZone(Number.NaN)).toBe(0);
  });

  it('left stick moves, right stick looks the way it is pushed, triggers go up and down', () => {
    const c = readPad(pad([1, -1, 1, -1], [], { 7: 1 }));
    expect(c.right).toBe(1);
    expect(c.forward).toBe(1);
    // Stick right turns the view right (negative yaw), stick up looks up.
    expect(c.yaw).toBeCloseTo(-PAD_LOOK_RATE, 9);
    expect(c.pitch).toBeCloseTo(PAD_LOOK_RATE, 9);
    expect(c.up).toBe(1);
    expect(readPad(pad([0, 0, 0, 0], [], { 6: 1 })).up).toBe(-1);
    expect(readPad(pad([0, 0, 0, 0], [4])).roll).toBe(-1);
    const idle = readPad(pad([0.05, -0.08, 0.1, 0]));
    expect([idle.right, idle.forward, idle.yaw, idle.pitch, idle.up, idle.roll]).toEqual([
      0, -0, -0, -0, 0, 0,
    ]);
  });

  it('prefers a pad with the standard mapping', () => {
    const odd = { axes: [0, 0], buttons: [], mapping: '' };
    const std = pad([0, 0, 0, 0]);
    expect(pickPad([null, odd, std])).toBe(std);
    expect(pickPad([null, odd])).toBe(odd);
    expect(pickPad([null, null])).toBeNull();
  });
});

describe('gamepad in the camera controller', () => {
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
      radius: R,
      influenceRadius: 1e9,
    });
    const camera = new CameraController({ frames, registry, jd: () => 2451545 });
    camera.setState({ frame: 'earth', local: vec3(0, 0, 3 * R), quat: quat() });
    return camera;
  };
  const step = (camera: CameraController, p: PadLike | null, n = 30) => {
    for (let i = 0; i < n; i++) {
      camera.pollGamepad(1 / 60, [p]);
      camera.update(1 / 60);
    }
  };

  it('flies forward with the left stick and stops when the pad goes away', () => {
    const camera = setup();
    const z0 = camera.getState().local.z;
    step(camera, pad([0, -1, 0, 0]));
    const z1 = camera.getState().local.z;
    expect(z1).toBeLessThan(z0 - 1000);
    step(camera, null, 120);
    const z2 = camera.getState().local.z;
    step(camera, null, 5);
    expect(camera.getState().local.z).toBe(z2);
  });

  it('a pad at rest does not cancel the on-screen stick', () => {
    const camera = setup();
    camera.setVirtualInput({ right: 1 });
    const x0 = camera.getState().local.x;
    step(camera, pad([0, 0, 0, 0]));
    expect(camera.getState().local.x).toBeGreaterThan(x0 + 1000);
  });

  it('looks right with the right stick and changes speed once per d-pad press', () => {
    const camera = setup();
    step(camera, pad([0, 0, 1, 0]), 20);
    const f = qrotate(vec3(), camera.getState().quat, vec3(0, 0, -1));
    expect(f.x).toBeGreaterThan(0.3);
    const k0 = camera.speedFactor;
    step(camera, pad([0, 0, 0, 0], [12]), 10);
    expect(camera.speedFactor).toBeCloseTo(k0 * 1.25, 9);
    step(camera, pad([0, 0, 0, 0]), 2);
    step(camera, pad([0, 0, 0, 0], [13]), 3);
    expect(camera.speedFactor).toBeCloseTo(k0, 9);
  });

  it('Y lands from above, and takes off again when walking', async () => {
    const camera = setup();
    step(camera, pad([0, 0, 0, 0], [3]), 1);
    expect(camera.traveling).toBe(true);
    for (let i = 0; i < 1200 && camera.traveling; i++) camera.update(1 / 60);
    await Promise.resolve();
    expect(camera.mode).toBe('walk');
    step(camera, pad([0, 0, 0, 0]), 1);
    step(camera, pad([0, 0, 0, 0], [3]), 1);
    expect(camera.mode).toBe('free');
  });
});
