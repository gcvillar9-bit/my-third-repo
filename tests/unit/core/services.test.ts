import { describe, expect, it, vi } from 'vitest';
import { joinBase, AssetLoaderImpl } from '../../../src/core/assets';
import { ResourceBudgetImpl } from '../../../src/core/budget';
import { QUALITY_PRESETS, type UniverseModule, type ModuleContext } from '../../../src/core/contracts';
import { collectModules, initModules, sortModules } from '../../../src/core/discover';
import { FrameTreeImpl } from '../../../src/core/frames';
import { v3set } from '../../../src/core/math64';
import { parseQuality, PRESET_KNOBS, QualityStateImpl } from '../../../src/core/quality';
import { RegistryImpl } from '../../../src/core/registry';
import { WorkerPoolImpl, type WrapFn } from '../../../src/core/workers';

describe('quality presets', () => {
  it('defines every preset with the DESIGN knobs', () => {
    expect(Object.keys(PRESET_KNOBS)).toEqual([...QUALITY_PRESETS]);
    expect(QUALITY_PRESETS.map((p) => PRESET_KNOBS[p].terrainTileCap)).toEqual([64, 192, 384, 768, 1024]);
    expect(QUALITY_PRESETS.map((p) => PRESET_KNOBS[p].gpuBudgetMB)).toEqual([128, 128, 256, 512, 512]);
    expect(PRESET_KNOBS.potato.smaa).toBe(false);
    expect(PRESET_KNOBS.potato.renderScale).toBe(1);
    expect(PRESET_KNOBS.ultra.maxTextureSize).toBe(8192);
    for (const p of QUALITY_PRESETS) expect(PRESET_KNOBS[p].preset).toBe(p);
  });

  it('parses ?q=, notifies and keeps tests deterministic', () => {
    expect(parseQuality('potato')).toBe('potato');
    expect(parseQuality('bogus')).toBe('medium');
    expect(parseQuality(null)).toBe('medium');
    const q = new QualityStateImpl('medium', true);
    expect(q.knobs.temporal).toBe(false);
    const seen: string[] = [];
    q.subscribe((k) => seen.push(k.preset));
    q.set('high');
    expect(seen).toEqual(['high']);
    q.setDynamicScale(0.6);
    expect(q.dynamicScale).toBe(1);
    const live = new QualityStateImpl('low');
    live.setDynamicScale(0.1);
    expect(live.dynamicScale).toBe(0.5);
  });
});

describe('ResourceBudget', () => {
  it('accounts bytes and evicts least recently used entries', () => {
    const b = new ResourceBudgetImpl(1000);
    const evicted: string[] = [];
    const a = b.alloc('m1', 'a', 400, () => evicted.push('a'));
    b.alloc('m2', 'b', 400, () => evicted.push('b'));
    a.touch();
    b.alloc('m1', 'c', 400); // needs room: evicts 'b' (older than the touched 'a')
    expect(evicted).toEqual(['b']);
    expect(b.used()).toBe(800);
    expect(b.used('m1')).toBe(800);
    expect(b.report()).toEqual({ m1: 800 });
    a.resize(100);
    expect(b.used()).toBe(500);
    a.free();
    a.free();
    expect(b.used()).toBe(400);
    expect(b.makeRoom(0)).toBe(0);
  });
});

describe('WorkerPool', () => {
  it('routes calls to the least busy worker and counts pending calls', async () => {
    const resolvers: (() => void)[] = [];
    const calls: number[] = [];
    let n = 0;
    const wrap: WrapFn = () => {
      const id = n++;
      return {
        work: (x: unknown) =>
          new Promise((r) => {
            calls.push(id);
            resolvers.push(() => r((x as number) * 2));
          }),
      } as unknown as ReturnType<WrapFn>;
    };
    const pool = new WorkerPoolImpl(8, wrap);
    expect(pool.maxWorkers).toBe(4);
    const h = pool.pool<{ work(x: number): Promise<number> }>('k', () => ({ terminate() {} }) as Worker, 2);
    expect(pool.pool('k', () => ({}) as Worker)).toBe(h);
    const p1 = h.call('work', 1);
    const p2 = h.call('work', 2);
    expect(calls).toEqual([0, 1]);
    expect(pool.pending()).toBe(2);
    resolvers.forEach((r) => r());
    expect(await Promise.all([p1, p2])).toEqual([2, 4]);
    expect(pool.pending()).toBe(0);
    pool.terminateAll();
  });
});

