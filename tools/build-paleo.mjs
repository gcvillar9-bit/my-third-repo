#!/usr/bin/env node
/**
 * build-paleo: deep-time Earth data for src/modules/paleo (docs/modules/paleo.md).
 *
 * - PALEOMAP PaleoDEMs (Scotese & Wright 2018, CC BY 4.0): 109 maps, 0-540 Ma every 5 Myr, 1x1 degree
 *   nodes (361 x 181, lon -180..180, lat 90..-90; maps from 150 Ma on omit 180 E and -90 and use \r lines). Each map is averaged to 360 x 180 cells (centres at
 *   half degrees, north row first; pole nodes replaced by their neighbouring row, whose values are
 *   junk in the source) and written to public/data/paleo/dem/<age>.png as 8-bit grey: elevation,
 *   sqrt-companded, e = sign(v - 128) * ((|v - 128|) / 127)^2 * ELEV_SCALE_M (128 = 0 m, land >= 0 m).
 *   Coast distances are derived at runtime (src/modules/paleo/fields.ts): stored they tripled the size.
 * - quaternary.png (1080 x 540 RGB, north row first) for ice ages (7 ka - 3 Ma):
 *     R  modern seabed depth in metres (ETOPO5 4 x 4 block mean): 0 land or a lake not connected to the
 *        ocean (Caspian, Black Sea), 1..254 m, 255 deeper
 *     G  global sea-level drop (m) at which the cell is ice-covered: 0 ice today (Natural Earth),
 *        1..254 grown from hand-entered LGM sheets (src/modules/paleo/data/lgm-ice.json), 255 never
 * - textures/paleo/land_fill_1k.webp: the Blue Marble day map with land colours pushed into the sea,
 *   for seabed exposed when sea level drops.
 * - modern_moisture.png (360 x 180 grey, north row first): today's effective moisture per land cell
 *   from the Blue Marble colour (soft nearest biome: desert 0.05 ... rainforest 0.8), 0 = not used
 *   (sea, ice, high mountains). The runtime fits its moisture model to it, so the rainfall pattern of
 *   every era is calibrated against today's Earth.
 * - index.json: encodings, ages, biome colours sampled from the Blue Marble day map (sRGB), global
 *   mean temperature per stage (PhanDA medians), vegetation ages and global sea level 0-3 Ma at 1 kyr
 *   (Bintanja & van de Wal 2008; its RSL column is the drop below today, sign checked at 21 ka).
 *
 * Deterministic and re-runnable: `node tools/fetch-assets.mjs paleo && node tools/build-paleo.mjs`.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encode } from 'fast-png';
import { CACHE_RAW, PUBLIC, ROOT } from './lib/fetch.mjs';
import { writeFormatted } from './lib/format.mjs';
import { img, writeWebp } from './lib/image.mjs';
import { ensureModuleAssets } from './lib/manifest.mjs';

const MODULE = 'paleo';
const OUT = join(PUBLIC, 'data', 'paleo');
const DATA_DIR = join(ROOT, 'src', 'modules', 'paleo', 'data');
const W = 360;
const H = 180;
const ELEV_SCALE_M = 11000;
const R_EARTH_KM = 6371;
const QW = 1080;
const QH = 540;
const DEG = Math.PI / 180;

// ------------------------------------------------------------------------------------------------
// Encodings (decoded by src/modules/paleo/fields.ts decodeElevation; scale in index.json)

export const encodeElevation = (e) =>
  e === 0
    ? 128
    : 128 + Math.sign(e) * Math.max(1, Math.round(Math.sqrt(Math.min(1, Math.abs(e) / ELEV_SCALE_M)) * 127));
export const decodeElevation = (r) => Math.sign(r - 128) * (Math.abs(r - 128) / 127) ** 2 * ELEV_SCALE_M;

const cellLat = (y) => 89.5 - y;
// Kept for the moisture target loop and the site search below.
const cellLon = (x) => -179.5 + x;

/** Great-circle distance between cell centres, km. */
function cellDistKm(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * DEG;
  const p2 = lat2 * DEG;
  const dl = (lon2 - lon1) * DEG;
  const a = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

// ------------------------------------------------------------------------------------------------
// PaleoDEM slices

/** Parses one PaleoDEM CSV ('# lon,lat,elev' then 361 x 181 nodes) into a node grid [lat 90..-90][lon -180..180]. */
export function parseDemCsv(text) {
  const nodes = new Float64Array(361 * 181).fill(NaN);
  // Maps from 150 Ma on use bare \r line ends, lat 90..-89 and lon -180..179 (no 180 E column).
  for (const line of text.split(/\r\n|\r|\n/)) {
    if (!line || line[0] === '#') continue;
    const [lo, la, el] = line.split(',').map(Number);
    if (!Number.isFinite(lo) || !Number.isFinite(la) || !Number.isFinite(el)) continue;
    const i = Math.round(lo + 180);
    const j = Math.round(90 - la);
    if (i < 0 || i > 360 || j < 0 || j > 180) continue;
    nodes[j * 361 + i] = el;
  }
  // 180 E is -180 E.
  for (let j = 0; j <= 180; j++)
    if (Number.isNaN(nodes[j * 361 + 360])) nodes[j * 361 + 360] = nodes[j * 361];
  // Pole rows hold junk (e.g. 10500 m at one node) or are missing: copy the next row in.
  for (let i = 0; i <= 360; i++) {
    nodes[i] = nodes[361 + i];
    nodes[180 * 361 + i] = nodes[179 * 361 + i];
  }
  for (let k = 0; k < nodes.length; k++)
    if (Number.isNaN(nodes[k])) throw new Error(`PaleoDEM node ${k} missing`);
  return nodes;
}

/** Node grid -> 360 x 180 cell means (north row first). */
export function cellsFromNodes(nodes) {
  const cells = new Float64Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const a = y * 361 + x;
      cells[y * W + x] = (nodes[a] + nodes[a + 1] + nodes[a + 361] + nodes[a + 362]) / 4;
    }
  return cells;
}

