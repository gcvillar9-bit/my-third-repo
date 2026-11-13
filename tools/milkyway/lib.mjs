/**
 * Shared helpers of the Milky Way atlas build (tools/build-milkyway.mjs and tools/milkyway/*.mjs).
 *
 * EVIDENCE RULE. Every value that ends up in public/data/milkyway/atlas/ comes from a response
 * fetched by this build and recorded as a source (id, citation, URL, licence, sha256). A value
 * that cannot be fetched is left out; an implausible value is rejected and reported.
 *
 * SOURCES. `source(def)` downloads a file (or a VizieR table) into .cache/raw/milkyway/ and
 * verifies its sha256 against tools/milkyway/sources/<group>.json (recorded on the first fetch).
 * VizieR answers carry a date in their header, so the hash is taken over the body without the
 * comment lines. build-milkyway.mjs merges all groups into assets/manifest/milkyway.json as
 * reference entries (no `url` key: `pnpm assets:fetch` does not download them, this build does).
 *
 * OUTPUT. Two kinds of file, both validated by `writeLayer` / `writeFeatures`:
 *
 * 1. Catalogue layer `<layer>.json` (many rows, one source per column):
 *    {
 *      layer: 'open-clusters', title: 'Open clusters', noun: 'Open cluster',
 *      sources: { hr23: { cite, url, license } },
 *      columns: [ { key, label?, unit?, source?, approximate?, digits? } ],
 *      rows: [ [ ... ] ]
 *    }
 *    Reserved column keys (no label, not shown as facts):
 *      id        unique slug inside the layer (lowercase, [a-z0-9-+.]), required
 *      name      display name, required
 *      aliases   string[] (other designations), optional
 *      x, y, z   position in parsecs from the Sun, ICRS axes (x to RA 0 Dec 0, z to Dec +90),
 *                required; the `source` of column x is the source of the position and distance
 *      r         characteristic radius in parsecs (meaning stated in the layer's `radius` text)
 *      rank      integer 0..3, how widely the object is labelled: 3 = famous, labelled from far
 *                away; 2 = well known; 1 = ordinary; 0 = labelled only from very close. Optional.
 *      note      free text shown under the facts (string or null), optional
 *      rowSource per-row citation that overrides or extends the column sources (string or null)
 *    Every other column is a fact: it needs `label` and `source` (a key of `sources`); `unit`,
 *    `approximate` and `digits` are optional. A null cell means "no value" and is not shown.
 *
 * 2. Features `features-<group>.json` (few objects, a source on every fact):
 *    {
 *      group: 'centre', sources: { ... },
 *      features: [ {
 *        id, name, aliases?, type, noun, rank?, x, y, z, r?, positionSource,
 *        facts: [ { label, value, unit?, source, approximate? } ],
 *        description?, shape?: { kind, source, ... }
 *      } ]
 *    }
 *    `type` is a machine-readable class: arm | bar | bulge | disc | halo | bubble | nucleus |
 *    cluster | cloud | remnant | stream | satellite | gas-stream | shell | wave | association |
 *    spur | region. `noun` is the human subtitle. x, y, z is the label anchor (pc from the Sun,
 *    ICRS axes); `positionSource` names the source of that position.
 *    `shape` is geometry for the renderer and carries its own `source`:
 *      { kind: 'polyline', points: [[x, y, z], ...], closed?: boolean }   pc from the Sun, ICRS
 *      { kind: 'sphere' }                                                 radius = feature r
 *      { kind: 'ellipsoid-pair', offsetPc, semiAxesPc: [a, b, c] }        two lobes centred
 *            offsetPc above and below Sgr A* along the Galactic pole; semi-axes along Galactic
 *            X (Sun-centre line), Y and Z, in pc
 *      { kind: 'radial-map', nLon, nLat, radiiPc: number[] }              a closed surface around
 *            the Sun: radius (pc) on a regular Galactic grid, row-major, lat index first:
 *            b = -90 + 180 (i + 0.5) / nLat, l = 360 (j + 0.5) / nLon
 *      { kind: 'log-spiral', betaKinkDeg, rKinkKpc, psiLtDeg, psiGtDeg, widthKpc,
 *            betaMeasuredDeg: [min, max] }                                Reid et al. 2019 eq. 1
 *
 * HAND-ENTERED VALUES (features). Keep them in tools/milkyway/features/<group>.json, each with
 * `evidence: { source: <source id>, quote: '<text copied from the fetched page>' }`. The builder
 * calls `checkQuote` for each one, so a value that is not on the fetched page fails the build.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { CACHE_RAW, PUBLIC, ROOT, curlDownload } from '../lib/fetch.mjs';

export const CACHE = join(CACHE_RAW, 'milkyway');
export const OUT_DIR = join(PUBLIC, 'data', 'milkyway', 'atlas');
export const SOURCES_DIR = join(ROOT, 'tools', 'milkyway', 'sources');
export const VIZIER = 'https://vizier.cfa.harvard.edu/viz-bin/asu-tsv';

export const DEG = Math.PI / 180;
export const PC_PER_KPC = 1000;
export const round = (v, d = 3) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);
/** Rounds to `n` significant digits. */
export const sig = (v, n = 4) => (Number.isFinite(v) && v !== 0 ? Number(v.toPrecision(n)) : v === 0 ? 0 : null);
/** Number or null from a catalogue cell ('' and non-numeric text give null). */
export const num = (s) => {
  if (s === null || s === undefined) return null;
  const t = String(s).trim();
  if (t === '') return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};
