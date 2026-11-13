/**
 * Solar neighbourhood features (group 'local'): the Local Bubble, the Radcliffe Wave, Sco-Cen, the
 * Per-Tau shell, the Gould Belt and the Local Interstellar Cloud. Geometry comes from fetched data
 * files (Local Bubble map, Radcliffe Wave model, BANYAN Sigma centres); hand-entered facts live in
 * local.json, each with a quote that checkQuote finds on the fetched page.
 *
 * Axis conventions (checked in build(), printed on every run):
 *  - Pelgrims et al. 2020 map: HEALPix RING, NSIDE 128, Galactic coordinates (tutorial: ang2pix of
 *    Galactic lon/lat), distance to the inner edge of the shell in pc (TUNITS1 = 'pc').
 *  - Radcliffe Wave best fit (Alves et al. 2020): heliocentric Galactic Cartesian, X to the Galactic
 *    centre, pc; the curve passes within 30 pc of Orion (l = 209, b = -19, 400 pc) and ends near
 *    Cygnus X (l = 78, 1.7 kpc).
 *  - BANYAN Sigma centres (Gagne et al. 2018, Table 7): heliocentric Galactic, X to the Galactic
 *    centre (Corona Australis comes out at l = 0, b = -18).
 *  - Bialy et al. 2021: heliocentric Galactic, X to the centre (their x y z and l b d agree).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEG,
  checkQuote,
  icrsFromGalacticXyz,
  icrsFromLb,
  lbFromIcrs,
  round,
  source,
  writeFeatures,
} from '../lib.mjs';
import { GAGNE, gagneTables } from '../layers/associations.mjs';

const OUT = ['data/milkyway/atlas/features-local.json'];
const CITED = 'cited (no explicit licence)';
const paper = (kind, id, arxiv, cite, license = CITED) => ({
  group: 'local',
  id,
  cite,
  url: `https://arxiv.org/abs/${arxiv}`,
  license,
  fetch:
    kind === 'pdf'
      ? { kind: 'file', url: `https://arxiv.org/pdf/${arxiv}`, file: `${id}.pdf` }
      : { kind: 'file', url: `https://ar5iv.labs.arxiv.org/html/${arxiv}`, file: `${id}.html` },
  outputs: OUT,
});

export const SRC = {
  pelgrims_map: {
    group: 'local',
    id: 'pelgrims_2020_map',
    cite: 'Pelgrims et al. 2020, A&A 636, A17: inner surface of the Local Bubble shell, from the Lallement et al. 2019 3D dust map (Harvard Dataverse doi:10.7910/DVN/RHPVNC, L19_map-inner_final.fits)',
    url: 'https://doi.org/10.7910/DVN/RHPVNC',
    license: 'CC0-1.0',
    fetch: {
      kind: 'file',
      url: 'https://dataverse.harvard.edu/api/access/datafile/6477817',
      file: 'L19_map-inner_final.fits',
    },
    outputs: OUT,
  },
  zucker22: paper('pdf', 'zucker_2022', '2201.05124', 'Zucker et al. 2022, Nature 601, 334', 'CC-BY-4.0'),
  oneill: paper(
    'html',
    'oneill_2024',
    '2403.04961',
    "O'Neill et al. 2024, ApJ 973, 136 (The Local Bubble is a Local Chimney)",
  ),
  alves: paper('pdf', 'alves_2020', '2001.08748', 'Alves et al. 2020, Nature 578, 237'),
  alves_fit: {
    group: 'local',
    id: 'alves_2020_fit',
    cite: 'Alves et al. 2020, Nature 578, 237: best-fit model of the Radcliffe Wave (Harvard Dataverse doi:10.7910/DVN/OE51SZ)',
    url: 'https://doi.org/10.7910/DVN/OE51SZ',
    license: 'CC0-1.0',
    fetch: {
      kind: 'file',
      url: 'https://dataverse.harvard.edu/api/access/datafile/5258284?format=original',
      file: 'Radcliffe_Wave_Best_Fit.csv',
    },
    outputs: OUT,
  },
  konietzka: paper(
    'pdf',
    'konietzka_2024',
    '2402.12596',
    'Konietzka et al. 2024, Nature 628, 62',
    'CC-BY-4.0',
  ),
  ratzenbock: paper(
    'html',
    'ratzenbock_2023',
    '2302.07853',
    'Ratzenböck et al. 2023, A&A 677, A59',
    'CC-BY-4.0',
  ),
  dezeeuw: paper('html', 'dezeeuw_1999', 'astro-ph/9809227', 'de Zeeuw et al. 1999, AJ 117, 354'),
  bialy: paper('html', 'bialy_2021', '2109.09763', 'Bialy et al. 2021, ApJL 919, L5', 'CC-BY-4.0'),
  redfield: paper('html', 'redfield_2008', '0709.4480', 'Redfield & Linsky 2008, ApJ 673, 283'),
  perrot: paper('html', 'perrot_2003', 'astro-ph/0303516', 'Perrot & Grenier 2003, A&A 404, 519'),
};

// ---------------------------------------------------------------------------------------
// FITS binary table and HEALPix (RING) reader
// ---------------------------------------------------------------------------------------
/** Header cards and data offsets of every HDU of a FITS file. */
export function readFits(path) {
  const buf = readFileSync(path);
  const hdus = [];
  let off = 0;
  while (off + 2880 <= buf.length) {
    const cards = {};
    let hlen = 0;
    for (let end = false; !end;) {
      if (off + hlen + 2880 > buf.length) throw new Error(`${path}: truncated FITS header`);
      const block = buf.toString('latin1', off + hlen, off + hlen + 2880);
      hlen += 2880;
      for (let i = 0; i < 36 && !end; i++) {
        const card = block.slice(i * 80, i * 80 + 80);
        const key = card.slice(0, 8).trim();
        if (key === 'END') end = true;
        else if (card.slice(8, 10) === '= ') {
          let v = card.slice(10).trim();
          if (v.startsWith("'")) v = v.slice(1, v.indexOf("'", 1)).trim();
          else {
            v = v.split('/')[0].trim();
            v = v === 'T' ? true : v === 'F' ? false : Number(v);
          }
          cards[key] = v;
        }
      }
    }
    let size = cards.NAXIS ? Math.abs(cards.BITPIX) / 8 : 0;
    for (let k = 1; k <= (cards.NAXIS ?? 0); k++) size *= cards[`NAXIS${k}`];
    size += cards.PCOUNT ?? 0;
    hdus.push({ cards, dataOffset: off + hlen, size });
    off += hlen + Math.ceil(size / 2880) * 2880;
  }
  return { buf, hdus };
}

