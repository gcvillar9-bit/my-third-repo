import { describe, expect, it } from 'vitest';
import type { Body, ViewState } from '../../../src/core/contracts';
import { PRESET_KNOBS } from '../../../src/core/quality';
import { qlookRotation, qrotate, quat, vec3 } from '../../../src/core/math64';
import { faceDir, nodeKey, ROOT_KEYS, unpackKey } from '../../../src/modules/terrain/cube';
import { defaultHeightSpec } from '../../../src/modules/terrain/defaults';
import {
  createFbmCraters,
  type FbmCratersParams,
} from '../../../src/modules/terrain/height/fbm-craters-lite';
import {
  frustumPlanes,
  TerrainManager,
  tileBounds,
  type Generator,
} from '../../../src/modules/terrain/manager';
import { buildPatch } from '../../../src/modules/terrain/patch';
import {
  morphAt,
  detailOrigins,
  terrainFragmentShader,
  terrainVertexShader,
} from '../../../src/modules/terrain/render';
import {
  culled,
  estimateBounds,
  screenSpaceError,
  selectTree,
  type SelectParams,
} from '../../../src/modules/terrain/select';
import { TerrainSystem } from '../../../src/modules/terrain/system';

const A = 1738.1e3;
const C = 1736.0e3;
const moon: Body = {
  id: 'moon',
  name: 'Moon',
  kind: 'moon',
  frame: 'moon',
  fixedFrame: 'moon.fixed',
  radius: A,
  oblateness: 1 - C / A,
  gm: 4.9028e12,
  influenceRadius: 6e7,
};
const spec = defaultHeightSpec(moon);
const fn = createFbmCraters(spec.params as FbmCratersParams);
const localGen: Generator = { build: async (req) => buildPatch(fn, req, req.key) };
const flush = async (m: TerrainManager) => {
  for (let i = 0; i < 2000 && m.inflight.size; i++) await new Promise((r) => setTimeout(r, 0));
};
const params = (
  cam: { x: number; y: number; z: number },
  over: Partial<SelectParams> = {},
): SelectParams => ({
  cam,
  planes: [],
  pixelAngle: (60 * Math.PI) / 180 / 1080,
  target: 4,
  maxLeaves: 300,
  maxTiles: 376,
  a: A,
  c: C,
  rOcc: C - spec.maxAbsHeight,
  ...over,
});

describe('screen-space error and culling', () => {
  const b = estimateBounds(unpackKey(nodeKey(0, 5, 10, 12)), A, C, -100, 100);

  it('SSE decreases monotonically with distance and with level', () => {
    let prev = Infinity;
    for (const d of [10, 1e3, 1e4, 1e5, 1e6, 1e7]) {
      const s = screenSpaceError(
        params(vec3(b.centre.x * (1 + d / A), b.centre.y * (1 + d / A), b.centre.z * (1 + d / A))),
        5,
        b,
      );
      expect(s).toBeLessThanOrEqual(prev);
      prev = s;
    }
    const cam = vec3(A * 3, 0, 0);
    for (let l = 0; l < 22; l++) {
      expect(screenSpaceError(params(cam), l + 1, b)).toBeLessThan(screenSpaceError(params(cam), l, b));
    }
  });

  it('culls nodes behind the horizon and outside the frustum, never the node under the camera', () => {
    const cam = vec3(A + 100, 0, 0); // above face 0 centre
    const all = (k: number) => estimateBounds(unpackKey(k), A, C, -spec.maxAbsHeight, spec.maxAbsHeight);
    expect(culled(params(cam), all(nodeKey(1, 0, 0, 0)))).toBe(true); // far side
    expect(culled(params(cam), all(nodeKey(0, 3, 4, 4)))).toBe(false);
    // Looking along +y: the plane x·n ≥ 0 with inward normal +y removes nodes on the −y side.
    const high = vec3(A + 1e6, 0, 0);
    const p = params(high, { planes: [vec3(0, 1, 0)] });
    expect(culled(p, all(nodeKey(0, 6, 20, 32)))).toBe(true);
    expect(culled(params(high), all(nodeKey(0, 6, 20, 32)))).toBe(false);
    expect(culled(p, all(nodeKey(0, 6, 44, 32)))).toBe(false);
  });

  it('splits with hysteresis (no flip-flop between target/1.5 and target)', () => {
    const root = ROOT_KEYS[0];
    const rb = estimateBounds(unpackKey(root), A, C, 0, 0);
    const bounds = (k: number) => estimateBounds(unpackKey(k), A, C, 0, 0);
    // Find a camera distance with root SSE ≈ 0.8 · target.
    let d = A;
    for (let i = 0; i < 60; i++) {
      const s = screenSpaceError(params(vec3(rb.centre.x + d, 0, 0)), 0, rb);
      d *= s / (0.8 * 4);
    }
    const cam = vec3(rb.centre.x + d, 0, 0);
    expect(selectTree(params(cam), bounds, new Set()).split.has(root)).toBe(false);
    expect(selectTree(params(cam), bounds, new Set([root])).split.has(root)).toBe(true);
  });

  it('respects the leaf and tile budgets and requests missing tiles by priority', () => {
    const bounds = (k: number) => estimateBounds(unpackKey(k), A, C, 0, 0);
    const dir = new Float64Array(3);
    faceDir(2, 0.3, -0.2, dir, 0);
    const cam = vec3(dir[0] * (A + 2), dir[1] * (A + 2), dir[2] * (A + 2));
    const s = selectTree(params(cam, { maxLeaves: 40, maxTiles: 50 }), bounds, new Set());
    expect(s.leaves.length).toBeLessThanOrEqual(40);
    expect(s.used.size).toBeLessThanOrEqual(50);
    const none = selectTree(params(cam), () => undefined, new Set());
    expect(none.leaves).toHaveLength(0);
    expect(none.requests.map((r) => r.key).sort()).toEqual([...ROOT_KEYS].sort());
  });
});

