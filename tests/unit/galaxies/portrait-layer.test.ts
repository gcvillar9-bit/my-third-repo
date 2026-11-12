import { describe, expect, it } from 'vitest';
import { ROOT_FRAME, type Vec3d, type ViewState } from '../../../src/core/contracts';
import { MPC } from '../../../src/core/units';
import type { GalaxyData } from '../../../src/modules/galaxies/format';
import { createPortraitLayer, PORTRAIT_MAX_DRAWS } from '../../../src/modules/galaxies/portrait';

/** n galaxies along +x, 1-3 Mpc from the camera at the origin, radius growing with index (Sb). */
function fakeData(n: number): GalaxyData {
  const pos = new Float32Array(3 * n);
  const radiusKpc = new Float32Array(n);
  const absMag = new Float32Array(n).fill(-20);
  const quat = new Int8Array(4 * n);
  for (let i = 0; i < n; i++) {
    pos[3 * i] = 1 + 0.1 * i;
    pos[3 * i + 1] = 0.05 * i;
    radiusKpc[i] = 5 + 2 * i;
    quat[4 * i + 3] = 127;
  }
  return {
    count: n,
    pos,
    radiusKpc,
    absMag,
    quat,
    nameIdx: new Uint16Array(n),
    type: new Uint8Array(n).fill(10),
  };
}

function fakeView(frameIndex: number): ViewState {
  return {
    frameIndex,
    pixelAngle: 1e-3,
    exposure: 1,
    test: true,
    knobs: { volumeSteps: 8 },
    frameQuat: (_f: string, out: { x: number; y: number; z: number; w: number }) =>
      Object.assign(out, { x: 0, y: 0, z: 0, w: 1 }),
    // Camera at the universe origin; the Sun 1 Gpc away (no panorama fade).
    toCamera: (frame: string, local: Vec3d, out: Vec3d) =>
      frame === ROOT_FRAME
        ? Object.assign(out, { x: local.x, y: local.y, z: local.z })
        : Object.assign(out, { x: 1000 * MPC, y: 0, z: 0 }),
  } as unknown as ViewState;
}

describe('galaxy portraits: per-frame selection', () => {
  it('draws the largest PORTRAIT_MAX_DRAWS as portraits and leaves the rest to the impostors', () => {
    const n = 12;
    const data = fakeData(n);
    const entries = Array.from({ length: n }, (_, i) => ({ id: `g${i}`, index: i }));
    const layer = createPortraitLayer(data, entries, { preset: 'potato' });
    const mask = layer.select(fakeView(1));
    const drawn = [...mask].map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
    // Angular radius grows with the index here (radius grows faster than distance).
    expect(drawn).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
    expect(drawn.length).toBe(PORTRAIT_MAX_DRAWS);
    // Same frame: cached; the update draws exactly those (plus the zero-area warm-up mesh).
    expect(layer.select(fakeView(1))).toBe(mask);
    layer.update(fakeView(1));
    const visible = layer.object.children.filter((c) => c.visible).length;
    expect(visible).toBe(PORTRAIT_MAX_DRAWS + 1);
    expect(layer.memoryBytes()).toBeGreaterThan(PORTRAIT_MAX_DRAWS * 128 * 128 * 8);
    layer.dispose();
  });

  it('draws nothing (all impostors) when the layer is hidden', () => {
    const data = fakeData(3);
    const layer = createPortraitLayer(data, [{ id: 'g0', index: 0 }], { preset: 'potato' });
    layer.visible = false;
    expect([...layer.select(fakeView(2))].every((v) => v === 0)).toBe(true);
    layer.dispose();
  });
});
