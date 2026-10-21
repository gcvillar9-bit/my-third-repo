#!/usr/bin/env node
/**
 * build-cities: public/data/cities/cities.json from the hand-entered history table
 * (src/modules/cities/history.json: cities from 7100 BC with population estimates over time, styles and
 * sources) and Natural Earth populated places (public domain, today's population) for cities that are
 * not in the table; those appear from 1950 (approximate).
 *
 * Output: { years: 'astronomical', styles: [...], cities: [[name, lat, lon, styleRows, popRows, endYear,
 * names?], ...] } with years converted to astronomical numbering (1 BC = 0), popRows [[year, pop], ...],
 * styleRows [[year, styleIndex], ...] and names [[year, name], ...] (only for renamed cities).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PUBLIC, ROOT } from './lib/fetch.mjs';
import { ensureModuleAssets } from './lib/manifest.mjs';

const STYLES = [
  'mesopotamian',
  'egyptian',
  'indus',
  'chinese',
  'classical',
  'persian',
  'medieval-european',
  'islamic',
  'indian',
  'japanese',
  'southeast-asian',
  'mesoamerican',
  'andean',
  'african',
  'colonial',
  'industrial',
  'modern',
];
/** Historical year (negative = BC, no year 0) to astronomical (1 BC = 0). */
const astro = (y) => (y < 0 ? y + 1 : y);

const history = JSON.parse(readFileSync(join(ROOT, 'src/modules/cities/history.json'), 'utf8')).cities;
const out = [];
for (const c of history) {
  const styles = c.styles.map(([y, s]) => {
    const i = STYLES.indexOf(s);
    if (i < 0) throw new Error(`build-cities: unknown style ${s} (${c.name})`);
    return [astro(y), i];
  });
  const pop = c.pop.map(([y, p]) => [astro(y), Math.round(p)]);
  const row = [
    c.name,
    +c.lat.toFixed(3),
    +c.lon.toFixed(3),
    styles,
    pop,
    c.end === undefined ? null : astro(c.end),
  ];
  if (c.names) row.push(c.names.map(([y, n]) => [astro(y), n]));
  // founded: the first style year marks the start of the city.
  styles[0][0] = Math.min(styles[0][0], astro(c.founded));
  out.push(row);
}

// Natural Earth: today's cities of at least 300 000 people that the table does not hold.
const paths = await ensureModuleAssets('cities', { ids: ['natural_earth_populated_places'] });
const places = JSON.parse(readFileSync(paths.get('natural_earth_populated_places'), 'utf8')).features.map(
  (f) => f.properties,
);
const near = (lat, lon) =>
  out.some(
    ([, la, lo]) =>
      Math.abs(la - lat) < 0.35 &&
      Math.abs(((lo - lon + 540) % 360) - 180) < 0.35 / Math.max(0.2, Math.cos((lat * Math.PI) / 180)),
  );
let added = 0;
for (const p of places.sort((a, b) => b.pop_max - a.pop_max)) {
  if (p.pop_max < 300_000) break;
  if (near(p.latitude, p.longitude)) continue;
  // From 1950 at a third of today's size (world urban population grew about 5x since 1950).
  out.push([
    p.name,
    +p.latitude.toFixed(3),
    +p.longitude.toFixed(3),
    [[1950, STYLES.indexOf('modern')]],
    [
      [1950, Math.round(p.pop_max / 3)],
      [2015, p.pop_max],
    ],
    null,
  ]);
  added++;
}
const dir = join(PUBLIC, 'data/cities');
mkdirSync(dir, { recursive: true });
writeFileSync(
  join(dir, 'cities.json'),
  JSON.stringify({
    source:
      'Hand-entered history table (src/modules/cities/history.json: Chandler 1987, Modelski 2003, UN WUP 2018 and others per row) and Natural Earth populated places v5.1.2 (public domain) for other cities of today, shown from 1950',
    years: 'astronomical',
    styles: STYLES,
    cities: out,
  }) + '\n',
);
console.log(`cities.json: ${history.length} historical + ${added} modern-only cities`);
