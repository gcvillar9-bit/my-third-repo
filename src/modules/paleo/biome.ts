/**
 * Synthetic paleo surface (pure, three-free; runs in the bake worker and in tests). A texel's land or
 * sea comes from the blended signed coast distance of the two bracketing PaleoDEM maps (so coasts
 * move instead of continents shrinking), with a small noise warp for sub-degree coastlines. Land
 * colour is a soft biome classification:
 *
 * - temperature: an equator-to-pole profile whose mean is the era's global mean temperature (polar
 *   amplification: the gradient narrows in warm eras, floor 20 K), minus 5 K/km of altitude (less than
 *   the free-air 6.5 K/km: high plateaus such as Tibet are warmer than that, and unglaciated);
 * - moisture: a linear model of latitude belts, distance to the sea (nearest coast, upwind), rain
 *   shadows and cold, fitted at load time to today's Earth (fitMoisture, modern_moisture.png);
 * - vegetation stage: bare rock before land plants, mosses and low plants before forests, shrub
 *   before grasslands; ice where it is below about -10 C, sea ice below about -8 C.
 *
 * Colours are the biome samples of the Blue Marble day map (sRGB), with hillshade and noise.
 * Approximate by design: a plausible look for an era, not a reconstruction.
 */
import type { BiomeRow, Vegetation } from './climate';
import { DEM_H, DEM_W, sampleField, type SliceFields } from './fields';

export type Rgb = [number, number, number];
export type Palette = Record<
  | 'tropical-forest'
  | 'savanna'
  | 'desert'
  | 'steppe'
  | 'temperate-forest'
  | 'boreal-forest'
  | 'tundra'
  | 'ice'
  | 'rock'
  | 'deep-ocean'
  | 'shelf'
  | 'sea-ice',
  Rgb
>;

