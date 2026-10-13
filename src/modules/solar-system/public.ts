/**
 * Cross-module API of solar-system (import only this file from other modules).
 *
 * - Frames: `<id>` (inertial, ICRF axes, origin at the body centre) and `<id>.fixed` (IAU pole
 *   and prime meridian) for every bodies.json row; `<id>.sunview` (+x Sun, +z ecliptic north)
 *   for bookmarked bodies.
 * - Surfaces: the 'sphere' geometry provider (priority 0, bodyId '*') and default shadings
 *   (priority 0) for every body; P2/P3 override per body with priority 10.
 * - Kepler helpers for small bodies (P3-B).
 */
export { MODULE_ID as SOLAR_SYSTEM_MODULE_ID, CITY_LUMINANCE } from './render/shading';
export { SPHERE_PROVIDER_ID } from './render/sphere';
export { BODIES_PATH, ATMOSPHERE_BODIES, texturePath } from './data';
export type { BodiesFile, BodyRow, ElementsRow, RotationRow } from './data';
export { SUNVIEW_SUFFIX, fixedFrameId, sunviewFrameId } from './frames';
export {
  KeplerOrbit,
  conicFromState,
  conicPoint,
  keplerPeriodDays,
  solveKepler,
  ECLIPTIC_TO_ICRF,
  OBLIQUITY_J2000,
} from './kepler';
export type { Conic, Mat3 } from './kepler';
export { SolarEphemeris, EPHEMERIS_HALF_RANGE_DAYS } from './ephemeris';
