/**
 * Large-scale structure of the Milky Way (atlas group 'structure'): spiral arms (Reid et al. 2019,
 * Table 2, plus the far 3-kpc arm of Dame & Thaddeus 2008), long bar, boxy/peanut bulge, thin and
 * thick disc, warp, flare, stellar halo and the galaxy as a whole.
 *
 * Every hand-entered value lives in structure.json with `evidence: { source, quote }`; the quote is
 * checked against the fetched paper (`checkQuote`) and every number of the value must occur in the
 * quote (`checkNumbers`), unless the fact is marked `derived` (computed here from quoted inputs).
 *
 * This file also exports the helpers and the source list shared by centre.mjs and bubbles.mjs.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEG,
  checkQuote,
  galacticXyzFromIcrs,
  icrsFromGalacticXyz,
  icrsFromLb,
  round,
  sig,
  source,
  writeFeatures,
} from '../lib.mjs';

const LICENSE = 'cited (no explicit licence)';
const OUT = (g) => [`data/milkyway/atlas/features-${g}.json`];
/** A paper read through ar5iv (HTML) or the arXiv PDF; cached as structure-<id>.<ext>. */
const paper = (id, arxiv, cite, { pdf = false, groups = ['structure'] } = {}) => ({
  group: 'structure',
  id,
  cite: `${cite} (arXiv:${arxiv})`,
  url: `https://arxiv.org/abs/${arxiv}`,
  license: LICENSE,
  fetch: pdf
    ? { kind: 'file', url: `https://arxiv.org/pdf/${arxiv}`, file: `structure-${id}.pdf` }
    : { kind: 'file', url: `https://ar5iv.labs.arxiv.org/html/${arxiv}`, file: `structure-${id}.html` },
  outputs: groups.flatMap(OUT),
});

