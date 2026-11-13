/**
 * Satellite dwarf galaxies of the Milky Way: Local Volume Database (Pace 2024), data/dwarf_mw.csv.
 * Positions from ra, dec and the distance modulus; absolute magnitude from the catalogue.
 */
import { readFileSync } from 'node:fs';
import { icrsFromRaDec, num, round, sig, source, writeLayer } from '../lib.mjs';

const COMMIT = 'c40961a42d2beb302be1da90bca2016c284ef63c';
const SRC = {
  group: 'halo',
  id: 'lvdb_dwarf_mw',
  cite: 'Pace 2024, The Local Volume Database: a library of the observed properties of nearby dwarf galaxies and star clusters (data/dwarf_mw.csv)',
  url: 'https://github.com/apace7/local_volume_database',
  license: 'CC0-1.0',
  attribution: 'Local Volume Database (Pace 2024), CC0',
  fetch: {
    kind: 'file',
    url: `https://raw.githubusercontent.com/apace7/local_volume_database/${COMMIT}/data/dwarf_mw.csv`,
    file: `lvdb-${COMMIT.slice(0, 8)}-dwarf_mw.csv`,
  },
  outputs: ['data/milkyway/atlas/satellites.json'],
};

/** CSV with optional double-quoted cells. */
function parseCsv(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = [];
    let cur = '';
    let q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === ',' && !q) {
        cells.push(cur);
        cur = '';
      } else cur += ch;
    }
    cells.push(cur);
    rows.push(cells);
  }
  const header = rows.shift();
  return rows.map((c) => Object.fromEntries(header.map((h, i) => [h, (c[i] ?? '').trim()])));
}

const RANK3 = new Set([
  'lmc',
  'smc',
  'sagittarius_1',
  'fornax_1',
  'sculptor_1',
  'carina_1',
  'draco_1',
  'ursa_minor_1',
  'sextans_1',
  'leo_1',
  'leo_2',
]);

export default function build() {
  const rows = [];
  let rejected = 0;
  const checks = {};
  for (const r of parseCsv(readFileSync(source(SRC), 'utf8'))) {
    const ra = num(r.ra);
    const dec = num(r.dec);
    const mu = num(r.distance_modulus);
    if (ra === null || dec === null || mu === null) {
      rejected++;
      console.log(`  satellites: no position or distance for ${r.key}`);
      continue;
    }
    const dPc = 10 ** (mu / 5 + 1);
    if (!(dPc > 10000 && dPc < 1.5e6) || ra < 0 || ra > 360 || Math.abs(dec) > 90) {
      rejected++;
      console.log(`  satellites: implausible ${r.key}: d = ${dPc.toFixed(0)} pc`);
      continue;
    }
    const [x, y, z] = icrsFromRaDec(ra, dec, dPc);
    const rhalf = num(r.rhalf);
    const rPc = rhalf !== null && rhalf > 0 ? (dPc * rhalf * Math.PI) / (180 * 60) : null;
    const em = num(r.distance_modulus_em);
    const ep = num(r.distance_modulus_ep);
    const dErr = em !== null && ep !== null ? ((Math.LN10 / 5) * dPc * (em + ep)) / 2 / 1000 : null;
    const vmag = num(r.apparent_magnitude_v);
    const absMag = num(r.M_V) ?? (vmag !== null ? vmag - mu : null);
    const real = r.confirmed_real === '1';
    const galaxy = r.confirmed_galaxy === '1';
    let rank = 1;
    if (RANK3.has(r.key)) rank = 3;
    else if (absMag !== null && absMag < -7) rank = 2;
    if (!real || !galaxy) rank = 0;
    const refs = [
      r.ref_distance && `distance ${r.ref_distance}`,
      r.ref_structure && `structure ${r.ref_structure}`,
      r.ref_m_v && `magnitude ${r.ref_m_v}`,
    ].filter(Boolean);
    checks[r.key] = { d_kpc: dPc / 1000, absMag };
    rows.push([
      r.key.replace(/_/g, '-'),
      r.name,
      [],
      round(x, 1),
      round(y, 1),
      round(z, 1),
      rPc === null ? null : round(rPc, 1),
      rank,
      refs.length ? `LVDB references: ${refs.join('; ')}` : null,
      round(dErr, 3),
      vmag,
      absMag === null ? null : round(absMag, 2),
      rhalf,
      num(r.ellipticity),
      num(r.position_angle),
      num(r.vlos_systemic),
      num(r.vlos_sigma),
      num(r.metallicity_spectroscopic),
      real ? 'yes' : 'no',
      galaxy ? 'yes' : 'no',
    ]);
  }
  if (rejected) console.log(`  satellites: rejected ${rejected} implausible rows`);
  for (const k of ['lmc', 'fornax_1', 'draco_1'])
    console.log(`  check ${k}: d = ${sig(checks[k]?.d_kpc, 4)} kpc, M_V = ${checks[k]?.absMag}`);
  return writeLayer({
    layer: 'satellites',
    title: 'Satellite galaxies',
    noun: 'Satellite dwarf galaxy',
    radius: 'Half-light radius (projected), from the angular size and the distance',
    sources: { lvdb: { cite: SRC.cite, url: SRC.url, license: SRC.license } },
    columns: [
      { key: 'id' },
      { key: 'name' },
      { key: 'aliases' },
      { key: 'x', source: 'lvdb' },
      { key: 'y' },
      { key: 'z' },
      { key: 'r' },
      { key: 'rank' },
      { key: 'rowSource' },
      { key: 'distErr', label: 'Distance uncertainty', unit: 'kpc', source: 'lvdb', digits: 1 },
      { key: 'vMag', label: 'Apparent magnitude (V)', source: 'lvdb', digits: 1 },
      { key: 'absMag', label: 'Absolute magnitude (V)', source: 'lvdb', digits: 2 },
      { key: 'rhalf', label: 'Half-light radius', unit: 'arcmin', source: 'lvdb', digits: 2 },
      { key: 'ellipticity', label: 'Ellipticity', source: 'lvdb', digits: 2 },
      { key: 'posAngle', label: 'Position angle', unit: 'deg', source: 'lvdb', digits: 0 },
      { key: 'vlos', label: 'Line-of-sight velocity', unit: 'km/s', source: 'lvdb', digits: 1 },
      { key: 'sigmaV', label: 'Velocity dispersion', unit: 'km/s', source: 'lvdb', digits: 1 },
      { key: 'feh', label: 'Metallicity [Fe/H] (spectroscopic)', source: 'lvdb', digits: 2 },
      { key: 'real', label: 'Confirmed as real', source: 'lvdb' },
      { key: 'galaxy', label: 'Confirmed as a galaxy', source: 'lvdb' },
    ],
    rows,
  });
}