export const slug = (name) =>
  String(name)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9+.]+/g, '-')
    .replace(/^-+|-+$/g, '');

// ---------------------------------------------------------------------------------------
// Coordinates. ICRS -> Galactic rotation (Hipparcos Vol. 1, eq. 1.5.11), row-major; the unit
// test cross-checks it against src/core/frames.ts.
// ---------------------------------------------------------------------------------------
export const ICRS_TO_GALACTIC = [
  -0.0548755604162154, -0.8734370902348850, -0.4838350155487132, 0.4941094278755837, -0.4448296299600112,
  0.7469822444972189, -0.8676661490190047, -0.1980763734312015, 0.4559837761750669,
];
const G = ICRS_TO_GALACTIC;
/** [x, y, z] ICRS from Galactic Cartesian (X to l = 0, Y to l = 90, Z to b = +90). */
export const icrsFromGalacticXyz = (X, Y, Z) => [
  G[0] * X + G[3] * Y + G[6] * Z,
  G[1] * X + G[4] * Y + G[7] * Z,
  G[2] * X + G[5] * Y + G[8] * Z,
];
export const galacticXyzFromIcrs = (x, y, z) => [
  G[0] * x + G[1] * y + G[2] * z,
  G[3] * x + G[4] * y + G[5] * z,
  G[6] * x + G[7] * y + G[8] * z,
];
/** Heliocentric ICRS position (pc) from RA/Dec in degrees and a distance in pc. */
export const icrsFromRaDec = (raDeg, decDeg, distPc) => {
  const a = raDeg * DEG;
  const d = decDeg * DEG;
  return [distPc * Math.cos(d) * Math.cos(a), distPc * Math.cos(d) * Math.sin(a), distPc * Math.sin(d)];
};
/** Heliocentric ICRS position (pc) from Galactic l, b in degrees and a distance in pc. */
export const icrsFromLb = (lDeg, bDeg, distPc) => {
  const l = lDeg * DEG;
  const b = bDeg * DEG;
  return icrsFromGalacticXyz(
    distPc * Math.cos(b) * Math.cos(l),
    distPc * Math.cos(b) * Math.sin(l),
    distPc * Math.sin(b),
  );
};
/** { l, b } in degrees and dist (pc) of a heliocentric ICRS position. */
export const lbFromIcrs = (x, y, z) => {
  const [X, Y, Z] = galacticXyzFromIcrs(x, y, z);
  const dist = Math.hypot(X, Y, Z);
  return { l: ((Math.atan2(Y, X) / DEG) % 360 + 360) % 360, b: Math.asin(Z / dist) / DEG, dist };
};
/** { ra, dec } in degrees and dist (pc) of a heliocentric ICRS position. */
export const raDecFromIcrs = (x, y, z) => {
  const dist = Math.hypot(x, y, z);
  return { ra: ((Math.atan2(y, x) / DEG) % 360 + 360) % 360, dec: Math.asin(z / dist) / DEG, dist };
};
/** 'hh mm ss.s' or 'hh:mm:ss.s' -> degrees. */
export const hmsToDeg = (s) => {
  const p = String(s).trim().split(/[\s:]+/).map(Number);
  return 15 * ((p[0] || 0) + (p[1] || 0) / 60 + (p[2] || 0) / 3600);
};
/** '+dd mm ss' or '-dd:mm:ss' -> degrees. */
export const dmsToDeg = (s) => {
  const t = String(s).trim();
  const p = t.replace(/^[+-]/, '').split(/[\s:]+/).map(Number);
  return (t.startsWith('-') ? -1 : 1) * ((p[0] || 0) + (p[1] || 0) / 60 + (p[2] || 0) / 3600);
};