/** Float64 column `name` of a binary table HDU (TFORM 'D' or 'double', one element per row). */
export function fitsColumn({ buf }, hdu, name) {
  const c = hdu.cards;
  let offset = 0;
  for (let k = 1; k <= c.TFIELDS; k++) {
    const form = String(c[`TFORM${k}`]).trim();
    const m = /^(\d*)([A-Za-z]+)$/.exec(form);
    const rep = m[1] === '' ? 1 : Number(m[1]);
    const code = { double: 'D', float: 'E', D: 'D', E: 'E', J: 'J', K: 'K', I: 'I', B: 'B' }[m[2]];
    const bytes = { D: 8, E: 4, J: 4, K: 8, I: 2, B: 1 }[code];
    if (!bytes) throw new Error(`unsupported TFORM ${form}`);
    if (c[`TTYPE${k}`] === name) {
      if (code !== 'D' || rep !== 1)
        throw new Error(`column ${name}: expected one double per row, got ${form}`);
      const out = new Float64Array(c.NAXIS2);
      for (let r = 0; r < c.NAXIS2; r++) out[r] = buf.readDoubleBE(hdu.dataOffset + r * c.NAXIS1 + offset);
      return out;
    }
    offset += rep * bytes;
  }
  throw new Error(`no column ${name}`);
}

