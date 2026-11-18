/**
 * Draw-range limit for the atlas star points while the camera is near the Sun.
 *
 * The point shader (points.glsl) removes a point whose peak pixel value is below a fixed cut, but
 * it still runs for every point on every frame. Seen from near the Sun the apparent brightness of
 * each point is fixed, so the points are put in order of that brightness once, and each frame only
 * the leading points that can pass the cut at the current exposure are drawn. In a daylit
 * planet view that is none of them. The result is the same picture: the limit is an upper bound
 * (no extinction, smallest point size, a margin for the camera offset), never an estimate.
 */
import type { PointArrays } from './points';

/** Constants of points.glsl. */
export const CORE_SIGMA = 0.65;
export const MIN_PEAK = 2.0e-4;
export const MIN_BLOB_PEAK = 2.0e-5;

/** Width of one brightness bin, magnitudes. */
const BIN = 0.25;
const MAX_BINS = 1024;
/** The order holds while the camera is closer to the Sun than this fraction of the nearest point's distance. */
const NEAR_FRACTION = 0.01;
/** Allowance for the camera offset (0.022 mag at NEAR_FRACTION) and float32 rounding in the shader, magnitudes. */
const MARGIN = 0.1;

export interface VisibilityOrder {
  /** The same points, brightest bin first. */
  data: PointArrays;
  /** The limit is valid while the camera is closer to the Sun than this, pc. */
  nearPc: number;
  /**
   * Number of leading points that can pass the brightness cut of the shader.
   * `scale` is uGain · uScale: illuminance to peak-normalised pixel value.
   */
  countFor(scale: number): number;
}

/**
 * Key of a point, magnitudes: the point can pass the cut only when key <= limitFor(scale).
 * It is the apparent magnitude from the Sun without extinction plus the cut of its kind.
 */
function keyOf(data: PointArrays, i: number): number {
  const d = Math.hypot(data.pos[3 * i], data.pos[3 * i + 1], data.pos[3 * i + 2]);
  const cut = data.blob && data.blob[i] > 0 ? MIN_BLOB_PEAK : MIN_PEAK;
  return data.mag[i] + 5 * Math.log10(Math.max(d, 1e-6) / 10) + 2.5 * Math.log10(cut);
}

/** Largest key that passes at this scale (a star of the smallest point size, on the cut). */
export const limitFor = (scale: number): number =>
  2.5 * Math.log10(scale / (2 * Math.PI * CORE_SIGMA * CORE_SIGMA));

export function orderByVisibility(data: PointArrays): VisibilityOrder {
  const n = data.mag.length;
  const keys = new Float32Array(n);
  let kMin = Infinity;
  let kMax = -Infinity;
  let dMin = Infinity;
  for (let i = 0; i < n; i++) {
    const k = keyOf(data, i);
    keys[i] = k;
    if (Number.isFinite(k)) {
      if (k < kMin) kMin = k;
      if (k > kMax) kMax = k;
    }
    const d = Math.hypot(data.pos[3 * i], data.pos[3 * i + 1], data.pos[3 * i + 2]);
    if (d < dMin) dMin = d;
  }
  if (!(kMin <= kMax)) {
    kMin = 0;
    kMax = 0;
  }
  const bins = Math.min(MAX_BINS, Math.floor((kMax - kMin) / BIN) + 1);
  // A key that is not finite goes in the first bin (always drawn); keys beyond the last bin share it.
  const binOf = (k: number): number =>
    Number.isFinite(k) ? Math.min(bins - 1, Math.max(0, Math.floor((k - kMin) / BIN))) : 0;

  // Counting sort: cum[b] = number of points in bins 0..b.
  const cum = new Uint32Array(bins);
  for (let i = 0; i < n; i++) cum[binOf(keys[i])]++;
  const next = new Uint32Array(bins);
  for (let b = 1; b < bins; b++) {
    next[b] = cum[b - 1];
    cum[b] += cum[b - 1];
  }
  const out: PointArrays = {
    pos: new Float32Array(n * 3),
    mag: new Float32Array(n),
    col: new Uint8Array(n * 3),
  };
  if (data.blob) out.blob = new Float32Array(n);
  if (data.ext) out.ext = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const j = next[binOf(keys[i])]++;
    out.pos[3 * j] = data.pos[3 * i];
    out.pos[3 * j + 1] = data.pos[3 * i + 1];
    out.pos[3 * j + 2] = data.pos[3 * i + 2];
    out.mag[j] = data.mag[i];
    out.col[3 * j] = data.col[3 * i];
    out.col[3 * j + 1] = data.col[3 * i + 1];
    out.col[3 * j + 2] = data.col[3 * i + 2];
    if (out.blob && data.blob) out.blob[j] = data.blob[i];
    if (out.ext && data.ext) out.ext[j] = data.ext[i];
  }
  return {
    data: out,
    nearPc: Number.isFinite(dMin) ? NEAR_FRACTION * dMin : 0,
    countFor(scale) {
      if (n === 0 || !(scale > 0)) return 0;
      const b = Math.floor((limitFor(scale) + MARGIN - kMin) / BIN);
      return b < 0 ? 0 : cum[Math.min(b, bins - 1)];
    },
  };
}
