import { encode } from 'fast-png';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Body, HeightSourceSpec, HeightWorkerContext, ViewState } from '../../../src/core/contracts';
import {
  HdEarthTerrain,
  hdTerrainAllowed,
  hdTerrainQualityOk,
  hdZoom,
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

/** A camera `alt` m above (lat 0, lon `lonDeg`) in an unrotated Earth frame (default 10 km over (0, 0)). */
const view = (quality: ViewState['quality'], lonDeg = 0, alt = 1e4) =>
  ({
    quality,
    toCamera: (_f: string, _l: unknown, out: { x: number; y: number; z: number }) => {
      const lon = (lonDeg * Math.PI) / 180;
      out.x = -(R + alt) * Math.cos(lon);
      out.y = -(R + alt) * Math.sin(lon);
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
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** An HdEarthTerrain on mocked fetch and registry; `settle()` awaits the block being loaded. */
function rig() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))),
  );
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
  /** Runs one frame and waits for the block it may start. */
  const frame = async (v: ViewState) => {
    hd.onFrame(v);
    await pending;
  };
  return { hd, added, frame };
}

/** Longitude (deg) of tile coordinate x at zoom z. */
const lonOfTile = (x: number, z: number) => (x / 2 ** z) * 360 - 180;

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

describe('HD Earth block hysteresis and blob URLs', () => {
  it('keeps the zoom near a threshold until the altitude is past it by a margin', () => {
    // z11/z12 switch at 4e7 / (12 * 2^11.5) = 1151 m, z10/z11 at 2302 m.
    expect(hdZoom(1151 * 1.05)).toBe(11);
    expect(hdZoom(1151 * 1.05, 12)).toBe(12);
    expect(hdZoom(1151 * 1.15, 12)).toBe(11);
    expect(hdZoom(1151 * 0.95)).toBe(12);
    expect(hdZoom(1151 * 0.95, 11)).toBe(11);
    expect(hdZoom(1151 * 0.88, 11)).toBe(12);
    expect(hdZoom(2302 * 1.05, 11)).toBe(11);
    expect(hdZoom(2302 * 0.95, 10)).toBe(10);
    // Clamped at z5-z12 whatever the current zoom.
    expect(hdZoom(10, 12)).toBe(12);
    expect(hdZoom(3e5, 5)).toBe(5);
    expect(hdZoom(1e4, 12)).toBe(8);
    // Hovering around 2302 m (e.g. walking in Addis Ababa) keeps one zoom.
    let z = hdZoom(2302 * 0.97);
    for (const f of [1.03, 0.96, 1.04, 0.97, 1.02]) expect((z = hdZoom(2302 * f, z))).toBe(11);
  });

  it('does not reload the block while the camera hovers at a tile edge or a zoom threshold', async () => {
    const { added, frame } = rig();
    // 10 km up: z8, camera in tile 128, block 127-129.
    await frame(view('low', lonOfTile(128.5, 8)));
    expect(added).toHaveLength(1);
    expect((added[0].params as SurfaceHeightParams).hd).toMatchObject({ z: 8, x0: 127 });
    // 0.1 tile past the middle tile's edges, either way: same block.
    for (const x of [127.9, 129.1, 127.95, 128.5]) await frame(view('low', lonOfTile(x, 8)));
    expect(added).toHaveLength(1);
    // Past the margin the block moves, and back across the edge it stays.
    await frame(view('low', lonOfTile(127.7, 8)));
    expect(added).toHaveLength(2);
    expect((added[1].params as SurfaceHeightParams).hd).toMatchObject({ z: 8, x0: 126 });
    await frame(view('low', lonOfTile(128.1, 8)));
    expect(added).toHaveLength(2);

    // z8/z9 switch at 9207 m: hovering at 9000-9500 m keeps the block.
    const lon = lonOfTile(127.5, 8);
    for (const alt of [9500, 9000, 9500, 9050]) await frame(view('low', lon, alt));
    expect(added).toHaveLength(2);
    await frame(view('low', lon, 8000));
    expect(added).toHaveLength(3);
    expect((added[2].params as SurfaceHeightParams).hd?.z).toBe(9);
  });

  it('revokes the blob URLs of a dropped block after the in-flight delay', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let n = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:t${n++}`);
    const revoked = new Set<string>();
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u) => void revoked.add(u));
    const { hd, frame } = rig();
    const all = () => Array.from({ length: n }, (_, i) => `blob:t${i}`);

    // Quality gate closes (potato): the block is dropped and its 9 URLs revoked 60 s later.
    await frame(view('low'));
    expect(n).toBe(HD_GRID * HD_GRID);
    await frame(view('potato'));
    vi.advanceTimersByTime(59_000);
    expect(revoked.size).toBe(0);
    vi.advanceTimersByTime(2_000);
    expect([...revoked].sort()).toEqual(all().sort());

    // HD switched off: the same.
    await frame(view('low'));
    expect(n).toBe(2 * HD_GRID * HD_GRID);
    hd.setEnabled(false);
    vi.advanceTimersByTime(61_000);
    expect([...revoked].sort()).toEqual(all().sort());
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
