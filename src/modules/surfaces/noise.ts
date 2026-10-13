/**
 * Float64 hashing and noise for the surfaces height sources (worker and main thread). Integer lattice
 * coordinates are hashed with 32-bit multiplies, so results are identical in every JS engine.
 */

/** 32-bit hash of three lattice coordinates and a seed. */
export function hash3(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x | 0, 0x8da6b343) ^ Math.imul(y | 0, 0xd8163841) ^ Math.imul(z | 0, 0xcb1ab31f) ^ seed;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Next value of a hash chain (for several random numbers per cell). */
export function rehash(h: number): number {
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

/** Uniform [0, 1) from a hash. */
export const unit = (h: number): number => h / 4294967296;

/** FNV-1a of a string, mixed with a seed: stable per-body seeds. */
export function stringSeed(id: string, seed = 0): number {
  let h = 0x811c9dc5 ^ seed;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

export const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function grad(h: number, x: number, y: number, z: number): number {
  const g = h & 15;
  const u = g < 8 ? x : y;
  const v = g < 4 ? y : g === 12 || g === 14 ? x : z;
  return ((g & 1) === 0 ? u : -u) + ((g & 2) === 0 ? v : -v);
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Improved Perlin gradient noise, roughly in [-1, 1]. */
export function gnoise(x: number, y: number, z: number, seed: number): number {
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

/** Vertex spacing of the terrain quadtree at `level` (terrain cube.ts cellSize). */
export function cellAt(radius: number, level: number): number {
  return ((Math.PI / 2) * radius) / (32 * 2 ** level);
}

/** Band-limit weight of a feature of size `lambda` on a grid of spacing `cell`: 0 below 2 cells, 1 above 4. */
export function band(lambda: number, cell: number): number {
  const x = lambda / cell;
  return x <= 2 ? 0 : x >= 4 ? 1 : smoothstep(2, 4, x);
}

/**
 * Band-limited fBm of gradient noise at p (metres): wavelengths lambda0 * 2^-i down to 2 cells,
 * amplitude a0 * (lambda_i / lambda0)^hurst. `ridged` uses (1 - |n|)^2 - 0.45 (sharp crests, ~zero mean).
 */
export function fbm(
  x: number,
  y: number,
  z: number,
  cell: number,
  lambda0: number,
  a0: number,
  hurst: number,
  seed: number,
  ridged = false,
  minLambda = 0,
): number {
  let s = 0;
  let lambda = lambda0;
  for (let i = 0; i < 40 && lambda > Math.max(2 * cell, minLambda); i++) {
    const w = band(lambda, cell);
    const n = gnoise(x / lambda, y / lambda, z / lambda, (seed + i * 0x9e3779b1) | 0);
    const v = ridged ? (1 - Math.abs(n)) ** 2 - 0.45 : n;
    s += w * a0 * (lambda / lambda0) ** hurst * v;
    lambda *= 0.5;
  }
  return s;
}

/** Sum of fbm amplitudes (bound on |fbm|, ridged included). */
export function fbmBound(a0: number, hurst: number, lambda0: number, minLambda: number): number {
  let s = 0;
  for (let lambda = lambda0; lambda > Math.max(minLambda, 1e-3); lambda *= 0.5)
    s += a0 * (lambda / lambda0) ** hurst;
  return s;
}

/**
 * 3D Worley noise: distances to the nearest (f1) and second nearest (f2) jittered cell point, in units
 * of the cell size. Writes into out[0], out[1].
 */
export function worley(x: number, y: number, z: number, seed: number, out: Float64Array): void {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  let f1 = 9;
  let f2 = 9;
  for (let dz = -1; dz <= 1; dz++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        let h = hash3(ix + dx, iy + dy, iz + dz, seed);
        const px = ix + dx + unit(h);
        h = rehash(h);
        const py = iy + dy + unit(h);
        h = rehash(h);
        const pz = iz + dz + unit(h);
        const d = Math.hypot(px - x, py - y, pz - z);
        if (d < f1) {
          f2 = f1;
          f1 = d;
        } else if (d < f2) f2 = d;
      }
  out[0] = f1;
  out[1] = f2;
}
