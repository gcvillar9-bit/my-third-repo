/**
 * sharp helpers for texture builds. Equirectangular maps are written as width x width/2.
 * Lossy WebP for colour maps; lossless (or near-lossless) WebP for channel-packed data maps, where
 * 4:2:0 chroma subsampling would bleed one data channel into another.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import sharp from 'sharp';
import { PUBLIC } from './fetch.mjs';

sharp.cache(false);

/** sharp instance without the default pixel limit (8k+ sources). `input` = path | Buffer | {data, info}. */
export function img(input) {
  if (input && input.data && input.info) {
    const { width, height, channels } = input.info;
    return sharp(input.data, { raw: { width, height, channels }, limitInputPixels: false });
  }
  return sharp(input, { limitInputPixels: false });
}

/**
 * Resizes and encodes one WebP. opts: width, height (default width/2), quality (85), lossless,
 * nearLossless (0-100 preprocessing level, implies lossless container), alpha (keep alpha, default false),
 * kernel (sharp resize kernel, default lanczos3). Returns the path relative to public/.
 */
export async function writeWebp(input, outPath, opts = {}) {
  const { width, height = width ? Math.round(width / 2) : undefined, quality = 85 } = opts;
  mkdirSync(dirname(outPath), { recursive: true });
  let s = img(input);
  if (width) s = s.resize(width, height, { fit: 'fill', kernel: opts.kernel ?? 'lanczos3' });
  if (!opts.alpha) s = s.removeAlpha();
  const webp =
    opts.nearLossless != null
      ? { nearLossless: true, quality: opts.nearLossless, effort: 6 }
      : opts.lossless
        ? { lossless: true, effort: 6 }
        : { quality, effort: 6, smartSubsample: true };
  await s.webp(webp).toFile(outPath);
  return relative(PUBLIC, outPath).split('\\').join('/');
}

export const TIER_WIDTH = { '1k': 1024, '2k': 2048, '4k': 4096, '8k': 8192 };

/**
 * Writes <dir>/<name>_<tier>.webp for each tier (equirectangular 2:1). Returns relative paths keyed by tier.
 */
export async function writeTiers(input, dir, name, tiers, opts = {}) {
  const out = {};
  for (const tier of tiers) {
    const q = typeof opts.quality === 'object' ? opts.quality[tier] : opts.quality;
    out[tier] = await writeWebp(input, join(dir, `${name}_${tier}.webp`), {
      ...opts,
      quality: q ?? 85,
      width: TIER_WIDTH[tier],
    });
  }
  return out;
}

/** Decodes to raw pixels: { data: Buffer, info: { width, height, channels } }. */
export async function readRaw(input, { channels } = {}) {
  let s = img(input);
  if (channels === 3) s = s.removeAlpha();
  if (channels === 1) s = s.greyscale();
  return s.raw().toBuffer({ resolveWithObject: true });
}

/**
 * Separable grey-scale morphology on interleaved 8-bit pixels (per channel). op: 'min' (erode) or 'max'
 * (dilate), radius r (window 2r+1), horizontal wrap (equirectangular), vertical clamp. Returns a new Buffer.
 */
export function morph(raw, op, r = 1) {
  const { width: w, height: h, channels: c } = raw.info;
  const src = raw.data;
  const tmp = Buffer.alloc(src.length);
  const dst = Buffer.alloc(src.length);
  const pick = op === 'min' ? Math.min : Math.max;
  for (let y = 0; y < h; y++) {
    const row = y * w * c;
    for (let x = 0; x < w; x++) {
      for (let k = 0; k < c; k++) {
        let v = src[row + x * c + k];
        for (let d = 1; d <= r; d++) {
          v = pick(v, src[row + ((x + d) % w) * c + k], src[row + ((x - d + w) % w) * c + k]);
        }
        tmp[row + x * c + k] = v;
      }
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let k = 0; k < c; k++) {
        let v = tmp[(y * w + x) * c + k];
        for (let d = 1; d <= r; d++) {
          const y0 = Math.max(0, y - d);
          const y1 = Math.min(h - 1, y + d);
          v = pick(v, tmp[(y0 * w + x) * c + k], tmp[(y1 * w + x) * c + k]);
        }
        dst[(y * w + x) * c + k] = v;
      }
    }
  }
  return { data: dst, info: { ...raw.info } };
}
