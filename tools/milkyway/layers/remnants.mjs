/**
 * Galactic supernova remnants: Green's catalogue (2024 October version, 310 SNRs, VizieR VII/297;
 * newer than the 2019 version VII/284 and identical in layout) with the distances of Ranasinghe &
 * Leahy 2022 (ApJ 940, 63; VizieR J/ApJ/940/63/table1, 215 SNRs). Only remnants with a distance
 * get a row. Adopted distance: the revised distance (column Dist, new rotation curve of Reid et
 * al. 2014, with e_Dist) when the paper gives one, else the literature distance (Distl1, with
 * the mean of e_Distl1 and E_Distl1); a literature range (Distl2) gives its midpoint and half-range.
 * r = half the mean angular diameter at that distance.
 * Rank rule: 3 = FAMOUS names, 2 = Green lists a common name, 1 = flux >= 10 Jy or mean size >= 30',
 * 0 = the rest.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  checkQuote,
  dmsToDeg,
  hmsToDeg,
  icrsFromRaDec,
  num,
  OUT_DIR,
  round,
  sig,
  slug,
  source,
  vizier,
  writeLayer,
} from '../lib.mjs';

const GREEN = {
  group: 'disc',
  id: 'green_2024_snrs',
  cite: 'Green D. A. 2025, J. Astrophys. Astron. 46, 14 (A Catalogue of Galactic Supernova Remnants, 2024 October version; VizieR VII/297)',
  url: 'https://www.mrao.cam.ac.uk/surveys/snrs/',
  license:
    'cited (copyright D. A. Green; the catalogue page asks users to cite Green 2025 and the catalogue)',
  attribution:
    'Green, D. A. 2025, JApA 46, 14; A Catalogue of Galactic Supernova Remnants (2024 October version), Cavendish Laboratory, Cambridge',
  fetch: { kind: 'vizier', table: 'VII/297/snrs' },
  outputs: ['data/milkyway/atlas/remnants.json'],
};
const GREEN_PAGE = {
  group: 'disc',
  id: 'green_catalogue_page',
  cite: 'Green D. A., Catalogue of Galactic Supernova Remnants, home page (citation terms)',
  url: 'https://www.mrao.cam.ac.uk/surveys/snrs/',
  license: 'cited (copyright D. A. Green)',
  fetch: { kind: 'file', url: 'https://www.mrao.cam.ac.uk/surveys/snrs/', file: 'green_snrs_home.html' },
  outputs: ['data/milkyway/atlas/remnants.json'],
};
const RL = {
  group: 'disc',
  id: 'ranasinghe_2022_snr_distances',
  cite: 'Ranasinghe & Leahy 2022, ApJ 940, 63, Table 1 (VizieR J/ApJ/940/63)',
  url: 'https://doi.org/10.3847/1538-4357/ac9b0f',
  license: 'cited (no explicit licence)',
  attribution: 'Ranasinghe, S. & Leahy, D. 2022, ApJ 940, 63, via CDS VizieR',
  fetch: { kind: 'vizier', table: 'J/ApJ/940/63/table1' },
  outputs: ['data/milkyway/atlas/remnants.json'],
};
const RL_PAPER = {
  group: 'disc',
  id: 'ranasinghe_2022_paper',
  cite: 'Ranasinghe & Leahy 2022, ApJ 940, 63 (arXiv:2209.04570)',
  url: 'https://arxiv.org/abs/2209.04570',
  license: 'cited (no explicit licence)',
  fetch: {
    kind: 'file',
    url: 'https://ar5iv.labs.arxiv.org/html/2209.04570',
    file: 'ranasinghe_2022_ar5iv.html',
  },
  outputs: ['data/milkyway/atlas/remnants.json'],
};
const FAMOUS = new Set([
  'Crab Nebula',
  'Cassiopeia A',
  'Tycho',
  'Kepler',
  'Vela',
  'Cygnus Loop',
  'SN1006',
  'IC 443',
  'Puppis A',
]);
const TYPES = { S: 'shell', C: 'composite', F: 'filled-centre' };

/** 'G018.8+00.3' and 'G18.8+0.3' to one key. */
const key = (s) => {
  const m = /^G\s*(\d+(?:\.\d+)?)\s*([+-])\s*(\d+(?:\.\d+)?)/.exec(s);
  return m ? `${Number(m[1])}${m[2]}${Number(m[3])}` : s;
};

