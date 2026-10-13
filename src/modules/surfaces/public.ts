/**
 * Cross-module API of surfaces (P2-C). Height specs use the worker module SURFACE_HEIGHT_MODULE
 * (priority 5); shadings override the solar-system default at priority 5 (Earth's 10 still wins).
 */
export const SURFACES_MODULE_ID = 'surfaces';
export { SURFACE_HEIGHT_MODULE, SURFACE_HEIGHT_PRIORITY, SURFACE_BODIES, ICY_BODIES } from './specs';
export { SURFACE_SHADING_PRIORITY } from './shading';
export { HIMALAYA_ID } from './bookmarks';
export { decodeTerrarium, terrariumTileUrl } from './terrarium';
export type { SurfaceHeightParams } from './heightfield';
