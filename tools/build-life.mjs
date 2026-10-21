#!/usr/bin/env node
/**
 * build-life: public/data/life/occurrences.json from Paleobiology Database occurrences (CC BY 4.0) for
 * every species row in src/modules/life/species.json with a `pbdb` query. Paleo-coordinates come from
 * the PALEOMAP model (pgm=scotese), the same frame as the paleo module's PaleoDEM maps.
 *
 * The API answers with a timing field, so responses are not byte-stable and are not pinned by sha256:
 * raw responses are cached in .cache/raw/life/ and the derived snapshot is committed. Pass --refresh to
 * download again (curl, because Node fetch ignores the proxy).
 *
 * Output: { source, pgm, species: { id: [[lat, lon, paleoLat, paleoLon, maxMa, minMa], ...] } }, finds
 * merged per 0.5 degree cell and time span.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PUBLIC, ROOT } from './lib/fetch.mjs';

const refresh = process.argv.includes('--refresh');
const species = JSON.parse(readFileSync(join(ROOT, 'src/modules/life/species.json'), 'utf8')).species;
const cache = join(ROOT, '.cache/raw/life');
mkdirSync(cache, { recursive: true });

const API = 'https://paleobiodb.org/data1.2/occs/list.json';

function occurrences(row) {
  const file = join(cache, `pbdb-${row.id}.json`);
  if (refresh || !existsSync(file)) {
    const url = `${API}?base_name=${encodeURIComponent(row.pbdb)}&show=coords,paleoloc&pgm=scotese&limit=all`;
    console.log(`fetch ${row.id}: ${row.pbdb}`);
    execFileSync('curl', ['-sS', '--fail', '-m', '300', '-o', file, url], { stdio: 'inherit' });
  }
  const json = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(json.records)) throw new Error(`build-life: no records for ${row.id}`);
  return json.records;
}

const round = (v, step) => Math.round(v / step) * step;
const out = {
  source:
    'The Paleobiology Database (paleobiodb.org, CC BY 4.0), occurrence API v1.2 with paleo-coordinates from the PALEOMAP model (pgm=scotese)',
  pgm: 'scotese',
  fields: ['lat', 'lon', 'paleoLat', 'paleoLon', 'maxMa', 'minMa'],
  species: {},
};
let total = 0;
for (const row of species) {
  if (!row.pbdb) continue;
  const seen = new Map();
  for (const r of occurrences(row)) {
    const lat = Number(r.lat);
    const lon = Number(r.lng);
    const eag = Number(r.eag);
    const lag = Number(r.lag ?? r.eag);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(eag)) continue;
    // Young finds keep modern coordinates; others need paleo-coordinates.
    const pla = r.pla === undefined || r.pla === '' ? null : Number(r.pla);
    const pln = r.pln === undefined || r.pln === '' ? null : Number(r.pln);
    if (eag >= 2.6 && (pla === null || pln === null)) continue;
    const ageStep = eag < 2.6 ? 0.001 : 0.1;
    const cell = [
      round(lat, 0.5),
      round(lon, 0.5),
      pla === null ? round(lat, 0.5) : round(pla, 0.5),
      pln === null ? round(lon, 0.5) : round(pln, 0.5),
      Number(round(eag, ageStep).toFixed(4)),
      Number(round(lag, ageStep).toFixed(4)),
    ];
    seen.set(cell.join(','), cell);
  }
  const cells = [...seen.values()].sort((a, b) => b[4] - a[4] || a[0] - b[0] || a[1] - b[1]);
  if (!cells.length) throw new Error(`build-life: ${row.id} has no usable occurrences`);
  out.species[row.id] = cells;
  total += cells.length;
  console.log(`${row.id}: ${cells.length} cells`);
}
const dir = join(PUBLIC, 'data/life');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'occurrences.json'), JSON.stringify(out) + '\n');
console.log(`occurrences.json: ${total} cells`);