/**
 * Finder of a pulsar with a parallax distance inside a circle on the sky (centre in degrees,
 * radius in arcmin), from the built `pulsars` layer. Returns { name, dist, err } in pc, or null.
 */
function pulsarFinder() {
  const path = join(OUT_DIR, 'pulsars.json');
  if (!existsSync(path)) return () => null;
  const file = JSON.parse(readFileSync(path, 'utf8'));
  const ix = Object.fromEntries(file.columns.map((c, i) => [c.key, i]));
  const list = file.rows
    .filter((r) => String(r[ix.method]).startsWith('Parallax'))
    .map((r) => {
      const d = Math.hypot(r[ix.x], r[ix.y], r[ix.z]);
      return { name: r[ix.name], u: [r[ix.x] / d, r[ix.y] / d, r[ix.z] / d], dist: d, err: r[ix.distErr] };
    });
  return (raDeg, decDeg, radiusArcmin) => {
    const a = (raDeg * Math.PI) / 180;
    const dd = (decDeg * Math.PI) / 180;
    const u = [Math.cos(dd) * Math.cos(a), Math.cos(dd) * Math.sin(a), Math.sin(dd)];
    const cosMax = Math.cos((radiusArcmin / 60) * (Math.PI / 180));
    let best = null;
    for (const p of list) {
      const c = p.u[0] * u[0] + p.u[1] * u[1] + p.u[2] * u[2];
      if (c >= cosMax && (!best || c > best.c)) best = { ...p, c };
    }
    return best;
  };
}