// ---------------------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------------------
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const groups = new Map();
const UPDATE = process.argv.includes('--update-sources');

function loadGroup(group) {
  if (!groups.has(group)) {
    const p = join(SOURCES_DIR, `${group}.json`);
    groups.set(group, existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : { group, sources: [] });
  }
  return groups.get(group);
}
function saveGroup(group) {
  mkdirSync(SOURCES_DIR, { recursive: true });
  writeFileSync(join(SOURCES_DIR, `${group}.json`), JSON.stringify(groups.get(group), null, 2) + '\n');
}
/** Every recorded source of every group (for the manifest and the tests). */
export function allSources() {
  if (!existsSync(SOURCES_DIR)) return [];
  return readdirSync(SOURCES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .flatMap((f) => JSON.parse(readFileSync(join(SOURCES_DIR, f), 'utf8')).sources);
}

function vizierUrl({ table, columns = '**', constraints = '' }) {
  const out = columns === '**' ? '-out.all' : `-out=${encodeURIComponent(columns)}`;
  return `${VIZIER}?-source=${encodeURIComponent(table)}&${out}&-out.max=unlimited&-oc.form=dec${constraints ? `&${constraints}` : ''}`;
}

/**
 * Makes a source available locally and returns its path.
 *   def = { group, id, cite, url (landing page or DOI), license, attribution?,
 *           fetch: { kind: 'file', url, file? } | { kind: 'vizier', table, columns?, constraints? },
 *           outputs?: string[] }
 * `license` is an SPDX id, or 'cited (no explicit licence)' for data that is free to use with
 * citation. The first fetch records sha256 and bytes in tools/milkyway/sources/<group>.json; later
 * fetches must match (pass --update-sources to accept an upstream change).
 */
export function source(def) {
  for (const k of ['group', 'id', 'cite', 'url', 'license', 'fetch'])
    if (!def[k]) throw new Error(`source ${def.id ?? '?'}: missing ${k}`);
  const g = loadGroup(def.group);
  let rec = g.sources.find((s) => s.id === def.id);
  const fetchUrl = def.fetch.kind === 'vizier' ? vizierUrl(def.fetch) : def.fetch.url;
  const file = def.fetch.file ?? (def.fetch.kind === 'vizier' ? `${def.id}.tsv` : decodeURIComponent(new URL(fetchUrl).pathname.split('/').pop()));
  const dest = join(CACHE, file);
  if (!existsSync(dest)) {
    console.log(`  fetch ${def.id}: ${fetchUrl}`);
    if (def.fetch.kind === 'vizier') {
      let ok = false;
      for (let attempt = 0; attempt < 4 && !ok; attempt++) {
        const tmp = `${dest}.raw`;
        try {
          curlDownload(fetchUrl, tmp);
        } catch (e) {
          if (attempt === 3) throw e;
          continue;
        }
        const body = readFileSync(tmp, 'utf8')
          .split('\n')
          .filter((l) => l.trim() !== '' && !l.startsWith('#'))
          .join('\n');
        // A valid answer has a header line, a units line and a line of dashes.
        if (/^-+(\t-+)*$/m.test(body.split('\n')[2] ?? '')) {
          writeFileSync(dest, body + '\n');
          ok = true;
        }
      }
      if (!ok) throw new Error(`source ${def.id}: VizieR did not return a table for ${fetchUrl}`);
    } else curlDownload(fetchUrl, dest);
  }
  const buf = readFileSync(dest);
  const sha = sha256(buf);
  if (rec?.sha256 && rec.sha256 !== sha && !UPDATE)
    throw new Error(`source ${def.id}: sha256 changed upstream (${rec.sha256.slice(0, 12)} -> ${sha.slice(0, 12)}); check the data, then pass --update-sources`);
  const next = {
    id: def.id,
    cite: def.cite,
    url: def.url,
    fetchUrl,
    license: def.license,
    attribution: def.attribution ?? def.cite,
    sha256: sha,
    bytes: buf.length,
    outputs: def.outputs ?? rec?.outputs ?? [],
  };
  if (JSON.stringify(rec) !== JSON.stringify(next)) {
    if (rec) g.sources[g.sources.indexOf(rec)] = next;
    else g.sources.push(next);
    saveGroup(def.group);
  }
  return dest;
}

/** Parses a tab-separated table with a header line (and optional units and dashes lines). */
export function parseTsv(text) {
  const lines = text.split('\n').filter((l) => l.trim() !== '' && !l.startsWith('#'));
  const header = lines[0].split('\t').map((s) => s.trim());
  let start = 1;
  if (/^-+(\t-+)*\s*$/.test(lines[2] ?? '')) start = 3;
  const rows = [];
  for (let i = start; i < lines.length; i++) {
    const cells = lines[i].split('\t');
    const row = {};
    for (let c = 0; c < header.length; c++) row[header[c]] = (cells[c] ?? '').trim();
    rows.push(row);
  }
  return { header, rows };
}
/** Fetches a VizieR table as an array of { column: text } rows. */
export const vizier = (def) => parseTsv(readFileSync(source(def), 'utf8')).rows;

/**
 * Plain text of a fetched HTML or PDF source: tags and MathML annotations removed, entities
 * decoded, all whitespace collapsed to single spaces. Use it to read values from papers.
 */
export function pageText(def) {
  const path = source(def);
  if (path.toLowerCase().endsWith('.pdf')) return run('pdftotext', ['-layout', path, '-']).replace(/\s+/g, ' ');
  return readFileSync(path, 'utf8')
    .replace(/<annotation[^>]*>[\s\S]*?<\/annotation>/g, ' ')
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/[\u2009\u200a\u200b\u2061-\u2064\u00a0]/g, ' ')
    .replace(/\s+/g, ' ');
}
const pages = new Map();
/**
 * Throws unless `quote` (whitespace-insensitive) occurs in the fetched page of source `def`.
 * This is the evidence check of every hand-entered value.
 */
