/**
 * Procedural, exactly tileable 256x256 RGBA8 detail texture for the triplanar surface detail
 * (no download): R fine regolith fBm, G rock blocks (periodic Worley cells with cracks), B coarse
 * mottling. Every lattice divides 256, so the texture wraps without a seam.
 */
import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat } from 'three';
import { hash3, rehash, smoothstep, unit } from './noise';

export const DETAIL_SIZE = 256;

/** Periodic value noise on an n x n lattice over [0, 1)^2 (smoothstep interpolation). */
function valueNoise(u: number, v: number, n: number, seed: number): number {
  const x = u * n;
  const y = v * n;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const val = (a: number, b: number) => unit(hash3(((a % n) + n) % n, ((b % n) + n) % n, 0, seed));
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = val(ix, iy) + sx * (val(ix + 1, iy) - val(ix, iy));
  const b = val(ix, iy + 1) + sx * (val(ix + 1, iy + 1) - val(ix, iy + 1));
  return a + sy * (b - a);
}

function periodicFbm(u: number, v: number, n0: number, octaves: number, seed: number): number {
  let s = 0;
  let a = 0.5;
  let norm = 0;
  for (let i = 0, n = n0; i < octaves; i++, n *= 2) {
    s += a * valueNoise(u, v, n, seed + i);
    norm += a;
    a *= 0.55;
  }
  return s / norm;
}

/** Periodic 2D Worley F1/F2 on an n x n cell grid. */
function worley2(u: number, v: number, n: number, seed: number): [number, number] {
  const x = u * n;
  const y = v * n;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let f1 = 9;
  let f2 = 9;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx;
      const cy = iy + dy;
      let h = hash3(((cx % n) + n) % n, ((cy % n) + n) % n, 1, seed);
      const px = cx + unit(h);
      h = rehash(h);
      const py = cy + unit(h);
      const d = Math.hypot(px - x, py - y);
      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) f2 = d;
    }
  return [f1, f2];
}

/** Texel bytes (RGBA8, row-major), deterministic. */
export function detailPixels(size = DETAIL_SIZE): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const fine = periodicFbm(u, v, 32, 3, 11);
      const [f1, f2] = worley2(u, v, 16, 23);
      const cracks = smoothstep(0.0, 0.12, f2 - f1);
      const block = 0.35 + 0.65 * smoothstep(0.75, 0.1, f1) * cracks;
      const coarse = periodicFbm(u, v, 4, 3, 37);
      const o = (y * size + x) * 4;
      out[o] = Math.round(255 * fine);
      out[o + 1] = Math.round(255 * Math.min(1, block * (0.8 + 0.4 * fine)));
      out[o + 2] = Math.round(255 * coarse);
      out[o + 3] = 255;
    }
  return out;
}

export function createDetailTexture(): DataTexture {
  const t = new DataTexture(detailPixels(), DETAIL_SIZE, DETAIL_SIZE, RGBAFormat);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}