/** SIMBAD identifiers whose ICRS positions the centre group uses (one TAP query). */
export const SIMBAD_IDS = [
  'NAME Arches Cluster',
  'NAME Quintuplet Cluster',
  'NAME Sgr B2',
  'NAME the Brick',
  'NAME Sgr C',
  'NAME Sgr A East',
  'NAME CND',
  'NAME Galactic Center Radio Arc',
];
/** All sources of the three groups (one sources file, tools/milkyway/sources/structure.json). */
export const SOURCES = Object.fromEntries(
  [
    paper('reid2019', '1910.03357', 'Reid et al. 2019, ApJ 885, 131'),
    paper('dame2008', '0807.1752', 'Dame & Thaddeus 2008, ApJ 683, L143'),
    paper('wegg2015', '1504.01401', 'Wegg, Gerhard & Portail 2015, MNRAS 450, 4050'),
    paper('portail2017', '1608.07954', 'Portail et al. 2017, MNRAS'),
    paper('bhg2016', '1602.07702', 'Bland-Hawthorn & Gerhard 2016, ARA&A 54, 529'),
    paper('gravity2019', '1904.05721', 'GRAVITY Collaboration 2019, A&A 625, L10', {
      groups: ['structure', 'centre', 'bubbles'],
    }),
    paper('bennett2019', '1809.03507', 'Bennett & Bovy 2019, MNRAS 482, 1417'),
    paper('chen2019', '1902.00998', 'Chen et al. 2019, Nature Astronomy 3, 320'),
    paper('skowron2019', '1806.10653', 'Skowron et al. 2019, Science 365, 478'),
    paper('lopez2014', '1405.7649', 'López-Corredoira & Molgó 2014, A&A 567, A106'),
    paper('chrobakova2022', '2206.08230', 'Chrobáková et al. 2022, A&A 664, A58'),
    paper('deason2019', '1908.02763', 'Deason, Belokurov & Sanders 2019, MNRAS'),
    paper('schodel2014', '1403.6657', 'Schödel et al. 2014, A&A 566, A47', { groups: ['centre'] }),
    paper('launhardt2002', 'astro-ph/0201294', 'Launhardt, Zylka & Mezger 2002, A&A', { groups: ['centre'] }),
    paper('sormani2022', '2111.12713', 'Sormani et al. 2022, MNRAS', { groups: ['centre'] }),
    paper('henshaw2023', '2203.11223', 'Henshaw et al. 2023, Protostars and Planets VII (review)', {
      groups: ['centre'],
    }),
    paper('kauffmann2017', '1610.03499', 'Kauffmann et al. 2017, A&A 603, A89, Table 1', {
      groups: ['centre'],
    }),
    paper('longmore2012', '1111.3199', 'Longmore et al. 2012, ApJ', { groups: ['centre'] }),
    paper('ginsburg2018', '1801.04941', 'Ginsburg et al. 2018, ApJ', { groups: ['centre'] }),
    paper('maeda2002', 'astro-ph/0102183', 'Maeda et al. 2002, ApJ', { groups: ['centre'] }),
    paper('pare2019', '1909.08268', 'Pare et al. 2019, ApJ', { groups: ['centre'] }),
    paper('hosek2019', '1808.02577', 'Hosek et al. 2019, ApJ', { groups: ['centre'] }),
    paper('hosek2022', '2208.08508', 'Hosek et al. 2022, ApJ', { groups: ['centre'] }),
    paper('clark2018', '1805.10139', 'Clark et al. 2018, A&A 618, A2', { groups: ['centre'] }),
    paper('su2010', '1005.5480', 'Su, Slatyer & Finkbeiner 2010, ApJ 724, 1044', { groups: ['bubbles'] }),
    paper('predehl2020', '2012.05840', 'Predehl et al. 2020, Nature 588, 227', {
      pdf: true,
      groups: ['bubbles'],
    }),
    {
      group: 'structure',
      id: 'simbad_gc',
      cite: 'SIMBAD astronomical database, CDS, Strasbourg (Wenger et al. 2000, A&AS 143, 9): ICRS positions',
      url: 'https://simbad.cds.unistra.fr/simbad/',
      license: LICENSE,
      attribution: 'This research has made use of the SIMBAD database, operated at CDS, Strasbourg, France',
      fetch: {
        kind: 'file',
        url:
          'https://simbad.cfa.harvard.edu/simbad/sim-tap/sync?request=doQuery&lang=adql&format=csv&query=' +
          encodeURIComponent(
            'SELECT i.id, b.main_id, b.ra, b.dec FROM basic AS b JOIN ident AS i ON i.oidref = b.oid WHERE i.id IN (' +
              SIMBAD_IDS.map((id) => `'${id}'`).join(',') +
              ')',
          ).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`),
        file: 'structure-simbad-centre.csv',
      },
      outputs: OUT('centre'),
    },
  ].map((s) => [s.id, s]),
);

/** Reads features/<group>.json (the hand-entered inputs). */
export const readInput = (group) =>
  JSON.parse(readFileSync(join(import.meta.dirname, `${group}.json`), 'utf8'));

// ---------------------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------------------
const norm = (s) => String(s).replace(/\s+/g, '').replace(/[−–]/g, '-').replace(/∘/g, '');
/** Strings under which a number may be printed in a paper (plain, or as a mantissa times 10^k). */
function spellings(v) {
  const out = new Set();
  for (let k = -3; k <= 60; k++) {
    const m = Math.abs(v) / 10 ** k;
    if (m < 1e-3 || m >= 1e5) continue;
    for (let p = 1; p <= 6; p++) out.add(String(Number(m.toPrecision(p))));
  }
  return [...out];
}
/** Throws unless every number in `value` (number, string or array) occurs in `quote`. */
export function checkNumbers(value, quote, where) {
  const q = norm(quote);
  const nums =
    typeof value === 'number'
      ? [value]
      : Array.isArray(value)
        ? value.flat()
        : (String(value).match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  for (const v of nums) {
    if (v === 0 || !Number.isFinite(v)) continue;
    const sp = spellings(v);
    if (!sp.some((s) => q.includes(s)))
      throw new Error(`${where}: value ${v} does not occur in the quote "${quote}"`);
  }
}
/** Checks one `evidence` object and returns its source id. */
export function evidence(ev, where, value) {
  if (!ev?.source || !ev.quote) throw new Error(`${where}: missing evidence`);
  const def = SOURCES[ev.source];
  if (!def) throw new Error(`${where}: unknown source ${ev.source}`);
  checkQuote(def, ev.quote);
  if (value !== undefined) checkNumbers(value, ev.quote, where);
  return ev.source;
}

// ---------------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------------
/** Sgr A* (direction and distance) from the group input: { l, b, distPc }. */
export function galacticCentre(input) {
  const gc = input.galacticCentre;
  evidence(gc.direction.evidence, 'galacticCentre.direction', [
    Math.abs(gc.direction.lQuoted),
    gc.direction.b,
  ]);
  evidence(gc.distance.evidence, 'galacticCentre.distance', gc.distance.pc);
  return {
    l: gc.direction.l,
    b: gc.direction.b,
    distPc: gc.distance.pc,
    source: gc.distance.evidence.source,
  };
}
/** Heliocentric ICRS (pc) of a point given in Galactocentric cylindrical coordinates. Azimuth beta
 * as in Reid et al. 2019: 0 towards the Sun, increasing in the direction of Galactic rotation; z
 * along the Galactic pole; the plane is the Galactic (b = 0) plane through Sgr A*. */
export function icrsFromGalactocentric(gc, rPc, betaDeg, zPc = 0) {
  const [Xg, Yg, Zg] = galacticXyzFromIcrs(...icrsFromLb(gc.l, gc.b, gc.distPc));
  const h = Math.hypot(Xg, Yg);
  const ex = [Xg / h, Yg / h]; // towards the centre
  const ey = [-ex[1], ex[0]]; // towards l = 90 deg at the Sun (direction of rotation)
  const c = Math.cos(betaDeg * DEG);
  const s = Math.sin(betaDeg * DEG);
  const X = Xg - rPc * c * ex[0] + rPc * s * ey[0];
  const Y = Yg - rPc * c * ex[1] + rPc * s * ey[1];
  return icrsFromGalacticXyz(X, Y, Zg + zPc);
}
export const xyz = (p) => ({ x: round(p[0], 1), y: round(p[1], 1), z: round(p[2], 1) });

// ---------------------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------------------
/** Output facts from input facts (each checked). */
export function facts(list, where) {
  return list.map((f) => {
    const w = `${where} "${f.label}"`;
    const src = evidence(f.evidence, w, f.derived ? undefined : f.value);
    const out = { label: f.label, value: f.value };
    if (f.unit) out.unit = f.unit;
    out.source = src;
    if (f.approximate || f.derived) out.approximate = true;
    return out;
  });
}
/** `r` from { value, evidence, derived? }. */
export function radius(r, where) {
  if (!r) return undefined;
  evidence(r.evidence, `${where} r`, r.derived ? undefined : r.value);
  return r.value;
}
/** Common part of a feature (everything but the position). */
export function base(f, where) {
  const out = { id: f.id, name: f.name };
  if (f.aliases?.length) out.aliases = f.aliases;
  out.type = f.type;
  out.noun = f.noun;
  if (f.rank !== undefined) out.rank = f.rank;
  return out;
}
/** Assembles the output file with only the sources that are used. */
export function finish(group, features) {
  const used = new Set();
  for (const f of features) {
    used.add(f.positionSource);
    for (const fact of f.facts) used.add(fact.source);
    if (f.shape) used.add(f.shape.source);
  }
  const sources = {};
  for (const id of [...used].sort()) {
    const s = SOURCES[id];
    if (!s) throw new Error(`${group}: unknown source ${id}`);
    source(s); // records the sha256 (already fetched by the quote checks)
    sources[id] = { cite: s.cite, url: s.url, license: s.license };
  }
  return writeFeatures({ group, sources, features });
}

// ---------------------------------------------------------------------------------------
// Group 'structure'
// ---------------------------------------------------------------------------------------
const PSI_NOTE = 'β ≤ β_kink';
/** Facts and shape of one Reid et al. 2019 Table 2 row. */
function arm(f, gc) {
  const t = f.table;
  const where = `structure/${f.id}`;
  // Every number of the row must be in the quoted row of Table 2.
  const src = evidence(t.evidence, where, [
    t.n,
    t.betaKinkDeg,
    t.rKinkKpc,
    Math.abs(t.psiLtDeg),
    Math.abs(t.psiGtDeg),
    t.widthKpc,
    t.betaMeasuredDeg.map(Math.abs),
    t.tangencyDeg ?? 0,
  ]);
  const out = { ...base(f) };
  const p = icrsFromGalactocentric(gc, t.rKinkKpc * 1000, t.betaKinkDeg);
  Object.assign(out, xyz(p), { positionSource: src });
  const fl = [];
  if (t.psiLtDeg === t.psiGtDeg) fl.push({ label: 'Pitch angle', value: t.psiLtDeg, unit: '°', source: src });
  else
    fl.push(
      { label: `Pitch angle inside the kink (${PSI_NOTE})`, value: t.psiLtDeg, unit: '°', source: src },
      { label: 'Pitch angle beyond the kink (β > β_kink)', value: t.psiGtDeg, unit: '°', source: src },
    );
  fl.push(
    { label: 'Galactocentric radius at the kink', value: t.rKinkKpc, unit: 'kpc', source: src },
    { label: 'Azimuth of the kink (β, 0 towards the Sun)', value: t.betaKinkDeg, unit: '°', source: src },
    { label: 'Arm width (Gaussian 1σ at the kink radius)', value: t.widthKpc, unit: 'kpc', source: src },
    {
      label: 'Azimuth range of the parallax data (β)',
      value: `${t.betaMeasuredDeg[0]} to ${t.betaMeasuredDeg[1]}`,
      unit: '°',
      source: src,
    },
    { label: 'Massive young stars with parallaxes assigned', value: t.n, source: src },
  );
  if (t.tangencyDeg)
    fl.push({ label: 'Tangency longitude (fourth quadrant)', value: t.tangencyDeg, unit: '°', source: src });
  out.facts = [...fl, ...facts(f.facts ?? [], where)];
  out.description = f.description;
  out.shape = {
    kind: 'log-spiral',
    betaKinkDeg: t.betaKinkDeg,
    rKinkKpc: t.rKinkKpc,
    psiLtDeg: t.psiLtDeg,
    psiGtDeg: t.psiGtDeg,
    widthKpc: t.widthKpc,
    betaMeasuredDeg: t.betaMeasuredDeg,
    source: src,
  };
  return out;
}

/** Position of a non-arm structure feature. */
function position(f, gc) {
  const p = f.position;
  const where = `structure/${f.id} position`;
  if (p.kind === 'centre') return { ...xyz(icrsFromLb(gc.l, gc.b, gc.distPc)), positionSource: gc.source };
  if (p.kind === 'galactocentric') {
    // Inputs are quoted (or derived from quoted laws) in the feature's facts; the anchor itself is a choice.
    const src = evidence(p.evidence, where);
    return { ...xyz(icrsFromGalactocentric(gc, p.rKpc * 1000, p.betaDeg, p.zPc ?? 0)), positionSource: src };
  }
  if (p.kind === 'lbd') {
    const src = evidence(p.evidence, where, p.dKpc);
    return { ...xyz(icrsFromLb(p.l, p.b, p.dKpc * 1000)), positionSource: src };
  }
  throw new Error(`${where}: unknown kind ${p.kind}`);
}

/** Polyline at a constant heliocentric distance over a longitude range (Dame & Thaddeus 2008). */
function arcAtDistance(s) {
  const pts = [];
  const n = Math.round((s.lToDeg - s.lFromDeg) / s.stepDeg);
  for (let i = 0; i <= n; i++) {
    const l = s.lFromDeg + ((s.lToDeg - s.lFromDeg) * i) / n;
    pts.push(icrsFromLb((l + 360) % 360, 0, s.dKpc * 1000).map((v) => round(v, 0)));
  }
  return pts;
}

/** Height (kpc) of the Chen et al. 2019 power-law warp at radius R (kpc), where sin(φ - φw) = ±1. */
export const warpHeightKpc = (w, rKpc) => (rKpc <= w.rOnsetKpc ? 0 : w.a * (rKpc - w.rOnsetKpc) ** w.b);

export default function build() {
  const input = readInput('structure');
  const gc = galacticCentre(input);
  const features = [];
  for (const f of input.features) {
    if (f.table) {
      features.push(arm(f, gc));
      continue;
    }
    const where = `structure/${f.id}`;
    const out = { ...base(f), ...position(f, gc) };
    const r = radius(f.r, where);
    if (r !== undefined) out.r = r;
    out.facts = facts(f.facts, where);
    if (f.id === 'warp') {
      // Derived fact: height of the fitted law at 15 kpc, checked against the inputs quoted above.
      const w = input.warpLaw;
      evidence(w.evidence, `${where} law`, [w.rOnsetKpc, w.a, w.b, w.lonDeg]);
      const h = warpHeightKpc(w, 15);
      out.facts.push({
        label: 'Height of the fitted warp at R = 15 kpc (where sin(φ − φw) = ±1)',
        value: sig(h, 2),
        unit: 'kpc',
        source: w.evidence.source,
        approximate: true,
      });
      if (Math.abs(f.position.zPc - round(-h * 1000, 0)) > 1)
        throw new Error(
          `${where}: anchor z ${f.position.zPc} pc does not match the law (${round(-h * 1000, 0)} pc)`,
        );
    }
    if (f.description) out.description = f.description;
    if (f.shape?.kind === 'polyline-arc') {
      const src = evidence(f.shape.evidence, `${where} shape`, [Math.abs(f.shape.lFromDeg), f.shape.lToDeg]);
      out.shape = { kind: 'polyline', points: arcAtDistance(f.shape), closed: false, source: src };
    }
    features.push(out);
  }
  return finish('structure', features);
}
