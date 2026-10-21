/**
 * Zonal cloud cover for deep time, baked once into an equirect R8 map (rows from the south) that the
 * earth shading and cloud shell sample through uEarthCloudZonalMap. Evaluating it per pixel in GLSL made
 * present-day Earth about 15% slower on SwiftShader even behind a uniform branch, so the noise runs here.
 * The noise is a port of gnoise (src/render/chunks/noise.glsl), so the look matches the tuned shader.
 */

function hashU(x: number): number {
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

const hashU3 = (x: number, y: number, z: number) => hashU((x ^ hashU((y ^ hashU(z >>> 0)) >>> 0)) >>> 0);

/** dot(cosmosGrad(c), f) */
function gradDot(cx: number, cy: number, cz: number, fx: number, fy: number, fz: number): number {
  const h = hashU3(cx, cy, cz);
  const gx = (h & 1023) / 511.5 - 1 + 1e-4;
  const gy = ((h >>> 10) & 1023) / 511.5 - 1 + 1e-4;
  const gz = ((h >>> 20) & 1023) / 511.5 - 1 + 1e-4;
  const l = Math.hypot(gx, gy, gz);
  return (gx * fx + gy * fy + gz * fz) / l;
}

const fade = (f: number) => f * f * f * (f * (f * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const PERIOD = 65536;
const wrap = (i: number) => ((i % PERIOD) + PERIOD) % PERIOD;

/** Gradient noise in [-1, 1] (gnoise). */
export function gnoise(px: number, py: number, pz: number): number {
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const iz = Math.floor(pz);
  const fx = px - ix;
  const fy = py - iy;
  const fz = pz - iz;
  const [x0, x1, y0, y1, z0, z1] = [wrap(ix), wrap(ix + 1), wrap(iy), wrap(iy + 1), wrap(iz), wrap(iz + 1)];
  const ux = fade(fx);
  const uy = fade(fy);
  const uz = fade(fz);
  const n000 = gradDot(x0, y0, z0, fx, fy, fz);
  const n100 = gradDot(x1, y0, z0, fx - 1, fy, fz);
  const n010 = gradDot(x0, y1, z0, fx, fy - 1, fz);
  const n110 = gradDot(x1, y1, z0, fx - 1, fy - 1, fz);
  const n001 = gradDot(x0, y0, z1, fx, fy, fz - 1);
  const n101 = gradDot(x1, y0, z1, fx - 1, fy, fz - 1);
  const n011 = gradDot(x0, y1, z1, fx, fy - 1, fz - 1);
  const n111 = gradDot(x1, y1, z1, fx - 1, fy - 1, fz - 1);
  return (
    1.6 *
    lerp(
      lerp(lerp(n000, n100, ux), lerp(n010, n110, ux), uy),
      lerp(lerp(n001, n101, ux), lerp(n011, n111, ux), uy),
      uz,
    )
  );
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Cloud cover 0..1 without today's geography at a body-fixed unit direction (z north): the equatorial
 * convergence band, clear subtropics, the mid-latitude storm tracks and polar stratus, broken up by
 * continental-scale noise.
 */
export function zonalCloudCover(dx: number, dy: number, dz: number): number {
  const lat = (Math.asin(Math.min(1, Math.max(-1, dz))) * 180) / Math.PI;
  const a = Math.abs(lat);
  const e0 = lat / 6;
  const e1 = (a - 55) / 10;
  const e2 = (a - 24) / 8;
  const cover = 0.3 + 0.32 * Math.exp(-e0 * e0) + 0.3 * Math.exp(-e1 * e1) - 0.2 * Math.exp(-e2 * e2);
  const n =
    0.55 * gnoise(dx * 7, dy * 7, dz * 7) +
    0.3 * gnoise(dx * 17, dy * 17, dz * 17) +
    0.15 * gnoise(dx * 41, dy * 41, dz * 41);
  return smoothstep(0.42, 0.75, cover + 0.55 * n);
}

/** R8 equirect map, rows from the south, texel centres (u = lon / 2pi + 0.5, v = lat / pi + 0.5). */
export function bakeZonalClouds(width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const lat = ((y + 0.5) / height - 0.5) * Math.PI;
    const cl = Math.cos(lat);
    const z = Math.sin(lat);
    for (let x = 0; x < width; x++) {
      const lon = ((x + 0.5) / width - 0.5) * 2 * Math.PI;
      out[y * width + x] = Math.round(255 * zonalCloudCover(cl * Math.cos(lon), cl * Math.sin(lon), z));
    }
  }
  return out;
}
