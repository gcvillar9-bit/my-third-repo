/**
 * Cross-module API of the oort module (import only this file from other modules).
 *
 * - Bodies and frames: 'sedna', '2012-vp113', 'leleakuhonua', 'ammonite', 'bernardinelli-bernstein',
 *   'oumuamua', 'borisov' and '3i-atlas'; frames 'flyby:gliese-710' and 'flyby:scholz-star'.
 * - Bookmarks, setting ids and the fades that keep the module out of inner Solar System views.
 */
export {
  CLOUD_FADE_IN_AU,
  FAR_FADE_AU,
  LINE_FADE_IN_AU,
  OORT_MODULE_ID,
  SETTING_BRIGHTNESS,
  SETTING_ENABLED,
  SETTING_MARKERS,
  fadesAt,
} from './shared';
export { CLOUD_BOOKMARK_ID, INSIDE_BOOKMARK_ID, SPIRAL_BOOKMARK_ID } from './cloud/bookmarks';
export {
  BB_ORBIT_BOOKMARK,
  SCHOLZ_BOOKMARK,
  SEDNA_BOOKMARK,
  SEDNOID_ORBITS_BOOKMARK,
  VISITORS_BOOKMARK,
} from './bodies/bookmarks';
