#!/usr/bin/env node
/**
 * build-nebulae: inputs of the Orion Nebula volume (src/modules/nebulae, docs/modules/nebulae.md).
 *
 *   node tools/build-nebulae.mjs            # writes public/data/nebulae/*
 *   NEBULAE_DEBUG=<dir> node tools/build-nebulae.mjs   # also writes inspection PNGs into <dir>
 *
 * 1. Registers the Stellarium M42 image (HG731GZ, CC BY 3.0) from its sky corners in textures.json and checks the
 *    registration against catalogue stars (src/modules/nebulae/orion.json "registration"): the build fails when
 *    any residual exceeds maxResidualPx source pixels.
 * 2. Removes the star remnants (halo rings around removed stars) and inpaints them.
 * 3. Resamples to a gnomonic square centred on θ¹ Ori C (north up, east left) and rebuilds the clipped Huygens
 *    region as a dome.
 * 4. Registers the Hubble heic0601a mosaic from the Trapezium stars (similarity fit) and writes a de-starred
 *    luminance detail-ratio map of the core, orion-core.webp (0.5 + log2(ratio)/(2·RATIO_LOG2_SPAN)): detail finer
 *    than the resampled photo (~16") outside the clipped region, and everything finer than ~2' (ratio against a
 *    60" blur) inside it, where the photo has no structure at all (the Orion Bar, the ridges, the Fish's Mouth).
 *    Skipped (core: null) when the registration fails.
 * 5. Fits the photometric calibration (L = a·sinh(p·v), the inverse of an asinh stretch) with the core ratio
 *    applied, so what the runtime shows has total V = 4.0 and a 16.5 mag/arcsec² core; M43 (V 9.0) is an
 *    independent check. Unmixes the colours into Hα+[NII], [OIII]+Hβ and scattered light; inside the clipped
 *    region (white in the photo) the sourced core mix of orion.json replaces the unmix. Writes
 *    orion-emission.webp (the three observed components, L/lRef encoded as v^ENCODE_EXP) and orion-maps.webp
 *    (R: dust optical depth τ_V / maxTau, from the calibrated light deficit of the lanes; G: z displacement;
 *    B: thickness noise; 0.5 = 0).
 * Deterministic and re-runnable. Records everything the runtime needs in orion-meta.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { PUBLIC, ROOT } from './lib/fetch.mjs';
import { ensureModuleAssets } from './lib/manifest.mjs';

sharp.cache(false);

const D2R = Math.PI / 180;
const ARCSEC = D2R / 3600;
/** Emission texture encoding: L / lRef = v^ENCODE_EXP (shared with src/modules/nebulae/model.ts). */
export const ENCODE_EXP = 4;
/** Detail-ratio encoding: ratio = 2^((v - 0.5) · RATIO_LOG2_SPAN · 2) (×1/8 to ×8, the Orion Bar's ×3-5). */
export const RATIO_LOG2_SPAN = 3;
/** σ of the wide reference blur of the core ratio inside the clipped region, arcsec. */
const CORE_WIDE_SIGMA_ARCSEC = 60;
/** V = 0 illuminance, lux (src/core/photometry.ts LUX_MAG0). */
const LUX_MAG0 = 2.54e-6;
const ORION = JSON.parse(readFileSync(join(ROOT, 'src', 'modules', 'nebulae', 'orion.json'), 'utf8'));
/**
 * Photo RGB (linear) of one unit of each component, as a typical RGB astro camera records it:
 * Hα+[NII] (656/658 nm) pink-red, [OIII]+Hβ (501/486 nm) teal, scattered starlight blue-white (orion.json
 * photo.cameraResponse, a sourced model choice).
 */
export const CAMERA = ORION.photo.cameraResponse;
/**
 * Calibrated log-deficits (ln of the local upper envelope over the light) below this are texture between
 * filaments, not dust; above it τ = deficit - floor, so behind a lane the de-reddened light S·e^τ is the envelope
 * (times e^-floor) and the view from inside, behind the Veil, stays smooth.
 */
const DEFICIT_FLOOR = 0.5;
/** Linear level above which all three channels of the Stellarium photo are clipped (it tops out at ~230/255). */
const SATURATED = 0.69;
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

// ---------------------------------------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------------------------------------

/** Gnomonic projection about (ra0, dec0), degrees -> tangent-plane (xi east, eta north), radians-ish (tan). */
export function gnomonic(ra0, dec0, ra, dec) {
  const a = ra * D2R;
  const d = dec * D2R;
  const a0 = ra0 * D2R;
  const d0 = dec0 * D2R;
  const cosc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(a - a0);
  return [
    (Math.cos(d) * Math.sin(a - a0)) / cosc,
    (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(a - a0)) / cosc,
  ];
}

/** Inverse gnomonic projection -> [ra, dec] degrees. */
export function inverseGnomonic(ra0, dec0, xi, eta) {
  const a0 = ra0 * D2R;
  const d0 = dec0 * D2R;
  const rho = Math.hypot(xi, eta);
  const c = Math.atan(rho);
  if (rho === 0) return [ra0, dec0];
  const dec = Math.asin(Math.cos(c) * Math.sin(d0) + (eta * Math.sin(c) * Math.cos(d0)) / rho);
  const ra =
    a0 + Math.atan2(xi * Math.sin(c), rho * Math.cos(d0) * Math.cos(c) - eta * Math.sin(d0) * Math.sin(c));
  return [(((ra / D2R) % 360) + 360) % 360, dec / D2R];
}

/** Solves the 8-parameter homography taking src[i] -> dst[i] (4 points). Returns a mapping function. */
export function homography(src, dst) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solveLinear(A, b);
  return (x, y) => {
    const w = h[6] * x + h[7] * y + 1;
    return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
  };
}

function solveLinear(A0, b0) {
  const A = A0.map((r) => r.slice());
  const b = b0.slice();
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  return b.map((v, i) => v / A[i][i]);
}

/** Least-squares similarity transform (scale, rotation, shift) taking src -> dst. */
export function fitSimilarity(src, dst) {
  // dst = [a -b; b a] src + [tx, ty]
  const n = src.length;
  let sx = 0;
  let sy = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    sx += src[i][0];
    sy += src[i][1];
    dx += dst[i][0];
    dy += dst[i][1];
  }
  sx /= n;
  sy /= n;
  dx /= n;
  dy /= n;
  let num1 = 0;
  let num2 = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const x = src[i][0] - sx;
    const y = src[i][1] - sy;
    const u = dst[i][0] - dx;
    const v = dst[i][1] - dy;
    num1 += x * u + y * v;
    num2 += x * v - y * u;
    den += x * x + y * y;
  }
  const a = num1 / den;
  const bb = num2 / den;
  const tx = dx - (a * sx - bb * sy);
  const ty = dy - (bb * sx + a * sy);
  const map = (x, y) => [a * x - bb * y + tx, bb * x + a * y + ty];
  map.inverse = (u, v) => {
    const k = a * a + bb * bb;
    const x0 = u - tx;
    const y0 = v - ty;
    return [(a * x0 + bb * y0) / k, (-bb * x0 + a * y0) / k];
  };
  map.scale = Math.hypot(a, bb);
  map.rotationDeg = Math.atan2(bb, a) / D2R;
  return map;
}

// ---------------------------------------------------------------------------------------------------------------
// Float images: { w, h, c, data: Float32Array } (row 0 at the top)
// ---------------------------------------------------------------------------------------------------------------

async function loadLinear(path) {
  const { data, info } = await sharp(path, { limitInputPixels: false })
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) lut[i] = srgbToLinear(i / 255);
  const out = new Float32Array(info.width * info.height * 3);
  for (let i = 0; i < out.length; i++) out[i] = lut[data[i]];
  return { w: info.width, h: info.height, c: 3, data: out };
}

function channel(img, k) {
  const out = new Float32Array(img.w * img.h);
  for (let i = 0; i < out.length; i++) out[i] = img.data[i * img.c + k];
  return out;
}

function luminanceOf(img) {
  const out = new Float32Array(img.w * img.h);
  for (let i = 0; i < out.length; i++)
    out[i] = lum(img.data[3 * i], img.data[3 * i + 1], img.data[3 * i + 2]);
  return out;
}

