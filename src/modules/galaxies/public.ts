/**
 * Cross-module API of the galaxies module (other modules import only this file): the GALX decoder and
 * the named galaxies (universe-frame positions in Mpc), e.g. for tours.
 */
export { decodeGalaxies, GALAXY_TYPES, galaxyQuat, type GalaxyData } from './format';
export { NAMED as NAMED_GALAXIES, galaxyId, namedBookmark, type NamedGalaxy } from './named';
