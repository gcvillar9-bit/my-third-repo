import { describe, expect, it } from 'vitest';
import type { HeightFunction, Vec3d } from '../../../src/core/contracts';
import {
  dirToFace,
  faceCoord,
  faceDir,
  MAX_LEVEL,
  nodeKey,
  PATCH_N,
  unpackKey,
  warp,
} from '../../../src/modules/terrain/cube';
import { DEFAULT_HEIGHT_MODULE, defaultHeightSpec, terrainEligible } from '../../../src/modules/terrain/defaults';
import { groundRadius } from '../../../src/modules/terrain/ground';
import {
  createFbmCraters,
  defaultParams,
  maxAbsHeight,
} from '../../../src/modules/terrain/height/fbm-craters-lite';
import { heightModuleKeys, loadHeightFunction } from '../../../src/modules/terrain/height-modules';
import { buildPatch, patchDirs, patchIndex, VERTEX_COUNT, type PatchRequest } from '../../../src/modules/terrain/patch';

const MOON_A = 1738.1e3;
const MOON_C = 1736.0e3;
const EARTH_A = 6378.137e3;
const fn = createFbmCraters(defaultParams(MOON_A, true, 7));
const B = PATCH_N + 2;

/** Seeded uniform random numbers. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function randomDir(r: () => number): Vec3d {
  const z = 2 * r() - 1;
  const p = 2 * Math.PI * r();
  const q = Math.sqrt(1 - z * z);
  return { x: q * Math.cos(p), y: q * Math.sin(p), z };
}

/** Grid edge of a patch (bordered dirs + float32 heights), i or j fixed. */
function edge(req: PatchRequest, axis: 'i' | 'j', at: number) {
  const dirs = patchDirs(req);
  const p = buildPatch(fn, req);
  const d: number[] = [];
  const h: number[] = [];
  for (let k = 0; k < PATCH_N; k++) {
    const i = axis === 'i' ? at : k;
    const j = axis === 'i' ? k : at;
    const b = ((j + 1) * B + (i + 1)) * 3;
    d.push(dirs[b], dirs[b + 1], dirs[b + 2]);
    h.push(p.upH[(j * PATCH_N + i) * 4 + 3]);
  }
  return { d, h };
}

describe('cube-sphere addressing', () => {
  it('packs node keys below 2^53 and round-trips them', () => {
    const k = nodeKey(5, MAX_LEVEL, 2 ** 22 - 1, 2 ** 22 - 1);
    expect(k).toBeLessThan(2 ** 53);
    expect(unpackKey(k)).toEqual({ face: 5, level: 22, x: 2 ** 22 - 1, y: 2 ** 22 - 1 });
    expect(unpackKey(nodeKey(3, 7, 100, 5))).toEqual({ face: 3, level: 7, x: 100, y: 5 });
  });

  it('warp is odd-exact and maps ±1 exactly; dirToFace inverts faceDir', () => {
    for (const s of [0.1, 0.5, 0.999, 1]) expect(warp(-s)).toBe(-warp(s));
    expect(warp(1)).toBe(1);
    const r = rng(3);
    const out = new Float64Array(3);
    for (let n = 0; n < 200; n++) {
      const f = Math.floor(r() * 6);
      const s = 2 * r() - 1;
      const t = 2 * r() - 1;
      faceDir(f, s, t, out, 0);
      const back = dirToFace({ x: out[0], y: out[1], z: out[2] });
      expect(back.face).toBe(f);
      expect(back.s).toBeCloseTo(s, 12);
      expect(back.t).toBeCloseTo(t, 12);
    }
  });
});

