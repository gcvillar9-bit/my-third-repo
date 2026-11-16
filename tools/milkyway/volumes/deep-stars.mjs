/**
 * Deep stars: real stars beyond the bright-star catalogue the app starts with (HYG, 119,625 stars).
 *
 *  - AT-HYG v4.0 to magnitude 11 (D. Nash, astronexus; Tycho-2 with Gaia DR3 distances; CC BY-SA 4.0),
 *    without the rows that carry a HYG id (the stars module draws those);
 *  - the hot luminous stars of Zari et al. 2021 (A&A 650, A112, "filtered" sample; Gaia EDR3 with
 *    astro-kinematic distances), which trace the young disc out to several kpc.
 * Stars that the atlas already draws as open-cluster members are left out (sidecar written by
 * layers/open-clusters.mjs: run that builder first).
 *
 * Not part of the default build (110 MB of downloads):  node tools/build-milkyway.mjs deep-stars
 *
 * Outputs (public/data/milkyway/atlas/): deep-stars-a.bin (stars of apparent magnitude <= 10 from
 * the Sun, or more luminous than M = -3), deep-stars-b.bin (the rest), deep-stars.json (counts,
 * encoding, sources). Brightness is the observed one, so the dust towards a star is included as
 * seen from the Sun. No proper motions: these stars stay at their J2000 (AT-HYG) or J2016 (Zari)
 * positions.
 *
 * Format MWDS version 1, little-endian: header 24 bytes (u32 magic 0x5344574d, u32 version,
 * u32 count N, u32 0, f32 s, f32 R); then x, y, z as i16 x N each, mag u8 x N, colour u8 x N.
 *   coordinate (pc from the Sun, ICRS axes) = sign(q) s (exp(|q| / 32767 ln(1 + R / s)) - 1)
 *   absolute magnitude = mag / 10 - 12;  B-V = colour / 100 - 0.5 (255 = unknown)
 * Rows are sorted from the most to the least luminous, so a prefix is a luminosity cut.
 */
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { ROOT } from '../../lib/fetch.mjs';
import { DEG, DERIVED, icrsFromGalacticXyz, num, OUT_DIR, source } from '../lib.mjs';

const ATHYG_COMMIT = 'eebe42b3552ae04e67d27ae085a8aad997b42bc0';
const ATHYG = {
  group: 'stars',
  id: 'athyg_v40_m11',
  cite: 'AT-HYG v4.0 (Augmented Tycho - HYG), David Nash (astronexus), subset to magnitude 11',
  url: 'https://codeberg.org/astronexus/athyg',
  license: 'CC-BY-SA-4.0',
  attribution: 'AT-HYG v4.0, David Nash (astronexus): Tycho-2, Gaia DR3, Hipparcos, Yale BSC, Gliese',
  fetch: {
    kind: 'file',
    url: `https://codeberg.org/astronexus/athyg/media/commit/${ATHYG_COMMIT}/data/subsets/athyg_40_reduced_m11.csv.gz`,
    file: 'athyg_40_reduced_m11.csv.gz',
  },
  outputs: [
    'data/milkyway/atlas/deep-stars-a.bin',
    'data/milkyway/atlas/deep-stars-b.bin',
    'data/milkyway/atlas/deep-stars.json',
  ],
};
const ZARI = {
  group: 'stars',
  id: 'zari_2021_filtered',
  cite: 'Zari et al. 2021, A&A 650, A112 (Mapping luminous hot stars in the Galaxy), filtered sample',
  url: 'https://doi.org/10.1051/0004-6361/202039726',
  license: 'cited (no explicit licence)',
  attribution:
    'Zari, E., Rix, H.-W., Frankel, N. et al. 2021, A&A 650, A112, via CDS VizieR (Gaia EDR3, 2MASS)',
  fetch: {
    kind: 'vizier',
    table: 'J/A+A/650/A112/filtered',
    columns: 'GaiaEDR3,RA_ICRS,DE_ICRS,Gmag,BPmag,RPmag,d50kin,d16kin,d84kin,xkin,ykin,zkin',
  },
  outputs: ATHYG.outputs,
};

