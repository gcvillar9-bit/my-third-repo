import { describe, expect, it } from 'vitest';
import type { Body, HeightSourceSpec } from '../../../src/core/contracts';
import { vec3 } from '../../../src/core/math64';
import { ROOT_KEYS } from '../../../src/modules/terrain/cube';
import { defaultHeightSpec } from '../../../src/modules/terrain/defaults';
import {
  createFbmCraters,
  type FbmCratersParams,
} from '../../../src/modules/terrain/height/fbm-craters-lite';
import {
  KNOWN_BOUNDS_MAX,
  RETRY_MAX_MS,
  RETRY_MIN_MS,
  SPEC_FAILURE_LIMIT,
  TerrainManager,
  type Generator,
} from '../../../src/modules/terrain/manager';
import { buildPatch } from '../../../src/modules/terrain/patch';
import type { NodeBounds } from '../../../src/modules/terrain/select';
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
const view = (x: number, y: number, z: number, alt = 50, cap = 64) => {
  const l = Math.hypot(x, y, z);
  return {
    cam: vec3((x / l) * (A + alt), (y / l) * (A + alt), (z / l) * (A + alt)),
    planes: [],
    pixelAngle: 0.004,
    target: 8,
    cap,
  };
};

describe('terrain manager robustness', () => {
  it('keeps drawing after the remembered-bounds map overflows', async () => {
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
    m.observeRaw(view(1, 0.1, 0.1));
    await flush(m);
    expect(m.leaves.length).toBeGreaterThan(0);
    const known = (m as unknown as { known: Map<number, NodeBounds> }).known;
    const dummy = known.values().next().value!;
    for (let i = 0; known.size <= KNOWN_BOUNDS_MAX + 1; i++) known.set(-1 - i, dummy);
    // A new view requests new tiles; the first arrival overflows the map.
    m.observeRaw(view(0.1, 1, -0.2));
    await flush(m);
    expect(known.size).toBeLessThan(KNOWN_BOUNDS_MAX);
    for (const k of ROOT_KEYS) expect(known.has(k)).toBe(true);
    expect(m.leaves.length).toBeGreaterThan(0);
    // Even with the map emptied, resident tiles provide their own bounds.
    known.clear();
    m.select();
    expect(m.leaves.length).toBeGreaterThan(0);
  }, 60_000);

  it('backs off failed tile builds per key and reports a failing spec once', async () => {
    let t = 0;
    let calls = 0;
    const failed: HeightSourceSpec[] = [];
    const errors: unknown[] = [];
    const bad: Generator = {
      build: () => {
        calls++;
        return Promise.reject(new Error('404'));
      },
    };
    const m = new TerrainManager({
      bodyId: 'moon',
      a: A,
      c: C,
      spec,
      generator: () => bad,
      base: '/',
      seed: 1,
      test: false,
      now: () => t,
      onError: (e) => errors.push(e),
      onSpecFailed: (s) => failed.push(s),
    });
    m.observeRaw(view(1, 0.1, 0.1));
    await flush(m);
    expect(calls).toBe(6); // the 6 roots
    // Many frames inside the back-off window issue nothing.
    for (let f = 0; f < 100; f++) m.select();
    await flush(m);
    expect(calls).toBe(6);
    // After the first delay each root is retried once, then the delay doubles.
    t += RETRY_MIN_MS + 1;
    for (let f = 0; f < 50; f++) m.select();
    await flush(m);
    expect(calls).toBe(12);
    t += RETRY_MIN_MS + 1;
    m.select();
    await flush(m);
    expect(calls).toBe(12);
    t += RETRY_MIN_MS;
    m.select();
    await flush(m);
    expect(calls).toBe(18);
    // Delays saturate at RETRY_MAX_MS; the spec failure is reported once.
    for (let i = 0; i < 10; i++) {
      t += RETRY_MAX_MS + 1;
      m.select();
      await flush(m);
    }
    expect(calls).toBe(18 + 60);
    expect(calls).toBeGreaterThanOrEqual(SPEC_FAILURE_LIMIT);
    expect(failed).toHaveLength(1);
    expect(errors.length).toBeLessThanOrEqual(3);
    expect(m.leaves).toHaveLength(0);
  });
});

describe('terrain eligibility', () => {
  const earth: Body = {
    ...moon,
    id: 'earth',
    name: 'Earth',
    kind: 'planet',
    frame: 'earth',
    fixedFrame: 'earth.fixed',
    radius: 6378.137e3,
    oblateness: 1 / 298.257,
  };
  const makeSystem = (registered: HeightSourceSpec | undefined) =>
    new TerrainSystem({
      registry: { heightSource: () => registered, body: () => earth } as never,
      hasFrame: () => true,
      assets: { track: <T>(p: Promise<T>) => p, binary: () => Promise.reject(new Error('no')) } as never,
      workers: null,
      exposure: { value: 1 },
      baseUrl: '/',
      seed: 1,
      test: true,
    });

  it('gives Earth, Venus and Titan no default fbm relief, only a registered height source', () => {
    const none = makeSystem(undefined);
    expect(none.specFor(earth)).toBeNull();
    expect(none.specFor({ ...earth, id: 'venus' })).toBeNull();
    expect(none.specFor({ ...earth, id: 'titan', kind: 'moon' })).toBeNull();
    expect(none.manager(earth)).toBeUndefined();
    expect(none.specFor({ ...earth, id: 'mercury' })?.workerModule).toBe(spec.workerModule);
    const reg = { ...defaultHeightSpec(earth), workerModule: '/src/modules/x/height/y.ts', priority: 5 };
    const withSpec = makeSystem(reg);
    expect(withSpec.specFor(earth)).toBe(reg);
    expect(withSpec.manager(earth)).toBeDefined();
    withSpec.dispose();
  });
});