describe('patches', () => {
  const L = 9;
  const base = { a: MOON_A, c: MOON_C, level: L };

  it('neighbouring patch edges have identical directions and heights (inside a face)', () => {
    const a = edge({ ...base, face: 2, x: 100, y: 37 }, 'i', PATCH_N - 1);
    const b = edge({ ...base, face: 2, x: 101, y: 37 }, 'i', 0);
    expect(a.d).toEqual(b.d);
    expect(a.h).toEqual(b.h);
    const c = edge({ ...base, face: 2, x: 100, y: 37 }, 'j', PATCH_N - 1);
    const d = edge({ ...base, face: 2, x: 100, y: 38 }, 'j', 0);
    expect(c.d).toEqual(d.d);
    expect(c.h).toEqual(d.h);
  });

  it('neighbouring patch edges are identical across cube edges', () => {
    const n = 2 ** L - 1;
    // +X face right edge (s = +1) meets +Y face left edge (s = −1), same t.
    const a = edge({ ...base, face: 0, x: n, y: 200 }, 'i', PATCH_N - 1);
    const b = edge({ ...base, face: 2, x: 0, y: 200 }, 'i', 0);
    expect(a.d).toEqual(b.d);
    expect(a.h).toEqual(b.h);
    // +X face top edge (t = +1) meets +Z face bottom edge (t = −1), same s.
    const c = edge({ ...base, face: 0, x: 77, y: n }, 'j', PATCH_N - 1);
    const d = edge({ ...base, face: 4, x: 77, y: 0 }, 'j', 0);
    expect(c.d).toEqual(d.d);
    expect(c.h).toEqual(d.h);
  });

  it('vertex error < 1 mm at level 20 (Earth radius, Float32 offsets + camera-relative centre)', () => {
    const earthFn = createFbmCraters(defaultParams(EARTH_A, false, 1));
    const req = { face: 4, level: 20, x: 345_678, y: 912_345, a: EARTH_A, c: EARTH_A * (1 - 0.003353) };
    const p = buildPatch(earthFn, req);
    const dirs = patchDirs(req);
    const h = new Float64Array(B * B);
    earthFn.sample(dirs, h, B * B, 20);
    const cam = { x: p.centre[0] + 37.3, y: p.centre[1] - 12.1, z: p.centre[2] + 80.9 };
    const f = Math.fround;
    let worst = 0;
    for (let j = 0; j < PATCH_N; j++) {
      for (let i = 0; i < PATCH_N; i++) {
        const k = (j + 1) * B + (i + 1);
        const re = req.c / Math.sqrt(1 - (1 - (req.c / req.a) ** 2) * (1 - dirs[3 * k + 2] ** 2)) + h[k];
        const v = j * PATCH_N + i;
        // GPU: float32(centre − camera) + float32 offset, summed in float32.
        for (let ax = 0; ax < 3; ax++) {
          const ref = dirs[3 * k + ax] * re - (ax === 0 ? cam.x : ax === 1 ? cam.y : cam.z);
          const gpu = f(f(p.centre[ax] - (ax === 0 ? cam.x : ax === 1 ? cam.y : cam.z)) + p.positions[3 * v + ax]);
          worst = Math.max(worst, Math.abs(gpu - ref));
        }
      }
    }
    expect(worst).toBeLessThan(1e-3);
  });

  it('normals point outward and skirts hang below the edges', () => {
    const p = buildPatch(fn, { ...base, face: 1, x: 3, y: 400 });
    for (let v = 0; v < VERTEX_COUNT; v++) {
      const d = p.upH[4 * v] * p.normals[3 * v] + p.upH[4 * v + 1] * p.normals[3 * v + 1] + p.upH[4 * v + 2] * p.normals[3 * v + 2];
      expect(d).toBeGreaterThan(0.2);
    }
    const r = (v: number) =>
      Math.hypot(p.centre[0] + p.positions[3 * v], p.centre[1] + p.positions[3 * v + 1], p.centre[2] + p.positions[3 * v + 2]);
    const skirt = PATCH_N * PATCH_N;
    expect(r(skirt)).toBeLessThan(r(0) - 1);
    expect(Math.max(...patchIndex())).toBe(VERTEX_COUNT - 1);
  });
});

