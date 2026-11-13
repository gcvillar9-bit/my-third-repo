/**
 * Stellar streams of the Milky Way halo: galstreams (Mateu 2023, MNRAS 520, 5225). One feature per
 * stream that has a default track ("On" = 1 in the master log). The 3D track (ra, dec, distance) is
 * resampled to at most N_POINTS points evenly spaced along its length.
 */
import { readFileSync } from 'node:fs';
import { DEG, icrsFromRaDec, round, slug, source, writeFeatures } from '../lib.mjs';

const COMMIT = '6a304c05bea7f774390a11082ea127719e99b70a';
const RAW = `https://raw.githubusercontent.com/cmateu/galstreams/${COMMIT}/galstreams`;
const N_POINTS = 48;
const D_MIN_KPC = 0.3;
const D_MAX_KPC = 300;
const CITE = 'Mateu 2023, MNRAS 520, 5225 (galstreams: a library of Milky Way stream footprints and tracks)';

const def = (id, path, extra = {}) => ({
  group: 'halo',
  id,
  cite: CITE,
  url: 'https://github.com/cmateu/galstreams',
  license: 'BSD-3-Clause',
  attribution: 'galstreams (Mateu 2023), BSD-3-Clause',
  fetch: {
    kind: 'file',
    url: `${RAW}/${path}`,
    file: `galstreams-${COMMIT.slice(0, 8)}/${path.replace(/\//g, '_')}`,
  },
  outputs: ['data/milkyway/atlas/features-streams.json'],
  ...extra,
});

const DISPLAY = { Pal5: 'Palomar 5', Pal13: 'Palomar 13', Pal15: 'Palomar 15', Willka_Yaku: 'Willka Yaku' };
const RANK3 = new Set(['Sagittarius', 'GD-1', 'Orphan-Chenab', 'Pal5']);

/** 'PriceWhelan2018' -> 'PriceWhelan 2018'; keys carry a suffix after '_' that is dropped. */
const refText = (key) =>
  key
    .split(',')
    .map((k) => k.replace(/_.*$/, '').replace(/^([A-Za-z]+)(\d{4})$/, '$1 $2'))
    .join(', ');

const table = (path, id) =>
  readFileSync(source(def(id, path)), 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => l.trim().split(/\s+/));

function readTrack(path) {
  const lines = readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#'));
  const head = lines[0].split(',');
  const ix = { ra: head.indexOf('ra'), dec: head.indexOf('dec'), d: head.indexOf('distance') };
  if (Object.values(ix).some((v) => v < 0))
    throw new Error(`track ${path}: missing ra, dec or distance column`);
  return lines.slice(1).map((l) => {
    const c = l.split(',');
    return [Number(c[ix.ra]), Number(c[ix.dec]), Number(c[ix.d])];
  });
}

/** Great-circle separation (deg) of two sky positions in degrees. */
function sep(a, b) {
  const [a1, d1, a2, d2] = [a[0] * DEG, a[1] * DEG, b[0] * DEG, b[1] * DEG];
  const s = Math.sin((d2 - d1) / 2) ** 2 + Math.cos(d1) * Math.cos(d2) * Math.sin((a2 - a1) / 2) ** 2;
  return (2 * Math.asin(Math.min(1, Math.sqrt(s)))) / DEG;
}

/** Point at fraction t (0..1) of the cumulative length `cum` along `pts`. */
function resample(pts, n) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++)
    cum.push(cum[i - 1] + Math.hypot(...pts[i].map((v, k) => v - pts[i - 1][k])));
  const total = cum[cum.length - 1];
  const at = (s) => {
    let lo = 0;
    let hi = cum.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (cum[m] <= s) lo = m;
      else hi = m;
    }
    const f = cum[hi] > cum[lo] ? (s - cum[lo]) / (cum[hi] - cum[lo]) : 0;
    return pts[lo].map((v, k) => v + f * (pts[hi][k] - v));
  };
  return { out: Array.from({ length: n }, (_, i) => at((total * i) / (n - 1))), mid: at(total / 2), total };
}