describe('terrain manager', () => {
  it('converges to level >= 19 under a camera 2 m above the ground (medium preset)', async () => {
    const m = new TerrainManager({
      bodyId: 'moon',
      a: A,
      c: C,
      spec,
      generator: () => localGen,
      base: '/',
      seed: 1,
      test: true,
    });
    m.fn = fn;
    const d = vec3(0.6, 0.7, 0.3);
    const l = Math.hypot(d.x, d.y, d.z);
    d.x /= l;
    d.y /= l;
    d.z /= l;
    const g = A + (m.heightAt(d) ?? 0);
    const cam = vec3(d.x * (g + 2), d.y * (g + 2), d.z * (g + 2));
    const knobs = PRESET_KNOBS.medium;
    // Looking horizontally (16:9, 60° vertical field of view, 1080 px).
    const q = qlookRotation(quat(), vec3(-d.y, d.x, 0), d);
    const planes = frustumPlanes(Math.PI / 3, 16 / 9).map((n) => qrotate(vec3(), q, n));
    m.observeRaw({
      cam,
      planes,
      pixelAngle: Math.PI / 3 / 1080,
      target: knobs.terrainSse,
      cap: knobs.terrainTileCap,
    });
    await flush(m);
    expect(m.inflight.size).toBe(0);
    expect(m.levelAt(d)).toBeGreaterThanOrEqual(19);
    expect(m.tiles.size).toBeLessThanOrEqual(knobs.terrainTileCap);
    expect(m.leaves.length).toBeLessThanOrEqual(300);
    expect(m.leaves.length).toBeGreaterThan(10);
    // The tile under the camera contains the camera direction and is close to it.
    const near = m.leaves.reduce((best, t) => {
      const b = tileBounds(t);
      const dist = Math.hypot(b.centre.x - cam.x, b.centre.y - cam.y, b.centre.z - cam.z);
      return Math.min(best, dist);
    }, Infinity);
    expect(near).toBeLessThan(20);
    // The ground under the camera now uses the deepest level and still sits ~2 m below.
    const ground = A + m.heightAt(d)!;
    expect(Math.abs(g + 2 - ground - 2)).toBeLessThan(5);
  }, 60_000);

  it('caps resident tiles on potato and evicts least-recently-used tiles', async () => {
    const m = new TerrainManager({
      bodyId: 'moon',
      a: A,
      c: C,
      spec,
      generator: () => localGen,
      base: '/',
      seed: 1,
      test: true,
    });
    const cap = PRESET_KNOBS.potato.terrainTileCap;
    const view = (x: number, y: number, z: number) => {
      const l = Math.hypot(x, y, z);
      return {
        cam: vec3((x / l) * (A + 50), (y / l) * (A + 50), (z / l) * (A + 50)),
        planes: [],
        pixelAngle: 0.004,
        target: 8,
        cap,
      };
    };
    m.observeRaw(view(1, 0.1, 0.1));
    await flush(m);
    m.observeRaw(view(0.1, 1, -0.2));
    await flush(m);
    expect(m.tiles.size + m.inflight.size).toBeLessThanOrEqual(cap);
    for (const k of ROOT_KEYS) expect(m.tiles.has(k)).toBe(true);
  }, 60_000);
});