describe('assets', () => {
  it('prefixes BASE_URL and leaves absolute URLs alone', () => {
    expect(joinBase('/my-third-repo/', 'data/stars/stars.bin')).toBe('/my-third-repo/data/stars/stars.bin');
    expect(joinBase('/my-third-repo', '/data/x.json')).toBe('/my-third-repo/data/x.json');
    expect(joinBase('/b/', 'https://example.org/x.png')).toBe('https://example.org/x.png');
    expect(joinBase('/b/', 'data:,x')).toBe('data:,x');
  });

  it('tracks loads and work until idle', async () => {
    const fetchFn = vi.fn(
      async (url: string) => new Response(JSON.stringify({ url })),
    ) as unknown as typeof fetch;
    const a = new AssetLoaderImpl('/base/', undefined, fetchFn);
    const j = a.json<{ url: string }>('data/x.json');
    let released!: () => void;
    a.track(new Promise<void>((r) => (released = r)));
    expect(a.progress().total).toBe(2);
    let idle = false;
    const w = a.whenIdle().then(() => (idle = true));
    expect((await j).url).toBe('/base/data/x.json');
    await new Promise((r) => setTimeout(r, 5));
    expect(idle).toBe(false);
    released();
    await w;
    expect(a.progress().loaded).toBe(2);
  });
});

describe('module discovery', () => {
  const mod = (
    id: string,
    dependsOn?: string[],
    init: UniverseModule['init'] = () => {},
  ): UniverseModule => ({
    id,
    dependsOn,
    init,
  });

  it('sorts topologically and rejects cycles or missing dependencies', () => {
    const order = sortModules([
      mod('ui-x', ['stars']),
      mod('stars', ['solar-system']),
      mod('solar-system'),
      mod('_debug'),
    ]);
    expect(order.map((m) => m.id)).toEqual(['_debug', 'solar-system', 'stars', 'ui-x']);
    expect(() => sortModules([mod('a', ['b']), mod('b', ['a'])])).toThrow(/cycle/);
    expect(() => sortModules([mod('a', ['zzz'])])).toThrow(/missing/);
    expect(() => sortModules([mod('a'), mod('a')])).toThrow(/duplicate/);
  });

  it('collects default or named exports whose id matches the folder', () => {
    const mods = collectModules({
      '/src/modules/a/index.ts': { default: mod('a') },
      '/src/modules/b/index.ts': { module: mod('b') },
    });
    expect(mods.map((m) => m.id)).toEqual(['a', 'b']);
    expect(() => collectModules({ '/src/modules/c/index.ts': { default: mod('d') } })).toThrow();
    expect(() => collectModules({ '/src/modules/c/index.ts': {} })).toThrow();
  });

  it('skips dependents of a failing module', async () => {
    const ran: string[] = [];
    const report = await initModules(
      [
        mod('a', [], () => {
          throw new Error('boom');
        }),
        mod('b', ['a'], () => void ran.push('b')),
        mod('c', [], async () => void ran.push('c')),
      ],
      {} as ModuleContext,
      () => {},
    );
    expect(ran).toEqual(['c']);
    expect(report.failed.map((f) => f.id)).toEqual(['a']);
    expect(report.skipped).toEqual(['b']);
  });
});

describe('registry', () => {
  it('picks the highest-priority shading and forwards renderables to hooks', () => {
    const frames = new FrameTreeImpl();
    const added: string[] = [];
    const disposed: string[] = [];
    const reg = new RegistryImpl(frames, { renderableAdded: (r) => added.push(r.id) });
    const kinds: string[] = [];
    reg.subscribe((k) => kinds.push(k));
    reg.addFrame({
      id: 'x',
      parent: 'universe',
      influenceRadius: 1,
      positionAt: (_j, o) => v3set(o, 0, 0, 0),
    });
    expect(frames.has('x')).toBe(true);
    reg.setSurfaceShading({ bodyId: 'moon', priority: 0, glsl: 'a', uniforms: {} });
    reg.setSurfaceShading({ bodyId: 'moon', priority: 10, glsl: 'b', uniforms: {} });
    expect(reg.surfaceShading('moon')!.glsl).toBe('b');
    const r = {
      id: 'm.r',
      layer: 'opaque' as const,
      object: {} as never,
      update() {},
      memoryBytes: () => 0,
      dispose: () => void disposed.push('m.r'),
    };
    reg.addRenderable(r);
    reg.removeRenderable('m.r');
    expect(added).toEqual(['m.r']);
    expect(disposed).toEqual(['m.r']);
    reg.addBookmarks([{ id: 'b1', title: 'B', frame: 'x', pos: { x: 0, y: 0, z: 1 } }]);
    expect(reg.bookmark('b1')!.title).toBe('B');
    expect(kinds).toEqual(['frame', 'surface', 'surface', 'renderable', 'renderable', 'bookmark']);
  });
});
