/**
 * Procedural morphology sprites (P5-A): six face-on galaxy templates (E, S0, Sa, Sc, SBb, Irr) baked once
 * on the CPU into a small RGBA8 atlas (3 x 2 tiles). R = old population (bulge, bar, elliptical light),
 * G = young population (arms, knots). Channels hold sqrt(value / peak) for dynamic range; the shader
 * squares them and multiplies by `gains[k]` so the mean of R + G over the tile's [-1, 1]^2 quad is 1
 * (the impostor then carries exactly the galaxy's integrated flux). No external images.
 */

export const MORPH_NAMES = ['E', 'S0', 'Sa', 'Sc', 'SBb', 'Irr'] as const;
export const ATLAS_COLS = 3;
export const ATLAS_ROWS = 2;

export interface MorphAtlas {
  /** Tile size in texels. */
  size: number;
  width: number;
  height: number;
  data: Uint8Array;
  /** Per sprite: peak / mean(R + G), multiplies the squared texel values. */
  gains: number[];
}

/** Integer hash → [0, 1). */
function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1). */
function vnoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

const fbm = (x: number, y: number, seed: number): number =>
  0.5 * vnoise(x, y, seed) +
  0.3 * vnoise(2.1 * x, 2.1 * y, seed + 1) +
  0.2 * vnoise(4.3 * x, 4.3 * y, seed + 2);

/** de Vaucouleurs-like Sersic profile (n = 4) with effective radius re. */
const sersic4 = (r: number, re: number): number => Math.exp(-7.669 * (Math.pow(r / re + 1e-6, 0.25) - 1));
/** Soft outer edge: 1 inside 0.65, 0 from 0.95 (tile borders stay black). */
const edge = (r: number): number => {
  const t = Math.min(1, Math.max(0, (r - 0.65) / 0.3));
  return 1 - t * t * (3 - 2 * t);
};
/** Logarithmic two-arm pattern with pitch angle `pitchDeg`, sharpened by `power`. */
function arms(r: number, theta: number, pitchDeg: number, power: number, phase = 0): number {
  const k = 1 / Math.tan((pitchDeg * Math.PI) / 180);
  const s = 0.5 + 0.5 * Math.cos(2 * (theta - k * Math.log(r + 1e-3)) + phase);
  return Math.pow(s, power);
}

/** Old (R) and young (G) light of sprite `k` at face-on disc coordinates (x, y) in [-1, 1]. */
export function morphSample(k: number, x: number, y: number): [number, number] {
  const r = Math.hypot(x, y);
  const th = Math.atan2(y, x);
  const e = edge(r);
  if (e <= 0) return [0, 0];
  switch (k) {
    case 0: // E: Sersic n = 4
      return [sersic4(r, 0.22) * e, 0];
    case 1: {
      // S0: bulge + smooth exponential disc with a faint lens, no arms
      const disc = Math.exp(-r / 0.2);
      return [
        (0.55 * sersic4(r, 0.1) + 0.45 * disc * (1 + 0.3 * Math.exp(-((r - 0.25) ** 2) / 0.004))) * e,
        0,
      ];
    }
    case 2: {
      // Sa(b): big bulge, tightly wound arms (pitch 9 deg) with dust lanes
      const disc = Math.exp(-r / 0.24);
      const a = arms(r, th, 9, 3);
      const dust = 1 - 0.45 * arms(r, th, 9, 6, 2.2) * Math.min(1, r / 0.15);
      return [(0.5 * sersic4(r, 0.1) + 0.25 * disc) * e * dust, 0.35 * disc * (0.25 + a) * dust * e];
    }
    case 3: {
      // Sc: small bulge, open clumpy arms (pitch 20 deg) with HII knots
      const disc = Math.exp(-r / 0.28);
      const a = arms(r, th, 20, 2.5);
      const clump = 0.6 + 0.8 * fbm(6 * x + 10, 6 * y + 10, 7);
      return [(0.18 * sersic4(r, 0.06) + 0.12 * disc) * e, 0.6 * disc * (0.15 + a * clump) * e];
    }
    case 4: {
      // SBb: bar along x, arms (pitch 13 deg) rooted at the bar ends
      const disc = Math.exp(-r / 0.26);
      const bar = Math.exp(-Math.hypot(x / 0.32, y / 0.07) * 2.2);
      const a = r > 0.25 ? arms(r, th, 13, 3, 0) * Math.min(1, (r - 0.25) / 0.12) : 0;
      return [(0.35 * sersic4(r, 0.07) + 0.35 * bar + 0.15 * disc) * e, 0.4 * disc * (0.1 + a) * e];
    }
    default: {
      // Irr: off-centre bar and clumpy star-forming patches
      const n = fbm(3.5 * x + 3, 3.5 * y + 5, 11);
      const blob = Math.exp(-Math.hypot((x + 0.1) / 0.55, (y - 0.05) / 0.4) * 2.5);
      const bar = Math.exp(-Math.hypot((x + 0.15) / 0.35, (y + 0.05) / 0.1) * 2);
      const knots = Math.pow(Math.max(0, fbm(9 * x, 9 * y, 23) - 0.45) * 2, 2);
      return [(0.25 * bar + 0.15 * blob) * e, (0.5 * blob * (0.4 + n) + 0.8 * knots * blob) * e];
    }
  }
}

/** Bakes the atlas with tiles of `size` texels (deterministic). */
export function bakeMorphAtlas(size = 128): MorphAtlas {
  const width = size * ATLAS_COLS;
  const height = size * ATLAS_ROWS;
  const data = new Uint8Array(width * height * 4);
  const gains: number[] = [];
  const tile = new Float32Array(size * size * 2);
  for (let k = 0; k < MORPH_NAMES.length; k++) {
    let peak = 1e-12;
    let sum = 0;
    for (let j = 0; j < size; j++)
      for (let i = 0; i < size; i++) {
        const [o, y] = morphSample(k, ((i + 0.5) / size) * 2 - 1, ((j + 0.5) / size) * 2 - 1);
        tile[2 * (j * size + i)] = o;
        tile[2 * (j * size + i) + 1] = y;
        peak = Math.max(peak, o, y);
        sum += o + y;
      }
    gains.push(peak / (sum / (size * size)));
    const x0 = (k % ATLAS_COLS) * size;
    const y0 = Math.floor(k / ATLAS_COLS) * size;
    for (let j = 0; j < size; j++)
      for (let i = 0; i < size; i++) {
        const p = 4 * ((y0 + j) * width + x0 + i);
        data[p] = Math.round(255 * Math.sqrt(tile[2 * (j * size + i)] / peak));
        data[p + 1] = Math.round(255 * Math.sqrt(tile[2 * (j * size + i) + 1] / peak));
        data[p + 3] = 255;
      }
  }
  return { size, width, height, data, gains };
}