/**
 * Distance (km) from every cell to the nearest cell of the other kind (land <-> sea), by propagating
 * nearest-site indices in raster sweeps with longitude wrap until nothing improves (exact distances
 * to the propagated sites, a standard vector distance transform).
 */
export function oppositeDistanceKm(land) {
  const site = new Int32Array(W * H).fill(-1);
  const dist = new Float64Array(W * H).fill(Infinity);
  const lat = (k) => cellLat(Math.floor(k / W));
  const lon = (k) => cellLon(k % W);
  // Seed: neighbours of a boundary see the other kind directly.
  const nb = (x, y) => {
    const out = [];
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ]) {
      const yy = y + dy;
      if (yy < 0 || yy >= H) continue;
      out.push(yy * W + ((x + dx + W) % W));
    }
    return out;
  };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const k = y * W + x;
      for (const n of nb(x, y)) {
        if (land[n] === land[k]) continue;
        const d = cellDistKm(lat(k), lon(k), lat(n), lon(n));
        if (d < dist[k]) {
          dist[k] = d;
          site[k] = n;
        }
      }
    }
  let changed = true;
  for (let pass = 0; changed && pass < 400; pass++) {
    changed = false;
    const sweep = (y, x) => {
      const k = y * W + x;
      for (const n of nb(x, y)) {
        const s = site[n];
        if (s < 0 || land[s] === land[k]) continue;
        const d = cellDistKm(lat(k), lon(k), lat(s), lon(s));
        if (d < dist[k] - 1e-9) {
          dist[k] = d;
          site[k] = s;
          changed = true;
        }
      }
    };
    if (pass % 2 === 0) {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) sweep(y, x);
    } else {
      for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) sweep(y, x);
    }
  }
  // A world with only land or only sea has no opposite cells; cap the distance.
  for (let k = 0; k < dist.length; k++) if (!Number.isFinite(dist[k])) dist[k] = 20000;
  return dist;
}

