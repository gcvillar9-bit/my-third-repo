/**
 * Cross-module API of the comets module (import only this file from other modules).
 *
 * - Frames and bodies: one inertial frame and one Body (`kind: 'comet'`) per row of data/comets/comets.json,
 *   with ids 'halley', 'encke', 'pons-brooks', '67p', 'swift-tuttle', 'hale-bopp', 'hyakutake', 'mcnaught',
 *   'neowise' and 'tsuchinshan-atlas'.
 * - Bookmarks, settings and the pure orbit and activity helpers.
 */
export { COMETS_MODULE_ID, COMETS_PATH } from './data';
export type { CometElements, CometRow, CometsFile } from './data';
export { HALE_BOPP_BOOKMARK, HALLEY_BOOKMARK, HALLEY_NUCLEUS_BOOKMARK, NEOWISE_BOOKMARK } from './bookmarks';
export { CometOrbit, solveUniversal, stumpffC, stumpffS } from './orbit';
export { activityFade, apparentMagnitude, comaIntensity, comaRadius, ionTailLength } from './model';

/** The module's one setting; comet orbit lines follow the app-wide 'solar-system.orbits' switch. */
export const COMETS_ENABLED_SETTING = 'comets.enabled';