export default function build() {
  checkQuote(GREEN_PAGE, 'Please cite the following paper for the summary data from this catalogue');
  checkQuote(GREEN_PAGE, '2024 October version');
  checkQuote(RL_PAPER, 'The revised distance estimates of SNRs were done using a consistent rotation curve');
  const dists = new Map();
  for (const r of vizier(RL)) dists.set(key(r.SNR), r);
  const rows = [];
  const stat = { green: 0, noDistance: 0, badDistance: 0, uncertain: 0, fromPulsar: 0, noSize: 0, limitFlux: 0, rlUnmatched: 0 };
  const pulsarInside = pulsarFinder();
  const matched = new Set();
  for (const g of vizier(GREEN)) {
    stat.green++;
    const d = dists.get(key(g.SNR));
    if (!d) {
      stat.noDistance++;
      continue;
    }
    matched.add(key(g.SNR));
    let dist = null;
    let err = null;
    let revised = false;
    if (num(d.Dist) > 0) {
      dist = num(d.Dist);
      err = num(d.e_Dist);
      revised = true;
    } else if (num(d.Distl2) > 0) {
      dist = (num(d.Distl1) + num(d.Distl2)) / 2;
      err = (num(d.Distl2) - num(d.Distl1)) / 2;
    } else if (num(d.Distl1) > 0) {
      dist = num(d.Distl1);
      const e = [num(d.e_Distl1), num(d.E_Distl1)].filter((v) => v !== null);
      err = e.length ? e.reduce((a, b) => a + b, 0) / e.length : null;
    }
    if (!(dist > 0.05 && dist < 30)) {
      stat.badDistance++;
      continue;
    }
    // A distance whose uncertainty is larger than half its value is not reliable (the Crab Nebula:
    // 3.37 +4.04 -0.97 kpc). Use the parallax distance of a pulsar inside the remnant when the
    // ATNF catalogue (layer `pulsars`, built before this one) has one, else leave the remnant out.
    let pulsarNote = null;
    const worst = Math.max(err ?? 0, num(d.E_Distl1) ?? 0);
    if (!revised && worst > 0.5 * dist) {
      const psr = pulsarInside(hmsToDeg(g.RAJ2000), dmsToDeg(g.DEJ2000), Math.max(num(g.MajDiam) ?? 0, 4) / 2);
      if (!psr) {
        stat.uncertain++;
        continue;
      }
      stat.fromPulsar++;
      dist = psr.dist / 1000;
      err = psr.err === null ? null : psr.err / 1000;
      pulsarNote = `Parallax of ${psr.name} inside the remnant (ATNF Pulsar Catalogue); the remnant's own value, ${num(d.Distl1)} kpc, is too uncertain`;
    }
    const maj = num(g.MajDiam);
    const min = num(g.MinDiam) ?? maj;
    const ra = hmsToDeg(g.RAJ2000);
    const dec = dmsToDeg(g.DEJ2000);
    const distPc = dist * 1000;
    const [x, y, z] = icrsFromRaDec(ra, dec, distPc);
    let r = null;
    if (maj > 0) r = (distPc * (((maj + min) / 2) * Math.PI)) / 180 / 60 / 2;
    else stat.noSize++;
    // Names: first listed name unless it is in parentheses (an uncertain association).
    const names = g.Names.split(',')
      .map((s) => s.trim().replace(/\s*\(XYZ\)$/, ''))
      .filter(Boolean);
    const common = names.map((s) => s.replace(/^IC(\d)/, 'IC $1')).find((s) => !s.startsWith('('));
    const other = names
      .filter((s) => s.replace(/^IC(\d)/, 'IC $1') !== common)
      .map((s) => s.replace(/^\((.*)\)$/, '$1'));
    const name = common ?? g.SNR;
    const aliases = common ? [g.SNR, ...other] : [...other];
    const tcode = g.type.replace('?', '').trim();
    const type = TYPES[tcode] ? TYPES[tcode] + (g.type.includes('?') ? ' (uncertain)' : '') : null;
    const flux = g['l_S(1GHz)'] === '' ? num(g['S(1GHz)']) : null;
    if (g['l_S(1GHz)'] !== '') stat.limitFlux++;
    const size = maj > 0 ? (min !== maj ? `${maj} x ${min}` : `${maj}`) : null;
    const rank = FAMOUS.has(name) ? 3 : common ? 2 : flux >= 10 || (maj + min) / 2 >= 30 ? 1 : 0;
    rows.push([
      slug(g.SNR),
      name,
      aliases,
      round(x, 1),
      round(y, 1),
      round(z, 1),
      r === null ? null : round(r, 1),
      rank,
      type,
      size,
      flux,
      sig(distPc, 3),
      err === null ? null : sig(err * 1000, 2),
      pulsarNote ??
        (d.Method || 'not stated') +
          (revised && Math.abs(num(d.Distl1) - dist) > 1e-6 ? ' (revised by Ranasinghe & Leahy)' : ''),
    ]);
  }
  stat.rlUnmatched = [...dists.keys()].filter((k) => !matched.has(k)).length;
  console.log('  remnants:', JSON.stringify(stat), `-> ${rows.length} rows`);
  return writeLayer({
    layer: 'remnants',
    title: 'Supernova remnants',
    noun: 'Supernova remnant',
    radius: 'Half the mean of the major and minor angular diameters (Green) at the adopted distance',
    sources: {
      green: { cite: GREEN.cite, url: GREEN.url, license: GREEN.license },
      rl: { cite: RL.cite, url: RL.url, license: RL.license },
    },
    columns: [
      { key: 'id' },
      { key: 'name' },
      { key: 'aliases' },
      { key: 'x', source: 'rl' },
      { key: 'y' },
      { key: 'z' },
      { key: 'r' },
      { key: 'rank' },
      { key: 'type', label: 'Type', source: 'green' },
      { key: 'size', label: 'Angular size', unit: 'arcmin', source: 'green' },
      { key: 'flux', label: 'Radio flux at 1 GHz', unit: 'Jy', source: 'green' },
      { key: 'dist', label: 'Distance', unit: 'pc', source: 'rl', approximate: true, digits: 0 },
      { key: 'distErr', label: 'Distance uncertainty', unit: 'pc', source: 'rl', digits: 0 },
      { key: 'method', label: 'Distance method', source: 'rl' },
    ],
    rows,
  });
}
