/**
 * Cross-module API of the nebulae module: ids only (settings, bookmarks, search entries, frame).
 */
export const NEBULAE_MODULE_ID = 'nebulae';
export { ENABLED_SETTING, STYLE_SETTING } from './style';
export { ASTROPHOTO_ID, FROM_20LY_ID, INSIDE_ID, TELESCOPE_ID } from './bookmarks';
export { SEARCH_M42, SEARCH_M43, SEARCH_TRAPEZIUM } from './ui';
export { NEBULA_FRAME } from './frame';
export type { NebulaStyle } from './display';
