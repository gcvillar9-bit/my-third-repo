/**
 * Cross-module API of the stars module (other modules import only this file).
 * P4-C (constellations, star systems) reads the decoded HYG catalogue through `starCatalog()`.
 */
import type { StarCatalog } from './catalog';

export type { NameRow, StarCatalog, StarNames } from './catalog';
export type { StarData } from './format';
export { appMagAt, raDec, spectralClass } from './catalog';
export { FLAG_DIST_UNKNOWN, FLAG_HIPPARCOS, FLAG_MULTIPLE, FLAG_NAMED, FLAG_VARIABLE } from './format';
export { galacticUv } from './milkyway';

let resolve: (c: StarCatalog) => void = () => {};
const catalogPromise = new Promise<StarCatalog>((r) => (resolve = r));

/** Resolves with the decoded catalogue once the stars module has initialised. */
export const starCatalog = (): Promise<StarCatalog> => catalogPromise;

/** @internal Called by the stars module after decoding. */
export const resolveCatalog = (c: StarCatalog): void => resolve(c);
