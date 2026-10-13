/**
 * Default height source 'fbm-craters-lite' (HeightModule). Used for every terrain-eligible body
 * without a registered HeightSourceSpec until P2-C supplies real data.
 *
 * Height(d) = clamp(fBm + craters, ±maxAbs), all in float64 metres:
 * - fBm: hashed 3D gradient noise on p = d·R, wavelengths λ_i = λ0·2^−i, amplitude A0·(λ_i/λ0)^H.
 * - Craters: per layer k, jittered 3D cells of size S_k (S_0 = λ0/2, ratio 1/2.8); a cell whose
 *   jittered point lies within ±0.15 S_k of the sphere holds a crater with D ≤ 0.35 S_k (bowl, rim,
 *   ejecta; depth = min(0.2 D, 1 km·(D/15 km)^0.3)), so 8 neighbouring cells cover every crater.
 * - Band limit: octaves/layers fade in between 4 and 2 vertex spacings of the requested level, so
 *   the same direction and level always give the same height (mesh and collision agree).
 */
import type { HeightFunction, HeightModule } from '../../../core/contracts';
import {
  band,
  cellAt,
  craterDepth,
  CRATER_RATIO,
  defaultParams,
  LACUNARITY,
  LAMBDA_MIN,
  maxAbsHeight,
  type FbmCratersParams,
} from '../fbm-params';

export { defaultParams, maxAbsHeight };
export type { FbmCratersParams };

// --- hashed gradient noise (float64) ---

function hash3(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x | 0, 0x8da6b343) ^ Math.imul(y | 0, 0xd8163841) ^ Math.imul(z | 0, 0xcb1ab31f) ^ seed;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

