/**
 * Module discovery (CONTRACTS lifecycle 1-2): every src/modules/<id>/index.ts, eagerly
 * imported, topologically sorted by dependsOn. Heavy code stays behind dynamic import().
 */
import type { UniverseModule } from '../core/contracts';
import { collectModules, sortModules } from '../core/discover';

export { initModules } from '../core/discover';

export function discoverModules(): UniverseModule[] {
  return sortModules(collectModules(import.meta.glob('/src/modules/*/index.ts', { eager: true })));
}