const MAGIC = 0x5344574d;
const S = 50; // pc: scale of the logarithmic coordinate
const R = 20000; // pc: largest coordinate
const LOG = Math.log(1 + R / S);
const encodeCoord = (v) =>
  Math.sign(v) * Math.round((32767 * Math.log(1 + Math.min(Math.abs(v), R) / S)) / LOG);
export const decodeCoord = (q) => Math.sign(q) * S * (Math.exp((Math.abs(q) / 32767) * LOG) - 1);
const MATCH_ARCSEC = 1.5;
/** Stars brighter than this (apparent magnitude) are all in HYG. */
const BRIGHT_LIMIT = 7;
/** Match radius for the stars that another module draws itself. */
const ELSEWHERE_ARCSEC = 4;

/** Sky grid of positions (degrees) for a cross-match within MATCH_ARCSEC. */
function skyGrid(points) {
  const cell = 0.05; // degrees
  const grid = new Map();
  const key = (ra, dec) =>
    `${Math.floor((dec + 90) / cell)}:${Math.floor(ra / (cell / Math.max(Math.cos(dec * DEG), 0.02)))}`;
  for (const p of points) {
    const k = key(p[0], p[1]);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(p);
  }
  const tol = MATCH_ARCSEC / 3600;
  return (ra, dec) => {
    const cd = Math.max(Math.cos(dec * DEG), 0.02);
    for (const dd of [-tol, 0, tol])
      for (const dr of [-tol / cd, 0, tol / cd]) {
        const list = grid.get(key((((ra + dr) % 360) + 360) % 360, dec + dd));
        if (!list) continue;
        for (const p of list) {
          const dra = (((ra - p[0] + 540) % 360) - 180) * cd;
          if (Math.hypot(dra, dec - p[1]) < tol) return true;
        }
      }
    return false;
  };
}

