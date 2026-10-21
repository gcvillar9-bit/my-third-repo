import { describe, expect, it } from 'vitest';
import type { Body, HeightSourceSpec } from '../../../src/core/contracts';
import { vec3 } from '../../../src/core/math64';
import { DEFAULT_HEIGHT_MODULE, defaultHeightSpec } from '../../../src/modules/terrain/defaults';
import { defaultParams } from '../../../src/modules/terrain/fbm-params';
import {
  cachedHeightKeys,
  loadHeightFunction,
  peekHeightFunction,
  specKey,
  type HeightSpecLike,
} from '../../../src/modules/terrain/height-modules';
import {
  setActiveSystem,
  terrainHeightAt,
  terrainHeightGeneration,
} from '../../../src/modules/terrain/public';
import { TerrainSystem } from '../../../src/modules/terrain/system';

const ctx = { seed: 1, fetchBinary: () => Promise.reject(new Error('no data')) };
const spec = (seed: number): HeightSpecLike => ({
  workerModule: DEFAULT_HEIGHT_MODULE,
  params: defaultParams(1e6, true, seed),
});
const cached = (s: HeightSpecLike) => cachedHeightKeys().includes(specKey(s));

describe('height-function cache (HD block moves)', () => {
  it('evicts a body’s superseded spec once the newer one has loaded', async () => {
    const [a, b] = [spec(101), spec(102)];
    const fa = await loadHeightFunction(a, ctx, { id: 'body-a', seq: 1 });
    expect(peekHeightFunction(a)).toBe(fa);
    const pb = loadHeightFunction(b, ctx, { id: 'body-a', seq: 2 });
    expect(cached(a)).toBe(true); // still the drawn function while the new one loads
    await pb;
    expect(cached(b)).toBe(true);
    expect(cached(a)).toBe(false);
    expect(peekHeightFunction(a)).toBeUndefined();
  });

  it('drops a spec superseded while loading and keeps the loaded one until the newest loads', async () => {
    const [a, b, c] = [spec(201), spec(202), spec(203)];
    await loadHeightFunction(a, ctx, { id: 'body-b', seq: 1 });
    const pb = loadHeightFunction(b, ctx, { id: 'body-b', seq: 2 });
    const pc = loadHeightFunction(c, ctx, { id: 'body-b', seq: 3 });
    expect(cached(b)).toBe(false);
    expect(cached(a)).toBe(true);
    // A build already waiting on the superseded spec still gets its function, which is not re-cached.
    expect(typeof (await pb).sample).toBe('function');
    expect(peekHeightFunction(b)).toBeUndefined();
    await pc;
    expect([a, b, c].map(cached)).toEqual([false, false, true]);
  });

  it('reuses the loaded function when the body returns to it and leaves other bodies alone', async () => {
    const [a, b, other] = [spec(301), spec(302), spec(303)];
    const pa = loadHeightFunction(a, ctx, { id: 'body-c', seq: 1 });
    await pa;
    await loadHeightFunction(other, ctx, { id: 'body-d', seq: 1 });
    void loadHeightFunction(b, ctx, { id: 'body-c', seq: 2 });
    expect(loadHeightFunction(a, ctx, { id: 'body-c', seq: 3 })).toBe(pa);
    expect(cached(b)).toBe(false);
    expect(cached(other)).toBe(true);
  });

  it('serves a late build of an older spec without caching it again', async () => {
    const [a, b] = [spec(401), spec(402)];
    await loadHeightFunction(a, ctx, { id: 'body-e', seq: 1 });
    await loadHeightFunction(b, ctx, { id: 'body-e', seq: 2 });
    const late = await loadHeightFunction(a, ctx, { id: 'body-e', seq: 1 });
    expect(typeof late.sample).toBe('function');
    expect(cached(a)).toBe(false);
    expect(peekHeightFunction(b)).toBeDefined();
  });

  it('keeps one function per body over many block moves', async () => {
    const specs = Array.from({ length: 20 }, (_, i) => spec(500 + i));
    for (let i = 0; i < specs.length; i++)
      await loadHeightFunction(specs[i], ctx, { id: 'body-f', seq: i + 1 });
    expect(specs.filter(cached)).toEqual([specs[19]]);
  });

  it('stays bounded under interleaved spec changes, repeat builds and late builds of several bodies', async () => {
    let rnd = 12345;
    const r = () => ((rnd = (rnd * 1103515245 + 12345) & 0x7fffffff), rnd / 0x7fffffff);
    const owners = ['body-g', 'body-h', 'body-i'];
    const latest = new Map<string, { s: HeightSpecLike; seq: number }>();
    const pending: Promise<unknown>[] = [];
    const pool = Array.from({ length: 10 }, (_, i) => spec(600 + i));
    const inPool = () => pool.filter(cached).length;
    let seq = 1000;
    for (let step = 0; step < 600; step++) {
      const id = owners[Math.floor(r() * owners.length)];
      const cur = latest.get(id);
      const x = r();
      if (x < 0.4 || !cur) {
        const next = { s: pool[Math.floor(r() * 10)], seq: ++seq }; // bodies may share a spec
        latest.set(id, next);
        pending.push(loadHeightFunction(next.s, ctx, { id, seq: next.seq }));
      } else if (x < 0.7) pending.push(loadHeightFunction(cur.s, ctx, { id, seq: cur.seq }));
      else if (x < 0.8) pending.push(loadHeightFunction(pool[Math.floor(r() * 10)], ctx, { id, seq: 0 }));
      else await new Promise((res) => setTimeout(res, 0));
      // Per body: the loaded spec and the one loading.
      expect(inPool()).toBeLessThanOrEqual(2 * owners.length);
    }
    await Promise.all(pending);
    for (const { s } of latest.values()) expect(peekHeightFunction(s)).toBeDefined();
    expect(inPool()).toBeLessThanOrEqual(owners.length);
  });
});

