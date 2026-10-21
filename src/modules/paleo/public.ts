/** Cross-module API of the paleo module (import only this file from other modules). */
export { PALEO_MODULE_ID } from './shading';
export { PALEO_BOOKMARK_IDS, middayNear, onFoldedDay } from './bookmarks';
export { regimeAt, seaLevelAt, gmstAt, type PaleoIndex, type Regime } from './climate';
export { paleoClimate, CLIMATE_W, CLIMATE_H, type ClimateMap } from './shading';
export { SURFACE } from './biome';

/** Climate at a point of a ClimateMap (nearest cell). */
export function sampleClimate(
  map: { width: number; height: number; data: Uint8Array },
  latDeg: number,
  lonDeg: number,
): { kind: number; tempC: number; moisture: number; elevM: number } {
  const x = Math.min(map.width - 1, Math.max(0, Math.floor(((lonDeg + 180) / 360) * map.width)));
  const y = Math.min(map.height - 1, Math.max(0, Math.floor(((latDeg + 90) / 180) * map.height)));
  const k = (y * map.width + x) * 4;
  const d = map.data;
  return { kind: d[k], tempC: d[k + 1] - 60, moisture: d[k + 2] / 255, elevM: (d[k + 3] - 128) * 40 };
}