export function checkQuote(def, quote) {
  if (!pages.has(def.id)) pages.set(def.id, pageText(def).replace(/\s+/g, ''));
  const q = String(quote).replace(/\s+/g, '');
  if (q.length < 6) throw new Error(`evidence quote for ${def.id} is too short: "${quote}"`);
  if (!pages.get(def.id).includes(q)) throw new Error(`evidence quote not found in ${def.id}: "${quote}"`);
  return true;
}

/** Runs a command and returns stdout (for tar, unzip and Python FITS readers). */
export const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 30, ...opts });

// ---------------------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------------------
const RESERVED = new Set(['id', 'name', 'aliases', 'x', 'y', 'z', 'r', 'rank', 'note', 'rowSource']);
const ID_RE = /^[a-z0-9][a-z0-9+.-]*$/;

/** Throws on a schema violation of a catalogue layer; returns short statistics. */
export function validateLayer(file) {
  const fail = (m) => {
    throw new Error(`layer ${file.layer}: ${m}`);
  };
  for (const k of ['layer', 'title', 'noun', 'sources', 'columns', 'rows']) if (!file[k]) fail(`missing ${k}`);
  const keys = file.columns.map((c) => c.key);
  for (const k of ['id', 'name', 'x', 'y', 'z']) if (!keys.includes(k)) fail(`missing column ${k}`);
  if (new Set(keys).size !== keys.length) fail('duplicate column keys');
  for (const c of file.columns) {
    if (c.key === 'x' && !file.sources[c.source]) fail('column x needs a source (the position source)');
    if (RESERVED.has(c.key)) continue;
    if (!c.label) fail(`fact column ${c.key} needs a label`);
    if (!file.sources[c.source]) fail(`fact column ${c.key} needs a source listed in sources`);
  }
  for (const [k, s] of Object.entries(file.sources))
    for (const f of ['cite', 'url', 'license']) if (!s[f]) fail(`source ${k} misses ${f}`);
  const ids = new Set();
  const ix = Object.fromEntries(keys.map((k, i) => [k, i]));
  for (const row of file.rows) {
    if (row.length !== keys.length) fail(`row ${row[ix.id]} has ${row.length} cells, expected ${keys.length}`);
    const id = row[ix.id];
    if (typeof id !== 'string' || !ID_RE.test(id)) fail(`bad id ${JSON.stringify(id)}`);
    if (ids.has(id)) fail(`duplicate id ${id}`);
    ids.add(id);
    if (typeof row[ix.name] !== 'string' || !row[ix.name]) fail(`row ${id} has no name`);
    for (const k of ['x', 'y', 'z']) if (!Number.isFinite(row[ix[k]])) fail(`row ${id} has a non-finite ${k}`);
    for (let c = 0; c < row.length; c++) {
      const v = row[c];
      if (typeof v === 'number' && !Number.isFinite(v)) fail(`row ${id} column ${keys[c]} is not finite`);
      if (v === undefined) fail(`row ${id} column ${keys[c]} is undefined`);
    }
  }
  return { rows: file.rows.length };
}