describe('provider hand-off', () => {
  const view = (alt: number, frame: number): ViewState =>
    ({
      jd: 2451545,
      frameIndex: frame,
      fovY: Math.PI / 3,
      viewport: [480, 270],
      pixelAngle: Math.PI / 3 / 270,
      worldQuat: quat(),
      knobs: PRESET_KNOBS.potato,
      test: true,
      toCamera: (
        _f: string,
        local: { x: number; y: number; z: number },
        out: { x: number; y: number; z: number },
      ) => {
        out.x = local.x;
        out.y = local.y;
        out.z = local.z - (A + alt);
        return out;
      },
      frameQuat: (_f: string, out: ReturnType<typeof quat>) => Object.assign(out, quat()),
    }) as unknown as ViewState;

  const makeSystem = () =>
    new TerrainSystem({
      registry: { heightSource: () => undefined, body: () => moon } as never,
      hasFrame: () => true,
      assets: { track: <T>(p: Promise<T>) => p, binary: () => Promise.reject(new Error('no')) } as never,
      workers: null,
      exposure: { value: 1 },
      baseUrl: '/',
      seed: 1,
      test: true,
    });

  it('takes over below 3 R once the roots are resident, with hysteresis, and excludes gas giants', async () => {
    const sys = makeSystem();
    let f = 0;
    expect(sys.wants(view(2 * A, f++), moon)).toBe(false); // roots requested
    const m = sys.managers.get('moon')!;
    await flush(m);
    expect(sys.wants(view(2 * A, f++), moon)).toBe(true);
    expect(sys.wants(view(3.02 * A, f++), moon)).toBe(true);
    expect(sys.wants(view(3.06 * A, f++), moon)).toBe(false);
    expect(sys.wants(view(3.02 * A, f++), moon)).toBe(false);
    expect(sys.wants(view(2.99 * A, f++), moon)).toBe(true);
    expect(sys.wants(view(10 * A, f++), moon)).toBe(false);
    expect(sys.wants(view(A, f++), { ...moon, id: 'saturn', kind: 'planet' })).toBe(false);
    const g = sys.ground();
    expect(g.heightAt('moon', vec3(1, 0, 0))).not.toBeNull();
    sys.dispose();
  });

  it('morphs relief in over 3 R → 2.5 R and anchors detail noise in float64', () => {
    expect(morphAt(3 * A, A)).toBe(0);
    expect(morphAt(2.5 * A, A)).toBe(1);
    expect(morphAt(100, A)).toBe(1);
    const o = vec3(1234567.891, -2345678.123, 987654.321);
    const out = detailOrigins(o);
    for (let k = 0; k < out.length; k++) {
      const lambda = 1e4 * 10 ** -k;
      const P = 256;
      const want = (((o.x / lambda) % P) + P) % P;
      expect(Math.abs(out[k].x - want)).toBeLessThan(1e-6);
      expect(out[k].x).toBeGreaterThanOrEqual(0);
      expect(out[k].x).toBeLessThan(P);
    }
  });

  it('builds shaders from the depth chunk, SurfaceInput and the body shading', () => {
    const frag = terrainFragmentShader({
      bodyId: 'moon',
      priority: 0,
      glsl: 'vec3 shadeSurface(SurfaceInput s) { return vec3(1.0); }',
      uniforms: {},
    });
    expect(frag).toContain('LOG_DEPTH_FRAGMENT');
    expect(frag).toContain('struct SurfaceInput');
    expect(frag).toContain('vec3 shadeSurface(SurfaceInput s)');
    expect(frag).toContain('sunVisibility');
    expect(frag).toContain('pnoise');
    expect(terrainVertexShader()).toContain('LOG_DEPTH_VERTEX');
  });
});