function boxBlur1(src, dst, w, h, r, horizontal) {
  const n = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const stride = horizontal ? 1 : w;
  const k = 1 / (2 * r + 1);
  for (let l = 0; l < lines; l++) {
    const base = horizontal ? l * w : l;
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += src[base + clamp(i, 0, n - 1) * stride];
    for (let i = 0; i < n; i++) {
      dst[base + i * stride] = acc * k;
      acc += src[base + Math.min(n - 1, i + r + 1) * stride] - src[base + Math.max(0, i - r) * stride];
    }
  }
}

/** Approximate Gaussian blur (three box passes per axis, clamped edges). */
export function gaussBlur(src, w, h, sigma) {
  if (sigma <= 0) return Float32Array.from(src);
  const n = 3;
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  const sizes = [0, 1, 2].map((i) => (i < m ? wl : wu));
  let a = Float32Array.from(src);
  let b = new Float32Array(src.length);
  for (const s of sizes) {
    const r = (s - 1) / 2;
    boxBlur1(a, b, w, h, r, true);
    boxBlur1(b, a, w, h, r, false);
  }
  return a;
}

function maxFilter(src, w, h, r) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let m = -Infinity;
      for (let i = Math.max(0, x - r); i <= Math.min(w - 1, x + r); i++) m = Math.max(m, src[y * w + i]);
      tmp[y * w + x] = m;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let m = -Infinity;
      for (let j = Math.max(0, y - r); j <= Math.min(h - 1, y + r); j++) m = Math.max(m, tmp[j * w + x]);
      out[y * w + x] = m;
    }
  return out;
}

