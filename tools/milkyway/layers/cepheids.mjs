/**
 * Classical Cepheids with distances (Skowron et al. 2019, Science 365, 478; OGLE). Real stars that
 * trace the young disc out to 20 kpc and its warp. Reference pattern for a catalogue layer.
 */
import { readFileSync } from 'node:fs';
import { icrsFromLb, num, round, slug, source, writeLayer } from '../lib.mjs';

const SRC = {
  group: 'tracers',
  id: 'skowron_2019_cepheids',
  cite: 'Skowron et al. 2019, Science 365, 478 (OGLE Collection of Galactic Cepheids)',
  url: 'https://doi.org/10.1126/science.aau3181',
  license: 'cited (no explicit licence)',
  attribution: 'OGLE project (Skowron, D. M. et al. 2019), Warsaw University Observatory',
  fetch: { kind: 'file', url: 'https://ftp.astrouw.edu.pl/ogle/ogle4/MILKY_WAY_3D_MAP/Skowron2019_GalClassCephDist.dat' },
  outputs: ['data/milkyway/atlas/cepheids.json'],
};
/** Period-luminosity relation, fundamental mode: M_V = a + b (log10 P - 1), Benedict et al. 2007, Table 12 (B07). */
const PL = { a: -4.05, b: -2.43 };

export default function build() {
  const text = readFileSync(source(SRC), 'utf8');
  const rows = [];
  let rejected = 0;
  for (const line of text.split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const c = line.trim().split(/\s+/);
    const [survey, name] = c;
    const l = num(c[2]);
    const b = num(c[3]);
    const dist = num(c[4]);
    const dDist = num(c[5]);
    const age = num(c[6]);
    const period = num(c[7]);
    const mode = c[8];
    if (!(dist > 0)) continue; // -1: no distance in the paper
    if (!(dist < 40000) || !(period > 0.2 && period < 100) || l === null || b === null) {
      rejected++;
      continue;
    }
    const [x, y, z] = icrsFromLb(l, b, dist);
    const display = name.replace(/_+/g, ' ');
    rows.push([
      slug(name),
      display,
      [],
      round(x, 1),
      round(y, 1),
      round(z, 1),
      dDist,
      round(period, 4),
      mode === 'F' ? 'fundamental' : 'first overtone',
      age,
      round(PL.a + PL.b * (Math.log10(period) - 1), 2),
      survey,
    ]);
  }
  if (rejected) console.log(`  cepheids: rejected ${rejected} implausible rows`);
  return writeLayer({
    layer: 'cepheids',
    title: 'Classical Cepheids',
    noun: 'Classical Cepheid (pulsating supergiant star)',
    sources: {
      skowron: { cite: SRC.cite, url: SRC.url, license: SRC.license },
      benedict: {
        cite: 'Benedict et al. 2007, AJ 133, 1810, Table 12: M_V = -4.05 - 2.43 (log P - 1)',
        url: 'https://arxiv.org/abs/astro-ph/0612465',
        license: 'cited (no explicit licence)',
      },
    },
    columns: [
      { key: 'id' },
      { key: 'name' },
      { key: 'aliases' },
      { key: 'x', source: 'skowron' },
      { key: 'y' },
      { key: 'z' },
      { key: 'distErr', label: 'Distance uncertainty', unit: 'pc', source: 'skowron' },
      { key: 'period', label: 'Pulsation period', unit: 'd', source: 'skowron' },
      { key: 'mode', label: 'Pulsation mode', source: 'skowron' },
      { key: 'age', label: 'Age', unit: 'Myr', source: 'skowron', approximate: true },
      { key: 'absMag', label: 'Absolute magnitude (V) from the period', source: 'benedict', approximate: true },
      { key: 'survey', label: 'Discovery survey', source: 'skowron' },
    ],
    rows,
  });
}