/** Splits one CSV line (the catalogue quotes no field that we read, but names may hold commas in quotes). */
function splitCsv(line) {
  if (!line.includes('"')) return line.split(',');
  const out = [];
  let cur = '';
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function encode(stars) {
  stars.sort((a, b) => a.m - b.m);
  const n = stars.length;
  const buf = Buffer.alloc(24 + 8 * n);
  buf.writeUInt32LE(MAGIC, 0);
  buf.writeUInt32LE(1, 4);
  buf.writeUInt32LE(n, 8);
  buf.writeFloatLE(S, 16);
  buf.writeFloatLE(R, 20);
  for (let i = 0; i < n; i++) {
    const s = stars[i];
    buf.writeInt16LE(encodeCoord(s.x), 24 + 2 * i);
    buf.writeInt16LE(encodeCoord(s.y), 24 + 2 * n + 2 * i);
    buf.writeInt16LE(encodeCoord(s.z), 24 + 4 * n + 2 * i);
    buf[24 + 6 * n + i] = Math.min(255, Math.max(0, Math.round((s.m + 12) * 10)));
    buf[24 + 7 * n + i] = s.bv === null ? 255 : Math.min(254, Math.max(0, Math.round((s.bv + 0.5) * 100)));
  }
  return buf;
}

export default async function build() {
  const sidecar = join(DERIVED, 'cluster-stars-kept.tsv');
  if (!existsSync(sidecar))
    throw new Error(
      'deep-stars: run "node tools/milkyway/run.mjs layers/open-clusters" first (kept cluster members)',
    );
  const inCluster = skyGrid(
    readFileSync(sidecar, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => l.split('\t').map(Number)),
  );

  // Stars that another module draws itself (the nebulae module: the Trapezium, theta2 Ori A, NU Ori).
  const orion = JSON.parse(readFileSync(join(ROOT, 'src', 'modules', 'nebulae', 'orion.json'), 'utf8'));
  const elsewhere = orion.stars.map((st) => [st.raDeg, st.decDeg]);
  const drawnElsewhere = (ra, dec) =>
    elsewhere.some(
      (p) =>
        Math.hypot((((ra - p[0] + 540) % 360) - 180) * Math.cos(dec * DEG), dec - p[1]) <
        ELSEWHERE_ARCSEC / 3600,
    );

  // --- AT-HYG ---------------------------------------------------------------------------------
  const stat = {
    athygRows: 0,
    hyg: 0,
    noDistance: 0,
    cluster: 0,
    bright: 0,
    elsewhere: 0,
    zariRows: 0,
    zariInAthyg: 0,
    zariInHyg: 0,
    zariCluster: 0,
    zariBad: 0,
  };
  const stars = [];
  const athygGaia = new Set();
  const hygGaia = new Set();
  const rl = createInterface({
    input: createReadStream(source(ATHYG)).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  let ix = null;
  for await (const line of rl) {
    const c = splitCsv(line);
    if (!ix) {
      ix = Object.fromEntries(c.map((k, i) => [k, i]));
      for (const k of [
        'id',
        'gaia',
        'hyg',
        'ra',
        'dec',
        'dist',
        'x0',
        'y0',
        'z0',
        'mag',
        'absmag',
        'ci',
        'pmra',
        'pmdec',
      ])
        if (ix[k] === undefined) throw new Error(`deep-stars: AT-HYG has no column ${k}`);
      continue;
    }
    stat.athygRows++;
    const gaia = c[ix.gaia];
    if (c[ix.hyg] !== '') {
      stat.hyg++;
      if (gaia) hygGaia.add(gaia);
      continue;
    }
    const dist = num(c[ix.dist]);
    const x = num(c[ix.x0]);
    const y = num(c[ix.y0]);
    const z = num(c[ix.z0]);
    const m = num(c[ix.absmag]);
    const mag = num(c[ix.mag]);
    if (!(dist > 1 && dist < R) || x === null || y === null || z === null || m === null || mag === null) {
      stat.noDistance++;
      continue;
    }
    // Catalogue positions are at epoch 2000: move to 2016 for the match with Gaia cluster members.
    const ra = num(c[ix.ra]) * 15;
    const dec = num(c[ix.dec]);
    const pmra = num(c[ix.pmra]) ?? 0;
    const pmdec = num(c[ix.pmdec]) ?? 0;
    const dec16 = dec + (pmdec * 16) / 3.6e6;
    const ra16 = ra + (pmra * 16) / 3.6e6 / Math.max(Math.cos(dec * DEG), 1e-6);
    if (drawnElsewhere(ra, dec)) {
      stat.elsewhere++;
      continue;
    }
    if (inCluster(((ra16 % 360) + 360) % 360, dec16)) {
      stat.cluster++;
      continue;
    }
    if (gaia) athygGaia.add(gaia);
    // HYG holds every star to about magnitude 7.3, so a brighter star without a HYG id is a
    // component of a multiple star that HYG lists as one: leave it out, or it would be drawn twice.
    if (mag < BRIGHT_LIMIT) {
      stat.bright++;
      continue;
    }
    stars.push({ x, y, z, m, bv: num(c[ix.ci]), app: mag });
  }
  const nAthyg = stars.length;

  // --- Zari et al. 2021 ---------------------------------------------------------------------------
  const text = readFileSync(source(ZARI), 'utf8');
  const lines = text.split('\n');
  const head = lines[0].split('\t').map((s) => s.trim());
  const zi = Object.fromEntries(head.map((k, i) => [k, i]));
  for (let i = 3; i < lines.length; i++) {
    if (!lines[i]) continue;
    const c = lines[i].split('\t');
    stat.zariRows++;
    const id = c[zi.GaiaEDR3].trim();
    if (athygGaia.has(id)) {
      stat.zariInAthyg++;
      continue;
    }
    if (hygGaia.has(id)) {
      stat.zariInHyg++;
      continue;
    }
    const d = num(c[zi.d50kin]);
    const g = num(c[zi.Gmag]);
    const X = num(c[zi.xkin]);
    const Y = num(c[zi.ykin]);
    const Z = num(c[zi.zkin]);
    const lo = num(c[zi.d16kin]);
    const hi = num(c[zi.d84kin]);
    // Distances in kpc. Reject missing values and distances known to worse than a factor of 1.5.
    if (
      !(d > 0.02 && d * 1000 < R) ||
      g === null ||
      X === null ||
      Y === null ||
      Z === null ||
      !(hi / lo < 1.5)
    ) {
      stat.zariBad++;
      continue;
    }
    if (g < BRIGHT_LIMIT) {
      stat.bright++;
      continue;
    }
    if (drawnElsewhere(num(c[zi.RA_ICRS]), num(c[zi.DE_ICRS]))) {
      stat.elsewhere++;
      continue;
    }
    if (inCluster(num(c[zi.RA_ICRS]), num(c[zi.DE_ICRS]))) {
      stat.zariCluster++;
      continue;
    }
    const [x, y, z] = icrsFromGalacticXyz(X * 1000, Y * 1000, Z * 1000);
    const bp = num(c[zi.BPmag]);
    const rp = num(c[zi.RPmag]);
    stars.push({
      x,
      y,
      z,
      m: g - 5 * Math.log10(d * 100),
      bv: bp !== null && rp !== null ? 0.75 * (bp - rp) : null,
      app: g,
    });
  }

  // --- Tiers and files ----------------------------------------------------------------------------
  const a = stars.filter((s) => s.app <= 10 || s.m <= -3);
  const b = stars.filter((s) => !(s.app <= 10 || s.m <= -3));
  mkdirSync(OUT_DIR, { recursive: true });
  const bufA = encode(a);
  const bufB = encode(b);
  writeFileSync(join(OUT_DIR, 'deep-stars-a.bin'), bufA);
  writeFileSync(join(OUT_DIR, 'deep-stars-b.bin'), bufB);
  // Round trip of the coordinate encoding: relative error below 0.1% beyond 10 pc.
  for (const v of [3.7, 42, 137.5, 999, 5400, 15000]) {
    const back = decodeCoord(encodeCoord(v));
    if (Math.abs(back - v) > Math.max(0.01, 1e-3 * v))
      throw new Error(`deep-stars: coordinate encoding is off at ${v} pc (${back})`);
  }
  const meta = {
    description:
      'Deep stars: real stars beyond the HYG catalogue. deep-stars-a.bin: apparent magnitude <= 10 from the Sun, or more luminous than M = -3; deep-stars-b.bin: the rest. Format MWDS v1 (tools/milkyway/volumes/deep-stars.mjs). Brightness is the observed one (dust towards the star included as seen from the Sun). Derived from AT-HYG: CC BY-SA 4.0.',
    license: 'CC-BY-SA-4.0',
    sources: [
      { cite: ATHYG.cite, url: ATHYG.url, license: ATHYG.license, stars: nAthyg },
      { cite: ZARI.cite, url: ZARI.url, license: ZARI.license, stars: stars.length - nAthyg },
    ],
    count: { a: a.length, b: b.length },
    encoding: { s: S, R, magScale: 10, magOffset: -12, bvScale: 100, bvOffset: -0.5 },
    stat,
  };
  writeFileSync(join(OUT_DIR, 'deep-stars.json'), JSON.stringify(meta) + '\n');
  console.log(`  deep-stars: ${JSON.stringify(stat)}`);
  console.log(
    `  deep-stars: ${nAthyg} from AT-HYG + ${stars.length - nAthyg} from Zari et al. -> a ${a.length} stars (${(bufA.length / 1e6).toFixed(2)} MB), b ${b.length} stars (${(bufB.length / 1e6).toFixed(2)} MB)`,
  );
}
