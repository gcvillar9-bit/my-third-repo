import { encode } from 'fast-png';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Body, HeightSourceSpec, HeightWorkerContext, ViewState } from '../../../src/core/contracts';
import {
  HdEarthTerrain,
  hdTerrainAllowed,
  hdTerrainQualityOk,
  HD_GRID,
  HD_PRIORITY,
} from '../../../src/modules/surfaces/hd';
import type { SurfaceHeightParams } from '../../../src/modules/surfaces/heightfield';
import { create } from '../../../src/modules/surfaces/height/surface';

const R = 6378137;
const earth: Body = {
  id: 'earth',
  name: 'Earth',
  kind: 'planet',
  frame: 'earth',
  fixedFrame: 'earth.fixed',
  radius: R,
  oblateness: 1 / 298.257,
  influenceRadius: 1e9,
};
const baseParams: SurfaceHeightParams = { bodyId: 'earth', radius: R, seed: 1, maxAbs: 9000 };
const base: HeightSourceSpec = {
  bodyId: 'earth',
  workerModule: '/src/modules/surfaces/height/surface.ts',
  params: baseParams,
  maxAbsHeight: 9000,
  priority: 5,
};

/** A camera 10 km above (lat 0, lon 0) in an unrotated Earth frame. */
const view = (quality: ViewState['quality']) =>
  ({
    quality,
    toCamera: (_f: string, _l: unknown, out: { x: number; y: number; z: number }) => {
      out.x = -(R + 1e4);
      out.y = 0;
      out.z = 0;
      return out;
    },
    frameQuat: (_f: string, out: { x: number; y: number; z: number; w: number }) => {
      out.x = out.y = out.z = 0;
      out.w = 1;
      return out;
    },
  }) as unknown as ViewState;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HD Earth terrain switches', () => {
  it('?hdterrain=1 forces it on, ?hdterrain=0 turns it off, else the setting outside test mode', () => {
    expect(hdTerrainAllowed('1', true, false)).toBe(true);
    expect(hdTerrainAllowed('0', false, true)).toBe(false);
    expect(hdTerrainAllowed(null, false, undefined)).toBe(true);
    expect(hdTerrainAllowed(null, false, false)).toBe(false);
    expect(hdTerrainAllowed(null, true, true)).toBe(false);
    expect(hdTerrainQualityOk(null, 'potato')).toBe(false);
    expect(hdTerrainQualityOk(null, 'low')).toBe(true);
    expect(hdTerrainQualityOk('1', 'potato')).toBe(true);
  });

  it('streams nothing while the quality gate is closed and drops the block when it closes', async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal('fetch', fetchMock);
    const added: HeightSourceSpec[] = [];
    let pending: Promise<unknown> = Promise.resolve();
    const hd = new HdEarthTerrain({
      registry: { addHeightSource: (h: HeightSourceSpec) => added.push(h) } as never,
      assets: { track: <T>(p: Promise<T>) => ((pending = p), p) } as never,
      ui: { toast: () => {} },
      body: earth,
      base,
      gate: (v) => hdTerrainQualityOk(null, v.quality),
    });
    hd.setEnabled(true);
    hd.onFrame(view('potato'));
    await pending;
    expect(fetchMock).not.toHaveBeenCalled();
    expect(added).toHaveLength(0);

    hd.onFrame(view('low'));
    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(HD_GRID * HD_GRID);
    expect(added).toHaveLength(1);
    expect((added[0].params as SurfaceHeightParams).hd?.z).toBe(8);

    hd.onFrame(view('potato'));
    expect(added).toHaveLength(2);
    expect(added[1].params).toBe(baseParams);
    expect(added[1].priority).toBe(HD_PRIORITY);
    hd.onFrame(view('potato'));
    expect(added).toHaveLength(2);

    // A block that finishes loading after the gate closed is not registered.
    hd.onFrame(view('low'));
    hd.onFrame(view('potato'));
    await pending;
    expect(added).toHaveLength(2);
  });
});

describe('surface height module', () => {
  it('decodes each base raster once and reuses it for later specs (HD block moves)', async () => {
    const png = (v: number) =>
      encode({ width: 16, height: 8, data: new Uint8Array(16 * 8).fill(v), depth: 8, channels: 1 }).slice()
        .buffer;
    const calls: string[] = [];
    const ctx: HeightWorkerContext = {
      seed: 1,
      fetchBinary: async (path) => {
        calls.push(path);
        return png(path.endsWith('ocean.png') ? 0 : 200) as ArrayBuffer;
      },
    };
    const params = (seed: number): SurfaceHeightParams => ({
      bodyId: 'earth',
      radius: R,
      seed,
      raster: { path: 'data/test/height.png', offsetM: -100, stepM: 10, minM: -100, maxM: 2450 },
      ocean: { path: 'data/test/ocean.png', floor: false },
      maxAbs: 9000,
    });
    const dirs = new Float64Array([1, 0, 0]);
    const out = new Float64Array(1);
    for (let i = 0; i < 3; i++) {
      const fn = await create(params(i + 1), ctx);
      fn.sample(dirs, out, 1, 0);
      expect(out[0]).toBeCloseTo(1900, 0); // -100 + 200 * 10 m on land
    }
    expect(calls.sort()).toEqual(['data/test/height.png', 'data/test/ocean.png']);

    // A failed fetch is not cached: the next spec retries it.
    let fail = true;
    const flaky: HeightWorkerContext = {
      seed: 1,
      fetchBinary: async () => {
        if (fail) throw new Error('offline');
        return png(50) as ArrayBuffer;
      },
    };
    const p = { ...params(9), raster: { ...params(9).raster!, path: 'data/test/flaky.png' } };
    await expect(create(p, flaky)).rejects.toThrow('offline');
    fail = false;
    await expect(create(p, flaky)).resolves.toBeDefined();
  });
});