export function paletteFrom(rows: readonly BiomeRow[]): Palette {
  const p = {} as Record<string, Rgb>;
  for (const r of rows) p[r.id] = r.srgb;
  for (const id of ['tropical-forest', 'desert', 'ice', 'deep-ocean', 'shelf', 'rock'])
    if (!p[id]) throw new Error(`paleo: biome '${id}' missing from index.json`);
  return p as Palette;
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** Mean annual temperature (C) at a latitude and altitude for a global mean temperature. */
export function temperatureC(latDeg: number, elevM: number, gmstC: number): number {
  // T(lat) = Teq - dT sin^2(lat); the area mean of sin^2 is 1/3, so GMST = Teq - dT/3.
  // Today (14 C): Teq 27 C, dT 39 K. Warmer eras narrow the gradient (polar amplification).
  const dT = Math.max(20, 39 - 1.45 * (gmstC - 14));
  const teq = gmstC + dT / 3;
  const s = Math.sin((latDeg * Math.PI) / 180);
  return teq - dT * s * s - 0.005 * Math.max(0, elevM);
}

export interface Maritime {
  /** Distance to the nearest coast, km. */
  coastKm: number;
  /** Distance to the sea looking west / east along the latitude row, km. */
  seaWestKm: number;
  seaEastKm: number;
  /** Highest ground on the way to that sea, m. */
  barrierWestM: number;
  barrierEastM: number;
}

/**
 * Moisture features: latitude belts (equatorial convergence, subtropical highs, storm tracks, polar
 * air), supply from the nearest coast, air from the west in the westerlies and from the east in the
 * trades (cut by mountains on the way: rain shadow), east-coast monsoons, and cold (low evaporation).
 */
export function moistureFeatures(latDeg: number, sea: Maritime, tC: number): number[] {
  const a = Math.abs(latDeg);
  const westerly = smooth(24, 34, a) * (1 - smooth(60, 70, a));
  const shadowW = Math.exp(-sea.barrierWestM / 1500);
  const shadowE = Math.exp(-sea.barrierEastM / 1500);
  const coast = Math.exp(-Math.max(0, sea.coastKm) / 1100);
  const coastFar = Math.exp(-Math.max(0, sea.coastKm) / 3000);
  const west = westerly * Math.exp(-sea.seaWestKm / 1500) * shadowW;
  const east = (1 - westerly) * Math.exp(-sea.seaEastKm / 2200) * shadowE;
  const fromEast = Math.exp(-sea.seaEastKm / 1500) * shadowE;
  const itcz = Math.exp(-((latDeg / 8) ** 2));
  const subtropic = Math.exp(-(((a - 25) / 7) ** 2));
  const midlat = Math.exp(-(((a - 50) / 14) ** 2));
  const cold = Math.max(0, 12 - tC) / 30;
  return [
    1,
    itcz,
    Math.exp(-((latDeg / 18) ** 2)),
    subtropic,
    midlat,
    smooth(65, 80, a),
    coast,
    coastFar,
    west,
    east,
    westerly * Math.exp(-sea.seaEastKm / 1300) * shadowE,
    subtropic * fromEast,
    Math.exp(-Math.max(sea.barrierWestM, sea.barrierEastM) / 1500),
    cold * coastFar,
    cold * west,
    Math.max(0, tC - 20) / 10,
    subtropic * coast,
    subtropic * coastFar,
    itcz * coastFar,
    midlat * west,
    midlat * coastFar,
  ];
}
export const MOISTURE_FEATURES = 21;

const logit = (m: number) => Math.log(m / (1 - m));

/** Effective moisture 0 (desert) .. 1 (rainforest): logistic model with fitted weights (fitMoisture). */
export function moisture(weights: readonly number[], latDeg: number, sea: Maritime, tC: number): number {
  const f = moistureFeatures(latDeg, sea, tC);
  let z = 0;
  for (let i = 0; i < f.length; i++) z += weights[i] * f[i];
  return 1 / (1 + Math.exp(-z));
}

/** Ridge least squares: weights w minimising sum (w . x - y)^2 + lambda |w|^2 (Gaussian elimination). */
export function fitLinear(xs: readonly number[][], ys: readonly number[], lambda = 1e-3): number[] {
  const n = xs[0].length;
  const A = Array.from({ length: n }, () => new Float64Array(n + 1));
  for (let s = 0; s < xs.length; s++) {
    const x = xs[s];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) A[i][j] += x[i] * x[j];
      A[i][n] += x[i] * ys[s];
    }
  }
  for (let i = 0; i < n; i++) A[i][i] += lambda * xs.length;
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k];
    }
  }
  return Array.from({ length: n }, (_, i) => A[i][n] / A[i][i]);
}

/**
 * Fits the moisture model (on the logit scale) to today's Earth: `target` is modern_moisture.png (1 + 254 m per land cell,
 * 0 unused) and `today` the 0 Ma fields, at today's global mean temperature.
 */
export function fitMoisture(today: SliceFields, target: Uint8Array, gmstC: number): number[] {
  const xs: number[][] = [];
  const ys: number[] = [];
  for (let y = 0; y < DEM_H; y++)
    for (let x = 0; x < DEM_W; x++) {
      const k = y * DEM_W + x;
      if (!target[k]) continue;
      const lat = 89.5 - y;
      const tC = temperatureC(lat, today.elev[k], gmstC);
      xs.push(moistureFeatures(lat, maritimeAt(today, k), tC));
      ys.push(logit(Math.max(0.03, Math.min(0.97, (target[k] - 1) / 254))));
    }
  return fitLinear(xs, ys);
}

/** Maritime inputs of one cell. */
export function maritimeAt(f: SliceFields, k: number): Maritime {
  return {
    coastKm: f.coastKm[k],
    seaWestKm: f.seaWestKm[k],
    seaEastKm: f.seaEastKm[k],
    barrierWestM: f.barrierWestM[k],
    barrierEastM: f.barrierEastM[k],
  };
}

