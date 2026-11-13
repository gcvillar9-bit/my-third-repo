/**
 * Molecular clouds with 3D distances (Zucker et al. 2020, A&A 633, A51, "A compendium of distances to
 * molecular clouds in the Star Formation Handbook"; 326 sightlines, VizieR J/A+A/633/A51/handbook).
 * One row per cloud name: direction = mean of the sightline directions, distance = median of the
 * sightlines' d50. r = half the largest chord between two sightlines at that distance.
 * Rank rule: 3 = hand-picked famous complexes (FAMOUS), 2 = 5 or more sightlines, 1 = 2 to 4, 0 = one.
 */
import { readFileSync } from 'node:fs';
import { icrsFromLb, num, round, sig, slug, source, vizier, writeLayer, DEG } from '../lib.mjs';

const TABLE = {
  group: 'disc',
  id: 'zucker_2020_handbook',
  cite: 'Zucker et al. 2020, A&A 633, A51 (VizieR J/A+A/633/A51)',
  url: 'https://doi.org/10.1051/0004-6361/201936145',
  license: 'cited (no explicit licence)',
  attribution: 'Zucker, C. et al. 2020, A&A 633, A51, via CDS VizieR',
  fetch: { kind: 'vizier', table: 'J/A+A/633/A51/handbook', columns: 'Name,GLON,GLAT,d16,d50,d84' },
  outputs: ['data/milkyway/atlas/clouds.json'],
};
/** Harvard Dataverse deposit of the same table (Table A.1); its metadata states the licence. */
const DATAVERSE = {
  group: 'disc',
  id: 'zucker_2020_dataverse',
  cite: 'Zucker et al. 2020, Harvard Dataverse, doi:10.7910/DVN/07L7YZ (Table A.1)',
  url: 'https://doi.org/10.7910/DVN/07L7YZ',
  license: 'CC0-1.0',
  fetch: {
    kind: 'file',
    url: 'https://dataverse.harvard.edu/api/datasets/:persistentId/?persistentId=doi:10.7910/DVN/07L7YZ',
    file: 'zucker_2020_dataverse.json',
  },
  outputs: ['data/milkyway/atlas/clouds.json'],
};
const FAMOUS = new Set(['Orion', 'Taurus', 'Perseus', 'Ophiuchus', 'CygnusX', 'Coalsack']);
const NAMES = { CygnusX: 'Cygnus X', Cam: 'Camelopardalis', Coalsack: 'Coalsack' };

export default function build() {
  // The licence comes from the fetched Dataverse record, not from memory.
  const dv = JSON.parse(readFileSync(source(DATAVERSE), 'utf8')).data.latestVersion;
  const licence = dv.license?.rightsIdentifier;
  if (licence !== 'CC0-1.0') throw new Error(`clouds: Dataverse licence is ${licence}, expected CC0-1.0`);
  const byName = new Map();
  let rejected = 0;
  for (const r of vizier(TABLE)) {
    const l = num(r.GLON);
    const b = num(r.GLAT);
    const d = num(r.d50);
    if (l === null || b === null || !(d > 20 && d < 20000)) {
      rejected++;
      continue;
    }
    if (!byName.has(r.Name)) byName.set(r.Name, []);
    byName.get(r.Name).push({ l, b, d, e: (num(r.d84) - num(r.d16)) / 2 });
  }
  const median = (a) => {
    const s = [...a].sort((p, q) => p - q);
    const n = s.length;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  };
  const rows = [];
  for (const [raw, sl] of byName) {
    const dist = median(sl.map((s) => s.d));
    const units = sl.map((s) => icrsFromLb(s.l, s.b, 1));
    const mean = [0, 1, 2].map((k) => units.reduce((a, u) => a + u[k], 0) / units.length);
    const norm = Math.hypot(...mean);
    const [x, y, z] = mean.map((v) => (v / norm) * dist);
    let maxSep = 0;
    for (let i = 0; i < units.length; i++)
      for (let j = i + 1; j < units.length; j++) {
        const dot = units[i][0] * units[j][0] + units[i][1] * units[j][1] + units[i][2] * units[j][2];
        maxSep = Math.max(maxSep, 2 * Math.asin(Math.min(1, Math.sqrt(Math.max(0, 2 - 2 * dot)) / 2)));
      }
    const rPc = sl.length > 1 ? (dist * 2 * Math.sin(maxSep / 2)) / 2 : null;
    const name = NAMES[raw] ?? raw.replace(/_/g, ' ');
    const rank = FAMOUS.has(raw) ? 3 : sl.length >= 5 ? 2 : sl.length >= 2 ? 1 : 0;
    rows.push([
      slug(name),
      name,
      raw.replace(/_/g, ' ') !== name ? [raw.replace(/_/g, ' ')] : [],
      round(x, 1),
      round(y, 1),
      round(z, 1),
      rPc === null ? null : round(rPc, 1),
      rank,
      sl.length,
      round(dist, 0),
      round(median(sl.map((s) => s.e)), 0),
      round(Math.min(...sl.map((s) => s.d)), 0),
      round(Math.max(...sl.map((s) => s.d)), 0),
    ]);
  }
  console.log(`  clouds: ${byName.size} clouds, ${rejected} sightlines rejected`);
  return writeLayer({
    layer: 'clouds',
    title: 'Molecular clouds',
    noun: 'Molecular cloud',
    radius:
      'Half the largest separation between two of the cloud sightlines, at the cloud distance (single-sightline clouds have none)',
    sources: {
      zucker: {
        cite: TABLE.cite,
        url: TABLE.url,
        license: `${TABLE.license}; the same table is CC0-1.0 on Harvard Dataverse (${DATAVERSE.url})`,
      },
      dataverse: { cite: DATAVERSE.cite, url: DATAVERSE.url, license: 'CC0-1.0' },
    },
    columns: [
      { key: 'id' },
      { key: 'name' },
      { key: 'aliases' },
      { key: 'x', source: 'zucker' },
      { key: 'y' },
      { key: 'z' },
      { key: 'r' },
      { key: 'rank' },
      { key: 'n', label: 'Sightlines', source: 'zucker' },
      { key: 'dist', label: 'Distance (median of sightlines)', unit: 'pc', source: 'zucker', digits: 0 },
      {
        key: 'distErr',
        label: 'Typical sightline uncertainty (16th to 84th percentile)',
        unit: 'pc',
        source: 'zucker',
        digits: 0,
      },
      { key: 'dMin', label: 'Nearest sightline', unit: 'pc', source: 'zucker', digits: 0 },
      { key: 'dMax', label: 'Farthest sightline', unit: 'pc', source: 'zucker', digits: 0 },
    ],
    rows,
  });
}