describe('fbm-craters-lite', () => {
  const dirs = new Float64Array(3 * 2000);
  const r = rng(11);
  for (let i = 0; i < 2000; i++) {
    const d = randomDir(r);
    dirs.set([d.x, d.y, d.z], 3 * i);
  }

  it('is deterministic and bounded by maxAbsHeight', () => {
    const p = defaultParams(MOON_A, true, 42);
    const f1 = createFbmCraters(p);
    const f2 = createFbmCraters(p);
    const a = new Float64Array(2000);
    const b = new Float64Array(2000);
    f1.sample(dirs, a, 2000, 18);
    f2.sample(dirs, b, 2000, 18);
    expect(a).toEqual(b);
    const m = maxAbsHeight(p);
    let lo = Infinity;
    let hi = -Infinity;
    for (const h of a) {
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    expect(hi).toBeLessThanOrEqual(m);
    expect(lo).toBeGreaterThanOrEqual(-m);
    expect(hi - lo).toBeGreaterThan(500); // real relief
    expect(m).toBeLessThan(20e3);
  });

  it('is band-limited by level (coarse levels drop small features only)', () => {
    const a = new Float64Array(2000);
    const b = new Float64Array(2000);
    fn.sample(dirs, a, 2000, 4);
    fn.sample(dirs, b, 2000, 20);
    let diff = 0;
    for (let i = 0; i < 2000; i++) diff = Math.max(diff, Math.abs(a[i] - b[i]));
    expect(diff).toBeGreaterThan(0);
    expect(diff).toBeLessThan(maxAbsHeight(defaultParams(MOON_A, true, 7)));
  });

  it('the default spec resolves through the height-module glob', async () => {
    expect(heightModuleKeys()).toContain(DEFAULT_HEIGHT_MODULE);
    const body = { id: 'moon', name: 'Moon', kind: 'moon' as const, frame: 'moon', radius: MOON_A, influenceRadius: 1e8 };
    const spec = defaultHeightSpec(body);
    const loaded = await loadHeightFunction(spec, { seed: 1, fetchBinary: () => Promise.reject(new Error('none')) });
    const direct = createFbmCraters(spec.params as ReturnType<typeof defaultParams>);
    const x = new Float64Array(5);
    const y = new Float64Array(5);
    loaded.sample(dirs, x, 5, 12);
    direct.sample(dirs, y, 5, 12);
    expect(x).toEqual(y);
    expect(terrainEligible(body)).toBe(true);
    expect(terrainEligible({ ...body, id: 'jupiter', kind: 'planet' })).toBe(false);
    expect(terrainEligible({ ...body, id: 'sun', kind: 'star' })).toBe(false);
  });
});

describe('ground query', () => {
  /** Radial intersection with the float32 triangle the GPU draws. */
  function meshRadius(h: HeightFunction, dir: Vec3d, level: number): number {
    const { face, s, t } = dirToFace(dir);
    const n = 2 ** level;
    const gs = (s + 1) * 16 * n;
    const gt = (t + 1) * 16 * n;
    const ci = Math.min(32 * n - 1, Math.floor(gs));
    const cj = Math.min(32 * n - 1, Math.floor(gt));
    const x = Math.floor(ci / 32);
    const y = Math.floor(cj / 32);
    const p = buildPatch(h, { face, level, x, y, a: MOON_A, c: MOON_C });
    const vtx = (i: number, j: number) => {
      const v = j * PATCH_N + i;
      // Float32 GPU vertex relative to the tile centre (as drawn), back in float64 body space.
      return [p.centre[0] + p.positions[3 * v], p.centre[1] + p.positions[3 * v + 1], p.centre[2] + p.positions[3 * v + 2]];
    };
    const i = ci - 32 * x;
    const j = cj - 32 * y;
    const p00 = vtx(i, j);
    const p10 = vtx(i + 1, j);
    const p11 = vtx(i + 1, j + 1);
    const p01 = vtx(i, j + 1);
    const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const d = [dir.x, dir.y, dir.z];
    const nrm = cross(p00, p11);
    const tri = dot(nrm, d) * dot(nrm, p10) >= 0 ? [p00, p10, p11] : [p00, p01, p11];
    const e1 = tri[1].map((v, k) => v - tri[0][k]);
    const e2 = tri[2].map((v, k) => v - tri[0][k]);
    const nn = cross(e1, e2);
    return dot(nn, tri[0]) / dot(nn, d);
  }

  it('matches the drawn mesh within 1 cm', () => {
    const r = rng(99);
    let worst = 0;
    for (let n = 0; n < 60; n++) {
      const dir = randomDir(r);
      const level = 6 + Math.floor(r() * 15);
      const g = groundRadius(fn, MOON_A, MOON_C, dir, level);
      worst = Math.max(worst, Math.abs(g - meshRadius(fn, dir, level)));
    }
    expect(worst).toBeLessThan(0.01);
  });

  it('agrees with the grid vertices exactly', () => {
    const req = { face: 3, level: 12, x: 1234, y: 2345, a: MOON_A, c: MOON_C };
    const p = buildPatch(fn, req);
    const dirs = patchDirs(req);
    const k = (5 + 1) * B + (7 + 1);
    const dir = { x: dirs[3 * k], y: dirs[3 * k + 1], z: dirs[3 * k + 2] };
    const want = p.upH[(5 * PATCH_N + 7) * 4 + 3];
    const g = groundRadius(fn, MOON_A, MOON_C, dir, 12);
    const rEll = 1 / Math.sqrt((dir.x ** 2 + dir.y ** 2) / MOON_A ** 2 + dir.z ** 2 / MOON_C ** 2);
    expect(g - rEll).toBeCloseTo(want, 2);
    expect(faceCoord(0, 0)).toBe(-1);
  });
});
