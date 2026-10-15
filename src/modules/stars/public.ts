/**
 * Cross-module API of the stars module (other modules import only this file).
 * P4-C (constellations, star systems) reads the decoded HYG catalogue through `starCatalog()`.
 */
import type { StarCatalog } from './catalog';
import type { PanoramaHole } from './milkyway';

export type { NameRow, StarCatalog, StarNames } from './catalog';
export type { StarData } from './format';
export { appMagAt, raDec, spectralClass } from './catalog';
export { FLAG_DIST_UNKNOWN, FLAG_HIPPARCOS, FLAG_MULTIPLE, FLAG_NAMED, FLAG_VARIABLE } from './format';
export { FADE_END, FADE_START, galacticUv, MILKY_WAY_LUMINANCE, milkyWayFade } from './milkyway';
export type { PanoramaHole } from './milkyway';
export { createStarSprites, HIDE_MAX, yearsSinceJ2000, type StarSprites } from './points';
export { PM_PC_PER_KMS_YR } from './format';

let resolve: (c: StarCatalog) => void = () => {};
const catalogPromise = new Promise<StarCatalog>((r) => (resolve = r));

/** Resolves with the decoded catalogue once the stars module has initialised. */
export const starCatalog = (): Promise<StarCatalog> => catalogPromise;

/** @internal Called by the stars module after decoding. */
export const resolveCatalog = (c: StarCatalog): void => resolve(c);

let hidden: readonly number[] = [];
let applyHidden: (indices: readonly number[]) => void = () => {};

/**
 * Hides HYG stars (indices into stars.bin, at most HIDE_MAX) from the point cloud and the star labels,
 * because another module draws them (P4 star promotion). Pass [] to restore.
 */
export function hideStars(indices: readonly number[]): void {
  hidden = indices.slice();
  applyHidden(hidden);
}

/** Currently hidden star indices. */
export const hiddenStars = (): readonly number[] => hidden;

/** @internal Wired by the stars module once the point cloud exists. */
export const bindHideStars = (fn: (indices: readonly number[]) => void): void => {
  applyHidden = fn;
  fn(hidden);
};

let hole: PanoramaHole | null = null;
let applyHole: (h: PanoramaHole | null) => void = () => {};

/**
 * Cuts a soft hole in the Milky Way panorama around an object another module draws itself (e.g. the Orion
 * Nebula volume), so the panorama's own blurred copy of it is not added on top: inside `inner` the panorama is
 * replaced by the mean of a ring of taps at `ring`, fading back to the panorama by `outer`. Pass null to restore.
 * One hole at a time (the last call wins).
 */
export function setPanoramaHole(h: PanoramaHole | null): void {
  hole = h;
  applyHole(hole);
}

/** @internal Wired by the stars module once the panorama exists. */
export const bindPanoramaHole = (fn: (h: PanoramaHole | null) => void): void => {
  applyHole = fn;
  fn(hole);
};
