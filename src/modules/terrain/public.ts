/**
 * Cross-module API of terrain (import only this file from other modules).
 *
 * - Geometry: provider 'terrain' (priority 10, bodyId '*') for planets, dwarfs, moons and minor
 *   bodies (not the gas giants) below 3 R; the 'sphere' provider keeps far views.
 * - Heights: register a HeightSourceSpec (registry.addHeightSource) whose workerModule is a key of
 *   import.meta.glob('/src/modules/*\/height/*.ts'); bodies without one use DEFAULT_HEIGHT_MODULE.
 * - Ground: a GroundProvider (priority 10) identical to the drawn mesh; terrainHeightAt for modules
 *   that place objects on the ground (life), and terrainHeightGeneration to know when to re-place them.
 * - Stats: terrainStats() (resident tiles, drawn leaves, in-flight requests).
 */
import type { Vec3d } from '../../core/contracts';
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

/**
 * Ground height under body-fixed unit direction `dir`, m above the body's equatorial radius (ground
 * radius = body.radius + h), from the finest grid like the camera's ground; null while the body has no
 * terrain height function yet.
 */
export function terrainHeightAt(bodyId: string, dir: Vec3d): number | null {
  return active ? active.heightAt(bodyId, dir) : null;
}

/**
 * Generation of the height function behind terrainHeightAt(bodyId): 0 while the body has none, else a
 * number that grows (by at least 1) every time that function is replaced (first load, HD block swaps), so
 * callers can cache ground heights and re-place objects when it changes.
 */
export function terrainHeightGeneration(bodyId: string): number {
  return active ? active.heightGeneration(bodyId) : 0;
}
