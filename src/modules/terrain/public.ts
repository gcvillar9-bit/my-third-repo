/**
 * Cross-module API of terrain (import only this file from other modules).
 *
 * - Geometry: provider 'terrain' (priority 10, bodyId '*') for planets, dwarfs, moons and minor
 *   bodies (not the gas giants) below 3 R; the 'sphere' provider keeps far views.
 * - Heights: register a HeightSourceSpec (registry.addHeightSource) whose workerModule is a key of
 *   import.meta.glob('/src/modules/*\/height/*.ts'); bodies without one use DEFAULT_HEIGHT_MODULE.
 * - Ground: a GroundProvider (priority 10) identical to the drawn mesh.
 * - Stats: terrainStats() (resident tiles, drawn leaves, in-flight requests).
 */
import type { TerrainStats, TerrainSystem } from './system';

export { DEFAULT_HEIGHT_MODULE } from './defaults';
export { MAX_LEVEL, PATCH_N } from './cube';
export { TERRAIN_PRIORITY, TERRAIN_PROVIDER_ID, HANDOFF_RADII } from './system';
export type { TerrainStats } from './system';

let active: TerrainSystem | null = null;

/** @internal Set by the module's init. */
export function setActiveSystem(s: TerrainSystem | null): void {
  active = s;
}

/** Resident tiles, drawn leaves and in-flight patch requests across all bodies. */
export function terrainStats(): TerrainStats {
  return active ? active.stats() : { tiles: 0, leaves: 0, inflight: 0 };
}
