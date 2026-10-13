#!/usr/bin/env node
/**
 * build-surfaces (P2-C): real height rasters for the terrain height sources.
 *
 * - Moon and Mars: Celestia's LOLA/MOLA-derived tangent-space normal maps (4096x2048) are turned into
 *   slopes p = dz/dcol = -nx/nz, q = dz/drow = -ny/nz (G points down the image: the curl test below picks
 *   this sign; craters come out as bowls and Olympus Mons as a mountain), box-averaged to 2048x1024 and
 *   integrated with Frankot-Chellappa (tools/lib/fft.mjs, y mirrored, Tikhonov cutoff at a quarter of
 *   the circumference where 8-bit normals carry no usable signal). The scale is set so the robust
 *   relief range (0.01 to 99.99 percentile) equals the published total relief (LOLA 19.91 km, MOLA
 *   29.43 km); the build log cross-checks it against Tycho's depth and Olympus Mons' relief.
 * - Earth: three-globe earth-topology.png (8-bit land relief, 0 = sea) mapped to metres with a power
 *   law fitted to reference elevations, smoothed (sigma 0.75 px) to remove the 8-bit terraces; ocean
 *   pixels (earth-water.png, white = water) get a smooth bathymetry proxy from the distance to the coast.
 *
 * Outputs public/data/surfaces/{moon,mars,earth}_height_2k.png (16-bit grey, h = offsetM + v * stepM)
 * and earth_ocean_2k.png (8-bit, 255 = water). The encoding of each raster is written to
 * src/modules/surfaces/rasters.json (bundled by the runtime). Deterministic and re-runnable.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { encode } from 'fast-png';
import { PUBLIC, ROOT } from './lib/fetch.mjs';
import { frankotChellappa } from './lib/fft.mjs';
import { writeFormatted } from './lib/format.mjs';
import { readRaw } from './lib/image.mjs';
import { ensureModuleAssets } from './lib/manifest.mjs';

const MODULE = 'surfaces';
const OUT_DIR = join(PUBLIC, 'data', 'surfaces');
const RASTERS_JSON = join(ROOT, 'src', 'modules', 'surfaces', 'rasters.json');
const W = 2048;
const H = 1024;

/** Published total relief (highest minus lowest point), metres. */
export const RELIEF = {
  moon: {
    rangeM: 19910,
    source: 'LRO LOLA: Selenean summit +10.78 km, Antoniadi crater -9.13 km (Smith et al. 2010)',
  },
  mars: {
    rangeM: 29430,
    source: 'MGS MOLA: Olympus Mons +21.23 km, Hellas floor -8.20 km (Smith et al. 2001)',
  },
};

/** Earth relief fit: metres = EARTH_TOP_M * (v / 250)^EARTH_GAMMA for v in 1..255 (0 = sea level). */
export const EARTH_TOP_M = 6000;
export const EARTH_GAMMA = 1.1;

/**
 * Slopes from an 8-bit RGB tangent-space normal map, box-averaged by `f` (W/f x H/f output), in output
 * pixel units: p = dz/dcol = -nx/nz, q = dz/drow = -ny/nz.
 */
export function normalsToSlopes(data, width, height, channels, f) {
  const w = width / f;
  const h = height / f;
  const p = new Float64Array(w * h);
  const q = new Float64Array(w * h);
  const k = 1 / f; // mean over f*f source pixels times f (output pixels are f times wider)
  for (let y = 0; y < height; y++) {
    const row = ((y / f) | 0) * w;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const nx = data[i] / 127.5 - 1;
      const ny = data[i + 1] / 127.5 - 1;
      const nz = Math.max(data[i + 2] / 127.5 - 1, 0.2);
      const o = row + ((x / f) | 0);
      p[o] -= (nx / nz) * k;
      q[o] -= (ny / nz) * k;
    }
  }
  return { p, q, w, h };
}

/** Sum of squared discrete curl (dp/drow - dq/dcol): small for a consistent gradient field. */
export function curlEnergy(p, q, w, h) {
  let e = 0;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const c = (p[(y + 1) * w + x] - p[(y - 1) * w + x] - q[y * w + x + 1] + q[y * w + x - 1]) / 2;
      e += c * c;
    }
  return e;
}

export function percentile(z, a) {
  const s = Float64Array.from(z).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(a * (s.length - 1))))];
}