/** Encodes one slice as 8-bit grey elevation (north row first). */
export function encodeSlice(cells) {
  const grey = new Uint8Array(W * H);
  const land = new Uint8Array(W * H);
  for (let k = 0; k < cells.length; k++) {
    grey[k] = encodeElevation(cells[k]);
    land[k] = cells[k] >= 0 ? 1 : 0;
  }
  return { grey, land };
}

// ------------------------------------------------------------------------------------------------
// Polygons (Natural Earth, LGM sheets) -> 1080 x 540 masks by scanline (even-odd per polygon)

function fillPolygon(rings, w, h, visit) {
  const xs = [];
  for (let y = 0; y < h; y++) {
    const lat = 90 - ((y + 0.5) * 180) / h;
    xs.length = 0;
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [x1, y1] = ring[j];
        const [x2, y2] = ring[i];
        if (y1 > lat === y2 > lat) continue;
        xs.push(x1 + ((lat - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const x0 = Math.ceil(((xs[i] + 180) * w) / 360 - 0.5);
      const x1 = Math.floor(((xs[i + 1] + 180) * w) / 360 - 0.5);
      for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) visit(x, y);
    }
  }
}

function geojsonRings(geo) {
  const polys = [];
  for (const f of geo.features) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === 'Polygon') polys.push(g.coordinates);
    else if (g.type === 'MultiPolygon') polys.push(...g.coordinates);
  }
  return polys;
}

// ------------------------------------------------------------------------------------------------
// Push-pull fill: land colours spread into the sea (for exposed shelves)

function pushPull(rgb, mask, w, h) {
  const levels = [
    { w, h, c: Float64Array.from(rgb, (v, i) => v * mask[Math.floor(i / 3)]), m: Float64Array.from(mask) },
  ];
  while (levels.at(-1).w > 2) {
    const p = levels.at(-1);
    const nw = Math.ceil(p.w / 2);
    const nh = Math.max(1, Math.ceil(p.h / 2));
    const c = new Float64Array(nw * nh * 3);
    const m = new Float64Array(nw * nh);
    for (let y = 0; y < p.h; y++)
      for (let x = 0; x < p.w; x++) {
        const k = Math.floor(y / 2) * nw + Math.floor(x / 2);
        m[k] += p.m[y * p.w + x];
        for (let ch = 0; ch < 3; ch++) c[k * 3 + ch] += p.c[(y * p.w + x) * 3 + ch];
      }
    levels.push({ w: nw, h: nh, c, m });
  }
  for (let l = levels.length - 2; l >= 0; l--) {
    const p = levels[l];
    const q = levels[l + 1];
    for (let y = 0; y < p.h; y++)
      for (let x = 0; x < p.w; x++) {
        const k = y * p.w + x;
        if (p.m[k] > 0) continue;
        const kq = Math.min(q.h - 1, Math.floor(y / 2)) * q.w + Math.min(q.w - 1, Math.floor(x / 2));
        if (q.m[kq] <= 0) continue;
        for (let ch = 0; ch < 3; ch++) p.c[k * 3 + ch] = q.c[kq * 3 + ch] / q.m[kq];
        p.m[k] = 1;
      }
    for (let k = 0; k < p.w * p.h; k++)
      if (p.m[k] > 0 && p.m[k] !== 1) {
        for (let ch = 0; ch < 3; ch++) p.c[k * 3 + ch] /= p.m[k];
        p.m[k] = 1;
      }
  }
  return Uint8Array.from(levels[0].c, (v) => Math.max(0, Math.min(255, Math.round(v))));
}

// ------------------------------------------------------------------------------------------------