/** Land colour (sRGB 0-255) from temperature, moisture, altitude and vegetation stage. */
export function landColour(p: Palette, tC: number, m: number, elevM: number, veg: Vegetation): Rgb {
  const steppe = p.steppe ?? p.desert;
  const savanna = p.savanna ?? steppe;
  const shrub = mix(steppe, p.desert, 0.3);
  const dry = mix(mix(shrub, steppe, veg.grass), savanna, smooth(14, 22, tC));
  let forest = mix(p['boreal-forest'] ?? p['temperate-forest'], p['temperate-forest'], smooth(2, 9, tC));
  forest = mix(forest, p['tropical-forest'], smooth(17, 23, tC));
  // Without forests, wet land carries low plants: a muted green between tundra and dry land.
  forest = mix(mix(p.tundra ?? dry, dry, 0.5), forest, veg.forests);
  let c = mix(p.desert, dry, smooth(0.1, 0.18, m));
  c = mix(c, forest, smooth(0.34, 0.48, m));
  c = mix(p.tundra ?? c, c, smooth(-6, 0, tC));
  // Bare rock and soil before land plants.
  const bare = mix(p.desert, p.rock, 0.55).map((v) => v * 0.85) as Rgb;
  c = mix(bare, c, veg.plants);
  c = mix(c, p.rock, smooth(2500, 4500, elevM) * 0.7);
  return mix(p.ice, c, smooth(-13, -8, tC));
}