/** Bilinear sample of channel k at continuous pixel coordinates (pixel i covers [i, i+1)). */
function sample(img, x, y, k) {
  const fx = clamp(x - 0.5, 0, img.w - 1);
  const fy = clamp(y - 0.5, 0, img.h - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(img.w - 1, x0 + 1);
  const y1 = Math.min(img.h - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const c = img.c;
  const d = img.data;
  const a = d[(y0 * img.w + x0) * c + k] * (1 - tx) + d[(y0 * img.w + x1) * c + k] * tx;
  const b = d[(y1 * img.w + x0) * c + k] * (1 - tx) + d[(y1 * img.w + x1) * c + k] * tx;
  return a * (1 - ty) + b * ty;
}

function percentile(arr, p) {
  const s = Float32Array.from(arr).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
}

/** Deterministic value-noise fBm in [-1, 1] on a w x h grid (seeded hash). */
export function fbm(w, h, seed, octaves = 5, base = 8) {
  const out = new Float32Array(w * h);
  const hash = (x, y, o) => {
    let n = (x * 374761393 + y * 668265263 + (seed + o * 1013) * 2147483647) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    n ^= n >>> 16;
    return ((n >>> 0) / 4294967296) * 2 - 1;
  };
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const cells = base << o;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const fx = (x / w) * cells;
        const fy = (y / h) * cells;
        const ix = Math.floor(fx);
        const iy = Math.floor(fy);
        const tx = fx - ix;
        const ty = fy - iy;
        const sx = tx * tx * (3 - 2 * tx);
        const sy = ty * ty * (3 - 2 * ty);
        const v00 = hash(ix, iy, o);
        const v10 = hash(ix + 1, iy, o);
        const v01 = hash(ix, iy + 1, o);
        const v11 = hash(ix + 1, iy + 1, o);
        out[y * w + x] += amp * ((v00 * (1 - sx) + v10 * sx) * (1 - sy) + (v01 * (1 - sx) + v11 * sx) * sy);
      }
    norm += amp;
    amp *= 0.55;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Star measurement and removal
// ---------------------------------------------------------------------------------------------------------------

/**
 * Background-subtracted luminance centroid in a window around (x, y) (continuous pixel coordinates).
 * Works for point stars and for the ring-shaped remnants of removed stars.
 */
export function centroid(Y, w, h, x, y, r = 9, r1 = 12, r2 = 18) {
  const ring = [];
  for (let j = Math.floor(y - r2); j <= Math.ceil(y + r2); j++)
    for (let i = Math.floor(x - r2); i <= Math.ceil(x + r2); i++) {
      if (i < 0 || j < 0 || i >= w || j >= h) continue;
      const d = Math.hypot(i + 0.5 - x, j + 0.5 - y);
      if (d >= r1 && d <= r2) ring.push(Y[j * w + i]);
    }
  ring.sort((a, b) => a - b);
  const bg = ring.length ? ring[Math.floor(ring.length / 2)] : 0;
  let sw = 0;
  let sx = 0;
  let sy = 0;
  for (let j = Math.floor(y - r); j <= Math.ceil(y + r); j++)
    for (let i = Math.floor(x - r); i <= Math.ceil(x + r); i++) {
      if (i < 0 || j < 0 || i >= w || j >= h) continue;
      if (Math.hypot(i + 0.5 - x, j + 0.5 - y) > r) continue;
      const v = Math.max(0, Y[j * w + i] - bg);
      sw += v;
      sx += v * (i + 0.5);
      sy += v * (j + 0.5);
    }
  return sw > 0 ? { x: sx / sw, y: sy / sw, flux: sw, bg } : { x, y, flux: 0, bg };
}

/**
 * Finds compact sources (stars and the halo rings of removed stars) as local maxima of a difference of
 * Gaussians that stand out against the local noise. Returns [{x, y, amp}] in pixel-centre coordinates.
 */
export function detectStars(Y, w, h, { s1, s2, k, exclude }) {
  const g1 = gaussBlur(Y, w, h, s1);
  const g2 = gaussBlur(Y, w, h, s2);
  const dog = new Float32Array(Y.length);
  for (let i = 0; i < Y.length; i++) dog[i] = g1[i] - g2[i];
  // Robust noise scale of the DoG, relative to the local level (so bright nebula needs a larger excess).
  const absDev = new Float32Array(Y.length);
  for (let i = 0; i < Y.length; i++) absDev[i] = Math.abs(dog[i]);
  const local = gaussBlur(absDev, w, h, 4 * s2);
  const out = [];
  const rr = Math.max(2, Math.round(s2));
  for (let y = rr; y < h - rr; y++)
    for (let x = rr; x < w - rr; x++) {
      const i = y * w + x;
      const v = dog[i];
      if (v <= k * local[i]) continue;
      let peak = true;
      for (let j = -rr; j <= rr && peak; j++)
        for (let q = -rr; q <= rr; q++) if ((j || q) && dog[i + j * w + q] > v) peak = false;
      if (!peak || (exclude && exclude(x + 0.5, y + 0.5))) continue;
      out.push({ x: x + 0.5, y: y + 0.5, amp: v / Math.max(1e-6, local[i]), dog: v });
    }
  return out;
}

/** Soft disc mask (1 inside r, 0 beyond r + feather). Accumulates with max. */
function paintDisc(mask, w, h, cx, cy, r, feather = 2) {
  const R = r + feather;
  for (let y = Math.max(0, Math.floor(cy - R)); y <= Math.min(h - 1, Math.ceil(cy + R)); y++)
    for (let x = Math.max(0, Math.floor(cx - R)); x <= Math.min(w - 1, Math.ceil(cx + R)); x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const m = d <= r ? 1 : d >= R ? 0 : 1 - (d - r) / feather;
      if (m > mask[y * w + x]) mask[y * w + x] = m;
    }
}

function paintBar(mask, w, h, cx, cy, halfLen, halfWidth, horizontal) {
  for (let t = -halfLen; t <= halfLen; t++)
    for (let s = -halfWidth; s <= halfWidth; s++) {
      const x = Math.round(cx - 0.5 + (horizontal ? t : s));
      const y = Math.round(cy - 0.5 + (horizontal ? s : t));
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const fall = 1 - Math.abs(t) / (halfLen + 1);
      mask[y * w + x] = Math.max(mask[y * w + x], Math.min(1, 0.5 + fall));
    }
}

/**
 * Inpaints masked pixels of every channel from their surroundings: a mask-weighted blur pyramid, taking for each
 * pixel the finest scale with enough unmasked support. Soft mask values blend the fill with the original.
 */
export function inpaint(img, mask) {
  const { w, h, c } = img;
  const weight = new Float32Array(w * h);
  for (let i = 0; i < weight.length; i++) weight[i] = 1 - mask[i];
  const sigmas = [1.5, 3, 6, 12, 24, 48];
  const wb = sigmas.map((s) => gaussBlur(weight, w, h, s));
  for (let k = 0; k < c; k++) {
    const ch = channel(img, k);
    const prod = new Float32Array(w * h);
    for (let i = 0; i < prod.length; i++) prod[i] = ch[i] * weight[i];
    const pb = sigmas.map((s) => gaussBlur(prod, w, h, s));
    for (let i = 0; i < w * h; i++) {
      if (mask[i] <= 0) continue;
      let fill = ch[i];
      for (let s = 0; s < sigmas.length; s++) {
        if (wb[s][i] > 0.45 || s === sigmas.length - 1) {
          fill = pb[s][i] / Math.max(1e-6, wb[s][i]);
          break;
        }
      }
      img.data[i * c + k] = ch[i] * (1 - mask[i]) + fill * mask[i];
    }
  }
  // Refine the fully masked pixels into a harmonic (Laplace) fill of their boundary: the blur pyramid alone pulls
  // a large hole towards the mean of a wide area, which a steep stretch inverse turns into a dark disc.
  const holes = [];
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) if (mask[y * w + x] >= 0.999) holes.push(y * w + x);
  const idx = Int32Array.from(holes);
  for (let k = 0; k < c; k++) {
    const d = img.data;
    for (let it = 0; it < 400; it++)
      for (let n = 0; n < idx.length; n++) {
        const i = idx[n];
        const avg =
          0.25 * (d[(i - 1) * c + k] + d[(i + 1) * c + k] + d[(i - w) * c + k] + d[(i + w) * c + k]);
        d[i * c + k] += 1.85 * (avg - d[i * c + k]);
      }
  }
}

/** True when a detected blob is bluer than its surroundings (Stellarium's star remnants are blue-white rings). */
function bluerThanSurroundings(img, x, y, rIn, r1, r2) {
  let bi = 0;
  let ri = 0;
  let bo = 0;
  let ro = 0;
  for (let j = Math.floor(y - r2); j <= Math.ceil(y + r2); j++)
    for (let i = Math.floor(x - r2); i <= Math.ceil(x + r2); i++) {
      if (i < 0 || j < 0 || i >= img.w || j >= img.h) continue;
      const d = Math.hypot(i + 0.5 - x, j + 0.5 - y);
      const p = (j * img.w + i) * 3;
      if (d <= rIn) {
        bi += img.data[p + 2];
        ri += img.data[p];
      } else if (d >= r1 && d <= r2) {
        bo += img.data[p + 2];
        ro += img.data[p];
      }
    }
  return bi / Math.max(1e-9, ri) > 1.06 * (bo / Math.max(1e-9, ro));
}

// ---------------------------------------------------------------------------------------------------------------
// Stellarium image registration
// ---------------------------------------------------------------------------------------------------------------

/** Extracts the m42.png entry (worldCoords, textureCoords) from Stellarium's textures.json text. */
export function parseStellariumEntry(text, image = 'm42.png') {
  const at = text.indexOf(`"${image}"`);
  if (at < 0) throw new Error(`build-nebulae: ${image} not found in textures.json`);
  const start = text.lastIndexOf('{', at);
  const end = text.indexOf('}', text.indexOf('"textureCoords"', at));
  const body = text.slice(start, end + 1).replace(/[\t\r\n]/g, ' ');
  const nums = (key) => {
    const m = new RegExp(`"${key}"\\s*:\\s*(\\[\\[\\[[^\\]]*(?:\\][^\\]]*)*?\\]\\]\\])`).exec(body);
    if (!m) throw new Error(`build-nebulae: ${key} missing for ${image}`);
    return JSON.parse(m[1])[0];
  };
  return { worldCoords: nums('worldCoords'), textureCoords: nums('textureCoords') };
}

/**
 * Sky -> source pixel mapping of a Stellarium image: a homography between the gnomonic projection of the four
 * corners (about their mean) and the texture coordinates. Stellarium's texture coordinate (0, 0) is the
 * bottom-left corner of the image (OpenGL convention), so the pixel row is (1 - t) · height.
 */
export function stellariumMapping(entry, width, height) {
  const wc = entry.worldCoords;
  const ra0 = wc.reduce((s, c) => s + c[0], 0) / wc.length;
  const dec0 = wc.reduce((s, c) => s + c[1], 0) / wc.length;
  const H = homography(
    wc.map((c) => gnomonic(ra0, dec0, c[0], c[1])),
    entry.textureCoords,
  );
  return (ra, dec) => {
    const [x, y] = gnomonic(ra0, dec0, ra, dec);
    const [s, t] = H(x, y);
    return [s * width, (1 - t) * height];
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Photometry
// ---------------------------------------------------------------------------------------------------------------

/** Inverse of a 3x3 matrix given as rows. */
function inv3(m) {
  const [a, b, c] = m[0];
  const [d, e, f] = m[1];
  const [g, h, i] = m[2];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

/**
 * Unmixes linear photo RGB into the three components (non-negative), each expressed as its photo luminance.
 * CAMERA rows are the photo RGB of one unit of each component; RGB = Σ c_k · CAMERA[k].
 */
export function unmix(r, g, b, out = [0, 0, 0]) {
  const M = UNMIX;
  let c0 = M[0][0] * r + M[0][1] * g + M[0][2] * b;
  let c1 = M[1][0] * r + M[1][1] * g + M[1][2] * b;
  let c2 = M[2][0] * r + M[2][1] * g + M[2][2] * b;
  // Clamp negatives and give their luminance back proportionally (keeps the total luminance).
  const total = lum(r, g, b);
  c0 = Math.max(0, c0) * CAM_LUM[0];
  c1 = Math.max(0, c1) * CAM_LUM[1];
  c2 = Math.max(0, c2) * CAM_LUM[2];
  const s = c0 + c1 + c2;
  const k = s > 0 ? total / s : 0;
  out[0] = c0 * k;
  out[1] = c1 * k;
  out[2] = c2 * k;
  return out;
}
// RGB = C^T · c  (columns of C^T are the CAMERA rows)
const CT = [0, 1, 2].map((r) => [0, 1, 2].map((k) => CAMERA[k][r]));
const UNMIX = inv3(CT);
const CAM_LUM = CAMERA.map((c) => lum(c[0], c[1], c[2]));

/** Surface brightness (mag/arcsec²) of a luminance (cd/m²). */
export const muFromLuminance = (L) => -2.5 * Math.log10((L * ARCSEC * ARCSEC) / LUX_MAG0);
/** Luminance (cd/m²) of a surface brightness (mag/arcsec²). */
export const luminanceFromMu = (mu) => (LUX_MAG0 * 10 ** (-0.4 * mu)) / (ARCSEC * ARCSEC);

/**
 * Inverse of the photo's stretch, up to the scale a: L / a as a function of the log of the (dome-reconstructed)
 * linear photo luminance and the stretch parameter p. NEBULAE_TRANSFER=power: Y^p; asinh (default): sinh(p·v)
 * with v = Y^(1/2.2) the display-encoded luminance, the inverse of the asinh stretch of astro images.
 */
const TRANSFER = process.env.NEBULAE_TRANSFER ?? 'asinh';
/**
 * Stretch parameter of the photo (asinh: p in sinh(p·v)). Fixed rather than fitted: a third fit on M43 is
 * ill-conditioned (M43's flux depends on how NU Ori's remnant is treated), so M43 stays an independent check.
 */
const STRETCH_P = 8;
/** Radius of NU Ori's halo ring in the Stellarium image, source px. */
const NU_RING_PX = 13;
export const transfer = (logY, p) =>
  TRANSFER === 'power' ? Math.exp(p * logY) : Math.sinh(p * Math.exp(logY / 2.2));
const TRANSFER_RANGE = TRANSFER === 'power' ? [1, 6] : [0.2, 40];

/**
 * Photometric calibration L = a · T(Y · e^{g·shape}, p) of the photo luminance Y (T = `transfer`), measured with an
 * optional per-pixel `gain` (the core detail ratio the runtime multiplies in). The photo's clipped
 * Huygens region is a plateau; its true brightness rises towards the inside as a dome, e^{g·shape} with
 * shape = d - d²/(2·dMax) (d = depth inside the plateau). With a fixed stretch p (`fixedP`), the dome slope g is set
 * by the core/total ratio (the brightest core disk against the M42 aperture total) and a by the total. Without
 * `fixedP`, p is also fitted so that M43 matches its catalogue V (ill-conditioned; kept for experiments).
 */
export function fitCalibration({
  Y,
  shape,
  N,
  omega,
  inTotal,
  inM43,
  coreSigma,
  totalLux,
  coreL,
  m43Lux,
  fixedP,
  gain = null,
}) {
  // Work inside the bounding box of the plateau (plus a margin) for the core maximum.
  let x0 = N;
  let y0 = N;
  let x1 = 0;
  let y1 = 0;
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++)
      if (shape[j * N + i] > 0) {
        x0 = Math.min(x0, i);
        y0 = Math.min(y0, j);
        x1 = Math.max(x1, i);
        y1 = Math.max(y1, j);
      }
  const m = Math.ceil(4 * coreSigma);
  if (x1 < x0) {
    x0 = y0 = N / 2 - 4 * m;
    x1 = y1 = N / 2 + 4 * m;
  }
  x0 = Math.max(0, x0 - m);
  y0 = Math.max(0, y0 - m);
  x1 = Math.min(N - 1, x1 + m);
  y1 = Math.min(N - 1, y1 + m);
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const logY = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) logY[i] = Math.log(Math.max(Y[i], 1e-9));
  const G = (i) => (gain ? gain[i] : 1);
  const total = (g, gs) => {
    let t = 0;
    for (let i = 0; i < N * N; i++) if (inTotal[i]) t += transfer(logY[i] + gs * shape[i], g) * G(i);
    return t * omega;
  };
  const m43 = (g, gs) => {
    let t = 0;
    for (let i = 0; i < N * N; i++) if (inM43[i]) t += transfer(logY[i] + gs * shape[i], g) * G(i);
    return t * omega;
  };
  const core = (g, gs) => {
    const p = new Float32Array(bw * bh);
    for (let j = 0; j < bh; j++)
      for (let i = 0; i < bw; i++) {
        const k = (j + y0) * N + i + x0;
        p[j * bw + i] = transfer(logY[k] + gs * shape[k], g) * G(k);
      }
    const b = gaussBlur(p, bw, bh, coreSigma);
    let mx = 0;
    for (let i = 0; i < b.length; i++) mx = Math.max(mx, b[i]);
    return mx;
  };
  const target = coreL / totalLux;
  const slopeFor = (g) => {
    const ratio = (gs) => core(g, gs) / total(g, gs);
    if (ratio(0) >= target) return 0;
    let lo = 0;
    let hi = 0.02;
    while (ratio(hi) < target && hi < 2) hi *= 2;
    for (let i = 0; i < 30; i++) {
      const mid = 0.5 * (lo + hi);
      if (ratio(mid) < target) lo = mid;
      else hi = mid;
    }
    return 0.5 * (lo + hi);
  };
  if (fixedP !== undefined) {
    const slope = slopeFor(fixedP);
    return { p: fixedP, slope, a: totalLux / total(fixedP, slope) };
  }
  // M43 / total falls as p grows (M43 is fainter than the core in the photo).
  const m43Ratio = (g) => {
    const gs = slopeFor(g);
    return { gs, r: m43(g, gs) / total(g, gs) };
  };
  const want = m43Lux / totalLux;
  let [lo, hi] = TRANSFER_RANGE;
  for (let i = 0; i < 26; i++) {
    const mid = 0.5 * (lo + hi);
    if (m43Ratio(mid).r > want) lo = mid;
    else hi = mid;
  }
  const p = 0.5 * (lo + hi);
  const slope = slopeFor(p);
  return { p, slope, a: totalLux / total(p, slope) };
}

/**
 * Two-pass chamfer (3-4) distance (px) from each pixel inside `mask` to the nearest pixel outside it. Beyond the
 * image edge counts as outside unless `edgeInside`.
 */
export function insideDistance(mask, w, h, edgeInside = false) {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? INF : 0;
  const oob = edgeInside ? INF : 0;
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? oob : d[y * w + x]);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
    }
  for (let i = 0; i < d.length; i++) d[i] /= 3;
  return d;
}

