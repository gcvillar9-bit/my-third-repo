/**
 * Magellanic gas system: the Magellanic Stream, the Magellanic Bridge and the Leading Arm, drawn as guide
 * lines. Geometry comes from the Magellanic Stream coordinate system of Nidever, Majewski & Burton 2008
 * (pole, zero point, sense) and the extents they and Nidever et al. 2010 publish. Hand-entered values live in
 * magellanic.json with evidence quotes that are checked against the fetched pages.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEG,
  icrsFromGalacticXyz,
  lbFromIcrs,
  icrsFromRaDec,
  raDecFromIcrs,
  round,
  source,
  checkQuote,
  writeFeatures,
} from '../lib.mjs';

const paper = (id, arxiv, cite, url, file) => ({
  group: 'halo',
  id,
  cite,
  url,
  license: 'cited (no explicit licence)',
  attribution: cite,
  fetch: { kind: 'file', url: `https://ar5iv.labs.arxiv.org/html/${arxiv}`, file: `ar5iv-${file}.html` },
  outputs: ['data/milkyway/atlas/features-magellanic.json'],
});
const SRC = {
  nidever2008: paper(
    'nidever_2008',
    '0706.1578',
    'Nidever, Majewski & Burton 2008, ApJ 679, 432 (The Origin of the Magellanic Stream and Its Leading Arm)',
    'https://arxiv.org/abs/0706.1578',
    '0706.1578',
  ),
  nidever2010: paper(
    'nidever_2010',
    '1009.0001',
    'Nidever et al. 2010, ApJ 723, 1618 (The 200 Degree-Long Magellanic Stream System)',
    'https://arxiv.org/abs/1009.0001',
    '1009.0001',
  ),
  putman2003: paper(
    'putman_2003',
    'astro-ph/0209127',
    'Putman et al. 2003, ApJ 586, 170 (The Magellanic Stream, High-Velocity Clouds and the Sculptor Group)',
    'https://arxiv.org/abs/astro-ph/0209127',
    'astro-ph-0209127',
  ),
  harris2007: paper(
    'harris_2007',
    'astro-ph/0612107',
    'Harris 2007, ApJ 658, 345 (The Magellanic Bridge: The Nearest Purely Tidal Stellar Population)',
    'https://arxiv.org/abs/astro-ph/0612107',
    'astro-ph-0612107',
  ),
  venzmer2012: paper(
    'venzmer_2012',
    '1208.4953',
    'Venzmer, Kerp & Kalberla 2012, A&A (The four leading arms of the Magellanic Cloud system), doi:10.1051/0004-6361/201118677',
    'https://arxiv.org/abs/1208.4953',
    '1208.4953',
  ),
};
const LVDB_COMMIT = 'c40961a42d2beb302be1da90bca2016c284ef63c';
const LVDB = {
  group: 'halo',
  id: 'lvdb_dwarf_mw',
  cite: 'Pace 2024, The Local Volume Database: a library of the observed properties of nearby dwarf galaxies and star clusters (data/dwarf_mw.csv)',
  url: 'https://github.com/apace7/local_volume_database',
  license: 'CC0-1.0',
  attribution: 'Local Volume Database (Pace 2024), CC0',
  fetch: {
    kind: 'file',
    url: `https://raw.githubusercontent.com/apace7/local_volume_database/${LVDB_COMMIT}/data/dwarf_mw.csv`,
    file: `lvdb-${LVDB_COMMIT.slice(0, 8)}-dwarf_mw.csv`,
  },
  outputs: ['data/milkyway/atlas/satellites.json'],
};

const V = JSON.parse(readFileSync(join(import.meta.dirname, 'magellanic.json'), 'utf8')).values;
const used = new Set();
/** Checks the evidence quote of a hand-entered value against its fetched page and returns the value. */
function val(key) {
  const v = V[key];
  if (!v) throw new Error(`magellanic.json: no value ${key}`);
  const def = SRC[v.evidence.source];
  if (!def) throw new Error(`magellanic.json: ${key}: unknown source ${v.evidence.source}`);
  checkQuote(def, v.evidence.quote);
  const q = v.evidence.quote.replace(/\s+/g, '').replace(/[−–]/g, '-');
  const nums =
    typeof v.value === 'number' ? [v.value] : typeof v.value === 'object' ? Object.values(v.value) : [];
  for (const n of nums) {
    const a = Math.abs(n);
    let ok = q.includes(String(a));
    if (!ok && a >= 1e5) {
      const e = Math.floor(Math.log10(a));
      ok = q.includes(`${Number((a / 10 ** e).toPrecision(6))}×10${e}`);
    }
    if (!ok) throw new Error(`magellanic.json: ${key}: value ${n} is not in its quote`);
  }
  used.add(v.evidence.source);
  return v;
}

