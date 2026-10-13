/**
 * Cross-module API of eclipses (import only this file from other modules).
 *
 * - `nextSolarEclipse(jd)`, `nextLunarEclipse(jd)`, `localSolarEclipse(jd, lat, lon)`: JD TT in/out.
 * - `buildGroundBookmark(frames, earth, opts)`: a walk-mode bookmark on the ground looking at the
 *   Sun or the Moon at an instant (used by the "next eclipse" search entries).
 * - `diskVisibleFraction`, `skyFactor`: how much the eclipse dims the sky.
 */
export {
  diskVisibleFraction,
  localSolarEclipse,
  nextLunarEclipse,
  nextSolarEclipse,
  skyFactor,
  TOTALITY_SKY_FLOOR,
  type LocalSolarEclipse,
  type LunarEclipse,
  type SolarEclipse,
} from './search';
export {
  LUXOR,
  LUXOR_BOOKMARK_ID,
  buildGroundBookmark,
  ellipsoidPoint,
  geodeticUp,
  type GroundBookmarkOptions,
} from './bookmarks';
