/**
 * Galactic HII regions (Hou & Han 2014, A&A 569, A125, Table A.1; VizieR J/A+A/569/A125/tablea1:
 * 4,551 literature measurements of 2,537 regions, rows of one region share the column Seq).
 * Distance, best first: the photometric or trigonometric distance (column Dist, with e_Dist); else
 * the kinematic distance D8.3 of the paper (flat rotation curve, R0 = 8.3 kpc, Theta0 = 239 km/s;
 * approximate; the near / far choice is the paper's note in column n_Dist). Regions without either
 * are not written. The WISE catalogue (Anderson et al. 2014) was looked at but gives only kinematic
 * distances for most of its rows, so it adds nothing here and is not used.
 * Names come from the designations in the table's notes: Orion A, Sgr B2, M, NGC, IC, W, RCW, Gum,
 * DR, Sharpless (S -> Sh 2-), K and BFS numbers, in that order of preference; otherwise
 * "HII G<l><b>". A name shared by several regions gets the Galactic designation appended.
 * Rank rule: 3 = the brightest region (largest listed flux) of each name in FAMOUS, 2 = has a
 * designation, 1 = has a photometric or trigonometric distance, 0 = the rest.
 */
import { checkQuote, icrsFromLb, num, round, sig, slug, source, vizier, writeLayer } from '../lib.mjs';

const TABLE = {
  group: 'disc',
  id: 'hou_han_2014_hii',
  cite: 'Hou & Han 2014, A&A 569, A125, Table A.1 (VizieR J/A+A/569/A125)',
  url: 'https://doi.org/10.1051/0004-6361/201424067',
  license: 'cited (no explicit licence)',
  attribution: 'Hou, L. G. & Han, J. L. 2014, A&A 569, A125, via CDS VizieR',
  fetch: { kind: 'vizier', table: 'J/A+A/569/A125/tablea1' },
  outputs: ['data/milkyway/atlas/hii-regions.json'],
};
const PAPER = {
  group: 'disc',
  id: 'hou_han_2014_paper',
  cite: 'Hou & Han 2014, A&A 569, A125 (arXiv:1407.7331), method and notes to Table A.1',
  url: 'https://arxiv.org/abs/1407.7331',
  license: 'cited (no explicit licence)',
  fetch: {
    kind: 'file',
    url: 'https://ar5iv.labs.arxiv.org/html/1407.7331',
    file: 'hou_han_2014_ar5iv.html',
  },
  outputs: ['data/milkyway/atlas/hii-regions.json'],
};
const KDA = {
  knear: 'nearer kinematic solution adopted',
  kfar: 'farther kinematic solution adopted',
  ktan: 'tangent-point distance adopted',
  kout: 'outer Galaxy',
  n3kpc: 'in the near 3-kpc arm',
  f3kpc: 'in the far 3-kpc arm',
};
const FAMOUS = new Set([
  'Orion A',
  'Sgr B2',
  'M 8',
  'M 16',
  'M 17',
  'M 20',
  'W 51',
  'W 43',
  'W 49',
  'W 3',
  'W 4',
  'W 33',
  'RCW 38',
  'NGC 6334',
  'NGC 3372',
  'NGC 7538',
  'NGC 281',
]);

