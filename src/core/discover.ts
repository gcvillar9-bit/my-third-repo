/**
 * Module discovery helpers (pure). src/app/discover.ts feeds them the
 * import.meta.glob('/src/modules/*\/index.ts') result.
 */
import type { ModuleContext, UniverseModule } from './contracts';

function isModule(x: unknown): x is UniverseModule {
  return (
    !!x &&
    typeof x === 'object' &&
    typeof (x as UniverseModule).id === 'string' &&
    typeof (x as UniverseModule).init === 'function'
  );
}

/**
 * Extracts modules from glob results ({ '/src/modules/<id>/index.ts': exports }). Each file
 * default-exports (or exports `module`) a UniverseModule whose id equals the folder name.
 */
export function collectModules(glob: Record<string, unknown>): UniverseModule[] {
  const out: UniverseModule[] = [];
  for (const [path, exp] of Object.entries(glob)) {
    const e = exp as { default?: unknown; module?: unknown };
    const m = isModule(e?.default) ? e.default : isModule(e?.module) ? e.module : null;
    if (!m) throw new Error(`discover: ${path} exports no UniverseModule`);
    const folder = /\/modules\/([^/]+)\/index\.ts$/.exec(path)?.[1];
    if (folder && folder !== m.id)
      throw new Error(`discover: ${path} has id '${m.id}', expected '${folder}'`);
    out.push(m);
  }
  return out;
}

/** Topological order by dependsOn (ties alphabetical). Throws on cycles or missing deps. */
export function sortModules(mods: readonly UniverseModule[]): UniverseModule[] {
  const byId = new Map<string, UniverseModule>();
  for (const m of mods) {
    if (byId.has(m.id)) throw new Error(`discover: duplicate module '${m.id}'`);
    byId.set(m.id, m);
  }
  const state = new Map<string, 1 | 2>();
  const out: UniverseModule[] = [];
  const visit = (m: UniverseModule, chain: string[]) => {
    const s = state.get(m.id);
    if (s === 2) return;
    if (s === 1) throw new Error(`discover: dependency cycle ${[...chain, m.id].join(' -> ')}`);
    state.set(m.id, 1);
    for (const d of [...(m.dependsOn ?? [])].sort()) {
      const dep = byId.get(d);
      if (!dep) throw new Error(`discover: module '${m.id}' depends on missing '${d}'`);
      visit(dep, [...chain, m.id]);
    }
    state.set(m.id, 2);
    out.push(m);
  };
  for (const m of [...mods].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) visit(m, []);
  return out;
}

export interface InitReport {
  ok: string[];
  failed: { id: string; error: unknown }[];
  skipped: string[];
}

/**
 * Awaits init in order. A failing module is reported and its dependents are skipped, so one
 * broken module never takes the app down.
 */
export async function initModules(
  mods: readonly UniverseModule[],
  ctx: ModuleContext,
  onError: (id: string, e: unknown) => void = (id, e) => console.error(`[cosmos] module '${id}' failed`, e),
): Promise<InitReport> {
  const report: InitReport = { ok: [], failed: [], skipped: [] };
  const bad = new Set<string>();
  for (const m of mods) {
    if ((m.dependsOn ?? []).some((d) => bad.has(d))) {
      bad.add(m.id);
      report.skipped.push(m.id);
      continue;
    }
    try {
      await m.init(ctx);
      report.ok.push(m.id);
    } catch (e) {
      bad.add(m.id);
      report.failed.push({ id: m.id, error: e });
      onError(m.id, e);
    }
  }
  return report;
}