// ---------------------------------------------------------------------------------------------
// Magellanic Stream coordinates -> ICRS
// ---------------------------------------------------------------------------------------------
const gal = (l, b) => [
  Math.cos(b * DEG) * Math.cos(l * DEG),
  Math.cos(b * DEG) * Math.sin(l * DEG),
  Math.sin(b * DEG),
];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => a.map((v) => v / Math.hypot(...a));

function msFrame() {
  val('sense');
  const P = unit(gal(val('pole_l').value, val('pole_b').value));
  const lmc = gal(val('zero_l').value, val('zero_b').value);
  const e0 = unit(lmc.map((v, i) => v - dot(lmc, P) * P[i])); // L_MS = 0 on the equator, below the LMC centre
  let e1 = cross(P, e0);
  // L_MS decreases towards the tail (sense), and the tail runs through the south Galactic cap
  // (the great circle reaches b = -82.5 deg at l = 8.5 deg; L_MS = -90 lies at b about -56 deg); pick the orientation accordingly.
  const at = (L, B, s) => {
    const c = Math.cos(B * DEG);
    return [0, 1, 2].map(
      (i) => c * (Math.cos(L * DEG) * e0[i] + Math.sin(L * DEG) * s * e1[i]) + Math.sin(B * DEG) * P[i],
    );
  };
  if (at(-90, 0, 1)[2] > 0) e1 = e1.map((v) => -v);
  if (!(at(-90, 0, 1)[2] < -0.5))
    throw new Error('Magellanic frame: the tail does not reach the south Galactic cap');
  const toIcrs = (L, B, dKpc) => {
    const u = at(L, B, 1);
    return icrsFromGalacticXyz(u[0] * dKpc * 1000, u[1] * dKpc * 1000, u[2] * dKpc * 1000);
  };
  const toMs = (l, b) => {
    const u = gal(l, b);
    return { L: Math.atan2(dot(u, e1), dot(u, e0)) / DEG, B: Math.asin(dot(u, P)) / DEG };
  };
  return { toIcrs, toMs };
}

const mid = (pts) => pts[Math.floor((pts.length - 1) / 2)];
const lerp = (a, b, t) => a + (b - a) * t;

/** Cloud centres from the LVDB (ra, dec, distance modulus). */
function cloud(key) {
  const line = readFileSync(source(LVDB), 'utf8')
    .split('\n')
    .find((l) => l.startsWith(`${key},`));
  const c = line.split(',');
  const mu = Number(c[18]);
  const d = 10 ** (mu / 5 + 1);
  return {
    ra: Number(c[1]),
    dec: Number(c[2]),
    dKpc: d / 1000,
    xyz: icrsFromRaDec(Number(c[1]), Number(c[2]), d),
  };
}

