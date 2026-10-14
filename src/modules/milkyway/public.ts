/**
 * Cross-module API of the milkyway module (other modules import only this file): the GalaxyModel
 * TypeScript twin (densities, dust, sky luminance) and the model frame.
 */
export {
  armAzimuth,
  armRadius,
  ARMS,
  dustKappa,
  emissivity,
  galacticDir,
  MODEL,
  MW_TO_MODEL,
  skyLuminance,
  SUN_MODEL,
  sunSkyLuminance,
  WORLD_TO_MODEL,
} from './model';
export { OUTSIDE_SWITCH, skyWeight } from './galaxy';