/** Colatitude theta and longitude phi (radians) of the centre of HEALPix pixel `p` (RING ordering). */
export function pix2angRing(nside, p) {
  const npix = 12 * nside * nside;
  const ncap = 2 * nside * (nside - 1);
  let z;
  let phi;
  if (p < ncap) {
    const i = Math.floor((1 + Math.sqrt(1 + 2 * p)) / 2);
    const j = p + 1 - 2 * i * (i - 1);
    z = 1 - (i * i) / (3 * nside * nside);
    phi = ((j - 0.5) * Math.PI) / (2 * i);
  } else if (p < npix - ncap) {
    const ip = p - ncap;
    const i = Math.floor(ip / (4 * nside)) + nside;
    const j = (ip % (4 * nside)) + 1;
    const s = (i + nside) % 2 ? 1 : 0.5;
    z = ((2 * nside - i) * 2) / (3 * nside);
    phi = ((j - s) * Math.PI) / (2 * nside);
  } else {
    const ip = npix - p;
    const i = Math.floor((1 + Math.sqrt(2 * ip - 1)) / 2);
    const j = 4 * i + 1 - (ip - 2 * i * (i - 1));
    z = -1 + (i * i) / (3 * nside * nside);
    phi = ((j - 0.5) * Math.PI) / (2 * i);
  }
  return [Math.acos(z), phi];
}

// ---------------------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------------------
const N_LON = 72;
const N_LAT = 36;
const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

const SHELL_COLUMN = 'r_in_lmax-10';

/** Local Bubble: inner shell surface resampled to a 5-degree Galactic grid (cell means). */
function localBubbleShape() {
  const fits = readFits(source(SRC.pelgrims_map));
  const hdu = fits.hdus.find((h) => h.cards.XTENSION === 'BINTABLE');
  const c = hdu.cards;
  if (c.PIXTYPE !== 'HEALPIX' || c.ORDERING !== 'RING')
    throw new Error(`Local Bubble map: ${c.PIXTYPE} ${c.ORDERING}`);
  if (c.NAXIS2 !== 12 * c.NSIDE * c.NSIDE) throw new Error('Local Bubble map: row count is not 12 NSIDE^2');
  if (c.TTYPE1 !== 'r_inner_raw' || c.TUNITS1 !== 'pc')
    throw new Error('Local Bubble map: unexpected first column');
  // The authors' spherical-harmonic model of the surface up to l = 10: smooth, without the
  // pixel noise and the foreground-cloud bias of the raw map (column r_inner_raw).
  const r = fitsColumn(fits, hdu, SHELL_COLUMN);
  const sum = new Float64Array(N_LON * N_LAT);
  const cnt = new Uint32Array(N_LON * N_LAT);
  const good = [];
  let rejected = 0;
  for (let p = 0; p < r.length; p++) {
    const v = r[p];
    if (!Number.isFinite(v) || v <= 0) {
      rejected++;
      continue;
    }
    good.push(v);
    const [theta, phi] = pix2angRing(c.NSIDE, p);
    const b = 90 - theta / DEG;
    const l = phi / DEG;
    const i = Math.min(N_LAT - 1, Math.floor(((b + 90) / 180) * N_LAT));
    const j = Math.min(N_LON - 1, Math.floor((l / 360) * N_LON));
    sum[i * N_LON + j] += v;
    cnt[i * N_LON + j]++;
  }
  const radiiPc = [];
  for (let k = 0; k < sum.length; k++) {
    if (!cnt[k]) throw new Error(`Local Bubble map: empty grid cell ${k}`);
    radiiPc.push(round(sum[k] / cnt[k], 1));
  }
  good.sort((a, b) => a - b);
  const stats = { min: good[0], median: quantile(good, 0.5), max: good.at(-1), rejected, pixels: r.length };
  // Volume and centroid of the star-shaped region bounded by the grid surface.
  let vol = 0;
  const m = [0, 0, 0];
  for (let i = 0; i < N_LAT; i++) {
    const b0 = (-90 + (180 * i) / N_LAT) * DEG;
    const b1 = (-90 + (180 * (i + 1)) / N_LAT) * DEG;
    const bc = (b0 + b1) / 2;
    const dOmega = (Math.sin(b1) - Math.sin(b0)) * ((2 * Math.PI) / N_LON);
    for (let j = 0; j < N_LON; j++) {
      const l = ((360 * (j + 0.5)) / N_LON) * DEG;
      const R = radiiPc[i * N_LON + j];
      vol += (R ** 3 / 3) * dOmega;
      const w = (R ** 4 / 4) * dOmega;
      m[0] += w * Math.cos(bc) * Math.cos(l);
      m[1] += w * Math.cos(bc) * Math.sin(l);
      m[2] += w * Math.sin(bc);
    }
  }
  const centroidGal = m.map((v) => v / vol);
  const rEq = Math.cbrt((3 * vol) / (4 * Math.PI));
  return { radiiPc, stats, centroidGal, rEq };
}