function grad(h: number, x: number, y: number, z: number): number {
  // Perlin's 12 cube-edge gradients (+4 repeats).
  const g = h & 15;
  const u = g < 8 ? x : y;
  const v = g < 4 ? y : g === 12 || g === 14 ? x : z;
  return ((g & 1) === 0 ? u : -u) + ((g & 2) === 0 ? v : -v);
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Improved Perlin noise, roughly in [−1, 1]. */
export function gradientNoise(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const u = fade(fx);
  const v = fade(fy);
  const w = fade(fz);
  const n000 = grad(hash3(ix, iy, iz, seed), fx, fy, fz);
  const n100 = grad(hash3(ix + 1, iy, iz, seed), fx - 1, fy, fz);
  const n010 = grad(hash3(ix, iy + 1, iz, seed), fx, fy - 1, fz);
  const n110 = grad(hash3(ix + 1, iy + 1, iz, seed), fx - 1, fy - 1, fz);
  const n001 = grad(hash3(ix, iy, iz + 1, seed), fx, fy, fz - 1);
  const n101 = grad(hash3(ix + 1, iy, iz + 1, seed), fx - 1, fy, fz - 1);
  const n011 = grad(hash3(ix, iy + 1, iz + 1, seed), fx, fy - 1, fz - 1);
  const n111 = grad(hash3(ix + 1, iy + 1, iz + 1, seed), fx - 1, fy - 1, fz - 1);
  const x00 = n000 + u * (n100 - n000);
  const x10 = n010 + u * (n110 - n010);
  const x01 = n001 + u * (n101 - n001);
  const x11 = n011 + u * (n111 - n011);
  const y0 = x00 + v * (x10 - x00);
  const y1 = x01 + v * (x11 - x01);
  return 0.97 * (y0 + w * (y1 - y0));
}

/** Uniform [0, 1) from a hash. */
const unit = (h: number) => h / 4294967296;

/** Crater profile at normalised distance r = dist / (D/2). Zero beyond r = 2. */
export function craterProfile(r: number, depth: number): number {
  const rim = 0.25 * depth;
  if (r < 1) return -depth + (depth + rim) * r * r;
  if (r >= 2) return 0;
  const ej = rim * Math.exp(-3.5 * (r - 1));
  const t = (r - 1.6) / 0.4;
  return t <= 0 ? ej : ej * (1 - t * t * (3 - 2 * t));
}

export function createFbmCraters(p: FbmCratersParams): HeightFunction {
  const R = p.radius;
  const maxAbs = maxAbsHeight(p);
  const seed = p.seed | 0;
  const octaves: { lambda: number; amp: number; off: number }[] = [];
  for (
    let i = 0, l = p.lambda0, a = p.amplitude;
    l >= LAMBDA_MIN;
    i++, l /= LACUNARITY, a *= LACUNARITY ** -p.hurst
  ) {
    octaves.push({ lambda: l, amp: a, off: 17.17 * i + 0.31 });
  }
  const layers: { S: number; seed: number }[] = [];
  for (let k = 0, S = p.lambda0 / 2; k < p.craterLayers; k++, S *= CRATER_RATIO) {
    layers.push({ S, seed: (seed ^ Math.imul(k + 1, 0x9e3779b1)) | 0 });
  }

  function heightAt(dx: number, dy: number, dz: number, cell: number): number {
    const px = dx * R;
    const py = dy * R;
    const pz = dz * R;
    let h = 0;
    for (let i = 0; i < octaves.length; i++) {
      const o = octaves[i];
      const w = band(o.lambda, cell);
      if (w === 0) break;
      const s = 1 / o.lambda;
      h += w * o.amp * gradientNoise(px * s + o.off, py * s - o.off, pz * s + 2 * o.off, seed + i);
    }
    for (let k = 0; k < layers.length; k++) {
      const L = layers[k];
      const S = L.S;
      const wl = band(0.35 * S, cell);
      if (wl === 0) break;
      const gx = px / S;
      const gy = py / S;
      const gz = pz / S;
      const cx = Math.floor(gx);
      const cy = Math.floor(gy);
      const cz = Math.floor(gz);
      const nx = gx - cx < 0.5 ? -1 : 1;
      const ny = gy - cy < 0.5 ? -1 : 1;
      const nz = gz - cz < 0.5 ? -1 : 1;
      let hl = 0;
      for (let c = 0; c < 8; c++) {
        const ix = cx + (c & 1 ? nx : 0);
        const iy = cy + (c & 2 ? ny : 0);
        const iz = cz + (c & 4 ? nz : 0);
        const h0 = hash3(ix, iy, iz, L.seed);
        if (unit(h0) >= p.craterDensity) continue;
        const h1 = hash3(ix, iy, iz, L.seed ^ 0x5bd1e995);
        const h2 = hash3(ix, iy, iz, L.seed ^ 0x27d4eb2f);
        const h3 = hash3(ix, iy, iz, L.seed ^ 0x165667b1);
        const qx = (ix + unit(h1)) * S;
        const qy = (iy + unit(h2)) * S;
        const qz = (iz + unit(h3)) * S;
        const ql = Math.sqrt(qx * qx + qy * qy + qz * qz);
        if (Math.abs(ql - R) > 0.15 * S) continue;
        const k2 = R / ql;
        const ex = qx * k2 - px;
        const ey = qy * k2 - py;
        const ez = qz * k2 - pz;
        // Diameter in [0.12, 0.35] S, skewed towards small craters.
        const u4 = unit(hash3(ix, iy, iz, L.seed ^ 0x2545f491));
        const D = S * (0.12 + 0.23 * u4 * u4);
        const r = Math.sqrt(ex * ex + ey * ey + ez * ez) / (0.5 * D);
        if (r >= 2) continue;
        hl += craterProfile(r, craterDepth(D));
      }
      h += wl * hl;
    }
    return h > maxAbs ? maxAbs : h < -maxAbs ? -maxAbs : h;
  }

  return {
    sample(dirs: Float64Array, out: Float64Array, count: number, level: number): void {
      const cell = cellAt(R, level);
      for (let i = 0; i < count; i++) {
        out[i] = heightAt(dirs[3 * i], dirs[3 * i + 1], dirs[3 * i + 2], cell);
      }
    },
  };
}

const heightModule: HeightModule = {
  create(params: unknown): HeightFunction {
    return createFbmCraters(params as FbmCratersParams);
  },
};

export const create = heightModule.create;
export default heightModule;