export default function build() {
  const log = table('lib/master_log.txt', 'galstreams_master_log'); // [Imp, On, TrackName, Name, TrackRefs, Latex, Notes, ...]
  const disc = new Map(
    table('lib/master_log.discovery_refs.txt', 'galstreams_discovery_refs').map((c) => [c[0], c]),
  );
  const comments = table('lib/master_log.comments.txt', 'galstreams_comments').map((c) => [
    c[0],
    c[1] ?? '-',
  ]);

  const features = [];
  const rejected = [];
  for (const c of log) {
    const [imp, on, trackName, name, trackRef, trackRefLatex, notes] = c;
    if (on !== '1') continue;
    const file = `tracks/track.${imp}.${name}.${trackRef}.ecsv`;
    let pts;
    try {
      pts = readTrack(source(def(`galstreams_track_${slug(trackName)}`, file)));
    } catch (e) {
      rejected.push(`${name}: ${e.message.slice(0, 90)}`);
      continue;
    }
    if (
      pts.length < 2 ||
      pts.some(
        (p) => !p.every(Number.isFinite) || p[2] < D_MIN_KPC || p[2] > D_MAX_KPC || Math.abs(p[1]) > 90,
      )
    ) {
      const finite = pts.filter((p) => p.every(Number.isFinite));
      rejected.push(
        `${name}: non-finite or implausible distances (${finite.length}/${pts.length} finite, ` +
          `${finite.length ? Math.min(...finite.map((p) => p[2])).toFixed(2) + '-' + Math.max(...finite.map((p) => p[2])).toFixed(1) : 'none'} kpc)`,
      );
      continue;
    }
    let angular = 0;
    for (let i = 1; i < pts.length; i++) angular += sep(pts[i - 1], pts[i]);
    const dists = pts.map((p) => p[2]);
    const dLo = Math.min(...dists);
    const dHi = Math.max(...dists);
    const xyz = pts.map((p) => icrsFromRaDec(p[0], p[1], p[2] * 1000));
    const { out, mid } = resample(xyz, N_POINTS);
    const d = disc.get(name);
    const aliases = [
      ...comments
        .filter(
          ([k, v]) => v !== '-' && k === name && /^(M|NGC|Pal)\d/.test(name) && !/[_"…]|^\.\.\.$/.test(v),
        )
        .flatMap(([, v]) => v.split(',')),
      ...comments.filter(([k, v]) => v !== '-' && k !== name && v.split(',').includes(name)).map(([k]) => k),
      ...comments
        .filter(
          ([k, v]) =>
            v !== '-' && name.includes('-') && name.split('-').includes(k) && !/[_"…]|^\.\.\.$/.test(v),
        )
        .flatMap(([, v]) => v.split(',')),
    ].filter((a, i, arr) => a && a !== name && arr.indexOf(a) === i && !/[_"?]/.test(a));
    const facts = [
      {
        label: 'Angular length of the track',
        value: round(angular, 1),
        unit: 'deg',
        source: 'galstreams',
        approximate: true,
      },
      {
        label: 'Distance range along the track',
        value: `${round(dLo, 1)} to ${round(dHi, 1)}`,
        unit: 'kpc',
        source: 'galstreams',
        approximate: true,
      },
      { label: 'Track reference', value: refText(trackRefLatex), source: 'galstreams' },
    ];
    if (d) facts.push({ label: 'Discovery', value: `${d[1]}: ${refText(d[2])}`, source: 'galstreams' });
    if (notes === 'GC')
      facts.push({
        label: 'Progenitor (globular cluster)',
        value: name.includes('-') ? name.split('-')[0] : name,
        source: 'galstreams',
      });
    features.push({
      id: slug(name),
      name: DISPLAY[name] ?? name.replace(/_/g, ' '),
      ...(aliases.length ? { aliases } : {}),
      type: 'stream',
      noun: 'Stellar stream',
      rank: RANK3.has(name) ? 3 : angular > 30 ? 2 : 1,
      x: Math.round(mid[0]),
      y: Math.round(mid[1]),
      z: Math.round(mid[2]),
      positionSource: 'galstreams',
      facts,
      shape: { kind: 'polyline', points: out.map((p) => p.map(Math.round)), source: 'galstreams' },
    });
  }
  console.log(`  streams: ${features.length} written, ${rejected.length} rejected`);
  for (const r of rejected) console.log(`    rejected ${r}`);
  return writeFeatures({
    group: 'streams',
    sources: {
      galstreams: { cite: CITE, url: 'https://github.com/cmateu/galstreams', license: 'BSD-3-Clause' },
    },
    features,
  });
}