/** Separable Gaussian blur on a w x h float grid: x wraps (longitude), y clamps. */
export function blur(z, w, h, sigma) {
  const r = Math.ceil(3 * sigma);
  const k = new Float64Array(2 * r + 1);
  let s = 0;
  for (let i = -r; i <= r; i++) s += k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const t = new Float64Array(w * h);
  const out = new Float64Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let a = 0;
      for (let i = -r; i <= r; i++) a += k[i + r] * z[y * w + ((x + i + w) % w)];
      t[y * w + x] = a;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let a = 0;
      for (let i = -r; i <= r; i++) a += k[i + r] * t[Math.min(h - 1, Math.max(0, y + i)) * w + x];
      out[y * w + x] = a;
    }
  return out;
}

/** Bilinear resample of a single-channel 8-bit equirectangular image to w x h floats in [0, 1]. */
function resample(data, sw, sh, channels, w, h) {
  const out = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(sh - 1, Math.max(0, ((y + 0.5) * sh) / h - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = ((x + 0.5) * sw) / w - 0.5;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const a = (xx, yy) => data[(yy * sw + ((xx + sw) % sw)) * channels] / 255;
      out[y * w + x] =
        (1 - ty) * ((1 - tx) * a(x0, y0) + tx * a(x0 + 1, y0)) +
        ty * ((1 - tx) * a(x0, y1) + tx * a(x0 + 1, y1));
    }
  }
  return out;
}