/** Radcliffe Wave: the best-fit curve, resampled to `n` points evenly spaced along its length. */
function radcliffeWave(n = 64) {
  const text = readFileSync(source(SRC.alves_fit), 'utf8').trim().split('\n');
  if (text[0].trim() !== 'x,y,z') throw new Error(`Radcliffe Wave fit: unexpected header ${text[0]}`);
  const pts = text.slice(1).map((l) => l.split(',').map(Number));
  if (pts.some((p) => p.length !== 3 || p.some((v) => !Number.isFinite(v))))
    throw new Error('Radcliffe Wave fit: bad row');
  const s = [0];
  for (let i = 1; i < pts.length; i++)
    s.push(s[i - 1] + Math.hypot(...pts[i].map((v, k) => v - pts[i - 1][k])));
  const total = s.at(-1);
  const out = [];
  let k = 0;
  for (let q = 0; q < n; q++) {
    const target = (total * q) / (n - 1);
    while (k < pts.length - 2 && s[k + 1] < target) k++;
    const t = Math.min(1, Math.max(0, (target - s[k]) / (s[k + 1] - s[k])));
    out.push(pts[k].map((v, d) => v + t * (pts[k + 1][d] - v)));
  }
  // Check: closest approach to Orion (l = 209, b = -19, 400 pc) and the far end (Cygnus X).
  const orion = [
    Math.cos(-19 * DEG) * Math.cos(209 * DEG),
    Math.cos(-19 * DEG) * Math.sin(209 * DEG),
    Math.sin(-19 * DEG),
  ].map((v) => v * 400);
  const dOrion = Math.min(...pts.map((p) => Math.hypot(p[0] - orion[0], p[1] - orion[1], p[2] - orion[2])));
  const end = lbFromIcrs(...icrsFromGalacticXyz(...pts.at(-1)));
  const start = lbFromIcrs(...icrsFromGalacticXyz(...pts[0]));
  console.log(
    `  radcliffe wave: ${pts.length} model points, length ${(total / 1000).toFixed(2)} kpc, ${dOrion.toFixed(0)} pc from Orion, ` +
      `start l = ${start.l.toFixed(0)} at ${start.dist.toFixed(0)} pc, end l = ${end.l.toFixed(0)} at ${end.dist.toFixed(0)} pc`,
  );
  if (dOrion > 60) throw new Error('Radcliffe Wave fit: does not pass Orion; check the axis convention');
  return { galPoints: out, totalPc: total };
}

const gal = (X, Y, Z) => icrsFromGalacticXyz(X, Y, Z).map((v) => round(v, 1));

