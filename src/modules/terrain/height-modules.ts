/**
 * Height-module loader shared by the terrain worker and the main thread (collision). Modules are
 * the files matched by import.meta.glob('/src/modules/*\/height/*.ts'), keyed by
 * HeightSourceSpec.workerModule; each default-exports a HeightModule or exports `create`.
 * Functions are cached per spec; loads made for an owner (a body's terrain) evict the owner's
 * superseded specs, so moving the HD Earth block does not keep every old block's function alive.
 */
import type {
  HeightFunction,
  HeightModule,
  HeightSourceSpec,
  HeightWorkerContext,
} from '../../core/contracts';

type HeightFile = { default?: HeightModule; create?: HeightModule['create'] };

const MODULES = import.meta.glob<HeightFile>('/src/modules/*/height/*.ts');

/** Keys of every discoverable height module. */
export const heightModuleKeys = (): string[] => Object.keys(MODULES);

export type HeightSpecLike = Pick<HeightSourceSpec, 'workerModule' | 'params'>;

export const specKey = (s: HeightSpecLike): string => `${s.workerModule}|${JSON.stringify(s.params)}`;

const cache = new Map<string, Promise<HeightFunction>>();
/** How long a failed height-module load stays cached (rejected) before it may be retried, ms. */
export const FAILED_SPEC_COOLDOWN_MS = 30_000;
const ready = new Map<string, HeightFunction>();

/**
 * Who a load is for: a body's terrain (`id`) and the stamp of its current spec (`seq`, grows with every
 * spec change across all managers). Specs replace each other per owner, so cached functions stay bounded.
 */
export interface HeightOwner {
  id: string;
  seq: number;
}

/** Per owner: the newest spec's key (maybe still loading) and the newest key that has loaded. */
const holders = new Map<string, { seq: number; latest: string; live: string }>();

/** Drops a cached function unless an owner still holds it (in-flight builds keep their own reference). */
function release(key: string): void {
  for (const h of holders.values()) if (h.latest === key || h.live === key) return;
  cache.delete(key);
  ready.delete(key);
}

function promote(h: { latest: string; live: string }, key: string): void {
  if (h.live === key) return;
  const old = h.live;
  h.live = key;
  if (old) release(old);
}

/**
 * Records that `owner` now wants `key`. A newer spec supersedes the older one; a superseded spec that never
 * loaded is dropped at once, the previous loaded one when the newer has loaded (HD block moves). Returns
 * false for a request older than the owner's current spec (an in-flight build of a replaced spec).
 */
function hold(owner: HeightOwner, key: string): boolean {
  const h = holders.get(owner.id);
  if (!h) {
    holders.set(owner.id, { seq: owner.seq, latest: key, live: ready.has(key) ? key : '' });
    return true;
  }
  if (owner.seq < h.seq) return false;
  h.seq = owner.seq;
  if (h.latest !== key) {
    const prev = h.latest;
    h.latest = key;
    if (prev !== h.live) release(prev);
  }
  if (ready.has(key)) promote(h, key);
  return true;
}

/**
 * Creates (once per module + params) the height function for a spec. With an `owner`, only its current
 * spec and the last loaded one stay cached; a request of an older spec gets an uncached function.
 */
export function loadHeightFunction(
  spec: HeightSpecLike,
  ctx: HeightWorkerContext,
  owner?: HeightOwner,
): Promise<HeightFunction> {
  const key = specKey(spec);
  const current = owner ? hold(owner, key) : true;
  let p = cache.get(key);
  if (!p) {
    const load = MODULES[spec.workerModule];
    if (!load) return Promise.reject(new Error(`terrain: unknown height module '${spec.workerModule}'`));
    const loading: Promise<HeightFunction> = load().then(async (m) => {
      const create = m.default?.create ?? m.create;
      if (!create) throw new Error(`terrain: '${spec.workerModule}' exports no create()`);
      const fn = await create(spec.params, ctx);
      // Not if it was superseded (released) while loading.
      if (cache.get(key) === loading) {
        ready.set(key, fn);
        for (const h of holders.values()) if (h.latest === key) promote(h, key);
      }
      return fn;
    });
    if (!current) return loading;
    // Keep a failed load cached for a cool-down so retries do not re-import and re-fetch every frame.
    loading.catch(() =>
      setTimeout(() => cache.get(key) === loading && cache.delete(key), FAILED_SPEC_COOLDOWN_MS),
    );
    cache.set(key, loading);
    p = loading;
  }
  return p;
}

/** The height function if it has already loaded (synchronous). */
export const peekHeightFunction = (spec: HeightSpecLike): HeightFunction | undefined =>
  ready.get(specKey(spec));

/** @internal Keys of the cached (loaded or loading) height functions, for tests. */
export const cachedHeightKeys = (): string[] => [...cache.keys()];