/** Quantises metres to 16 bits: h = offsetM + v * stepM. */
export function encodeHeights(z) {
  let mn = Infinity;
  let mx = -Infinity;
  for (const v of z) {
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  const offsetM = Math.floor(mn);
  const stepM = Math.ceil(((mx - offsetM) / 65535) * 1e4) / 1e4;
  const data = new Uint16Array(z.length);
  for (let i = 0; i < z.length; i++)
    data[i] = Math.max(0, Math.min(65535, Math.round((z[i] - offsetM) / stepM)));
  return { data, offsetM, stepM, minM: Math.round(mn), maxM: Math.round(mx) };
}

const pixAt = (lat, lon) => [
  Math.min(H - 1, Math.max(0, Math.floor(((90 - lat) / 180) * H))),
  Math.floor((((lon + 180) / 360) * W) % W),
];

/** Rim-ring mean minus the minimum within 0.4 r: depth of a feature of angular radius `rDeg`. */
function featureRelief(z, lat, lon, rDeg, sign) {
  let ext = sign > 0 ? -Infinity : Infinity;
  let ring = 0;
  let n = 0;
  const cl = Math.cos((lat * Math.PI) / 180);
  for (let y = 0; y < H; y++) {
    const la = 90 - ((y + 0.5) / H) * 180;
    if (Math.abs(la - lat) > rDeg * 1.2) continue;
    for (let x = 0; x < W; x++) {
      let dl = ((x + 0.5) / W) * 360 - 180 - lon;
      dl -= 360 * Math.round(dl / 360);
      const d = Math.hypot(la - lat, dl * cl) / rDeg;
      const v = z[y * W + x];
      if (d < 0.4) ext = sign > 0 ? Math.max(ext, v) : Math.min(ext, v);
      if (d > 0.9 && d < 1.1) {
        ring += v;
        n++;
      }
    }
  }
  return sign * (ext - ring / n);
}

async function writePng16(name, enc) {
  mkdirSync(OUT_DIR, { recursive: true });
  const png = encode({ width: W, height: H, data: enc.data, depth: 16, channels: 1 });
  writeFileSync(join(OUT_DIR, name), png);
  return `data/surfaces/${name}`;
}

async function buildFromNormals(id, file) {
  const raw = await readRaw(file, { channels: 3 });
  const { width, height, channels } = raw.info;
  const g = normalsToSlopes(raw.data, width, height, channels, width / W);
  const flipped = curlEnergy(
    g.p,
    g.q.map((v) => -v),
    W,
    H,
  );
  const kept = curlEnergy(g.p, g.q, W, H);
  if (flipped < kept)
    console.warn(`  ${id}: curl test prefers the opposite G convention (${flipped} < ${kept})`);
  const z = frankotChellappa(g.p, g.q, W, H, { lambda: ((2 * Math.PI) / (W / 4)) ** 2 });
  const range = percentile(z, 0.9999) - percentile(z, 0.0001);
  const scale = RELIEF[id].rangeM / range;
  let mean = 0;
  let wsum = 0;
  for (let y = 0; y < H; y++) {
    const c = Math.cos((((y + 0.5) / H - 0.5) * Math.PI) % Math.PI);
    for (let x = 0; x < W; x++) {
      mean += c * z[y * W + x];
      wsum += c;
    }
  }
  mean /= wsum;
  for (let i = 0; i < z.length; i++) z[i] = (z[i] - mean) * scale;
  if (id === 'moon')
    console.log(
      `  moon: Tycho depth ${(featureRelief(z, -43.31, -11.36, 1.4, -1) / 1000).toFixed(2)} km (4.8 published)`,
    );
  if (id === 'mars')
    console.log(
      `  mars: Olympus Mons relief ${(featureRelief(z, 18.65, -133.8, 5, 1) / 1000).toFixed(1)} km (~22 published)`,
    );
  const enc = encodeHeights(z);
  const path = await writePng16(`${id}_height_2k.png`, enc);
  console.log(`  ${path}: ${enc.minM} .. ${enc.maxM} m, step ${enc.stepM} m (curl ${kept.toExponential(2)})`);
  return {
    path,
    width: W,
    height: H,
    offsetM: enc.offsetM,
    stepM: enc.stepM,
    minM: enc.minM,
    maxM: enc.maxM,
    approximate: true,
    source: `Frankot-Chellappa from Celestia ${id}-normal.png; scale: ${RELIEF[id].source}`,
  };
}

async function buildEarth(topoFile, waterFile) {
  const topo = await readRaw(topoFile, { channels: 1 });
  const water = await readRaw(waterFile, { channels: 1 });
  if (topo.info.width !== W || topo.info.height !== H)
    throw new Error('earth-topology.png must be 2048x1024');
  const ocean = resample(water.data, water.info.width, water.info.height, water.info.channels, W, H);
  const land = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const v = topo.data[i * topo.info.channels];
    land[i] = v > 0 ? EARTH_TOP_M * (v / 250) ** EARTH_GAMMA : 0;
  }
  const smooth = blur(land, W, H, 0.75);
  const far = blur(ocean, W, H, 8);
  const z = new Float64Array(W * H);
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const o = ocean[i];
    mask[i] = Math.round(Math.min(1, Math.max(0, o)) * 255);
    const t = Math.min(1, Math.max(0, (far[i] - 0.5) / 0.5));
    const depth = -(100 + 4400 * t * t * (3 - 2 * t));
    z[i] = o > 0.5 ? depth : Math.max(smooth[i], 0);
  }
  const enc = encodeHeights(z);
  const path = await writePng16('earth_height_2k.png', enc);
  writeFileSync(
    join(OUT_DIR, 'earth_ocean_2k.png'),
    encode({ width: W, height: H, data: mask, depth: 8, channels: 1 }),
  );
  const [ey, ex] = pixAt(27.988, 86.925);
  console.log(`  ${path}: ${enc.minM} .. ${enc.maxM} m (Everest pixel ${Math.round(z[ey * W + ex])} m)`);
  return {
    path,
    oceanPath: 'data/surfaces/earth_ocean_2k.png',
    width: W,
    height: H,
    offsetM: enc.offsetM,
    stepM: enc.stepM,
    minM: enc.minM,
    maxM: enc.maxM,
    approximate: true,
    source:
      `three-globe earth-topology.png (NASA/NOAA ETOPO) mapped as ${EARTH_TOP_M} m * (v/250)^${EARTH_GAMMA} ` +
      '(fit to Kansas, Denver, Mexico City, Greenland, Altiplano, Dome A, Tibet); ocean depth is a ' +
      'smooth proxy (100 m at the coast to 4.5 km) from the earth-water.png mask, not bathymetry',
  };
}

async function main() {
  const paths = await ensureModuleAssets(MODULE);
  const rasters = {};
  console.log('> moon');
  rasters.moon = await buildFromNormals('moon', paths.get('celestia_moon-normal'));
  console.log('> mars');
  rasters.mars = await buildFromNormals('mars', paths.get('celestia_mars-normal'));
  console.log('> earth');
  rasters.earth = await buildEarth(
    paths.get('three-globe_earth-topology'),
    paths.get('three-globe_earth-water'),
  );
  await writeFormatted(RASTERS_JSON, JSON.stringify(rasters, null, 2));
  console.log(`wrote ${RASTERS_JSON}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