/** Dome shape of the clipped plateau: d - d²/(2·dMax), with d the depth inside it in pixels (0 outside). */
export function clippedDome(sat, N) {
  const d = insideDistance(sat, N, N);
  let depth = 0;
  let pixels = 0;
  for (let i = 0; i < d.length; i++) {
    depth = Math.max(depth, d[i]);
    if (d[i] > 0) pixels++;
  }
  const shape = new Float32Array(d.length);
  if (depth > 0) for (let i = 0; i < d.length; i++) shape[i] = d[i] - (d[i] * d[i]) / (2 * depth);
  return { shape, depth, pixels };
}

/**
 * Feathered weight (0..1) of a binary region: smoothstep of the signed distance to its edge (px, + inside) over
 * `blendPx` centred on the edge.
 */
export function plateauWeight(mask, N, blendPx) {
  const dIn = insideDistance(mask, N, N);
  const out = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) out[i] = mask[i] ? 0 : 1;
  const dOut = insideDistance(out, N, N, true);
  const w = new Float32Array(N * N);
  const h = 0.5 * Math.max(blendPx, 1e-6);
  for (let i = 0; i < N * N; i++) {
    const t = clamp((dIn[i] - dOut[i] + h) / (2 * h), 0, 1);
    w[i] = t * t * (3 - 2 * t);
  }
  return w;
}

/**
 * The core detail ratio as the runtime applies it, averaged over each emission pixel (4x4 bilinear sub-samples of
 * the decoded orion-core.webp; 1 outside the core field): the gain the calibration and the data test include.
 */
export function coreGainOnGrid(bytes, C, channels, core, N, xiMax, sub = 4) {
  const ratio = { w: C, h: C, c: 1, data: new Float32Array(C * C) };
  for (let i = 0; i < C * C; i++)
    ratio.data[i] = 2 ** ((bytes[i * channels] / 255 - 0.5) * 2 * core.ratioLog2Span);
  const gain = new Float32Array(N * N).fill(1);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let b = 0; b < sub; b++)
        for (let a = 0; a < sub; a++) {
          const xi = (1 - (2 * (i + (a + 0.5) / sub)) / N) * xiMax;
          const eta = (1 - (2 * (j + (b + 0.5) / sub)) / N) * xiMax;
          const u = (1 - xi / core.xiMax) * 0.5;
          const v = (1 - eta / core.xiMax) * 0.5;
          s += u > 0 && u < 1 && v > 0 && v < 1 ? sample(ratio, u * C, v * C, 0) : 1;
        }
      gain[j * N + i] = s / (sub * sub);
    }
  return gain;
}

// ---------------------------------------------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------------------------------------------

async function writeRgb(path, w, h, r, g, b, opts) {
  const buf = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    buf[3 * i] = Math.round(clamp(r[i], 0, 1) * 255);
    buf[3 * i + 1] = Math.round(clamp(g[i], 0, 1) * 255);
    buf[3 * i + 2] = Math.round(clamp(b[i], 0, 1) * 255);
  }
  mkdirSync(join(path, '..'), { recursive: true });
  const s = sharp(buf, { raw: { width: w, height: h, channels: 3 } });
  if (path.endsWith('.png')) await s.png().toFile(path);
  else await s.webp(opts).toFile(path);
}

/** Debug view: tone-mapped sRGB of a linear RGB image. */
async function debugPng(dir, name, w, h, r, g, b, scale = 1) {
  if (!dir) return;
  const f = (v) => linearToSrgb(clamp(v * scale, 0, 1));
  await writeRgb(join(dir, name), w, h, r.map(f), g.map(f), b.map(f));
}

// ---------------------------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------------------------

