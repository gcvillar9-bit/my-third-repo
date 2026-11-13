/**
 * Open clusters and moving groups (Hunt & Reffert 2023, 2024; Gaia DR3) and their real member stars.
 * Outputs: public/data/milkyway/atlas/open-clusters.json (catalogue layer) and cluster-stars.bin
 * (MWCS v1: the brightest members that are not in HYG; sky positions and brightness are measured, the
 * app invents only the depth inside the cluster).
 *
 * Offsets in cluster-stars.bin: dx = dist50 cos(Dec0) dRA, dy = dist50 dDec (pc, Dec0 = Dec of the cluster
 * centre, dRA wrapped to +-pi), stored as round(offset / rMem x 32767).
 */
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DEG, OUT_DIR, icrsFromRaDec, num, parseTsv, round, sig, slug, source, writeLayer } from '../lib.mjs';
import { ensureModuleAssets } from '../../lib/manifest.mjs';

const OPENNGC_COMMIT = 'be3cd6c5498806a2fbb2f7e0452ef802dbb02be0';
const OPENNGC = `https://raw.githubusercontent.com/mattiaverga/OpenNGC/${OPENNGC_COMMIT}/database_files`;
const MAX_BYTES = 3_000_000;
const HEADER = 16;
const BYTES_PER_STAR = 8;
const R = 'J/A+A/673/A114';

const HR23 = {
  cite: 'Hunt & Reffert 2023, A&A 673, A114 (Improving the open cluster census. II.), VizieR J/A+A/673/A114',
  url: 'https://doi.org/10.1051/0004-6361/202346285',
  license: 'CC-BY-4.0',
};
const HR24 = {
  cite: 'Hunt & Reffert 2024, A&A 686, A42 (Improving the open cluster census. III.), VizieR J/A+A/686/A42',
  url: 'https://doi.org/10.1051/0004-6361/202348662',
  license: 'CC-BY-4.0',
};
const ONGC = {
  cite: `OpenNGC (Mattia Verga), commit ${OPENNGC_COMMIT.slice(0, 10)}, NGC.csv and addendum.csv`,
  url: 'https://github.com/mattiaverga/OpenNGC',
  license: 'CC-BY-SA-4.0',
};
const HYG = {
  cite: 'HYG Database v4.1, David Nash (astronexus)',
  url: 'https://www.astronexus.com/projects/hyg',
  license: 'CC-BY-SA-4.0',
};

const SRC = {
  clusters: {
    group: 'clusters',
    id: 'hr23_clusters',
    ...HR23,
    attribution: 'Hunt, E. L. & Reffert, S. 2023, A&A 673, A114; data from CDS/VizieR',
    fetch: {
      kind: 'vizier',
      table: `${R}/clusters`,
      columns:
        'Name,ID,AllNames,Type,CST,N,RA_ICRS,DE_ICRS,r50pc,rcpc,rtpc,dist16,dist50,dist84,logAge50,AV50,CMDCl50',
    },
    outputs: ['data/milkyway/atlas/open-clusters.json', 'data/milkyway/atlas/cluster-stars.bin'],
  },
  members: {
    group: 'clusters',
    id: 'hr23_members',
    ...HR23,
    attribution: 'Hunt, E. L. & Reffert, S. 2023, A&A 673, A114; data from CDS/VizieR',
    fetch: {
      kind: 'vizier',
      table: `${R}/members`,
      columns: 'Name,Prob,RA_ICRS,DE_ICRS,pmRA,pmDE,Gmag,BP-RP',
    },
    outputs: ['data/milkyway/atlas/open-clusters.json', 'data/milkyway/atlas/cluster-stars.bin'],
  },
  mass: {
    group: 'clusters',
    id: 'hr24_clusters',
    ...HR24,
    attribution: 'Hunt, E. L. & Reffert, S. 2024, A&A 686, A42; data from CDS/VizieR',
    fetch: { kind: 'vizier', table: 'J/A+A/686/A42/clusters', columns: 'Name,ID,MassTot,e_MassTot' },
    outputs: ['data/milkyway/atlas/open-clusters.json'],
  },
  ngc: {
    group: 'clusters',
    id: 'openngc_ngc',
    ...ONGC,
    fetch: {
      kind: 'file',
      url: `${OPENNGC}/NGC.csv`,
      file: `openngc_NGC_${OPENNGC_COMMIT.slice(0, 10)}.csv`,
    },
    outputs: ['data/milkyway/atlas/open-clusters.json'],
  },
  addendum: {
    group: 'clusters',
    id: 'openngc_addendum',
    ...ONGC,
    fetch: {
      kind: 'file',
      url: `${OPENNGC}/addendum.csv`,
      file: `openngc_addendum_${OPENNGC_COMMIT.slice(0, 10)}.csv`,
    },
    outputs: ['data/milkyway/atlas/open-clusters.json'],
  },
};