describe('terrainHeightGeneration', () => {
  const A = 1738.1e3;
  const moon: Body = {
    id: 'moon',
    name: 'Moon',
    kind: 'moon',
    frame: 'moon',
    fixedFrame: 'moon.fixed',
    radius: A,
    influenceRadius: 6e7,
  };

  it('is 0 without a height function and grows each time the function is replaced', async () => {
    let registered: HeightSourceSpec = defaultHeightSpec(moon);
    const sys = new TerrainSystem({
      registry: { heightSource: () => registered, body: () => moon } as never,
      hasFrame: () => true,
      assets: { track: <T>(p: Promise<T>) => p, binary: () => Promise.reject(new Error('no')) } as never,
      workers: null,
      exposure: { value: 1 },
      baseUrl: '/',
      seed: 1,
      test: true,
    });
    setActiveSystem(sys);
    const dir = vec3(0.6, 0.48, 0.64);
    try {
      expect(terrainHeightGeneration('moon')).toBe(0);
      await sys.loadFunction(moon);
      const g1 = terrainHeightGeneration('moon');
      const h1 = terrainHeightAt('moon', dir);
      expect(g1).toBeGreaterThan(0);
      expect(h1).not.toBeNull();

      sys.refreshSpecs(); // same spec: same function
      await sys.loadFunction(moon);
      expect(terrainHeightGeneration('moon')).toBe(g1);

      // Same module, new parameters (an HD block move): the old function stays until the new one loads.
      registered = { ...registered, params: defaultParams(A, true, 4242) };
      sys.refreshSpecs();
      expect(terrainHeightGeneration('moon')).toBe(g1);
      await sys.loadFunction(moon);
      const g2 = terrainHeightGeneration('moon');
      expect(g2).toBeGreaterThan(g1);
      expect(terrainHeightAt('moon', dir)).not.toBe(h1);

      // Another module: no function until it loads, then a larger generation than before.
      registered = {
        ...registered,
        workerModule: '/src/modules/surfaces/height/surface.ts',
        params: { bodyId: 'moon', radius: A, seed: 3, maxAbs: 100 },
        maxAbsHeight: 100,
      };
      sys.refreshSpecs();
      expect(terrainHeightGeneration('moon')).toBe(0);
      await sys.loadFunction(moon);
      expect(terrainHeightGeneration('moon')).toBeGreaterThan(g2);

      expect(terrainHeightGeneration('mars')).toBe(0);
    } finally {
      setActiveSystem(null);
      sys.dispose();
    }
    expect(terrainHeightGeneration('moon')).toBe(0);
  });
});
