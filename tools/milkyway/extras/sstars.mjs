#!/usr/bin/env node
/**
 * Adds the measured S-star orbits of Gillessen et al. 2017 (ApJ 837, 30, Table 3; 40 orbits) to
 * the black holes module's data file, public/data/blackholes/blackholes.json, next to the rows
 * that module already has. Run by hand (`node tools/milkyway/extras/sstars.mjs`); idempotent:
 * existing ids are never changed, rows added by an earlier run are replaced.
 *
 * Orbital elements and the K magnitude are the table's. The two display values the module needs
 * are approximate and say so in `source`: absMagV is scaled from S2 (the module's row: M_V -3.0 at
 * K = 14.0 in this table) by the K magnitude, with +3.8 mag for late-type stars (redder V-K);
 * teffK is 22000 K for early-type (B) stars and 4000 K for late-type giants.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PUBLIC } from '../../lib/fetch.mjs';
import { num, round, vizier } from '../lib.mjs';

const SRC = {
  group: 'centre-stars',
  id: 'gillessen_2017_orbits',
  cite: 'Gillessen et al. 2017, ApJ 837, 30, Table 3 (orbits of 40 stars around Sgr A*)',
  url: 'https://doi.org/10.3847/1538-4357/aa5c41',
  license: 'cited (no explicit licence)',
  fetch: { kind: 'vizier', table: 'J/ApJ/837/30/table3', columns: 'Star,a,e,i,Omega,w,Tp,Per,SpT,Kmag' },
  outputs: ['data/blackholes/blackholes.json'],
};
const TAG = 'Gillessen et al. 2017, ApJ 837, 30, Table 3';

const path = join(PUBLIC, 'data', 'blackholes', 'blackholes.json');
// The file is hand-formatted with one row per line: keep its text and only add or replace lines.
const text = readFileSync(path, 'utf8');
const lines = text.split('\n').filter((l) => !l.includes(`"source": "${TAG}`));
const cat = JSON.parse(lines.join('\n').replace(/,(\s*\])/g, '$1'));
const rows = vizier(SRC);
const kS2 = num(rows.find((r) => r.Star === 'S2').Kmag);
const have = new Set(cat.sstars.map((s) => s.id));
const added = [];
let rejected = 0;
for (const r of rows) {
  const id = r.Star.toLowerCase();
  if (have.has(id)) continue;
  const v = ['a', 'e', 'i', 'Omega', 'w', 'Tp', 'Per', 'Kmag'].map((k) => num(r[k]));
  const [a, e, i, Omega, w, tp, per, k] = v;
  if (v.some((x) => x === null) || !(e >= 0 && e < 1) || !(a > 0) || !(per > 0)) {
    rejected++;
    continue;
  }
  const late = r.SpT === 'l';
  const row = {
    id,
    name: r.Star,
    aArcsec: a,
    e,
    iDeg: i,
    OmegaDeg: Omega,
    omegaDeg: w,
    tpYear: tp,
    periodYr: per,
    absMagV: round(-3.0 + (k - kS2) + (late ? 3.8 : 0), 1),
    teffK: late ? 4000 : 22000,
    approximate: true,
    source: `${TAG} (elements; K = ${k}, ${late ? 'late' : r.SpT === 'e' ? 'early' : 'unclassified'} type); absMagV scaled from S2 by the K magnitude and teffK from the spectral class, both approximate`,
  };
  added.push(
    `    { ${Object.entries(row)
      .map(([key, val]) => `${JSON.stringify(key)}: ${JSON.stringify(val)}`)
      .join(', ')} }`,
  );
}
// Insert before the line that closes the "sstars" array (the last "  ]" of the file).
const close = lines.lastIndexOf('  ]');
let last = close - 1;
while (lines[last].trim() === '') last--;
lines[last] = lines[last].replace(/,?\s*$/, ',');
lines.splice(close, 0, ...added.map((l, n) => l + (n < added.length - 1 ? ',' : '')));
const out = lines.join('\n');
JSON.parse(out);
writeFileSync(path, out);
console.log(`sstars: ${rows.length} orbits in the table, ${have.size} rows already present, ${added.length} added, ${rejected} rejected`);
