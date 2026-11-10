/**
 * Cross-module API of spacecraft (import only this file from other modules).
 *
 * - Bodies (kind 'spacecraft') and frames: `iss`, `hubble`, `jwst`, `voyager1`, `voyager2`,
 *   `newhorizons`, `pioneer10`, `pioneer11`; each with `<id>.fixed` (the craft's body axes).
 *   A craft is registered only between its launch and the end of the fleet's validity range.
 * - Bookmarks: SPACECRAFT_BOOKMARKS. Setting: `spacecraft.enabled`.
 * - Motion models and two-body helpers for anything else that flies (three-free).
 */
export { MODULE_ID as SPACECRAFT_MODULE_ID, fixedFrameId, FLEET_JD_MAX } from './fleet';
export { CRAFT_PATH } from './data';
export type { CraftFile, CraftRow } from './data';
export { lambert, propagate, conicSummary } from './kepler';
export { astronomyEphemeris, createMotion, ECLIPTIC_NORTH } from './trajectory';
export type { CraftMotion, Ephemeris } from './trajectory';

export const SPACECRAFT_IDS = [
  'iss',
  'hubble',
  'jwst',
  'voyager1',
  'voyager2',
  'newhorizons',
  'pioneer10',
  'pioneer11',
] as const;

export const SPACECRAFT_BOOKMARKS = [
  'iss-over-earth',
  'hubble-over-earth',
  'jwst-l2',
  'voyager1-looking-back',
  'new-horizons',
] as const;