export default function build() {
  const { toIcrs, toMs } = msFrame();
  const fmtPt = (p) => p.map(Math.round);

  // --- Magellanic Stream: along the equator B_MS = 0 from the LMC (L_MS = 0) to the tip -----------
  const lTip = val('ms_tip_lmin').value;
  const dTip = val('ms_tip_distance').value;
  const dHead = val('ms_distance').value;
  const msDist = (L) => (L >= -100 ? dHead : L > -120 ? lerp(dHead, dTip, (-100 - L) / 20) : dTip);
  const stream = [];
  for (let L = 0; L >= lTip; L -= 5) stream.push(toIcrs(L, 0, msDist(L)));
  const sMid = mid(stream);

  // --- Magellanic Bridge: from the LMC centre to the SMC centre (positions from the LVDB) ---------
  const lmc = cloud('lmc');
  const smc = cloud('smc');
  const bridge = [];
  const u0 = unit(lmc.xyz);
  const u1 = unit(smc.xyz);
  const om = Math.acos(Math.min(1, dot(u0, u1)));
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const w0 = Math.sin((1 - t) * om) / Math.sin(om);
    const w1 = Math.sin(t * om) / Math.sin(om);
    const u = unit([0, 1, 2].map((k) => w0 * u0[k] + w1 * u1[k]));
    const d = lerp(lmc.dKpc, smc.dKpc, t) * 1000;
    bridge.push(u.map((v) => v * d));
  }
  const bMid = mid(bridge);
  const bridgeSepDeg = om / DEG;

  // --- Leading Arm: through the centres of the complexes LA I and LA II ---------------------------
  const la1 = val('la1_box').value;
  const la2 = val('la2_box').value;
  const laDist = val('la_distance').value;
  const laPts = [
    [la1.lmin, (la1.bmin + la1.bmax) / 2],
    [(la1.lmin + la1.lmax) / 2, (la1.bmin + la1.bmax) / 2],
    [(la2.lmin + la2.lmax) / 2, (la2.bmin + la2.bmax) / 2],
    [la2.lmax, (la2.bmin + la2.bmax) / 2],
  ].map(([L, B]) => toIcrs(L, B, laDist));
  const laMid = laPts[1];

  // --- Checks against the published description -------------------------------------------------
  const check = (name, xyz) => {
    const g = lbFromIcrs(...xyz);
    const m = toMs(g.l, g.b);
    return `${name}: l=${g.l.toFixed(1)} b=${g.b.toFixed(1)} -> L_MS=${m.L.toFixed(1)} B_MS=${m.B.toFixed(1)}`;
  };
  console.log('  ' + check('LMC centre (LVDB)', lmc.xyz));
  console.log(
    '  ' + check('SMC centre (LVDB)', smc.xyz) + '   (Nidever 2008: SMC/Bridge gas near L_MS = -16)',
  );
  console.log('  ' + check('Stream tip', stream[stream.length - 1]));
  const tipRd = raDecFromIcrs(...stream[stream.length - 1]);
  console.log(
    `  Stream tip: RA ${tipRd.ra.toFixed(1)} Dec ${tipRd.dec.toFixed(1)} (Nidever 2010: continues to dec about +50 deg)`,
  );

  const msKm = (k) => val(k);
  const features = [
    {
      id: 'magellanic-stream',
      name: 'Magellanic Stream',
      aliases: ['MS'],
      type: 'gas-stream',
      noun: 'Neutral hydrogen gas stream (not visible to the eye)',
      rank: 3,
      x: Math.round(sMid[0]),
      y: Math.round(sMid[1]),
      z: Math.round(sMid[2]),
      positionSource: 'nidever2008',
      description:
        'A stream of neutral hydrogen gas pulled out of the Magellanic Clouds, seen only in 21-cm radio emission. ' +
        'The line is a guide along the Stream equator of the Magellanic Stream coordinate system; the distances ' +
        'along it are assumptions, not measurements.',
      facts: [
        {
          label: 'Length of the Stream (at least)',
          value: msKm('ms_length').value,
          unit: 'deg',
          source: 'nidever2010',
        },
        {
          label: 'Length of the Stream plus Leading Arm (at least)',
          value: msKm('system_length').value,
          unit: 'deg',
          source: 'nidever2010',
        },
        {
          label: 'Distance of the head (assumed)',
          value: dHead,
          unit: 'kpc',
          source: 'nidever2008',
          approximate: true,
        },
        {
          label: 'Distance of the tip (adopted)',
          value: dTip,
          unit: 'kpc',
          source: 'nidever2010',
          approximate: true,
        },
        {
          label: 'Neutral hydrogen mass (Bruns et al. 2005)',
          value: msKm('ms_mass_bruns').value,
          unit: 'solar masses',
          source: 'nidever2010',
          approximate: true,
        },
        {
          label: 'Neutral hydrogen mass (Putman et al. 2003, at 55 kpc)',
          value: msKm('ms_mass_putman').value,
          unit: 'solar masses',
          source: 'putman2003',
          approximate: true,
        },
        {
          label: 'Coordinate system',
          value: `Magellanic Stream coordinates: equator is the great circle with pole at (l, b) = (${V.pole_l.value}, ${V.pole_b.value}) deg; L_MS = 0 at the LMC centre`,
          source: 'nidever2008',
        },
        { label: 'Discovery', value: msKm('ms_discovery').value, source: 'nidever2010' },
      ],
      shape: { kind: 'polyline', points: stream.map(fmtPt), source: 'nidever2008' },
    },
    {
      id: 'magellanic-bridge',
      name: 'Magellanic Bridge',
      type: 'gas-stream',
      noun: 'Neutral hydrogen gas bridge (not visible to the eye)',
      rank: 2,
      x: Math.round(bMid[0]),
      y: Math.round(bMid[1]),
      z: Math.round(bMid[2]),
      positionSource: 'lvdb',
      description:
        'Neutral hydrogen gas between the Large and the Small Magellanic Cloud. The line is a guide from one Cloud ' +
        'centre to the other; the real gas is spread over a wide area.',
      facts: [
        {
          label: 'Angular separation of the two Cloud centres',
          value: round(bridgeSepDeg, 1),
          unit: 'deg',
          source: 'lvdb',
          approximate: true,
        },
        {
          label: 'Distance (adopted)',
          value: msKm('bridge_distance').value,
          unit: 'kpc',
          source: 'putman2003',
          approximate: true,
        },
        {
          label: 'Neutral hydrogen mass (at 55 kpc)',
          value: msKm('bridge_mass').value,
          unit: 'solar masses',
          source: 'putman2003',
          approximate: true,
        },
        { label: 'First reported', value: msKm('bridge_discovery').value, source: 'harris2007' },
      ],
      shape: { kind: 'polyline', points: bridge.map(fmtPt), source: 'lvdb' },
    },
    {
      id: 'leading-arm',
      name: 'Leading Arm',
      aliases: ['Magellanic Leading Arm'],
      type: 'gas-stream',
      noun: 'Neutral hydrogen gas stream (not visible to the eye)',
      rank: 2,
      x: Math.round(laMid[0]),
      y: Math.round(laMid[1]),
      z: Math.round(laMid[2]),
      positionSource: 'nidever2008',
      description:
        'Neutral hydrogen gas that leads the Magellanic Clouds along their orbit. The line is a guide through the ' +
        'centres of the two main complexes, LA I and LA II; the distance is an assumption.',
      facts: [
        {
          label: 'Extent of complex LA I (Magellanic longitude, latitude)',
          value: `${la1.lmin} to ${la1.lmax}, ${la1.bmin} to ${la1.bmax}`,
          unit: 'deg',
          source: 'nidever2008',
        },
        {
          label: 'Extent of complex LA II (Magellanic longitude, latitude)',
          value: `${la2.lmin} to ${la2.lmax}, ${la2.bmin} to ${la2.bmax}`,
          unit: 'deg',
          source: 'nidever2008',
        },
        { label: 'Distance (assumed)', value: laDist, unit: 'kpc', source: 'venzmer2012', approximate: true },
        {
          label: 'Neutral hydrogen mass (at b < 0)',
          value: msKm('la_mass').value,
          unit: 'solar masses',
          source: 'putman2003',
          approximate: true,
        },
        { label: 'Discovery', value: msKm('la_discovery').value, source: 'nidever2008' },
      ],
      shape: { kind: 'polyline', points: laPts.map(fmtPt), source: 'nidever2008' },
    },
  ];

  const sources = Object.fromEntries(
    Object.entries(SRC).map(([k, d]) => [k, { cite: d.cite, url: d.url, license: d.license }]),
  );
  sources.lvdb = { cite: LVDB.cite, url: LVDB.url, license: LVDB.license };
  return writeFeatures({ group: 'magellanic', sources, features });
}
