/**
 * Terrarium elevation tiles (AWS Open Data 'elevation-tiles-prod', Web Mercator, 256x256 PNG):
 * height = R * 256 + G + B / 256 - 32768 metres. Used by the optional Earth HD terrain path and its
 * Playwright fixtures; decoding and tile maths are pure functions.
 */

export const TERRARIUM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export const TERRARIUM_TILE = 256;

export const terrariumTileUrl = (z: number, x: number, y: number): string =>
  TERRARIUM_URL.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));

/** Metres from one Terrarium pixel. */
export const terrariumHeight = (r: number, g: number, b: number): number => r * 256 + g + b / 256 - 32768;

/** Decodes RGBA (or RGB with `channels` 3) Terrarium pixels into metres. */
export function decodeTerrarium(px: ArrayLike<number>, count: number, channels = 4): Float32Array {
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const o = i * channels;
    out[i] = terrariumHeight(px[o], px[o + 1], px[o + 2]);
  }
  return out;
}

/** Inverse of terrariumHeight (fixtures): RGB bytes of a height in metres (1/256 m resolution). */
export function encodeTerrarium(h: number): [number, number, number] {
  const v = Math.round((Math.max(-32768, Math.min(32767, h)) + 32768) * 256);
  return [Math.floor(v / 65536) & 255, Math.floor(v / 256) & 255, v & 255];
}

/** Web Mercator tile (fractional) containing longitude/latitude (degrees) at zoom z. */
export function lonLatToTile(lonDeg: number, latDeg: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const lat = (Math.max(-85.0511, Math.min(85.0511, latDeg)) * Math.PI) / 180;
  return {
    x: ((lonDeg + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n,
  };
}