/** Biome sample boxes on the Blue Marble day map: [lon0, lon1, lat0, lat1]. */
const BIOME_BOXES = [
  { id: 'tropical-forest', box: [-64, -60, -6, -2], place: 'central Amazon' },
  { id: 'savanna', box: [25, 32, 8, 11], place: 'South Sudan savanna' },
  { id: 'desert', box: [5, 15, 21, 26], place: 'central Sahara' },
  { id: 'steppe', box: [60, 70, 47, 50], place: 'Kazakh steppe' },
  { id: 'temperate-forest', box: [-82, -78, 36, 40], place: 'Appalachians' },
  { id: 'boreal-forest', box: [95, 105, 58, 62], place: 'central Siberian taiga' },
  { id: 'tundra', box: [-105, -95, 66, 69], place: 'northern Canada' },
  { id: 'ice', box: [0, 40, -80, -76], place: 'East Antarctic ice sheet' },
  { id: 'rock', box: [82, 90, 32, 35], place: 'Tibetan Plateau' },
  { id: 'deep-ocean', box: [-160, -150, -5, 0], place: 'central Pacific' },
  { id: 'shelf', box: [-79, -77, 23, 25], place: 'Great Bahama Bank' },
  { id: 'sea-ice', box: [-160, -140, 82, 86], place: 'Arctic Ocean pack ice' },
];

function sampleBiomes(day) {
  const { width, height, channels } = day.info;
  return BIOME_BOXES.map(({ id, box, place }) => {
    const [lo0, lo1, la0, la1] = box;
    const sum = [0, 0, 0];
    let n = 0;
    for (let y = Math.floor(((90 - la1) / 180) * height); y < Math.ceil(((90 - la0) / 180) * height); y++)
      for (let x = Math.floor(((lo0 + 180) / 360) * width); x < Math.ceil(((lo1 + 180) / 360) * width); x++) {
        for (let c = 0; c < 3; c++) sum[c] += day.data[(y * width + x) * channels + c];
        n++;
      }
    return {
      id,
      srgb: sum.map((s) => Math.round(s / n)),
      source: `mean of the NASA Blue Marble day map (three.js earth_day) over ${place}, lon ${lo0}..${lo1}, lat ${la0}..${la1}`,
    };
  });
}

function readSeaLevel(text) {
  const rows = text
    .split('\n')
    .filter((l) => /^\d/.test(l))
    .map((l) => l.trim().split(/\s+/).map(Number));
  // Columns: age_calkaBP ... RSL (last). RSL is the drop below today (122.8 m at 21 ka).
  const at = (ka) => {
    let best = rows[0];
    for (const r of rows) if (Math.abs(r[0] - ka) < Math.abs(best[0] - ka)) best = r;
    return best;
  };
  const rsl0 = at(0).at(-1);
  const lgm = at(21).at(-1) - rsl0;
  if (!(lgm > 100 && lgm < 140))
    throw new Error(`sea level: unexpected LGM drop ${lgm} m (sign or column changed?)`);
  const out = [];
  let i = 0;
  for (let ka = 0; ka <= 3000; ka++) {
    while (i + 1 < rows.length && rows[i + 1][0] <= ka) i++;
    const a = rows[i];
    const b = rows[Math.min(rows.length - 1, i + 1)];
    const t = b[0] > a[0] ? (ka - a[0]) / (b[0] - a[0]) : 0;
    const rsl = a.at(-1) + t * (b.at(-1) - a.at(-1));
    out.push(Math.round(-(rsl - rsl0) * 10) / 10);
  }
  return out;
}

function readClimate(text) {
  const [head, ...lines] = text.trim().split('\n');
  const cols = head.split(',');
  const ci = (n) => cols.indexOf(n);
  return lines
    .map((l) => l.split(','))
    .map((c) => ({
      ageMa: Number(c[ci('AverageAge')]),
      gmstC: Math.round(Number(c[ci('GMST_50')]) * 100) / 100,
      stage: c[ci('Stage')],
    }))
    .sort((a, b) => a.ageMa - b.ageMa);
}