// ---------------------------------------------------------------------------------------------
// Name matching against OpenNGC
// ---------------------------------------------------------------------------------------------
/** 'Melotte_22' / 'Mel 022' / 'NGC2632' -> 'mel22' / 'mel22' / 'ngc2632'. */
function key(s) {
  let t = String(s)
    .toLowerCase()
    .replace(/[\s_\-]+/g, '');
  t = t
    .replace(/^melotte/, 'mel')
    .replace(/^collinder/, 'cr')
    .replace(/^cl(?=\d)/, 'cl');
  return t.replace(/^([a-z]+)0+(?=\d)/, '$1');
}
function readOpenNgc() {
  const entries = [];
  for (const s of [SRC.ngc, SRC.addendum]) {
    const lines = readFileSync(source(s), 'utf8').split('\n').filter(Boolean);
    const head = lines[0].split(';');
    const ix = Object.fromEntries(head.map((h, i) => [h, i]));
    for (const line of lines.slice(1)) {
      const c = line.split(';');
      if (!['OCl', 'Cl+N', '*Ass'].includes(c[ix.Type])) continue;
      const m = num(c[ix.M]);
      const common = (c[ix['Common names']] ?? '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
      const names = [c[ix.Name], ...(c[ix.Identifiers] ?? '').split(',')]
        .map((v) => v.trim())
        .filter(Boolean);
      const ngc = num(c[ix.NGC]);
      const ic = num(c[ix.IC]);
      if (ngc) names.push(`NGC${ngc}`);
      if (ic) names.push(`IC${ic}`);
      entries.push({
        name: c[ix.Name],
        messier: m && m > 0 ? m : null,
        common,
        keys: new Set(names.map(key)),
      });
    }
  }
  const byKey = new Map();
  for (const e of entries) for (const k of e.keys) if (!byKey.has(k)) byKey.set(k, e);
  return byKey;
}

// ---------------------------------------------------------------------------------------------
// HYG
// ---------------------------------------------------------------------------------------------
async function readHyg() {
  const paths = await ensureModuleAssets('stars', { ids: ['hyg_v41'] });
  const path = paths.get('hyg_v41');
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  const head = lines[0].split(',').map((h) => h.replace(/"/g, ''));
  const ix = Object.fromEntries(head.map((h, i) => [h, i]));
  const out = [];
  for (const line of lines.slice(1)) {
    const c = line.split(',');
    const ra = num(c[ix.ra]);
    const dec = num(c[ix.dec]);
    const mag = num(c[ix.mag]);
    if (ra === null || dec === null || mag === null || (num(c[ix.dist]) === 0 && c[ix.proper] === 'Sol'))
      continue;
    out.push({ ra: ra * 15, dec, mag });
  }
  out.sort((a, b) => a.dec - b.dec);
  return {
    decs: Float64Array.from(out, (s) => s.dec),
    ras: Float64Array.from(out, (s) => s.ra),
    mags: Float64Array.from(out, (s) => s.mag),
  };
}
const ARCSEC = 1 / 3600;
function inHyg(h, ra, dec, g) {
  let lo = 0;
  let hi = h.decs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (h.decs[mid] < dec - 2 * ARCSEC) lo = mid + 1;
    else hi = mid;
  }
  const cd = Math.cos(dec * DEG);
  for (let i = lo; i < h.decs.length && h.decs[i] <= dec + 2 * ARCSEC; i++) {
    let dra = Math.abs(h.ras[i] - ra);
    if (dra > 180) dra = 360 - dra;
    if (Math.hypot(dra * cd, h.decs[i] - dec) <= 2 * ARCSEC && Math.abs(g - h.mags[i]) < 1.5) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
export default async function build() {
  const cl = parseTsv(readFileSync(source(SRC.clusters), 'utf8')).rows;
  const massRows = parseTsv(readFileSync(source(SRC.mass), 'utf8')).rows;
  const mass = new Map(massRows.map((r) => [r.Name.trim(), r]));
  const ongc = readOpenNgc();

  // 1. Rows ---------------------------------------------------------------------------------
  let skippedGlobular = 0;
  let skippedOtherType = 0;
  const rejected = { distance: 0, position: 0, age: 0, extinction: 0, radius: 0, mass: 0 };
  const cand = []; // { r: HR row, d: dist50, ... }
  for (const r of cl) {
    if (r.Type === 'g') {
      skippedGlobular++;
      continue;
    }
    if (r.Type !== 'o' && r.Type !== 'm') {
      skippedOtherType++;
      continue;
    }
    const d = num(r.dist50);
    const ra = num(r.RA_ICRS);
    const dec = num(r.DE_ICRS);
    if (ra === null || dec === null || ra < 0 || ra >= 360 || dec < -90 || dec > 90) {
      rejected.position++;
      continue;
    }
    if (!(d >= 20 && d <= 20000)) {
      rejected.distance++;
      continue;
    }
    cand.push({ r, d, ra, dec });
  }

  // OpenNGC claims: one OpenNGC entry names at most one cluster (direct name match first, then most members).
  const claims = new Map();
  for (const c of cand) {
    const names = [c.r.Name, ...c.r.AllNames.split(',')];
    for (let i = 0; i < names.length; i++) {
      const e = ongc.get(key(names[i]));
      if (!e) continue;
      const score = (i === 0 ? 1e9 : 0) + (num(c.r.N) ?? 0);
      const prev = claims.get(e);
      if (!prev || score > prev.score) claims.set(e, { c, score });
      break;
    }
  }
  for (const [e, { c }] of claims) c.ongc = e;

  const rowIndex = new Map(); // HR Name -> row index
  const rows = [];
  const ids = new Set();
  const meta = []; // per row: { d, ra, dec }
  let ranks = [0, 0, 0, 0];
  for (const c of cand) {
    const r = c.r;
    const catName = r.Name.replace(/_+/g, ' ');
    let id = slug(r.Name);
    if (ids.has(id)) id = `${id}-${r.ID.trim()}`;
    ids.add(id);
    const e = c.ongc;
    // Display name: a common name of the cluster itself (OpenNGC lists nebula names for objects
    // that are a cluster with nebulosity, and names in other languages; those stay aliases),
    // else the Messier number, else the catalogue name.
    const usable = e ? e.common.filter((n) => !/Nebula|Cloud|^the |^Amas /i.test(n)) : [];
    const common = usable.find((n) => /Cluster|Box/i.test(n)) ?? usable[0] ?? (e?.messier ? `M ${e.messier}` : null);
    const aliases = [];
    const add = (a) => {
      const t = String(a).replace(/_+/g, ' ').trim();
      if (t && t !== (common ?? catName) && !aliases.includes(t)) aliases.push(t);
    };
    if (e?.messier) {
      add(`M ${e.messier}`);
      add(`M${e.messier}`);
    }
    if (common) add(catName);
    if (e) for (const cn of e.common) add(cn);
    for (const a of r.AllNames.split(',')) add(a);
    const N = num(r.N);
    const quality = (num(r.CST) ?? 0) > 5 && (num(r.CMDCl50) ?? 0) > 0.5;
    const designated = /^(NGC|IC|Melotte|Collinder)_/.test(r.Name);
    const rank = e?.messier || common ? 3 : designated && N >= 200 ? 2 : quality ? 1 : 0;
    ranks[rank]++;
    const [x, y, z] = icrsFromRaDec(c.ra, c.dec, c.d);
    const logAge = num(r.logAge50);
    let age = null;
    if (logAge !== null) {
      if (logAge >= 5 && logAge <= 10.5) age = sig(10 ** (logAge - 6), 3);
      else rejected.age++;
    }
    let av = num(r.AV50);
    if (av !== null && !(av >= 0 && av <= 20)) {
      rejected.extinction++;
      av = null;
    }
    const rad = (v) => {
      const t = num(v);
      if (t === null) return null;
      if (!(t > 0 && t < 2000)) {
        rejected.radius++;
        return null;
      }
      return round(t, 3);
    };
    const m = mass.get(r.Name.trim());
    let mt = num(m?.MassTot);
    if (mt !== null && !(mt > 0 && mt < 1e7)) {
      rejected.mass++;
      mt = null;
    }
    rowIndex.set(r.Name.trim(), rows.length);
    meta.push({ d: c.d, ra: c.ra, dec: c.dec });
    rows.push([
      id,
      common ?? catName,
      aliases.slice(0, 6),
      round(x, 2),
      round(y, 2),
      round(z, 2),
      rad(r.r50pc),
      rank,
      r.Type === 'o' ? 'open cluster' : 'moving group',
      N,
      round(c.d, 1),
      round(num(r.dist16), 1),
      round(num(r.dist84), 1),
      age,
      av === null ? null : round(av, 2),
      rad(r.rcpc),
      rad(r.rtpc),
      mt === null ? null : sig(mt, 3),
      quality ? 'yes' : 'no',
      null, // gMag
      null, // rMem
      0, // nStars
    ]);
  }
  const COL = { gMag: 19, rMem: 20, nStars: 21 };

  // 2. Members ------------------------------------------------------------------------------
  const hyg = await readHyg();
  const text = readFileSync(source(SRC.members), 'utf8');
  const lines = text.split('\n');
  const head = lines[0].split('\t').map((h) => h.trim());
  const ix = Object.fromEntries(head.map((h, i) => [h, i]));
  const flux = new Float64Array(rows.length);
  const stars = []; // { c, g, bp, dRa, dDec } (radians)
  let nMembers = 0;
  let hygMatched = 0;
  let badGmag = 0;
  let nCandidates = 0;
  const dRaWrap = (a) => {
    let v = a * DEG;
    while (v > Math.PI) v -= 2 * Math.PI;
    while (v < -Math.PI) v += 2 * Math.PI;
    return v;
  };
  for (let i = 3; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const c = line.split('\t');
    const ci = rowIndex.get(c[ix.Name].trim());
    if (ci === undefined) continue;
    nMembers++;
    const g = num(c[ix.Gmag]);
    if (g === null) continue;
    if (!(g > 0 && g < 25)) {
      badGmag++;
      continue;
    }
    flux[ci] += 10 ** (-0.4 * g);
    const prob = num(c[ix.Prob]);
    const ra = num(c[ix.RA_ICRS]);
    const dec = num(c[ix.DE_ICRS]);
    if (!(prob >= 0.5) || ra === null || dec === null) continue;
    nCandidates++;
    // Gaia epoch 2016.0 -> 2000.0 with the proper motion (pmRA already contains cos Dec).
    const pmra = num(c[ix.pmRA]) ?? 0;
    const pmde = num(c[ix.pmDE]) ?? 0;
    const dec0 = dec - (pmde * 16) / 3.6e6;
    const ra0 = ra - (pmra * 16) / 3.6e6 / Math.max(Math.cos(dec * DEG), 1e-6);
    if (inHyg(hyg, ((ra0 % 360) + 360) % 360, dec0, g)) {
      hygMatched++;
      continue;
    }
    const m = meta[ci];
    stars.push({
      c: ci,
      g,
      bp: num(c[ix['BP-RP']]),
      dRa: dRaWrap(ra - m.ra) * Math.cos(m.dec * DEG),
      dDec: (dec - m.dec) * DEG,
    });
  }
  console.log(
    `  members: ${nMembers} in kept clusters, ${nCandidates} with Prob >= 0.5, ${hygMatched} matched to HYG`,
  );

  // 3. Choose K and write the binary file -----------------------------------------------------
  stars.sort((a, b) => a.c - b.c || a.g - b.g);
  const perCluster = new Int32Array(rows.length);
  for (const s of stars) perCluster[s.c]++;
  const total = (K) => perCluster.reduce((t, n) => t + Math.min(n, K), 0);
  let K = 1;
  while (HEADER + BYTES_PER_STAR * total(K + 1) <= MAX_BYTES && K < 1e6) K++;
  const kept = [];
  const seen = new Int32Array(rows.length);
  for (const s of stars) if (seen[s.c]++ < K) kept.push(s);
  // rMem in pc: largest |component| of the kept members, with the cluster distance
  const rMemPc = new Float64Array(rows.length);
  for (const s of kept) {
    const d = meta[s.c].d;
    rMemPc[s.c] = Math.max(rMemPc[s.c], Math.abs(s.dRa) * d, Math.abs(s.dDec) * d);
  }
  // Stored value: rounded up to 0.001 pc, so the app's scale is never below the true extent.
  for (let i = 0; i < rMemPc.length; i++) rMemPc[i] = Math.ceil(rMemPc[i] * 1000) / 1000;
  const N = kept.length;
  const buf = Buffer.alloc(HEADER + N * BYTES_PER_STAR);
  buf.writeUInt32LE(0x5343574d, 0);
  buf.writeUInt32LE(1, 4);
  buf.writeUInt32LE(N, 8);
  buf.writeUInt32LE(0, 12);
  const oC = HEADER;
  const oDx = oC + 2 * N;
  const oDy = oDx + 2 * N;
  const oG = oDy + 2 * N;
  const oCol = oG + N;
  kept.forEach((s, i) => {
    const d = meta[s.c].d;
    const rm = rMemPc[s.c];
    buf.writeUInt16LE(s.c, oC + 2 * i);
    buf.writeInt16LE(Math.round(((s.dRa * d) / rm) * 32767), oDx + 2 * i);
    buf.writeInt16LE(Math.round(((s.dDec * d) / rm) * 32767), oDy + 2 * i);
    buf.writeUInt8(Math.max(0, Math.min(255, Math.round(s.g / 0.08))), oG + i);
    buf.writeUInt8(
      s.bp === null ? 255 : Math.max(0, Math.min(254, Math.round((s.bp + 0.6) / 0.02))),
      oCol + i,
    );
  });
  const binPath = join(OUT_DIR, 'cluster-stars.bin');
  writeFileSync(binPath, buf);

  // 4. Fill the remaining columns and write the layer -------------------------------------------
  const counts = new Int32Array(rows.length);
  for (const s of kept) counts[s.c]++;
  rows.forEach((row, i) => {
    row[COL.gMag] = flux[i] > 0 ? round(-2.5 * Math.log10(flux[i]), 2) : null;
    row[COL.rMem] = rMemPc[i] > 0 ? rMemPc[i] : null;
    row[COL.nStars] = counts[i];
  });
  const out = writeLayer({
    layer: 'open-clusters',
    title: 'Open clusters',
    noun: 'Open cluster',
    radius: 'Radius containing half of the catalogued members (r50)',
    sources: { hr23: HR23, hr24: HR24, openngc: ONGC, hyg: HYG },
    columns: [
      { key: 'id' },
      { key: 'name' },
      { key: 'aliases' },
      { key: 'x', source: 'hr23' },
      { key: 'y' },
      { key: 'z' },
      { key: 'r' },
      { key: 'rank' },
      { key: 'kind', label: 'Kind', source: 'hr23' },
      { key: 'members', label: 'Catalogued members', source: 'hr23' },
      { key: 'dist', label: 'Distance (median)', unit: 'pc', source: 'hr23' },
      { key: 'distLo', label: 'Distance, lower bound (16th percentile)', unit: 'pc', source: 'hr23' },
      { key: 'distHi', label: 'Distance, upper bound (84th percentile)', unit: 'pc', source: 'hr23' },
      { key: 'age', label: 'Age', unit: 'Myr', source: 'hr23', approximate: true },
      { key: 'av', label: 'Extinction A_V', unit: 'mag', source: 'hr23' },
      { key: 'rCore', label: 'Core radius', unit: 'pc', source: 'hr23' },
      { key: 'rTidal', label: 'Tidal radius', unit: 'pc', source: 'hr23' },
      { key: 'mass', label: 'Total mass', unit: 'Msun', source: 'hr24', approximate: true },
      {
        key: 'quality',
        label: 'Passes the catalogue quality cuts (CST > 5 and CMDCl50 > 0.5)',
        source: 'hr23',
      },
      {
        key: 'gMag',
        label: 'Integrated apparent G magnitude (sum over catalogued members)',
        unit: 'mag',
        source: 'hr23',
        approximate: true,
      },
      {
        key: 'rMem',
        label: 'Radius of the plotted member stars (largest sky offset component)',
        unit: 'pc',
        source: 'hr23',
      },
      {
        key: 'nStars',
        label: 'Member stars plotted (brightest members not in the HYG catalogue)',
        source: 'hyg',
      },
    ],
    rows,
  });

  // 5. Self-check -------------------------------------------------------------------------------
  const chk = readFileSync(binPath);
  const fail = (m) => {
    throw new Error(`cluster-stars.bin self-check: ${m}`);
  };
  if (chk.readUInt32LE(0) !== 0x5343574d || chk.readUInt32LE(4) !== 1) fail('bad header');
  const n = chk.readUInt32LE(8);
  if (n !== N || chk.length !== HEADER + n * BYTES_PER_STAR) fail('count or size mismatch');
  if (chk.length > MAX_BYTES) fail('file too large');
  let prevC = -1;
  let prevG = -1;
  for (let i = 0; i < n; i++) {
    const c = chk.readUInt16LE(HEADER + 2 * i);
    if (c >= rows.length) fail(`cluster index ${c} out of range at ${i}`);
    const gm = chk.readUInt8(oG + i);
    if (c < prevC || (c === prevC && gm < prevG)) fail(`sort order broken at ${i}`);
    prevC = c;
    prevG = gm;
  }
  const json = JSON.parse(readFileSync(out.path, 'utf8'));
  if (json.rows.reduce((t, r) => t + r[COL.nStars], 0) !== n) fail('nStars column does not sum to count');

  // 6. Report -------------------------------------------------------------------------------------
  const find = (nm) => json.rows.find((r) => r[1] === nm) ?? json.rows.find((r) => r[2].includes(nm));
  const show = (nm) => {
    const r = find(nm);
    if (!r) return console.log(`  check ${nm}: NOT FOUND`);
    const ra = (((Math.atan2(r[4], r[3]) / DEG) % 360) + 360) % 360;
    const dec = Math.asin(r[5] / Math.hypot(r[3], r[4], r[5])) / DEG;
    console.log(
      `  check ${nm}: ${r[1]} dist ${r[10]} pc, RA ${ra.toFixed(2)} Dec ${dec.toFixed(2)}, G ${r[COL.gMag]}, nStars ${r[COL.nStars]}`,
    );
  };
  ['Pleiades', 'Hyades', 'M 67', 'M 44', 'NGC 4755'].forEach(show);
  const dmin = Math.min(...rows.map((r) => r[10]));
  const dmax = Math.max(...rows.map((r) => r[10]));
  console.log(`  distance range ${dmin} .. ${dmax} pc`);
  console.log(
    `  rows ${rows.length}; ranks 0..3 = ${ranks.join(', ')}; left out: ${skippedGlobular} globular (Type g), ${skippedOtherType} other types`,
  );
  console.log(`  rejected: ${JSON.stringify(rejected)}; members with bad Gmag ${badGmag}`);
  console.log(
    `  K = ${K}; stars kept ${N}; candidates ${nCandidates}; dropped as HYG matches ${hygMatched}; file ${statSync(binPath).size} bytes`,
  );
  return out;
}