// Value noise on the unit sphere (deterministic, seamless).
function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function valueNoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const f = (t: number) => t * t * (3 - 2 * t);
  const u = f(x - xi);
  const v = f(y - yi);
  const w = f(z - zi);
  let acc = 0;
  for (let dz = 0; dz < 2; dz++)
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++)
        acc += hash3(xi + dx, yi + dy, zi + dz) * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
  return acc * 2 - 1;
}
/** fBm in [-1, 1] at a unit-sphere point, `octaves` from base frequency `f`. */
export function sphereNoise(px: number, py: number, pz: number, f: number, octaves: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(px * f + o * 17.1, py * f - o * 9.3, pz * f + o * 3.7);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

export interface BakeInput {
  a: SliceFields;
  b: SliceFields;
  /** Weight of `b`. */
  w: number;
  gmstC: number;
  veg: Vegetation;
  palette: Palette;
  /** fitMoisture weights. */
  moistureWeights: readonly number[];
  width: number;
  height: number;
}

/** Climate of one cell (land or sea), shared by the bake and the climate map so they agree. */
interface Cell {
  land: boolean;
  elev: number;
  /** Temperature at the surface (land: at altitude, with noise), C. */
  tC: number;
  /** Sea-level temperature, C (sea ice). */
  t0: number;
  /** Moisture 0..1 (land). */
  m: number;
  /** Large-scale noise -1..1 (tint). */
  n: number;
}

type CellInput = Pick<BakeInput, 'a' | 'b' | 'w' | 'gmstC' | 'moistureWeights'> & {
  /** Observed moisture (modern_moisture.png, 1 + 254 m per land cell, 0 unused) used where set. */
  observed?: Uint8Array;
};

function cellSampler(inp: CellInput) {
  const { a, b, w, gmstC } = inp;
  const blend = (fa: Float32Array, fb: Float32Array, lat: number, lon: number) =>
    w <= 0 ? sampleField(fa, lat, lon) : sampleField(fa, lat, lon) * (1 - w) + sampleField(fb, lat, lon) * w;
  const sampler = (lat: number, lon: number, px: number, py: number, pz: number): Cell => {
    const elev = blend(a.elev, b.elev, lat, lon);
    // Coast: blended signed distance plus a noise warp of about a third of a cell.
    const coast = blend(a.coastKm, b.coastKm, lat, lon) + 45 * sphereNoise(px, py, pz, 24, 3);
    const n = sphereNoise(px, py, pz, 9, 3);
    const t0 = temperatureC(lat, 0, gmstC);
    if (coast <= 0) return { land: false, elev, tC: t0, t0, m: 1, n };
    const tC = temperatureC(lat, elev, gmstC) + 1.5 * n;
    let m: number;
    const ok =
      inp.observed?.[
        Math.min(DEM_H - 1, Math.max(0, Math.floor(90 - lat))) * DEM_W +
          Math.min(DEM_W - 1, Math.floor(lon + 180))
      ];
    if (ok) m = (ok - 1) / 254;
    else {
      const sea: Maritime = {
        coastKm: coast,
        seaWestKm: blend(a.seaWestKm, b.seaWestKm, lat, lon),
        seaEastKm: blend(a.seaEastKm, b.seaEastKm, lat, lon),
        barrierWestM: blend(a.barrierWestM, b.barrierWestM, lat, lon),
        barrierEastM: blend(a.barrierEastM, b.barrierEastM, lat, lon),
      };
      m = moisture(inp.moistureWeights, lat, sea, tC) + 0.05 * n;
    }
    return { land: true, elev, tC, t0, m, n };
  };
  return { sampler, blend };
}

/**
 * Bakes the synthetic surface into RGBA8, rows from the south (v = 0) to match Earth's equirect uv:
 * rgb = sRGB albedo, a = 255 open water (glint, level sea) else 0.
 */
export function bakeSurface(inp: BakeInput, out = new Uint8Array(inp.width * inp.height * 4)): Uint8Array {
  const { a, b, veg, palette: p, width, height } = inp;
  const DEG = Math.PI / 180;
  const cellDeg = 360 / DEM_W;
  const { sampler, blend } = cellSampler(inp);
  for (let y = 0; y < height; y++) {
    const lat = -90 + ((y + 0.5) * 180) / height;
    const cl = Math.cos(lat * DEG);
    const sl = Math.sin(lat * DEG);
    for (let x = 0; x < width; x++) {
      const lon = -180 + ((x + 0.5) * 360) / width;
      const cell = sampler(lat, lon, cl * Math.cos(lon * DEG), cl * Math.sin(lon * DEG), sl);
      const { elev, n } = cell;
      let c: Rgb;
      let water = 0;
      if (cell.land) {
        c = landColour(p, cell.tC, cell.m, elev, veg);
        // Hillshade from the elevation gradient, light from the north-west.
        const step = cellDeg * 0.5;
        const dzE = (blend(a.elev, b.elev, lat, lon + step / Math.max(0.2, cl)) - elev) / (step * 111);
        const dzN = (blend(a.elev, b.elev, lat + step, lon) - elev) / (step * 111);
        // Slopes facing the north-west (ground rising to the east and south) are lit.
        const shade = 1 + Math.max(-0.3, Math.min(0.3, 0.012 * 0.7 * (dzE - dzN)));
        const tint = 1 + 0.07 * n;
        c = [c[0] * shade * tint, c[1] * shade * tint, c[2] * shade * tint];
      } else {
        const depth = Math.min(elev, -1);
        c = mix(p['deep-ocean'], p.shelf, smooth(-2500, -120, depth));
        const ice = smooth(-6, -10, cell.t0);
        c = mix(c, p['sea-ice'] ?? p.ice, ice);
        water = 1 - ice;
      }
      const k = (y * width + x) * 4;
      out[k] = Math.max(0, Math.min(255, Math.round(c[0])));
      out[k + 1] = Math.max(0, Math.min(255, Math.round(c[1])));
      out[k + 2] = Math.max(0, Math.min(255, Math.round(c[2])));
      out[k + 3] = Math.round(water * 255);
    }
  }
  return out;
}

/**
 * Surface kinds of the climate map (byte 0). `shelf` is sea floor bared by the ice-age sea level
 * (iceAgeOverlay): land for every purpose, kept apart because today's terrain has no bathymetry and
 * cannot tell it from the sea.
 */
export const SURFACE = { sea: 0, land: 1, landIce: 2, seaIce: 3, shelf: 4 } as const;

/**
 * Climate map for life at ground level, RGBA8 rows from the south like the bake: R = SURFACE kind,
 * G = temperature + 60 C, B = moisture * 255, A = elevation / 40 m + 128 (clamped). Land ice where the
 * landColour ice blend passes one half (about -10.5 C).
 */
export function climateMap(inp: CellInput & { width: number; height: number }): Uint8Array {
  const { width, height } = inp;
  const out = new Uint8Array(width * height * 4);
  const DEG = Math.PI / 180;
  const { sampler } = cellSampler(inp);
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  for (let y = 0; y < height; y++) {
    const lat = -90 + ((y + 0.5) * 180) / height;
    const cl = Math.cos(lat * DEG);
    const sl = Math.sin(lat * DEG);
    for (let x = 0; x < width; x++) {
      const lon = -180 + ((x + 0.5) * 360) / width;
      const c = sampler(lat, lon, cl * Math.cos(lon * DEG), cl * Math.sin(lon * DEG), sl);
      const k = (y * width + x) * 4;
      out[k] = c.land
        ? c.tC < -10.5
          ? SURFACE.landIce
          : SURFACE.land
        : c.t0 < -8
          ? SURFACE.seaIce
          : SURFACE.sea;
      out[k + 1] = clamp(c.tC + 60);
      out[k + 2] = clamp(c.m * 255);
      out[k + 3] = clamp(c.elev / 40 + 128);
    }
  }
  return out;
}

/**
 * Sea-level drop past an ice threshold at which paleo-surface.glsl draws the sheet half iced: its blend is
 * smoothstep(G, G + 8 m, drop).
 */
export const ICE_HALF_M = 4;

/**
 * Ice ages over today's climate map (in place), matching paleo-surface.glsl at its half-points. `quat` is
 * quaternary.png as RG8 rows from the south: R seabed depth today (m, 0 land), G the sea-level drop (m)
 * that grows the ice sheet there (0 or 255 never). Sea and sea-ice cells whose seabed is shallower than
 * `seaDropM` become SURFACE.shelf (the shader exposes half at depth = drop); cells whose threshold the
 * drop passes by ICE_HALF_M become SURFACE.landIce. A shelf takes the temperature and moisture of the
 * nearest land (the sea's own values would make every bared seabed rainforest).
 */
export function iceAgeOverlay(
  data: Uint8Array,
  width: number,
  height: number,
  quat: { data: Uint8Array; width: number; height: number },
  seaDropM: number,
): void {
  const { data: q, width: qw, height: qh } = quat;
  // Shelf cells still holding the sea's climate.
  const open = new Uint8Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const k = i * 4;
      const s = (Math.floor(((y + 0.5) / height) * qh) * qw + Math.floor(((x + 0.5) / width) * qw)) * 2;
      const depth = q[s];
      const ice = q[s + 1];
      if ((data[k] === SURFACE.sea || data[k] === SURFACE.seaIce) && depth > 0 && depth < seaDropM) {
        data[k] = SURFACE.shelf;
        open[i] = 1;
      }
      if (ice > 0 && ice < 255 && ice + ICE_HALF_M <= seaDropM) {
        data[k] = SURFACE.landIce;
        open[i] = 0;
      }
    }
  // Breadth-first from the coast: each shelf cell copies the cell it was reached from (columns wrap).
  const queue: number[] = [];
  const step = (i: number, visit: (j: number) => void) => {
    const x = i % width;
    visit(i - x + ((x + 1) % width));
    visit(i - x + ((x + width - 1) % width));
    if (i >= width) visit(i - width);
    if (i + width < width * height) visit(i + width);
  };
  for (let i = 0; i < width * height; i++) {
    const kind = data[i * 4];
    if (open[i] || (kind !== SURFACE.land && kind !== SURFACE.landIce)) continue;
    let coast = false;
    step(i, (j) => (coast ||= open[j] === 1));
    if (coast) queue.push(i);
  }
  for (let h = 0; h < queue.length; h++) {
    const i = queue[h];
    step(i, (j) => {
      if (!open[j]) return;
      open[j] = 0;
      data[j * 4 + 1] = data[i * 4 + 1];
      data[j * 4 + 2] = data[i * 4 + 2];
      queue.push(j);
    });
  }
}

export { DEM_H, DEM_W };
