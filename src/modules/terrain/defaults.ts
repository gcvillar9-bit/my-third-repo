/**
 * Default height sources and terrain eligibility. Bodies without a registered HeightSourceSpec get
 * 'fbm-craters-lite' (P2-C replaces it per body by registering a spec).
 */
import type { Body, HeightSourceSpec } from '../../core/contracts';
import { defaultParams, maxAbsHeight } from './fbm-params';

export const DEFAULT_HEIGHT_MODULE = '/src/modules/terrain/height/fbm-craters-lite.ts';

const TERRAIN_KINDS: ReadonlySet<Body['kind']> = new Set(['planet', 'dwarf', 'moon', 'minor']);
/** Bodies without a solid surface to walk on. */
const NO_TERRAIN: ReadonlySet<string> = new Set(['jupiter', 'saturn', 'uranus', 'neptune']);
/** Bodies whose surfaces are not dominated by impact craters. */
const NO_CRATERS: ReadonlySet<string> = new Set(['earth', 'venus', 'titan', 'io', 'europa']);

/**
 * Bodies whose visible surface is ocean or a cloud deck: they get terrain only from a registered
 * HeightSourceSpec, never the default fbm relief (which would wrinkle oceans and cloud tops).
 */
export const NO_DEFAULT_RELIEF: ReadonlySet<string> = new Set(['earth', 'venus', 'titan']);

export function terrainEligible(b: Body): boolean {
  return TERRAIN_KINDS.has(b.kind) && !NO_TERRAIN.has(b.id) && b.radius > 0;
}

/** FNV-1a of the body id: a stable per-body seed. */
export function bodySeed(id: string, seed = 1): number {
  let h = 0x811c9dc5 ^ seed;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

export function defaultHeightSpec(b: Body, seed = 1): HeightSourceSpec {
  const params = defaultParams(b.radius, !NO_CRATERS.has(b.id), bodySeed(b.id, seed));
  return {
    bodyId: b.id,
    workerModule: DEFAULT_HEIGHT_MODULE,
    params,
    maxAbsHeight: maxAbsHeight(params),
    priority: 0,
  };
}
