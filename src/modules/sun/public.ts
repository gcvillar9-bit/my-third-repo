/**
 * Cross-module API of the sun module (import only this file from other modules).
 *
 * - `starSurface(teff, radius, opts?)`: a photosphere SurfaceShading (Neckel limb darkening,
 *   animated granulation, physically pre-exposed) for any star; register it with
 *   `registry.setSurfaceShading(starSurface(teff, R, { bodyId }))` (priority 10 by default).
 * - CPU twins: limb darkening, mean disk luminance versus Teff, Baumbach corona brightness.
 */
export { starSurface, granuleSize, starTime, type StarSurfaceOptions } from './shading';
export { coronaBrightness, diskLuminance, limbDiskMean, limbProfile } from './photometry';
export { SUN_CLOSEUP_ID } from './bookmarks';
export { CORONA_ID } from './corona';
export const SUN_MODULE_ID = 'sun';