async function main() {
  const debug = process.env.NEBULAE_DEBUG || null;
  const orion = JSON.parse(readFileSync(join(ROOT, 'src', 'modules', 'nebulae', 'orion.json'), 'utf8'));
  const paths = await ensureModuleAssets('nebulae');
  const outDir = join(PUBLIC, 'data', 'nebulae');
  mkdirSync(outDir, { recursive: true });
  const { raDeg: ra0, decDeg: dec0 } = orion.center;
  const xiMax = Math.tan(orion.field.halfWidthDeg * D2R);

  // --- 1. Stellarium registration ---------------------------------------------------------------------------
  const src = await loadLinear(paths.get('stellarium_m42'));
  const entry = parseStellariumEntry(readFileSync(paths.get('stellarium_textures'), 'utf8'));
  const toSrc = stellariumMapping(entry, src.w, src.h);
  const Ysrc = luminanceOf(src);
  const residuals = [];
  for (const s of orion.registration.stars) {
    const [px, py] = toSrc(s.raDeg, s.decDeg);
    const c = centroid(Ysrc, src.w, src.h, px, py);
    residuals.push({
      name: s.name,
      predicted: [round(px, 2), round(py, 2)],
      measured: [round(c.x, 2), round(c.y, 2)],
      px: round(Math.hypot(c.x - px, c.y - py), 2),
    });
  }
  const maxRes = Math.max(...residuals.map((r) => r.px));
  console.log(
    `build-nebulae: Stellarium registration, ${residuals.length} stars, max residual ${maxRes.toFixed(2)} px`,
  );
  for (const r of residuals) console.log(`  ${r.name.padEnd(16)} ${r.px.toFixed(2)} px`);
  if (residuals.length < 5) throw new Error('build-nebulae: fewer than 5 registration stars');
  if (maxRes > orion.registration.maxResidualPx)
    throw new Error(
      `build-nebulae: registration residual ${maxRes.toFixed(2)} px > ${orion.registration.maxResidualPx} px`,
    );

  // --- 2. Star removal in the source image ------------------------------------------------------------------
  const [cx0, cy0] = toSrc(ra0, dec0);
  const srcPxArcsec =
    (3600 * Math.hypot(...entry.worldCoords[1].map((v, i) => v - entry.worldCoords[0][i]))) / src.w;
  // Huygens region and the heart of M43 around NU Ori: knots and nebula, not star remnants.
  const nuRow = orion.stars.find((s) => s.id === 'nu-ori');
  const [nx0, ny0] = toSrc(nuRow.raDeg, nuRow.decDeg);
  const coreExclude = (x, y) =>
    Math.hypot(x - cx0, y - cy0) * srcPxArcsec < 240 || Math.hypot(x - nx0, y - ny0) * srcPxArcsec < 90;
  // Saturated (clipped) pixels of the original image: the Huygens region, reconstructed after resampling.
  const satSrc = { w: src.w, h: src.h, c: 1, data: new Float32Array(src.w * src.h) };
  for (let i = 0; i < src.w * src.h; i++)
    satSrc.data[i] = Math.min(src.data[3 * i], src.data[3 * i + 1], src.data[3 * i + 2]) >= SATURATED ? 1 : 0;
  // Pass 1: halo rings left by Stellarium's star removal (blob scale); pass 2: residual compact cores.
  const blobs = detectStars(Ysrc, src.w, src.h, { s1: 3, s2: 9, k: 3, exclude: coreExclude });
  const det = blobs.filter((d) => bluerThanSurroundings(src, d.x, d.y, 8, 14, 22));
  const mask = new Float32Array(src.w * src.h);
  for (const d of det) paintDisc(mask, src.w, src.h, d.x, d.y, clamp(8 + 3 * Math.log2(d.amp), 10, 22), 3);
  for (const s of orion.registration.stars) {
    const [px, py] = toSrc(s.raDeg, s.decDeg);
    paintDisc(mask, src.w, src.h, px, py, clamp(26 - 2.5 * (s.v - 3), 12, 28), 3);
  }
  // NU Ori: Stellarium's removal left a bright halo ring (and a dark core) in the middle of M43. The ring is
  // scattered starlight, not nebula (keeping it makes M43 ~1.2 mag brighter than its catalogue V), so the whole
  // ring is replaced by a smooth fill from M43's outer nebulosity.
  paintDisc(mask, src.w, src.h, nx0, ny0, NU_RING_PX, 5);
  // The dark frame of the source image (vignette border) is masked too.
  const border = 10;
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++)
      if (x < border || y < border || x >= src.w - border || y >= src.h - border) mask[y * src.w + x] = 1;
  inpaint(src, mask);
  const det2 = detectStars(luminanceOf(src), src.w, src.h, { s1: 1.5, s2: 5, k: 6, exclude: coreExclude });
  const mask2 = new Float32Array(src.w * src.h);
  for (const d of det2) paintDisc(mask2, src.w, src.h, d.x, d.y, clamp(4 + 2 * Math.log2(d.amp), 5, 10), 2);
  inpaint(src, mask2);
  for (let i = 0; i < mask.length; i++) mask[i] = Math.max(mask[i], mask2[i]);
  console.log(
    `build-nebulae: star remnants removed: ${det.length} halos (of ${blobs.length} blobs), ${det2.length} residual cores`,
  );
  det.push(...det2);
  console.log(`build-nebulae: removed ${det.length} star remnants`);
  if (debug) {
    await debugPng(
      debug,
      'src-destarred.png',
      src.w,
      src.h,
      channel(src, 0),
      channel(src, 1),
      channel(src, 2),
      1,
    );
    await writeRgb(join(debug, 'src-mask.png'), src.w, src.h, mask, mask, mask);
  }

  // --- 3. Resample to the gnomonic grid about θ¹ Ori C (north up, east left) ----------------------------------
  const N = orion.field.emissionPixels;
  const grid = { w: N, h: N, c: 3, data: new Float32Array(N * N * 3) };
  for (let j = 0; j < N; j++) {
    const eta = (1 - (2 * (j + 0.5)) / N) * xiMax;
    for (let i = 0; i < N; i++) {
      const xi = (1 - (2 * (i + 0.5)) / N) * xiMax;
      const [ra, dec] = inverseGnomonic(ra0, dec0, xi, eta);
      const [sx, sy] = toSrc(ra, dec);
      for (let k = 0; k < 3; k++) grid.data[(j * N + i) * 3 + k] = sample(src, sx, sy, k);
    }
  }
  const satGrid = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    const eta = (1 - (2 * (j + 0.5)) / N) * xiMax;
    for (let i = 0; i < N; i++) {
      const xi = (1 - (2 * (i + 0.5)) / N) * xiMax;
      const [ra, dec] = inverseGnomonic(ra0, dec0, xi, eta);
      const [sx, sy] = toSrc(ra, dec);
      satGrid[j * N + i] = sample(satSrc, sx, sy, 0) > 0.5 ? 1 : 0;
    }
  }
  // Sky background: the darkest 3% of the field.
  const Yg0 = luminanceOf(grid);
  const sky = percentile(Yg0, 0.03);
  const skyRgb = [0, 1, 2].map((k) => {
    let s = 0;
    let n = 0;
    for (let i = 0; i < N * N; i++)
      if (Yg0[i] <= sky) {
        s += grid.data[3 * i + k];
        n++;
      }
    return s / Math.max(1, n);
  });
  for (let i = 0; i < N * N; i++)
    for (let k = 0; k < 3; k++) grid.data[3 * i + k] = Math.max(0, grid.data[3 * i + k] - skyRgb[k]);
  const Y = luminanceOf(grid);
  const dome = clippedDome(satGrid, N);
  const pxRad = (2 * xiMax) / N;
  const pxArcsec = pxRad / ARCSEC;
  const omega = pxRad * pxRad;
  // Feathered weight of the clipped region (photo.coreBlendArcmin across its edge): where the core ratio uses its
  // wide reference and the sourced core mix replaces the photo's (white) colours.
  const plateauW = plateauWeight(satGrid, N, (orion.photo.coreBlendArcmin * 60) / pxArcsec);
  const plateauImg = { w: N, h: N, c: 1, data: plateauW };
  const plateauAt = (xi, eta) =>
    sample(plateauImg, (1 - xi / xiMax) * 0.5 * N, (1 - eta / xiMax) * 0.5 * N, 0);

  // --- 4. Hubble core detail ratio (applied by the runtime on top of the emission) -----------------------------
  const core = await buildCore(orion, paths.get('hubble_m42'), outDir, debug, pxArcsec, plateauAt);
  let gain = null;
  if (core) {
    const dec = await sharp(join(outDir, 'orion-core.webp')).raw().toBuffer({ resolveWithObject: true });
    gain = coreGainOnGrid(dec.data, dec.info.width, dec.info.channels, core, N, xiMax);
  }

  // --- 5. Calibration: L = a · sinh(p · v), measured with the core ratio --------------------------------------
  const posOf = (ra, dec) => {
    const [xi, eta] = gnomonic(ra0, dec0, ra, dec);
    return [(1 - xi / xiMax) * 0.5 * N, (1 - eta / xiMax) * 0.5 * N];
  };
  const nu = orion.stars.find((s) => s.id === 'nu-ori');
  const [m43x, m43y] = posOf(nu.raDeg, nu.decDeg);
  const ph = orion.photometry;
  const inTotal = new Uint8Array(N * N);
  const inM43 = new Uint8Array(N * N);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const dC = Math.hypot(i + 0.5 - N / 2, j + 0.5 - N / 2) * pxArcsec;
      const d43 = Math.hypot(i + 0.5 - m43x, j + 0.5 - m43y) * pxArcsec;
      inM43[j * N + i] = d43 <= ph.m43ApertureArcmin * 60 ? 1 : 0;
      inTotal[j * N + i] = dC <= ph.totalApertureArcmin * 60 && !inM43[j * N + i] ? 1 : 0;
    }
  const coreR = (ph.coreRadiusArcmin * 60) / pxArcsec;
  const fit = fitCalibration({
    Y,
    shape: dome.shape,
    N,
    omega,
    inTotal,
    inM43,
    coreSigma: coreR / Math.SQRT2, // a Gaussian of σ = r/√2 has the second moment of a disk of radius r
    totalLux: LUX_MAG0 * 10 ** (-0.4 * ph.totalV),
    coreL: luminanceFromMu(ph.coreMuV),
    m43Lux: LUX_MAG0 * 10 ** (-0.4 * ph.m43V),
    fixedP: process.env.NEBULAE_P ? Number(process.env.NEBULAE_P) : STRETCH_P,
    gain,
  });
  const { p: stretch, a, slope } = fit;
  const L = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++)
    L[i] = a * transfer(Math.log(Math.max(Y[i], 1e-9)) + slope * dome.shape[i], stretch);
  // What the runtime shows: the emission times the core ratio.
  const Lshown = gain ? L.map((v, i) => v * gain[i]) : L;
  const measure = (mask) => {
    let t = 0;
    for (let i = 0; i < N * N; i++) if (mask[i]) t += Lshown[i] * omega;
    return -2.5 * Math.log10(t / LUX_MAG0);
  };
  const m43V = measure(inM43);
  const totalV = measure(inTotal);
  let coreMax = 0;
  const coreB = gaussBlur(Lshown, N, N, coreR / Math.SQRT2);
  for (let i = 0; i < N * N; i++) coreMax = Math.max(coreMax, coreB[i]);
  const coreMu = muFromLuminance(coreMax);
  console.log(
    `build-nebulae: calibration ${TRANSFER} p = ${stretch.toFixed(3)}, a = ${a.toExponential(3)}, clipped core ${dome.pixels} px ` +
      `(dome peak x${Math.exp((slope * dome.depth) / 2).toFixed(2)}); total V ${totalV.toFixed(2)}, core ${coreMu.toFixed(2)} mag/arcsec², M43 V ${m43V.toFixed(2)}`,
  );

  // --- 6. Components and the dust map -----------------------------------------------------------------------
  // The photo's colours, except in the clipped region (white in the photo, which would unmix to a pink-white):
  // there the sourced luminance shares of the [OIII]-dominated Huygens region, blended over the region's edge.
  const mix = orion.photo.coreMix;
  const coreFrac = [mix.halpha, mix.oiii, mix.scattered];
  const coreSum = coreFrac[0] + coreFrac[1] + coreFrac[2];
  const comp = [new Float32Array(N * N), new Float32Array(N * N), new Float32Array(N * N)];
  const tmp = [0, 0, 0];
  for (let i = 0; i < N * N; i++) {
    unmix(grid.data[3 * i], grid.data[3 * i + 1], grid.data[3 * i + 2], tmp);
    const s = tmp[0] + tmp[1] + tmp[2];
    const w = plateauW[i];
    for (let k = 0; k < 3; k++) {
      const photo = s > 0 ? tmp[k] / s : 1 / 3;
      comp[k][i] = L[i] * ((1 - w) * photo + (w * coreFrac[k]) / coreSum);
    }
  }
  // Dust lanes: the local deficit of the calibrated light against its upper envelope over ~1.5', only where the
  // envelope is nebular light and the pixel is brown-red (reddened) or dark (blue reflection deficits are not
  // dust). τ = ln(L_env / L) - DEFICIT_FLOOR: seen from Earth the lane still shows the photo, and behind it (from
  // inside, past the Veil) the de-reddened light S·e^τ is the envelope, not a dark hole.
  const V = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) V[i] = Math.max(Y[i], 0) ** (1 / 2.2);
  const env = gaussBlur(maxFilter(gaussBlur(V, N, N, 1.2), N, N, 8), N, N, 5);
  const envRef = percentile(env, 0.999);
  const Ls = gaussBlur(L, N, N, 1.2);
  const envL = gaussBlur(maxFilter(Ls, N, N, 8), N, N, 5);
  const tauMax = orion.geometry.veil.maxTau;
  const tau = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) {
    const deficit = Math.log(Math.max(1e-12, envL[i]) / Math.max(1e-12, Ls[i]));
    const weight = clamp((env[i] / envRef - 0.15) / 0.15, 0, 1);
    const r = grid.data[3 * i] + 1e-9;
    const bl = grid.data[3 * i + 2];
    const brown = clamp(1.6 - (2 * bl) / r, 0, 1);
    tau[i] = clamp((deficit - DEFICIT_FLOOR) * weight * brown, 0, tauMax);
  }
  // The Dark Bay next to the core, where the photo is clipped or the deficit spans the whole envelope window:
  // the light NE of θ¹ Ori C short of its azimuthal envelope at the same radius is the Veil's extinction
  // (orion.json geometry.darkBay), so S·e^τ restores the envelope behind it.
  const db = orion.geometry.darkBay;
  const rMax = (db.radiusArcmin * 60) / pxArcsec;
  const LsShown = gaussBlur(Lshown, N, N, 2);
  const ringEnv = new Float32Array(Math.ceil(rMax) + 2);
  {
    const bins = Array.from({ length: ringEnv.length }, () => []);
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const r = Math.hypot(i + 0.5 - N / 2, j + 0.5 - N / 2);
        if (r < ringEnv.length) bins[Math.floor(r)].push(LsShown[j * N + i]);
      }
    bins.forEach((b, k) => {
      b.sort((x, y) => x - y);
      ringEnv[k] = b.length ? b[Math.min(b.length - 1, Math.floor(db.ringPercentile * b.length))] : 0;
    });
  }
  let bayMax = 0;
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const east = -(i + 0.5 - N / 2);
      const north = -(j + 0.5 - N / 2);
      const r = Math.hypot(east, north);
      if (r >= rMax) continue;
      const pa = (Math.atan2(east, north) * 180) / Math.PI;
      let dpa = Math.abs(pa - db.centerPaDeg) % 360;
      if (dpa > 180) dpa = 360 - dpa;
      const ang = 1 - clamp((dpa - db.halfWidthDeg) / db.softDeg, 0, 1);
      const rad = 1 - clamp((r - 0.8 * rMax) / (0.2 * rMax), 0, 1);
      const k = j * N + i;
      const env = ringEnv[Math.floor(r)];
      const t = Math.log(Math.max(1e-12, env) / Math.max(1e-12, LsShown[k]));
      const bay = clamp(t, 0, tauMax) * ang * ang * (3 - 2 * ang) * rad;
      if (bay > tau[k]) tau[k] = bay;
      bayMax = Math.max(bayMax, bay);
    }
  const tauS = gaussBlur(tau, N, N, 2.5);
  console.log(`build-nebulae: dust lanes and the Dark Bay, τ_V up to ${bayMax.toFixed(2)} next to the core`);

  // --- 7. Encode emission ---------------------------------------------------------------------------------
  let lRef = 0;
  for (let k = 0; k < 3; k++) for (const v of comp[k]) lRef = Math.max(lRef, v);
  const enc = (v) => clamp(v / lRef, 0, 1) ** (1 / ENCODE_EXP);
  await writeRgb(
    join(outDir, 'orion-emission.webp'),
    N,
    N,
    comp[0].map(enc),
    comp[1].map(enc),
    comp[2].map(enc),
    // Near-lossless: the three channels are independent components, so no 4:2:0 chroma subsampling.
    { nearLossless: true, quality: 60, effort: 6 },
  );

  // --- 8. Maps: τ, z displacement (log-brightness structure), thickness noise -------------------------------
  const M = orion.field.mapPixels;
  const down = (arr) => {
    const f = N / M;
    const b = gaussBlur(arr, N, N, f * 0.5);
    const out = new Float32Array(M * M);
    for (let j = 0; j < M; j++)
      for (let i = 0; i < M; i++)
        out[j * M + i] = b[Math.floor((j + 0.5) * f) * N + Math.floor((i + 0.5) * f)];
    return out;
  };
  const logY = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) logY[i] = Math.log(Math.max(Y[i], 1e-5));
  const fine = gaussBlur(logY, N, N, 2);
  const coarse = gaussBlur(logY, N, N, 24);
  const disp = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) disp[i] = clamp((fine[i] - coarse[i]) / 1.5, -1, 1);
  const thick = fbm(M, M, 42, 5, 6);
  const tauM = down(tauS);
  const dispM = down(disp);
  await writeRgb(
    join(outDir, 'orion-maps.webp'),
    M,
    M,
    tauM.map((t) => t / tauMax),
    dispM.map((d) => 0.5 + 0.5 * d),
    thick.map((d) => 0.5 + 0.5 * clamp(d * 1.6, -1, 1)),
    { lossless: true, effort: 6 },
  );
  if (debug) {
    const scale = 1 / (lRef * 0.6);
    await debugPng(debug, 'emission.png', N, N, comp[0], comp[1], comp[2], scale);
    await writeRgb(
      join(debug, 'tau.png'),
      N,
      N,
      tauS.map((t) => t / tauMax),
      tauS.map((t) => t / tauMax),
      tauS.map((t) => t / tauMax),
    );
    await writeRgb(
      join(debug, 'disp.png'),
      N,
      N,
      disp.map((d) => 0.5 + 0.5 * d),
      disp.map((d) => 0.5 + 0.5 * d),
      disp.map((d) => 0.5 + 0.5 * d),
    );
  }

  const meta = {
    version: 1,
    source:
      'tools/build-nebulae.mjs from the Stellarium M42 image (HG731GZ, CC BY 3.0) and the Hubble heic0601a mosaic (NASA, ESA, M. Robberto and the HST Orion Treasury Project Team)',
    center: { raDeg: ra0, decDeg: dec0 },
    field: {
      halfWidthDeg: orion.field.halfWidthDeg,
      xiMax,
      pixels: N,
      mapPixels: M,
      pxArcsec: round(pxArcsec, 4),
    },
    emission: {
      file: 'data/nebulae/orion-emission.webp',
      encodeExp: ENCODE_EXP,
      lRef,
      components: ['halpha', 'oiii', 'scattered'],
      camera: CAMERA,
      coreMix: coreFrac.map((v) => round(v / coreSum, 4)),
    },
    maps: {
      file: 'data/nebulae/orion-maps.webp',
      tauMax,
      channels: ['tauV/tauMax', 'displacement', 'thickness'],
    },
    core,
    calibration: {
      transfer: TRANSFER,
      stretch: round(stretch, 5),
      domePeak: round(Math.exp((slope * dome.depth) / 2), 4),
      a,
      skyRgb: skyRgb.map((v) => round(v, 6)),
      totalV: ph.totalV,
      coreMuV: ph.coreMuV,
      m43V: round(m43V, 3),
      totalApertureArcmin: ph.totalApertureArcmin,
      m43ApertureArcmin: ph.m43ApertureArcmin,
      coreRadiusArcmin: ph.coreRadiusArcmin,
    },
    registration: {
      stellarium: {
        convention: 'textures.json texture coordinate (0, 0) = bottom-left of the image',
        maxResidualPx: round(maxRes, 3),
        limitPx: orion.registration.maxResidualPx,
        stars: residuals,
      },
      hubble: core ? core.registration : null,
    },
    removedStars: det.length,
  };
  writeFileSync(join(outDir, 'orion-meta.json'), JSON.stringify(meta, null, 2) + '\n');
  console.log(
    'build-nebulae: wrote public/data/nebulae/{orion-emission.webp, orion-maps.webp, orion-core.webp, orion-meta.json}',
  );
}

