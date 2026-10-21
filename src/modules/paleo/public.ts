/** Cross-module API of the paleo module (import only this file from other modules). */
import { SURFACE } from './biome';

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

/** The nearest land or exposed-shelf cell within `maxCells` of a point (rings outward), or null. */
export function sampleClimateLand(
  map: { width: number; height: number; data: Uint8Array },
  latDeg: number,
  lonDeg: number,
  maxCells = 2,
): { kind: number; tempC: number; moisture: number; elevM: number } | null {
  const x0 = Math.floor(((lonDeg + 180) / 360) * map.width);
  const y0 = Math.min(map.height - 1, Math.max(0, Math.floor(((latDeg + 90) / 180) * map.height)));
  for (let r = 1; r <= maxCells; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const y = Math.min(map.height - 1, Math.max(0, y0 + dy));
        const x = (((x0 + dx) % map.width) + map.width) % map.width;
        const k = (y * map.width + x) * 4;
        const d = map.data;
        if (d[k] === SURFACE.land || d[k] === SURFACE.shelf)
          return { kind: d[k], tempC: d[k + 1] - 60, moisture: d[k + 2] / 255, elevM: (d[k + 3] - 128) * 40 };
      }
  return null;
}