async function main() {
  const paths = await ensureModuleAssets(MODULE);
  const p = (id) => paths.get(id);
  mkdirSync(join(OUT, 'dem'), { recursive: true });

  // --- PaleoDEM slices
  const unz = join(CACHE_RAW, MODULE, 'paleodem');
  rmSync(unz, { recursive: true, force: true });
  mkdirSync(unz, { recursive: true });
  execFileSync('unzip', ['-q', '-o', p('paleomap_paleodem_csv'), '-d', unz]);
  const csvDir = join(unz, 'PaleoDEMS_long_lat_elev_csv_v2.csv');
  const files = readdirSync(csvDir).filter((f) => /^Map[\d.]+_(\d+)Ma\.csv$/.test(f));
  const slices = files
    .map((f) => ({ f, age: Number(/_(\d+)Ma\.csv$/.exec(f)[1]) }))
    .sort((a, b) => a.age - b.age);
  if (slices.length !== 109) throw new Error(`expected 109 PaleoDEM maps, got ${slices.length}`);
  const ages = [];
  const landAt = new Map();
  let cells0 = null;
  let bytes = 0;
  for (const { f, age } of slices) {
    const cells = cellsFromNodes(parseDemCsv(readFileSync(join(csvDir, f), 'utf8')));
    const { grey, land } = encodeSlice(cells);
    if (age === 0) cells0 = cells;
    const png = encode({ width: W, height: H, data: grey, depth: 8, channels: 1 });
    const name = `${String(age).padStart(3, '0')}.png`;
    writeFileSync(join(OUT, 'dem', name), png);
    bytes += png.length;
    ages.push(age);
    landAt.set(age, land);
  }
  console.log(`[paleo] ${ages.length} DEM slices, ${(bytes / 1e6).toFixed(2)} MB`);

  // Sanity: today's Africa is land, the central Pacific is sea.
  const landCell = (age, lat, lon) =>
    landAt.get(age)[(Math.floor(90 - lat) % H) * W + (Math.floor(lon + 180) % W)];
  if (!landCell(0, 0.5, 20.5) || landCell(0, 0.5, -179.5))
    throw new Error('PaleoDEM 0 Ma orientation check failed');

  // --- Quaternary texture: seabed depth (ETOPO5) and ice threshold
  const etopo = readFileSync(p('noaa_etopo5'));
  const EW = 4320;
  const EH = 2160;
  if (etopo.length !== EW * EH * 2) throw new Error('ETOPO5 size');
  const q = new Uint8Array(QW * QH * 3);
  for (let y = 0; y < QH; y++)
    for (let x = 0; x < QW; x++) {
      let s = 0;
      for (let dy = 0; dy < 4; dy++)
        for (let dx = 0; dx < 4; dx++) {
          const sx = (x * 4 + dx + EW / 2) % EW; // output starts at -180, ETOPO5 at 0 E
          s += etopo.readInt16BE(((y * 4 + dy) * EW + sx) * 2);
        }
      const e = s / 16;
      q[(y * QW + x) * 3] = e >= 0 ? 0 : Math.min(255, Math.max(1, Math.round(-e)));
      q[(y * QW + x) * 3 + 1] = 255;
    }
  // Only seabed connected to the ocean can be exposed by a global sea-level fall: flood-fill the
  // water from ocean seeds (8-neighbour, longitude wrap) and clear R elsewhere, so lakes below sea
  // level (Caspian, Ladoga) never drain. Straits narrower than a cell are bridged by seeding the
  // Mediterranean and Red seas; the Black Sea is left out (an isolated lake at the glacial maximum).
  const OCEAN_SEEDS = [
    [0, -150],
    [0, -30],
    [-20, 80],
    [85, 0],
    [-60, 0],
    [35, 18],
    [20, 38.5],
  ];
  const reached = new Uint8Array(QW * QH);
  const stack = [];
  for (const [lat, lon] of OCEAN_SEEDS) {
    const k = Math.floor(((90 - lat) * QH) / 180) * QW + Math.floor(((lon + 180) * QW) / 360);
    if (q[k * 3] === 0) throw new Error(`ocean seed ${lat},${lon} is on land`);
    stack.push(k);
  }
  while (stack.length) {
    const k = stack.pop();
    if (reached[k] || q[k * 3] === 0) continue;
    reached[k] = 1;
    const y = Math.floor(k / QW);
    const x = k % QW;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy;
        if ((dx || dy) && yy >= 0 && yy < QH) stack.push(yy * QW + ((x + dx + QW) % QW));
      }
  }
  let lakes = 0;
  for (let k = 0; k < QW * QH; k++)
    if (q[k * 3] > 0 && !reached[k]) {
      q[k * 3] = 0;
      lakes++;
    }
  console.log(`[paleo] ${lakes} lake texels below sea level kept as lakes`);

  const lgm = JSON.parse(readFileSync(join(DATA_DIR, 'lgm-ice.json'), 'utf8'));
  const qLat = (y) => 90 - ((y + 0.5) * 180) / QH;
  const qLon = (x) => -180 + ((x + 0.5) * 360) / QW;
  for (const sheet of lgm.sheets) {
    fillPolygon([sheet.polygon], QW, QH, (x, y) => {
      let t = lgm.maxDropM;
      for (const c of sheet.centres) {
        const d = cellDistKm(qLat(y), qLon(x), c.lat, c.lon);
        t = Math.min(t, lgm.minDropM + (lgm.maxDropM - lgm.minDropM) * Math.min(1, d / c.radiusKm) ** 1.5);
      }
      const k = (y * QW + x) * 3 + 1;
      q[k] = Math.min(q[k], Math.max(1, Math.round(t)));
    });
  }
  let modern = 0;
  for (const id of ['natural_earth_glaciated_areas', 'natural_earth_antarctic_ice_shelves']) {
    for (const rings of geojsonRings(JSON.parse(readFileSync(p(id), 'utf8'))))
      fillPolygon(rings, QW, QH, (x, y) => {
        q[(y * QW + x) * 3 + 1] = 0;
        modern++;
      });
  }
  writeFileSync(
    join(OUT, 'quaternary.png'),
    encode({ width: QW, height: QH, data: q, depth: 8, channels: 3 }),
  );
  console.log(`[paleo] quaternary.png (${modern} modern-ice cells)`);

  // --- Land fill and biome colours from the Blue Marble day map (sRGB) and the ocean mask
  const dayPath = join(PUBLIC, 'textures', 'solar-system', 'earth_day_2k.webp');
  const specPath = join(PUBLIC, 'textures', 'solar-system', 'earth_spec_2k.webp');
  const day = await img(dayPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const biomes = sampleBiomes(day);
  const LW = 1024;
  const LH = 512;
  const day1k = await img(dayPath).removeAlpha().resize(LW, LH, { fit: 'fill' }).raw().toBuffer();
  const spec1k = await img(specPath).greyscale().resize(LW, LH, { fit: 'fill' }).raw().toBuffer();
  const landMask = Float64Array.from(spec1k, (v) => (v < 128 ? 1 : 0));
  const filled = pushPull(day1k, landMask, LW, LH);
  await writeWebp(
    { data: Buffer.from(filled), info: { width: LW, height: LH, channels: 3 } },
    join(PUBLIC, 'textures', 'paleo', 'land_fill_1k.webp'),
    { quality: 80 },
  );

  // --- Today's moisture per land cell, from the Blue Marble colour
  const MOISTURE_OF = {
    desert: 0.05,
    steppe: 0.2,
    savanna: 0.28,
    tundra: 0.4,
    'boreal-forest': 0.6,
    'temperate-forest': 0.65,
    'tropical-forest': 0.8,
  };
  const classes = biomes.filter((b) => b.id in MOISTURE_OF);
  const moist = new Uint8Array(W * H);
  const land0 = landAt.get(0);
  const { width: DW, height: DH, channels: DC } = day.info;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const k = y * W + x;
      const lat = cellLat(y);
      const e = cells0[k];
      // Today's temperature as the classifier models it (biome.ts temperatureC at 14 C): skip ice and peaks.
      const t = 27 - 39 * Math.sin(lat * DEG) ** 2 - 0.005 * Math.max(0, e);
      if (!land0[k] || t < -8 || e > 3000) continue;
      const sum = [0, 0, 0];
      let n = 0;
      for (let py = Math.floor((y * DH) / H); py < Math.floor(((y + 1) * DH) / H); py++)
        for (let px = Math.floor((x * DW) / W); px < Math.floor(((x + 1) * DW) / W); px++) {
          for (let c = 0; c < 3; c++) sum[c] += day.data[(py * DW + px) * DC + c];
          n++;
        }
      const rgb = sum.map((v) => v / n);
      // Soft nearest biome colour (inverse distance^4).
      let wsum = 0;
      let m = 0;
      for (const b of classes) {
        const d2 = (rgb[0] - b.srgb[0]) ** 2 + (rgb[1] - b.srgb[1]) ** 2 + (rgb[2] - b.srgb[2]) ** 2;
        const wgt = 1 / (d2 * d2 + 1);
        wsum += wgt;
        m += wgt * MOISTURE_OF[b.id];
      }
      moist[k] = 1 + Math.round((m / wsum) * 254);
    }
  writeFileSync(
    join(OUT, 'modern_moisture.png'),
    encode({ width: W, height: H, data: moist, depth: 8, channels: 1 }),
  );

  // --- index.json
  const climate = readClimate(readFileSync(p('judd2024_phanda_gmst'), 'utf8'));
  const seaLevel = readSeaLevel(readFileSync(p('bintanja2008_sealevel'), 'utf8'));
  const vegetation = JSON.parse(readFileSync(join(DATA_DIR, 'vegetation.json'), 'utf8')).rows;
  const index = {
    about:
      'Deep-time Earth data built by tools/build-paleo.mjs; formats in docs/modules/data-formats.md. Approximate.',
    dem: {
      path: 'data/paleo/dem/{age}.png',
      width: W,
      height: H,
      ages,
      elevationScaleM: ELEV_SCALE_M,
      source: 'Scotese & Wright 2018, PALEOMAP PaleoDEMs (CC BY 4.0), doi:10.5281/zenodo.5460860',
    },
    quaternary: {
      path: 'data/paleo/quaternary.png',
      landFill: 'textures/paleo/land_fill_1k.webp',
      width: QW,
      height: QH,
      source: 'ETOPO5 (NOAA, public domain); Natural Earth ice (public domain); hand-entered LGM margins',
    },
    biomes,
    moisture: {
      path: 'data/paleo/modern_moisture.png',
      classes: MOISTURE_OF,
      source: 'Blue Marble colour of each land cell today (soft nearest biome), 0 = unused',
    },
    climate: {
      rows: climate,
      source:
        'Judd et al. 2024 (Science 385, eadk3705), PhanDA global mean surface temperature, median per stage',
    },
    vegetation,
    seaLevel: {
      stepKa: 1,
      metres: seaLevel,
      source: 'Bintanja & van de Wal 2008 (Nature 454, 869-872), global sea level relative to today',
    },
  };
  await writeFormatted(join(OUT, 'index.json'), JSON.stringify(index));
  console.log(
    `[paleo] index.json: ${biomes.length} biomes, ${climate.length} climate rows, ${seaLevel.length} sea levels`,
  );

  // Candidate bookmark sites (hand-copied into src/modules/paleo/sites.json).
  const interior = (age) => {
    let best = null;
    const d = oppositeDistanceKm(landAt.get(age));
    for (let k = 0; k < W * H; k++)
      if (landAt.get(age)[k] && !landAt.get(0)[k] && (!best || d[k] > best.d)) best = { k, d: d[k] };
    return best && { lat: cellLat(Math.floor(best.k / W)), lon: cellLon(best.k % W), km: Math.round(best.d) };
  };
  console.log('[paleo] deepest land at 250 Ma that is sea today:', interior(250));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
