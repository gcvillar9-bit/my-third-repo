/**
 * Height-module loader shared by the terrain worker and the main thread (collision). Modules are
 * the files matched by import.meta.glob('/src/modules/*\/height/*.ts'), keyed by
 * HeightSourceSpec.workerModule; each default-exports a HeightModule or exports `create`.
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

/** Creates (once per module + params) the height function for a spec. */
export function loadHeightFunction(spec: HeightSpecLike, ctx: HeightWorkerContext): Promise<HeightFunction> {
  const key = specKey(spec);
  let p = cache.get(key);
  if (!p) {
    const load = MODULES[spec.workerModule];
    if (!load) return Promise.reject(new Error(`terrain: unknown height module '${spec.workerModule}'`));
    const loading = load().then(async (m) => {
      const create = m.default?.create ?? m.create;
      if (!create) throw new Error(`terrain: '${spec.workerModule}' exports no create()`);
      const fn = await create(spec.params, ctx);
      ready.set(key, fn);
      return fn;
    });
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
