/**
 * High-mass star-forming regions with VLBI radio parallaxes (Reid et al. 2019, ApJ 885, 131; BeSSeL
 * and VERA). Distance = 1 / parallax. Rank rule: 3 = hand-picked famous regions (FAMOUS), 2 = the
 * table gives a common alias, 1 = no alias but parallax better than 10 %, 0 = the rest.
 */
import { readFileSync } from 'node:fs';
import {
  checkQuote,
  hmsToDeg,
  dmsToDeg,
  icrsFromRaDec,
  num,
  round,
  slug,
  sig,
  source,
  vizier,
  writeLayer,
} from '../lib.mjs';

const TABLE = {
  group: 'disc',
  id: 'reid_2019_masers',
  cite: 'Reid et al. 2019, ApJ 885, 131, Table 1 (VizieR J/ApJ/885/131)',
  url: 'https://doi.org/10.3847/1538-4357/ab4a11',
  license: 'cited (no explicit licence)',
  attribution: 'Reid, M. J. et al. 2019, ApJ 885, 131 (BeSSeL Survey and VERA), via CDS VizieR',
  fetch: { kind: 'vizier', table: 'J/ApJ/885/131/table1' },
  outputs: ['data/milkyway/atlas/masers.json'],
};
const PAPER = {
  group: 'disc',
  id: 'reid_2019_paper',
  cite: 'Reid et al. 2019, ApJ 885, 131, notes to Table 1 (spiral arm codes)',
  url: 'https://arxiv.org/abs/1910.03357',
  license: 'cited (no explicit licence)',
  fetch: { kind: 'file', url: 'https://ar5iv.labs.arxiv.org/html/1910.03357', file: 'reid_2019_ar5iv.html' },
  outputs: ['data/milkyway/atlas/masers.json'],
};
const ARMS = {
  GC: 'Galactic Centre region',
  Con: 'Connecting arm',
  '3kN': '3-kpc arm (near)',
  '3kF': '3-kpc arm (far)',
  Nor: 'Norma arm',
  ScN: 'Scutum-Centaurus arm (near)',
  ScF: 'Scutum-Centaurus arm (far)',
  SgN: 'Sagittarius arm (near)',
  SgF: 'Sagittarius arm (far)',
  Loc: 'Local arm',
  Per: 'Perseus arm',
  Out: 'Outer arm',
  OSC: 'Outer Scutum-Centaurus arm',
  LoS: 'Local arm spur',
  AqS: 'Aquarius spur',
  '???': 'not assigned to an arm',
};
const QUOTE =
  'GC=Galactic Center region; Con=Connecting arm; 3kN/F=3-kpc arm (near/far); Nor=Norma (a.k.a 4-kpc) arm; ScN/F=Scutum-Centaurus arm (near/far); SgN/F=Sagittarius arm (near/far); Loc=Local arm; Per=Perseus arm; and Out=Outer arm; OSC=Outer-Scutum-Centaurus arm. In addition we list two spurs: LoS=Local arm spur; AqS=Aquarius spur. Sources indicated with';
/** Famous regions, by the alias in the table. */
const FAMOUS = new Set([
  'Orion',
  'SgrB2',
  'W51IRS2',
  'W51M',
  'W49N',
  'W3OH',
  'NGC6334',
  'W43M',
  'W43S',
  'NGC7538',
  'W33A',
]);

/** Alias as printed in the table ('SgrB2') to a readable form ('Sgr B2'). */
const pretty = (a) =>
  a
    .replace(/^(NGC|IRAS|AFGL|IRC)(?=[-\d])/, '$1 ')
    .replace(/^(Sgr)(B2)$/, '$1 $2')
    .replace(/^(VX|PZ|NML|VY)(Sgr|Cas|Cyg|CMa)$/, '$1 $2')
    .replace(/^SPer$/, 'S Per')
    .replace(/^V838Mon$/, 'V838 Mon')
    .replace(/^(W\d+)(IRS2|N|S|M|A|B)$/, '$1 $2')
    .replace(/^NGC (\d+)W$/, 'NGC $1 W');

export default function build() {
  checkQuote(PAPER, QUOTE);
  const table = vizier(TABLE);
  // Count aliases so that two regions with one alias (W33A, W43M, ...) get distinct names.
  const used = new Map();
  for (const r of table) if (r.OName) used.set(pretty(r.OName), (used.get(pretty(r.OName)) ?? 0) + 1);
  const rows = [];
  const rejected = { lowSignificance: 0, tooFar: 0, noParallax: 0 };
  for (const r of table) {
    const plx = num(r.plx);
    const ePlx = num(r.e_plx);
    if (!(plx > 0) || !(ePlx > 0)) {
      rejected.noParallax++;
      continue;
    }
    if (plx < 3 * ePlx) {
      rejected.lowSignificance++;
      continue;
    }
    const dist = 1000 / plx;
    if (dist > 25000) {
      rejected.tooFar++;
      continue;
    }
    const dErr = (1000 * ePlx) / (plx * plx);
    const ra = hmsToDeg(r.RAJ2000);
    const dec = dmsToDeg(r.DEJ2000);
    const [x, y, z] = icrsFromRaDec(ra, dec, dist);
    const g = r.Name;
    const alias = r.OName ? pretty(r.OName) : null;
    const name = alias ? (used.get(alias) > 1 ? `${alias} (${g})` : alias) : g;
    const rank = FAMOUS.has(r.OName) ? 3 : alias ? 2 : dErr / dist < 0.1 ? 1 : 0;
    let id = slug(g);
    if (rows.some((q) => q[0] === id)) id = `${id}-${slug(r.OName || 'b')}`;
    rows.push([
      id,
      name,
      alias ? [g] : [],
      round(x, 1),
      round(y, 1),
      round(z, 1),
      rank,
      sig(dist, 4),
      sig(dErr, 2),
      plx,
      ePlx,
      num(r.VLSR),
      ARMS[r.Arm] ?? null,
    ]);
  }
  console.log(`  masers: ${table.length} rows read, ${rows.length} kept, rejected`, rejected);
  return writeLayer({
    layer: 'masers',
    title: 'Star-forming regions with radio parallaxes',
    noun: 'High-mass star-forming region',
    sources: {
      reid: { cite: TABLE.cite, url: TABLE.url, license: TABLE.license },
      reidArms: { cite: PAPER.cite, url: PAPER.url, license: PAPER.license },
    },
    columns: [
      { key: 'id' },
      { key: 'name' },
      { key: 'aliases' },
      { key: 'x', source: 'reid' },
      { key: 'y' },
      { key: 'z' },
      { key: 'rank' },
      { key: 'dist', label: 'Distance (1 / parallax)', unit: 'pc', source: 'reid', digits: 0 },
      { key: 'distErr', label: 'Distance uncertainty', unit: 'pc', source: 'reid', digits: 0 },
      { key: 'plx', label: 'Radio parallax', unit: 'mas', source: 'reid' },
      { key: 'ePlx', label: 'Parallax uncertainty', unit: 'mas', source: 'reid' },
      { key: 'vlsr', label: 'Velocity (LSR)', unit: 'km/s', source: 'reid' },
      { key: 'arm', label: 'Spiral arm', source: 'reidArms' },
    ],
    rows,
  });
}