/** Normalises one designation of the Note column; returns { name, pri } or null. */
function designation(tok) {
  const t = tok.trim().replace(/\s*\?$/, '');
  let m;
  if ((m = /^OrionA$/.exec(t))) return { name: 'Orion A', pri: 0 };
  if ((m = /^SgrB(\d)$/.exec(t))) return { name: `Sgr B${m[1]}`, pri: 0 };
  if ((m = /^M\s?(\d+)$/.exec(t))) return { name: `M ${m[1]}`, pri: 1 };
  if ((m = /^NGC\s?(\d+)$/.exec(t))) return { name: `NGC ${m[1]}`, pri: 2 };
  if ((m = /^IC\s?(\d+)$/.exec(t))) return { name: `IC ${m[1]}`, pri: 3 };
  if ((m = /^W\s?(\d+[A-Z]?)$/.exec(t))) return { name: `W ${m[1]}`, pri: 4 };
  if ((m = /^RCW\s?(\d+)$/i.exec(t))) return { name: `RCW ${m[1]}`, pri: 5 };
  if ((m = /^Gum\s?(\d+)$/.exec(t))) return { name: `Gum ${m[1]}`, pri: 6 };
  if ((m = /^DR\s?(\d+)$/.exec(t))) return { name: `DR ${m[1]}`, pri: 7 };
  if ((m = /^S(\d+)$/.exec(t))) return { name: `Sh 2-${m[1]}`, pri: 8 };
  if ((m = /^(K\d+-\d+)$/.exec(t))) return { name: m[1].replace('K', 'K '), pri: 9 };
  if ((m = /^(BFS)\s?(\d+)$/.exec(t))) return { name: `BFS ${m[2]}`, pri: 10 };
  return null;
}
/** All designations in a Note such as "(rus03),S17(bgs82),W51(kb94)". */
function designations(note) {
  const out = [];
  for (const m of note.matchAll(/(?:^|,)\s*([^,(]+?)\s*\(/g)) {
    const d = designation(m[1]);
    if (d) out.push(d);
  }
  return out;
}

export default function build() {
  checkQuote(
    PAPER,
    'If the photometric or trigonometric distance was not yet available, we determined the kinematic distance',
  );
  checkQuote(
    PAPER,
    'knear–the nearer kinematic distance is adopted; kfar–the farther kinematic distance is adopted; ktan–the tracer is located at the tangential point',
  );
  checkQuote(PAPER, 'the most recent updated values of R 0 = 8.3 kpc and Θ 0 = 239 km s -1');
  const bySeq = new Map();
  for (const r of vizier(TABLE)) {
    if (!bySeq.has(r.Seq)) bySeq.set(r.Seq, []);
    bySeq.get(r.Seq).push(r);
  }
  const stat = { regions: bySeq.size, photTrig: 0, kinematic: 0, noDistance: 0, rejected: 0 };
  const items = [];
  for (const [seq, rs] of bySeq) {
    let dRow = rs.find((r) => num(r.Dist) > 0);
    let kin = false;
    if (!dRow) {
      dRow = rs.find((r) => num(r['D8.3']) > 0);
      kin = true;
    }
    if (!dRow) {
      stat.noDistance++;
      continue;
    }
    const dist = kin ? num(dRow['D8.3']) : num(dRow.Dist);
    const l = num(dRow.GLON);
    const b = num(dRow.GLAT);
    if (l === null || b === null || !(dist >= 0.05 && dist <= 25)) {
      stat.rejected++;
      continue;
    }
    if (kin) stat.kinematic++;
    else stat.photTrig++;
    const first = (k) => rs.map((r) => num(r[k])).find((v) => v !== null) ?? null;
    const desig = rs.flatMap((r) => designations(r.Note));
    const uniq = [...new Map(desig.sort((p, q) => p.pri - q.pri).map((d) => [d.name, d])).values()];
    const gname = `G${dRow.GLON}${dRow.GLAT}`;
    const fluxRow = rs.find((r) => num(r.S) !== null);
    items.push({ seq, dRow, kin, dist, l, b, gname, names: uniq.map((d) => d.name), fluxRow, rs, first });
  }
  // Names, shared-name disambiguation and the brightest region of each famous name.
  const nameCount = new Map();
  for (const it of items) if (it.names[0]) nameCount.set(it.names[0], (nameCount.get(it.names[0]) ?? 0) + 1);
  const brightest = new Map();
  for (const it of items) {
    const n = it.names[0];
    const s = it.fluxRow ? num(it.fluxRow.S) : -1;
    if (n && FAMOUS.has(n) && s > (brightest.get(n)?.s ?? -2)) brightest.set(n, { s, it });
  }
  const rows = [];
  const ids = new Set();
  for (const it of items) {
    const base = it.names[0];
    const name = base ? (nameCount.get(base) > 1 ? `${base} (${it.gname})` : base) : `HII ${it.gname}`;
    let id = slug(name);
    if (ids.has(id)) id = `${id}-${it.seq}`;
    ids.add(id);
    const aliases = [
      ...(base && nameCount.get(base) > 1 ? [base] : []),
      ...(base ? [it.gname] : []),
      ...it.names.slice(1),
    ];
    const rank = base && brightest.get(base)?.it === it ? 3 : base ? 2 : !it.kin ? 1 : 0;
    const [x, y, z] = icrsFromLb(it.l, it.b, it.dist * 1000);
    const d = it.dRow;
    const kda = KDA[d.n_Dist] ?? (d.n_Dist ? d.n_Dist : null);
    const method = it.kin
      ? `Kinematic distance, flat rotation curve R0 = 8.3 kpc${kda ? `; ${kda}` : ''}`
      : `Photometric or trigonometric distance from the literature (reference key ${d.r_Dist || 'not stated'})`;
    rows.push([
      id,
      name,
      aliases,
      round(x, 1),
      round(y, 1),
      round(z, 1),
      rank,
      it.kin ? null : sig(it.dist * 1000, 4),
      it.kin ? sig(it.dist * 1000, 3) : null,
      it.kin ? null : num(d.e_Dist) === null ? null : sig(num(d.e_Dist) * 1000, 2),
      method,
      it.first('VLSR'),
      it.first('Te'),
      it.fluxRow ? num(it.fluxRow.S) : null,
      it.fluxRow ? num(it.fluxRow.n_S) : null,
    ]);
  }
  console.log('  hii-regions:', JSON.stringify(stat), `-> ${rows.length} rows`);
  return writeLayer({
    layer: 'hii-regions',
    title: 'Ionised hydrogen regions',
    noun: 'HII region (ionised gas around young hot stars)',
    sources: {
      hou: { cite: TABLE.cite, url: TABLE.url, license: TABLE.license },
      houPaper: { cite: PAPER.cite, url: PAPER.url, license: PAPER.license },
    },
    columns: [
      { key: 'id' },
      { key: 'name' },
      { key: 'aliases' },
      { key: 'x', source: 'hou' },
      { key: 'y' },
      { key: 'z' },
      { key: 'rank' },
      { key: 'dist', label: 'Distance (photometric or trigonometric)', unit: 'pc', source: 'hou', digits: 0 },
      {
        key: 'distKin',
        label: 'Distance (kinematic)',
        unit: 'pc',
        source: 'houPaper',
        approximate: true,
        digits: 0,
      },
      { key: 'distErr', label: 'Distance uncertainty', unit: 'pc', source: 'hou', digits: 0 },
      { key: 'method', label: 'Distance method', source: 'hou' },
      { key: 'vlsr', label: 'Velocity (LSR)', unit: 'km/s', source: 'hou' },
      { key: 'te', label: 'Electron temperature', unit: 'K', source: 'hou' },
      { key: 'flux', label: 'Radio continuum flux density', unit: 'Jy', source: 'hou' },
      { key: 'fluxFreq', label: 'Continuum frequency', unit: 'GHz', source: 'hou' },
    ],
    rows,
  });
}
