/**
 * Deep stars: 1.09 million real stars beyond the HYG catalogue (AT-HYG to magnitude 11 and the hot
 * luminous stars of Zari et al. 2021; built by tools/milkyway/volumes/deep-stars.mjs). Two files,
 * each sorted from the most to the least luminous star: tier A (apparent magnitude <= 10 from the
 * Sun, or more luminous than M = -3) and tier B (the rest). Low presets draw a prefix.
 */
import type { QualityPreset } from '../../../core/contracts';
import { blackbodyRgb, bvToTeff } from '../../../core/photometry';
import type { PointArrays } from './points';

export const DEEP_STARS_MAGIC = 0x5344574d;

/** Stars drawn per preset: [of tier A, of tier B] (Infinity = all; 0 = the file is not loaded). */
export const DEEP_BUDGET: Record<QualityPreset, readonly [number, number]> = {
  potato: [60_000, 0],
  low: [Infinity, 0],
  medium: [Infinity, 400_000],
  high: [Infinity, Infinity],
  ultra: [Infinity, Infinity],
};

export interface DeepStars {
  count: number;
  /** Logarithmic coordinate scale and range, pc. */
  s: number;
  R: number;
  x: Int16Array;
  y: Int16Array;
  z: Int16Array;
  mag: Uint8Array;
  bv: Uint8Array;
}

/** Decodes an MWDS v1 file. */
export function decodeDeepStars(buf: ArrayBuffer): DeepStars {
  const head = new DataView(buf, 0, 24);
  if (head.getUint32(0, true) !== DEEP_STARS_MAGIC || head.getUint32(4, true) !== 1)
    throw new Error('deep-stars: bad header');
  const n = head.getUint32(8, true);
  if (buf.byteLength !== 24 + 8 * n) throw new Error('deep-stars: bad length');
  return {
    count: n,
    s: head.getFloat32(16, true),
    R: head.getFloat32(20, true),
    x: new Int16Array(buf, 24, n),
    y: new Int16Array(buf, 24 + 2 * n, n),
    z: new Int16Array(buf, 24 + 4 * n, n),
    mag: new Uint8Array(buf, 24 + 6 * n, n),
    bv: new Uint8Array(buf, 24 + 7 * n, n),
  };
}

/** Parsecs of a stored coordinate. */
export const deepCoord = (q: number, s: number, R: number): number =>
  Math.sign(q) * s * (Math.exp((Math.abs(q) / 32767) * Math.log(1 + R / s)) - 1);
/** Absolute magnitude and B-V of the stored bytes (B-V 255 = unknown, drawn as 0.65). */
export const deepAbsMag = (m: number): number => m / 10 - 12;
export const deepBv = (c: number): number => (c === 255 ? 0.65 : c / 100 - 0.5);

let lut: Uint8Array | null = null;
let lutGain: Float32Array | null = null;
/** Colour per B-V byte: 8-bit RGB scaled to a maximum of 1, and the magnitude offset that restores it. */
function colourLut(): { rgb: Uint8Array; dMag: Float32Array } {
  if (!lut || !lutGain) {
    lut = new Uint8Array(256 * 3);
    lutGain = new Float32Array(256);
    for (let c = 0; c < 256; c++) {
      const rgb = blackbodyRgb(Math.min(30000, Math.max(2500, bvToTeff(deepBv(c)))));
      const m = Math.max(rgb[0], rgb[1], rgb[2]);
      for (let k = 0; k < 3; k++) lut[3 * c + k] = Math.round((255 * rgb[k]) / m);
      lutGain[c] = -2.5 * Math.log10(m);
    }
  }
  return { rgb: lut, dMag: lutGain };
}

/** The first `limit` stars of a decoded file as point arrays (positions in pc, ICRS axes). */
export function deepPointArrays(files: readonly { stars: DeepStars; limit: number }[]): PointArrays {
  const total = files.reduce((n, f) => n + Math.min(f.stars.count, f.limit), 0);
  const pos = new Float32Array(total * 3);
  const mag = new Float32Array(total);
  const col = new Uint8Array(total * 3);
  const { rgb, dMag } = colourLut();
  let k = 0;
  for (const { stars, limit } of files) {
    const n = Math.min(stars.count, limit);
    const scale = Math.log(1 + stars.R / stars.s) / 32767;
    const coord = (q: number): number => (q < 0 ? -1 : 1) * stars.s * (Math.exp(Math.abs(q) * scale) - 1);
    for (let i = 0; i < n; i++, k++) {
      pos[3 * k] = coord(stars.x[i]);
      pos[3 * k + 1] = coord(stars.y[i]);
      pos[3 * k + 2] = coord(stars.z[i]);
      const c = stars.bv[i];
      mag[k] = deepAbsMag(stars.mag[i]) + dMag[c];
      col[3 * k] = rgb[3 * c];
      col[3 * k + 1] = rgb[3 * c + 1];
      col[3 * k + 2] = rgb[3 * c + 2];
    }
  }
  return { pos, mag, col };
}