/**
 * Priors of the Hubble press image (ESA/Hubble heic0601a, north up and east left, ~30' across): scale range in
 * pixels per arcsec for the 1280 px copy, and the largest rotation searched.
 */
const HST_SCALE = [0.6, 0.85];
const HST_MAX_ROTATION_DEG = 6;

/** Registers the Hubble mosaic from the Trapezium stars and writes the core detail-ratio map. */
async function buildCore(orion, path, outDir, debug, emissionPxArcsec, plateauAt) {
  const img = await loadLinear(path);
  const { raDeg: ra0, decDeg: dec0 } = orion.center;
  // Registration targets: the Trapezium (θ¹ Ori A-E, unresolved and saturated at this scale) as one blob at its
  // flux-weighted position, θ² Ori A and NU Ori.
  const byId = (id) => orion.stars.find((s) => s.id === id);
  const skyOf = (s) => gnomonic(ra0, dec0, s.raDeg, s.decDeg).map((v) => v / ARCSEC); // arcsec, east/north
  const trap = orion.stars.filter((s) => s.id.startsWith('theta1-ori-'));
  const wsum = trap.reduce((t, s) => t + 10 ** (-0.4 * s.v), 0);
  const trapSky = [0, 1].map((k) => trap.reduce((t, s) => t + skyOf(s)[k] * 10 ** (-0.4 * s.v), 0) / wsum);
  const targets = [
    { name: 'Trapezium (θ¹ Ori A-E)', sky: trapSky },
    { name: byId('theta2-ori-a').name, sky: skyOf(byId('theta2-ori-a')) },
    { name: byId('nu-ori').name, sky: skyOf(byId('nu-ori')) },
  ];
  const toPx = (s) => [-s[0], -s[1]]; // east left, north up: image x grows west, y grows south
  // Hot stars are blue-white against the pink-yellow core of the nebula: work in B - R/2.
  const blue = new Float32Array(img.w * img.h);
  for (let i = 0; i < blue.length; i++) blue[i] = img.data[3 * i + 2] - 0.5 * img.data[3 * i];
  const blueS = gaussBlur(blue, img.w, img.h, 2);
  const at = (x, y) =>
    blueS[clamp(Math.round(y - 0.5), 0, img.h - 1) * img.w + clamp(Math.round(x - 0.5), 0, img.w - 1)];
  // Coarse search: every blue peak as the Trapezium, scale and rotation inside the priors; score the others.
  const cands = detectStars(blue, img.w, img.h, { s1: 1, s2: 3, k: 0 })
    .sort((p, q) => q.dog - p.dog)
    .slice(0, 400);
  let best = null;
  for (const c of cands)
    for (let sc = HST_SCALE[0]; sc <= HST_SCALE[1] + 1e-9; sc += 0.01)
      for (let rot = -HST_MAX_ROTATION_DEG; rot <= HST_MAX_ROTATION_DEG; rot += 1) {
        const cr = Math.cos(rot * D2R) * sc;
        const sr = Math.sin(rot * D2R) * sc;
        const [x0, y0] = toPx(targets[0].sky);
        let score = 0;
        for (const t of targets.slice(1)) {
          const [x, y] = toPx(t.sky);
          const dx = x - x0;
          const dy = y - y0;
          score += at(c.x + cr * dx - sr * dy, c.y + sr * dx + cr * dy);
        }
        if (!best || score > best.score) best = { score, c, sc, rot };
      }
  // Refine: thresholded blob centroids at the predicted positions, similarity fit, twice.
  const blobCentroid = (x, y, r = 9) => {
    let peak = -Infinity;
    const vals = [];
    for (let j = Math.floor(y - r); j <= Math.ceil(y + r); j++)
      for (let i = Math.floor(x - r); i <= Math.ceil(x + r); i++) {
        if (i < 0 || j < 0 || i >= img.w || j >= img.h) continue;
        const v = blueS[j * img.w + i];
        vals.push(v);
        peak = Math.max(peak, v);
      }
    vals.sort((p, q) => p - q);
    const level = 0.5 * peak + 0.5 * vals[Math.floor(vals.length / 2)];
    let sw = 0;
    let sx = 0;
    let sy = 0;
    for (let j = Math.floor(y - r); j <= Math.ceil(y + r); j++)
      for (let i = Math.floor(x - r); i <= Math.ceil(x + r); i++) {
        if (i < 0 || j < 0 || i >= img.w || j >= img.h) continue;
        const w = Math.max(0, blueS[j * img.w + i] - level);
        sw += w;
        sx += w * (i + 0.5);
        sy += w * (j + 0.5);
      }
    return sw > 0 ? [sx / sw, sy / sw] : [x, y];
  };
  const cr0 = Math.cos(best.rot * D2R) * best.sc;
  const sr0 = Math.sin(best.rot * D2R) * best.sc;
  const [bx, by] = toPx(targets[0].sky);
  let map = (x, y) => [
    best.c.x + cr0 * (x - bx) - sr0 * (y - by),
    best.c.y + sr0 * (x - bx) + cr0 * (y - by),
  ];
  let measured = [];
  for (let iter = 0; iter < 3; iter++) {
    measured = targets.map((t) => blobCentroid(...map(...toPx(t.sky))));
    map = fitSimilarity(
      targets.map((t) => toPx(t.sky)),
      measured,
    );
  }
  const res = targets.map((t, k) => {
    const [u, v] = map(...toPx(t.sky));
    return Math.hypot(u - measured[k][0], v - measured[k][1]);
  });
  const maxRes = Math.max(...res);
  const arcsecPerPx = 1 / map.scale;
  console.log(
    `build-nebulae: Hubble registration on ${targets.length} targets, ${arcsecPerPx.toFixed(3)}"/px, rotation ${map.rotationDeg.toFixed(2)}°, max residual ${maxRes.toFixed(2)} px`,
  );
  for (let k = 0; k < targets.length; k++)
    console.log(
      `  ${targets[k].name.padEnd(24)} (${measured[k][0].toFixed(1)}, ${measured[k][1].toFixed(1)}) ${res[k].toFixed(2)} px`,
    );
  if (maxRes > 3 || map.scale < HST_SCALE[0] || map.scale > HST_SCALE[1]) {
    console.warn(
      'build-nebulae: Hubble registration failed (residual or scale out of range); core map skipped',
    );
    return null;
  }
  const Yh = luminanceOf(img);
  // De-star: compact peaks well above their surroundings, plus diffraction spikes of the bright ones.
  const det = detectStars(Yh, img.w, img.h, { s1: 1.2, s2: 4, k: 3 });
  const mask = new Float32Array(img.w * img.h);
  const bright = [];
  for (const d of det) {
    const r = clamp(2 + 1.4 * Math.log2(d.amp), 3, 12);
    paintDisc(mask, img.w, img.h, d.x, d.y, r, 2);
    if (d.amp > 40) bright.push(d);
  }
  for (const d of bright) {
    const len = clamp(6 * Math.log2(d.amp), 14, 60);
    paintBar(mask, img.w, img.h, d.x, d.y, len, 1, true);
    paintBar(mask, img.w, img.h, d.x, d.y, len, 1, false);
  }
  inpaint(img, mask);
  const Yc = luminanceOf(img);
  // Outside the clipped region: detail beyond the resolution of the resampled Stellarium image (~2.5 emission
  // texels FWHM). Inside it the photo has no structure at all, so the reference is a wide (60") blur: the
  // Orion Bar, the bright ridges and the edge of the Fish's Mouth (20"-3') come from the Hubble image.
  const sigma = (2.5 * emissionPxArcsec) / 2.355 / arcsecPerPx;
  const smooth = gaussBlur(Yc, img.w, img.h, sigma);
  const wide = gaussBlur(Yc, img.w, img.h, CORE_WIDE_SIGMA_ARCSEC / arcsecPerPx);
  const floor = percentile(smooth, 0.05) + 1e-4;
  // The numerator is lightly smoothed (σ 1.2 px, ~1.7"): the 1280 px JPEG's pixel grain would otherwise show as a
  // mottled texture at the inside views' magnification (~0.6"/px), with up to ×8 contrast inside the clipped region.
  const sharpY = gaussBlur(Yc, img.w, img.h, 1.2);
  const ratioSrc = { w: img.w, h: img.h, c: 1, data: new Float32Array(img.w * img.h) };
  const ratioWide = { w: img.w, h: img.h, c: 1, data: new Float32Array(img.w * img.h) };
  for (let i = 0; i < Yc.length; i++) {
    ratioSrc.data[i] = (sharpY[i] + floor) / (smooth[i] + floor);
    ratioWide.data[i] = (sharpY[i] + floor) / (wide[i] + floor);
  }
  // Resample onto the core grid (gnomonic about θ¹ Ori C).
  const C = orion.field.corePixels;
  // Half-width: stay inside the Hubble frame around θ¹ Ori C.
  const [c0x, c0y] = map(0, 0);
  const halfPx = Math.min(c0x, c0y, img.w - c0x, img.h - c0y) - 4;
  const halfArcsec = halfPx * arcsecPerPx;
  const xiCore = Math.tan(halfArcsec * ARCSEC);
  const out = new Float32Array(C * C);
  for (let j = 0; j < C; j++)
    for (let i = 0; i < C; i++) {
      const xi = (1 - (2 * (i + 0.5)) / C) * xiCore;
      const eta = (1 - (2 * (j + 0.5)) / C) * xiCore;
      const [u, v] = map(-xi / ARCSEC, -eta / ARCSEC);
      const w = plateauAt(xi, eta);
      const lf = Math.log2(Math.max(sample(ratioSrc, u, v, 0), 1e-3));
      const lw = Math.log2(Math.max(sample(ratioWide, u, v, 0), 1e-3));
      // Feather to 1 over the outer 10% of the core field.
      const edge = Math.max(Math.abs(xi), Math.abs(eta)) / xiCore;
      const f = clamp((1 - edge) / 0.1, 0, 1);
      const lr = clamp(w * lw + (1 - w) * lf, -RATIO_LOG2_SPAN, RATIO_LOG2_SPAN) * f;
      out[j * C + i] = 0.5 + lr / (2 * RATIO_LOG2_SPAN);
    }
  await writeRgb(join(outDir, 'orion-core.webp'), C, C, out, out, out, { quality: 90, effort: 6 });
  if (debug) {
    await debugPng(
      debug,
      'hubble-destarred.png',
      img.w,
      img.h,
      channel(img, 0),
      channel(img, 1),
      channel(img, 2),
      1,
    );
    await writeRgb(join(debug, 'core-ratio.png'), C, C, out, out, out);
  }
  return {
    file: 'data/nebulae/orion-core.webp',
    halfWidthArcsec: round(halfArcsec, 2),
    xiMax: xiCore,
    pixels: C,
    ratioLog2Span: RATIO_LOG2_SPAN,
    registration: {
      targets: targets.map((t, k) => ({
        name: t.name,
        measured: measured[k].map((v) => round(v, 2)),
        px: round(res[k], 3),
      })),
      arcsecPerPx: round(arcsecPerPx, 4),
      rotationDeg: round(map.rotationDeg, 3),
      maxResidualPx: round(maxRes, 3),
      removedStars: det.length,
    },
  };
}

function round(v, d) {
  return Number(v.toFixed(d));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