/** Validates and writes public/data/milkyway/atlas/<layer>.json. Returns { path, bytes, rows }. */
export function writeLayer(file) {
  const { rows } = validateLayer(file);
  mkdirSync(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, `${file.layer}.json`);
  const text = JSON.stringify(file) + '\n';
  writeFileSync(path, text);
  console.log(`  ${file.layer}: ${rows} rows, ${(text.length / 1024).toFixed(0)} KB`);
  return { path, bytes: text.length, rows };
}

/** Throws on a schema violation of a features file. */
export function validateFeatures(file) {
  const fail = (m) => {
    throw new Error(`features ${file.group}: ${m}`);
  };
  for (const k of ['group', 'sources', 'features']) if (!file[k]) fail(`missing ${k}`);
  for (const [k, s] of Object.entries(file.sources))
    for (const f of ['cite', 'url', 'license']) if (!s[f]) fail(`source ${k} misses ${f}`);
  const ids = new Set();
  for (const f of file.features) {
    if (typeof f.id !== 'string' || !ID_RE.test(f.id)) fail(`bad id ${JSON.stringify(f.id)}`);
    if (ids.has(f.id)) fail(`duplicate id ${f.id}`);
    ids.add(f.id);
    if (!f.name || !f.noun || !f.type) fail(`${f.id}: missing name, noun or type`);
    for (const k of ['x', 'y', 'z']) if (!Number.isFinite(f[k])) fail(`${f.id}: non-finite ${k}`);
    if (!file.sources[f.positionSource]) fail(`${f.id}: positionSource is not in sources`);
    for (const fact of f.facts ?? []) {
      if (!fact.label || fact.value === undefined || fact.value === null) fail(`${f.id}: fact without label or value`);
      if (!file.sources[fact.source]) fail(`${f.id}: fact "${fact.label}" has no listed source`);
    }
    if (f.shape && !file.sources[f.shape.source]) fail(`${f.id}: shape has no listed source`);
  }
  return { features: file.features.length };
}

/** Validates and writes public/data/milkyway/atlas/features-<group>.json. */
export function writeFeatures(file) {
  const { features } = validateFeatures(file);
  mkdirSync(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, `features-${file.group}.json`);
  const text = JSON.stringify(file) + '\n';
  writeFileSync(path, text);
  console.log(`  features-${file.group}: ${features} features, ${(text.length / 1024).toFixed(0)} KB`);
  return { path, bytes: text.length, features };
}
