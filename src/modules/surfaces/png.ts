/**
 * PNG decoding for height rasters (fast-png). Imported only by the lazily loaded height module and
 * tests, so the decoder stays out of the initial bundle.
 */
import { decode } from 'fast-png';
import { Raster } from './raster';

/** Decodes a grey PNG (8 or 16 bit) into a Raster of `offset + value * step`. */
export function rasterFromPng(buf: ArrayBuffer | Uint8Array, offset: number, step: number): Raster {
  const img = decode(buf instanceof Uint8Array ? buf : new Uint8Array(buf));
  const n = img.width * img.height;
  const c = img.channels;
  const data = new Float32Array(n);
  const src = img.data as ArrayLike<number>;
  for (let i = 0; i < n; i++) data[i] = offset + src[i * c] * step;
  return new Raster(img.width, img.height, data);
}
