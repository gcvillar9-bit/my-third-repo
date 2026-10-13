/**
 * Cross-module API of the earth module (import only this file from other modules).
 * The module overrides Earth's SurfaceShading (priority 10) and adds the cloud shell and bookmarks.
 */
export { EARTH_MODULE_ID } from './textures';
export { CLOUD_ALTITUDE_M } from './shading';
/** Bookmark ids (earth-dawn-400km is the intended default start view). */
export const EARTH_BOOKMARKS = [
  'earth-dawn-400km',
  'earth-limb-400km',
  'earth-night-lights',
  'earth-sunrise-400km',
] as const;
