/**
 * Composite height function of the 'surface' height module: real raster (bicubic, band-limited mips)
 * plus procedural layers, all float64 and deterministic (seeded by body id and the app seed; cell
 * hashes make every tile reproduce the same heights). Heights are metres above the reference
 * ellipsoid, clamped to the spec's maxAbsHeight.
 */
import type { HeightFunction } from '../../core/contracts';
import { craterBound, craterHeight, type CraterParams } from './craters';
import { band, cellAt, fbm, fbmBound, gnoise, smoothstep, worley } from './noise';
import { dirToUv, type Raster } from './raster';
import { lonLatToTile, TERRARIUM_TILE } from './terrarium';

export interface RasterRef {
  path: string;
  offsetM: number;
  stepM: number;
  minM: number;
  maxM: number;
}

export interface FbmParams {
  lambda0: number;
  a0: number;
  hurst: number;
}

export interface SurfaceHeightParams {
  bodyId: string;
  /** Reference (equatorial) radius, m. */
  radius: number;
  seed: number;
  raster?: RasterRef;
  /** Earth: ocean mask (8-bit, 255 = water). `floor` keeps the bathymetry proxy instead of sea level. */
  ocean?: { path: string; floor: boolean };
  /** Optional Earth HD layer: an n x n block of Terrarium tiles at zoom z (urls null = unavailable). */
  hd?: HdBlock;
  craters?: CraterParams;
  fbm?: FbmParams;
  /** Ridged fBm on land (Earth): amplitude a0 + perMetre * elevation. */
  ridged?: FbmParams & { perMetre: number };
  /** Aeolian dunes (Mars): crest spacing lambda, height amp, cover fraction via a noise mask. */
  dunes?: { lambda: number; amp: number; maskLambda: number; threshold: number };
  /** Europa: double ridges along Worley cell borders, per scale (cell size, crest height, crest offset). */
  ridges?: { cell: number; amp: number; width: number }[];
  maxAbs: number;
}

export interface HdBlock {
  z: number;
  x0: number;
  y0: number;
  n: number;
  urls: (string | null)[];
}

export interface SurfaceRasters {
  height?: Raster;
  ocean?: Raster;
  /** Decoded Terrarium tiles of params.hd (row-major n x n, null = missing). */
  hd?: (Float32Array | null)[];
}

/** Analytic bound on |height| for a parameter set (culling bounds, collision margin). */
export function heightBound(p: Omit<SurfaceHeightParams, 'maxAbs'>): number {
  let b = 0;
  if (p.raster) b += Math.max(Math.abs(p.raster.minM), Math.abs(p.raster.maxM));
  if (p.craters) b += 1.5 * craterBound(p.craters);
  if (p.fbm) b += fbmBound(p.fbm.a0, p.fbm.hurst, p.fbm.lambda0, 0.05);
  if (p.ridged) {
    const top = p.raster ? Math.max(0, p.raster.maxM) : 0;
    b += 0.55 * fbmBound(p.ridged.a0 + p.ridged.perMetre * top, p.ridged.hurst, p.ridged.lambda0, 0.05);
  }
  if (p.hd) b += 3000; // Terrarium peaks above the smoothed 2k raster (Everest 8.8 km vs ~5.7 km)
  if (p.dunes) b += p.dunes.amp * 1.1;
  if (p.ridges) for (const r of p.ridges) b += r.amp;
  return Math.ceil(b + 10);
}

/** Dune cross-section over one wavelength, t in [0, 1): long stoss slope, short steep lee face. */
export function duneProfile(t: number): number {
  return t < 0.8
    ? Math.sin(((Math.PI / 2) * t) / 0.8) ** 2
    : Math.cos(((Math.PI / 2) * (t - 0.8)) / 0.2) ** 2;
}

// Fixed prevailing-wind axis for dunes (body-fixed, unit).
const WIND = [0.36, 0.8, 0.48];

/**
 * Bilinear Terrarium height at equirectangular (u, v) from an HD block: out[0] = metres, out[1] = blend
 * weight (0 outside the block or over missing tiles, fading in over the outer quarter tile). Returns out[1].
 */
export function hdSample(
  b: HdBlock,
  tiles: (Float32Array | null)[],
  u: number,
  v: number,
  out: Float64Array,
): number {
  out[0] = 0;
  out[1] = 0;
  const t = lonLatToTile(u * 360 - 180, 90 - v * 180, b.z);
  const fx = t.x - b.x0;
  const fy = t.y - b.y0;
  const edge = Math.min(fx, b.n - fx, fy, b.n - fy);
  if (edge <= 0) return 0;
  const N = TERRARIUM_TILE;
  const px = fx * N - 0.5;
  const py = fy * N - 0.5;
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const ax = px - ix;
  const ay = py - iy;
  let sum = 0;
  let wsum = 0;
  for (let j = 0; j < 2; j++)
    for (let i = 0; i < 2; i++) {
      const gx = Math.min(b.n * N - 1, Math.max(0, ix + i));
      const gy = Math.min(b.n * N - 1, Math.max(0, iy + j));
      const tile = tiles[Math.floor(gy / N) * b.n + Math.floor(gx / N)];
      if (!tile) continue;
      const w = (i ? ax : 1 - ax) * (j ? ay : 1 - ay);
      sum += w * tile[(gy % N) * N + (gx % N)];
      wsum += w;
    }
  if (wsum < 1e-6) return 0;
  out[0] = sum / wsum;
  out[1] = smoothstep(0, 0.25, edge) * Math.min(1, wsum);
  return out[1];
}

