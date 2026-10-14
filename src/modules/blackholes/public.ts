/**
 * Cross-module API of the blackholes module (import only this file from other modules).
 */
export const BLACKHOLES_MODULE_ID = 'blackholes';
/** Public path of the catalogue (holes and S-stars). */
export const CATALOGUE_PATH = 'data/blackholes/blackholes.json';
/** Id of the lensing ScreenPass (stage 'lensing'). */
export const LENSING_PASS_ID = 'blackholes.lensing';
export { B_CRIT, PHOTON_SPHERE, R_ISCO, deflectionExact, shadowAngle } from './geodesic';
export { schwarzschildRadius, holeFrameId } from './catalog';