export default function build() {
  const input = JSON.parse(readFileSync(join(import.meta.dirname, 'local.json'), 'utf8')).features;
  /** Checked hand-entered facts of one feature. */
  const facts = (id) =>
    input[id].facts.map((f) => {
      const def = SRC[f.evidence.source];
      if (!def) throw new Error(`${id}: unknown evidence source ${f.evidence.source}`);
      checkQuote(def, f.evidence.quote);
      // The leading number of the value must occur in the quote (guards against typos).
      const lead = /\d[\d.]*/.exec(f.value)?.[0];
      if (lead && !f.evidence.quote.replace(/\s+/g, '').includes(lead))
        throw new Error(`${id}: ${f.label}: ${lead} not in quote`);
      return {
        label: f.label,
        value: f.value,
        ...(f.unit ? { unit: f.unit } : {}),
        source: f.evidence.source,
        ...(f.approximate ? { approximate: true } : {}),
      };
    });
  const checked = (id, key) => {
    const v = input[id][key];
    checkQuote(SRC[v.evidence.source], v.evidence.quote);
    for (const k of ['X', 'Y', 'Z', 'l', 'd', 'value'])
      if (k in v && !v.evidence.quote.replace(/\s+/g, '').includes(String(Math.abs(v[k]))))
        throw new Error(`${id}.${key}: ${k} = ${v[k]} not in quote`);
    return v;
  };

  const features = [];

  // Local Bubble
  const lb = localBubbleShape();
  const lbAnchor = gal(...lb.centroidGal);
  const st = lb.stats;
  console.log(
    `  local bubble: ${st.pixels} pixels, ${st.rejected} rejected; radius min ${st.min.toFixed(1)}, median ${st.median.toFixed(1)}, ` +
      `max ${st.max.toFixed(1)} pc; volume-equivalent radius ${lb.rEq.toFixed(1)} pc; centroid (Galactic) ${lb.centroidGal.map((v) => v.toFixed(1)).join(', ')} pc`,
  );
  features.push({
    id: 'local-bubble',
    name: 'Local Bubble',
    type: 'shell',
    noun: 'Cavity of hot thin gas around the Sun',
    rank: 3,
    x: lbAnchor[0],
    y: lbAnchor[1],
    z: lbAnchor[2],
    r: round(lb.rEq, 0),
    positionSource: 'pelgrims_map',
    facts: [
      {
        label: 'Distance to the inner edge of the shell (min, median, max of the map)',
        value: `${st.min.toFixed(0)}, ${st.median.toFixed(0)}, ${st.max.toFixed(0)}`,
        unit: 'pc',
        source: 'pelgrims_map',
      },
      ...facts('local-bubble'),
    ],
    description:
      'A cavity of low-density, very hot gas some 300 pc across, blown by about fifteen supernovae over the last 14 million years; the Sun drifted into it about 5 million years ago. ' +
      'Nearly all nearby star-forming clouds sit on its surface. The surface shown is the inner edge of its dusty shell (Pelgrims et al. 2020), averaged over 5-degree cells and centred on the Sun; ' +
      "O'Neill et al. 2024 find an extension towards the north Galactic hemisphere that looks like a 'Local Chimney' venting gas into the lower halo, so the bubble may be open there.",
    shape: { kind: 'radial-map', nLon: N_LON, nLat: N_LAT, radiiPc: lb.radiiPc, source: 'pelgrims_map' },
  });

  // Radcliffe Wave
  const rw = radcliffeWave(64);
  const rwMid = rw.galPoints[Math.floor(rw.galPoints.length / 2)];
  const rwAnchor = gal(...rwMid);
  features.push({
    id: 'radcliffe-wave',
    name: 'Radcliffe Wave',
    type: 'wave',
    noun: 'Wave-shaped chain of gas clouds',
    rank: 3,
    x: rwAnchor[0],
    y: rwAnchor[1],
    z: rwAnchor[2],
    positionSource: 'alves_fit',
    facts: facts('radcliffe-wave'),
    description:
      'A narrow, 2.7 kpc long chain of dense gas clouds, including Orion, Perseus, Taurus, Cepheus, the North America nebula and Cygnus X, that undulates above and below the Galactic plane. ' +
      'Konietzka et al. 2024 showed that it oscillates through the plane like a wave while drifting away from the Galactic Centre. Much of what was called the Gould Belt is part of it. ' +
      'The line is the best-fit damped-sinusoid model of Alves et al. 2020.',
    shape: { kind: 'polyline', points: rw.galPoints.map((p) => gal(...p)), source: 'alves_fit' },
  });

  // Sco-Cen: the three classical subgroups, centres from BANYAN Sigma (Gagne et al. 2018, Table 7).
  const { centres } = gagneTables();
  const sub = ['LCC', 'UCL', 'USCO'].map((k) => {
    if (!centres[k]) throw new Error(`Gagne Table 7: no ${k}`);
    return centres[k];
  });
  for (const [k, c] of Object.entries({ LCC: sub[0], UCL: sub[1], USCO: sub[2] })) {
    const p = lbFromIcrs(...icrsFromGalacticXyz(c.X, c.Y, c.Z));
    console.log(`  sco-cen ${k}: l = ${p.l.toFixed(1)}, b = ${p.b.toFixed(1)}, d = ${p.dist.toFixed(0)} pc`);
  }
  const ucl = gal(sub[1].X, sub[1].Y, sub[1].Z);
  features.push({
    id: 'sco-cen',
    name: 'Scorpius-Centaurus OB association',
    aliases: ['Sco-Cen', 'Sco OB2'],
    type: 'association',
    noun: 'Nearest OB association',
    rank: 3,
    x: ucl[0],
    y: ucl[1],
    z: ucl[2],
    positionSource: 'gagne',
    facts: facts('sco-cen'),
    description:
      'The nearest region where massive stars formed recently, made of the subgroups Lower Centaurus-Crux, Upper Centaurus-Lupus and Upper Scorpius. ' +
      'Its supernovae are thought to have blown the Local Bubble. The line joins the centres of the three subgroups (BANYAN Sigma models, Gagné et al. 2018); the label sits on Upper Centaurus-Lupus.',
    shape: { kind: 'polyline', points: sub.map((c) => gal(c.X, c.Y, c.Z)), source: 'gagne' },
  });

  // Per-Tau shell
  const pt = checked('per-tau-shell', 'centre');
  const ptR = checked('per-tau-shell', 'radius');
  const ptPos = gal(pt.X, pt.Y, pt.Z);
  features.push({
    id: 'per-tau-shell',
    name: 'Perseus-Taurus shell',
    aliases: ['Per-Tau shell'],
    type: 'shell',
    noun: 'Supernova-blown shell of gas and dust',
    rank: 2,
    x: ptPos[0],
    y: ptPos[1],
    z: ptPos[2],
    r: ptR.value,
    positionSource: 'bialy',
    facts: facts('per-tau-shell'),
    description:
      'A near-spherical shell found in 3D dust maps, with the Perseus molecular cloud on its far side and Taurus on its near side; it was probably blown by supernovae. ' +
      'Drawn as the sphere of Bialy et al. 2021.',
    shape: { kind: 'sphere', source: 'bialy' },
  });

  // Gould Belt (centre assumed in the Galactic plane: the paper gives only its distance and longitude).
  const gb = checked('gould-belt', 'centre');
  const gbR = checked('gould-belt', 'radius');
  const gbPos = icrsFromLb(gb.l, 0, gb.d).map((v) => round(v, 1));
  features.push({
    id: 'gould-belt',
    name: 'Gould Belt',
    aliases: ["Gould's Belt"],
    type: 'region',
    noun: 'Ring of bright young stars and clouds tilted to the Milky Way',
    rank: 2,
    x: gbPos[0],
    y: gbPos[1],
    z: gbPos[2],
    r: gbR.value,
    positionSource: 'perrot',
    facts: facts('gould-belt'),
    description:
      'A ring of bright young stars and gas clouds tilted by about 20 degrees to the Milky Way, described since the 19th century and modelled here as an expanding ring (Perrot & Grenier 2003; the label sits at its centre, taken to lie in the Galactic plane). ' +
      'The Radcliffe Wave work (Alves et al. 2020) reinterprets it as a projection on the sky of two straight cloud complexes, the Radcliffe Wave and the Split, rather than a real ring.',
  });

  // Local Interstellar Cloud
  const lic = checked('local-interstellar-cloud', 'centre');
  const licPos = icrsFromLb(lic.l, lic.b, lic.d).map((v) => round(v, 2));
  features.push({
    id: 'local-interstellar-cloud',
    name: 'Local Interstellar Cloud',
    aliases: ['LIC'],
    type: 'cloud',
    noun: 'Warm cloud the Sun is passing through',
    rank: 2,
    x: licPos[0],
    y: licPos[1],
    z: licPos[2],
    positionSource: 'redfield',
    facts: facts('local-interstellar-cloud'),
    description:
      'A warm, partly ionised wisp of gas a few parsecs across; the Sun is inside it or at its edge, and its gas flows through the Solar System. ' +
      'The label sits towards the centre of the cloud on the sky (l = 170, b = -10) at 2.6 pc, the distance of the nearest star whose light shows the cloud, which is an upper limit to its distance (Redfield & Linsky 2008).',
  });

  const used = new Set(['gagne']);
  for (const f of features) {
    used.add(f.positionSource);
    if (f.shape) used.add(f.shape.source);
    for (const x of f.facts) used.add(x.source);
  }
  const sources = {};
  for (const k of [...used].sort()) {
    const d =
      k === 'gagne' ? { ...GAGNE, cite: `${GAGNE.cite}, Table 7 (centres of the subgroups)` } : SRC[k];
    sources[k] = { cite: d.cite, url: d.url, license: d.license };
  }
  return writeFeatures({ group: 'local', sources, features });
}