export function createSurfaceHeight(p: SurfaceHeightParams, rasters: SurfaceRasters): HeightFunction {
  const R = p.radius;
  const hdOut = new Float64Array(2);
  const uv = new Float64Array(2);
  const wv = new Float64Array(2);
  const seed = p.seed | 0;

  const heightAt = (dx: number, dy: number, dz: number, cell: number): number => {
    let h = 0;
    const x = dx * R;
    const y = dy * R;
    const z = dz * R;
    if (rasters.height || rasters.ocean) dirToUv(dx, dy, dz, uv);
    if (rasters.height) h = rasters.height.sample(uv[0], uv[1], cell, R);
    if (rasters.ocean) {
      const s = smoothstep(0.35, 0.65, rasters.ocean.sample(uv[0], uv[1], cell, R, true));
      let land = Math.max(h, 0);
      if (p.ridged && s < 1) {
        const a = p.ridged.a0 + p.ridged.perMetre * land;
        land = Math.max(
          0,
          land + fbm(x, y, z, cell, p.ridged.lambda0, a, p.ridged.hurst, seed ^ 0x51ed27, true),
        );
      }
      if (p.hd && rasters.hd && s < 1 && hdSample(p.hd, rasters.hd, uv[0], uv[1], hdOut) > 0) {
        // Streamed Terrarium heights replace the baked land relief; ridged detail only below the tile pixel.
        const pix = (2 * Math.PI * R) / (256 * 2 ** p.hd.z);
        const fine = fbm(x, y, z, cell, 2 * pix, 0.06 * pix, 0.8, seed ^ 0x51ed27, true);
        land += hdOut[1] * (Math.max(hdOut[0], 0) + fine - land);
      }
      h = (1 - s) * land + s * (p.ocean?.floor ? Math.min(h, 0) : 0);
    }
    if (p.craters) h += craterHeight(p.craters, R, x, y, z, cell);
    if (p.fbm) h += fbm(x, y, z, cell, p.fbm.lambda0, p.fbm.a0, p.fbm.hurst, seed ^ 0x2545f491);
    if (p.dunes) {
      const d = p.dunes;
      const mask = smoothstep(
        d.threshold,
        d.threshold + 0.15,
        gnoise(x / d.maskLambda, y / d.maskLambda, z / d.maskLambda, seed ^ 0x1b873593),
      );
      const w = band(d.lambda, cell);
      if (mask > 0 && w > 0) {
        const L = d.lambda;
        const warp = 0.8 * gnoise(x / (5 * L), y / (5 * L), z / (5 * L), seed ^ 0x6a09e667);
        const phase = (x * WIND[0] + y * WIND[1] + z * WIND[2]) / L + warp;
        const t = phase - Math.floor(phase);
        // Ripples on the dunes, 1/40 of the spacing.
        const rw = band(L / 40, cell);
        const rp = (phase * 40 + 3 * warp) % 1;
        h += mask * (w * d.amp * duneProfile(t) + rw * 0.02 * d.amp * duneProfile(rp < 0 ? rp + 1 : rp));
      }
    }
    if (p.ridges) {
      for (let i = 0; i < p.ridges.length; i++) {
        const r = p.ridges[i];
        const w = band(2 * r.width, cell);
        if (w <= 0) continue;
        worley(x / r.cell, y / r.cell, z / r.cell, (seed + 0x3c6ef372 * (i + 1)) | 0, wv);
        const b = 0.5 * (wv[1] - wv[0]) * r.cell; // ~ distance to the cell border, m
        const crest = Math.exp(-(((b - r.width) / (0.6 * r.width)) ** 2));
        const trough = 0.35 * Math.exp(-((b / (0.45 * r.width)) ** 2));
        h += w * r.amp * (crest - trough);
      }
    }
    return Math.max(-p.maxAbs, Math.min(p.maxAbs, h));
  };

  return {
    sample(dirs: Float64Array, out: Float64Array, count: number, level: number): void {
      const cell = cellAt(R, level);
      for (let i = 0; i < count; i++) out[i] = heightAt(dirs[3 * i], dirs[3 * i + 1], dirs[3 * i + 2], cell);
    },
  };
}
