/**
 * Pulsars of the ATNF Pulsar Catalogue (Manchester et al. 2005, AJ 129, 1993; psrcat database v2.9.0,
 * read from the version line of the downloaded file). Position from RAJ / DECJ. Distance, best first:
 * parallax PX when PX >= 3 x its uncertainty (1 / PX), else DIST_A (association or other independent
 * estimate), else DIST_DM (from the dispersion measure, YMW16 model; approximate). Distances above
 * 60 kpc are rejected. Pulsars timed in ecliptic coordinates (no RAJ) use ELONG / ELAT with the
 * obliquity 84381.4059 arcsec that psrcat itself uses (defineParams.c in the same tarball). The first value of a repeated keyword is used. Characteristic age = P0 / (2 P1).
 * Rank rule: 3 = FAMOUS (listed by B or J name), 2 = associated with a supernova remnant or pulsar
 * wind nebula (ASSOC SNR: or PWN:), 1 = has a B name (a pulsar of the early surveys) or a parallax
 * distance, 0 = the rest.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CACHE,
  DEG,
  checkQuote,
  dmsToDeg,
  hmsToDeg,
  icrsFromRaDec,
  num,
  round,
  run,
  sig,
  slug,
  source,
  writeLayer,
} from '../lib.mjs';

const DB = {
  group: 'disc',
  id: 'atnf_psrcat',
  cite: 'Manchester, Hobbs, Teoh & Hobbs 2005, AJ 129, 1993 (ATNF Pulsar Catalogue, psrcat database)',
  url: 'https://www.atnf.csiro.au/research/pulsar/psrcat',
  license:
    'cited (ATNF/CSIRO database; the catalogue page asks to acknowledge Manchester et al. 2005 and the web address)',
  attribution:
    'Manchester, R. N., Hobbs, G. B., Teoh, A. & Hobbs, M. 2005, AJ 129, 1993; ATNF Pulsar Catalogue, CSIRO',
  fetch: {
    kind: 'file',
    url: 'https://www.atnf.csiro.au/research/pulsar/psrcat/downloads/psrcat_pkg.tar.gz',
  },
  outputs: ['data/milkyway/atlas/pulsars.json'],
};
const DOWNLOAD_PAGE = {
  group: 'disc',
  id: 'atnf_psrcat_terms',
  cite: 'ATNF Pulsar Catalogue, download page (copyright and referencing)',
  url: 'https://www.atnf.csiro.au/research/pulsar/psrcat/download.html',
  license: 'cited (ATNF/CSIRO database)',
  fetch: {
    kind: 'file',
    url: 'https://www.atnf.csiro.au/research/pulsar/psrcat/download.html',
    file: 'psrcat_download.html',
  },
  outputs: ['data/milkyway/atlas/pulsars.json'],
};
const FAMOUS = new Set([
  'B0531+21', // Crab
  'B0833-45', // Vela
  'J0633+1746', // Geminga
  'B1919+21', // first pulsar
  'B1913+16', // Hulse-Taylor binary
  'J0737-3039A', // double pulsar
  'B1257+12', // first planets
  'J0437-4715', // nearest millisecond pulsar
  'B1937+21', // first millisecond pulsar
]);

/** Uncertainty from the catalogue's last-digit convention: 0.53 with 6 means 0.53 +- 0.06. */
const errOf = (valStr, errStr) => {
  if (errStr === undefined || !/^\d+$/.test(errStr)) return null;
  const [mant, exp = '0'] = valStr.split(/[eE]/);
  const dec = (mant.split('.')[1] ?? '').length;
  return Number(errStr) * 10 ** -dec * 10 ** Number(exp);
};

function readCatalogue(path) {
  const text = readFileSync(path, 'utf8');
  const version = /^#CATALOGUE\s+(\S+)/m.exec(text)?.[1] ?? null;
  const records = [];
  for (const block of text.split(/^@-+\s*$/m)) {
    const rec = {};
    for (const line of block.split('\n')) {
      if (!line.trim() || line.startsWith('#')) continue;
      const t = line.trim().split(/\s+/);
      const k = t[0];
      if (k in rec) continue; // first value is the preferred one
      const hasErr = t.length > 2 && /^\d+$/.test(t[2]);
      rec[k] = { v: t[1], e: hasErr ? t[2] : undefined, raw: t.slice(1).join(' ') };
    }
    if (rec.PSRJ) records.push(rec);
  }
  return { version, records };
}

const clean = (s) =>
  [
    ...new Set(
      s
        .replace(/\[[^\]]*\]/g, '')
        .split(',')
        .map((x) => x.trim())
        .filter((x) => x && !x.endsWith(':')),
    ),
  ].join(', ');

export default function build() {
  const tgz = source(DB);
  checkQuote(
    DOWNLOAD_PAGE,
    'The ATNF Pulsar Catalogue", R. N. Manchester, G. B. Hobbs, A. Teoh & M. Hobbs, Astronomical Journal, 129, 1993-2006 (2005)',
  );
  const dir = join(CACHE, 'psrcat');
  const dbPath = join(dir, 'psrcat_tar', 'psrcat.db');
  if (!existsSync(dbPath) || !existsSync(join(dir, 'psrcat_tar', 'defineParams.c'))) {
    mkdirSync(dir, { recursive: true });
    run('tar', ['-xzf', tgz, '-C', dir, 'psrcat_tar/psrcat.db', 'psrcat_tar/defineParams.c']);
  }
  if (!readFileSync(join(dir, 'psrcat_tar', 'defineParams.c'), 'utf8').includes('84381.4059'))
    throw new Error('pulsars: the psrcat obliquity constant 84381.4059 is not in defineParams.c');
  const eps = (84381.4059 / 3600) * DEG;
  const { version, records } = readCatalogue(dbPath);
  const stat = {
    total: records.length,
    noPosition: 0,
    ecliptic: 0,
    noDistance: 0,
    tooFar: 0,
    byParallax: 0,
    byAssociation: 0,
    byDm: 0,
  };
  const rows = [];
  for (const r of records) {
    const j = r.PSRJ.v;
    const b = r.PSRB?.v ?? null;
    let ra;
    let dec;
    if (r.RAJ && r.DECJ) {
      ra = hmsToDeg(r.RAJ.v);
      dec = dmsToDeg(r.DECJ.v);
    } else if (num(r.ELONG?.v) !== null && num(r.ELAT?.v) !== null) {
      const lam = num(r.ELONG.v) * DEG;
      const bet = num(r.ELAT.v) * DEG;
      const ex = Math.cos(bet) * Math.cos(lam);
      const ey = Math.cos(bet) * Math.sin(lam) * Math.cos(eps) - Math.sin(bet) * Math.sin(eps);
      const ez = Math.cos(bet) * Math.sin(lam) * Math.sin(eps) + Math.sin(bet) * Math.cos(eps);
      ra = (Math.atan2(ey, ex) / DEG + 360) % 360;
      dec = Math.asin(ez) / DEG;
      stat.ecliptic++;
    } else {
      stat.noPosition++;
      continue;
    }
    const px = r.PX ? num(r.PX.v) : null;
    const pxErr = r.PX ? errOf(r.PX.v, r.PX.e) : null;
    let dist = null;
    let err = null;
    let method = null;
    let dmDist = false;
    if (px > 0 && pxErr > 0 && px >= 3 * pxErr) {
      dist = 1 / px;
      err = pxErr / (px * px);
      method = `Parallax (${r.PX.raw.split(/\s+/).pop()})`;
      stat.byParallax++;
    } else if (num(r.DIST_A?.v) > 0) {
      dist = num(r.DIST_A.v);
      const e = errOf(r.DIST_A.v, r.DIST_A.e);
      err = e ?? (r.DIST_AMN && r.DIST_AMX ? (num(r.DIST_AMX.v) - num(r.DIST_AMN.v)) / 2 : null);
      method = `Association or independent estimate (${r.DIST_A.raw.split(/\s+/).pop()})`;
      stat.byAssociation++;
    } else if (num(r.DIST_DM?.v) > 0) {
      dist = num(r.DIST_DM.v);
      method = `Dispersion measure, ${r.DIST_DM.raw.split(/\s+/).pop()} electron-density model`;
      dmDist = true;
      stat.byDm++;
    } else {
      stat.noDistance++;
      continue;
    }
    if (!(dist > 0) || dist > 60) {
      stat.tooFar++;
      if (px > 0 && method.startsWith('Parallax')) stat.byParallax--;
      else if (dmDist) stat.byDm--;
      else stat.byAssociation--;
      continue;
    }
    const [x, y, z] = icrsFromRaDec(ra, dec, dist * 1000);
    // Period and its derivative from P0/P1, or from F0/F1.
    let p0 = num(r.P0?.v);
    let p1 = num(r.P1?.v);
    const f0 = num(r.F0?.v);
    const f1 = num(r.F1?.v);
    if (p0 === null && f0 > 0) p0 = 1 / f0;
    if (p1 === null && f0 > 0 && f1 !== null) p1 = -f1 / (f0 * f0);
    const age = p0 > 0 && p1 > 0 ? p0 / (2 * p1) / 3.15576e7 : null;
    const assoc = r.ASSOC ? clean(r.ASSOC.v) : null;
    const rank =
      FAMOUS.has(b) || FAMOUS.has(j)
        ? 3
        : assoc && /(^|, )(SNR|PWN):/.test(assoc)
          ? 2
          : b || method.startsWith('Parallax')
            ? 1
            : 0;
    rows.push([
      slug(j),
      `PSR ${j}`,
      b ? [`PSR ${b}`, b] : [],
      round(x, 1),
      round(y, 1),
      round(z, 1),
      rank,
      dmDist ? null : sig(dist * 1000, 4),
      dmDist ? sig(dist * 1000, 3) : null,
      err === null ? null : sig(err * 1000, 2),
      method,
      p0 > 0 ? sig(p0, 8) : null,
      p1 > 0 || p1 < 0 ? sig(p1, 4) : null,
      num(r.DM?.v),
      age === null ? null : sig(age, 3),
      assoc || null,
      r.TYPE ? clean(r.TYPE.v) : null,
    ]);
  }
  console.log(`  pulsars: catalogue v${version}`, JSON.stringify(stat), `-> ${rows.length} rows`);
  return writeLayer({
    layer: 'pulsars',
    title: 'Pulsars',
    noun: 'Pulsar (rotating neutron star)',
    sources: {
      atnf: { cite: `${DB.cite}, version ${version}`, url: DB.url, license: DB.license },
    },
    columns: [
      { key: 'id' },
      { key: 'name' },
      { key: 'aliases' },
      { key: 'x', source: 'atnf' },
      { key: 'y' },
      { key: 'z' },
      { key: 'rank' },
      { key: 'dist', label: 'Distance', unit: 'pc', source: 'atnf', digits: 0 },
      {
        key: 'distDm',
        label: 'Distance from the dispersion measure',
        unit: 'pc',
        source: 'atnf',
        approximate: true,
        digits: 0,
      },
      { key: 'distErr', label: 'Distance uncertainty', unit: 'pc', source: 'atnf', digits: 0 },
      { key: 'method', label: 'Distance method (reference key)', source: 'atnf' },
      { key: 'p0', label: 'Spin period', unit: 's', source: 'atnf' },
      { key: 'p1', label: 'Period derivative', unit: 's/s', source: 'atnf' },
      { key: 'dm', label: 'Dispersion measure', unit: 'pc/cm3', source: 'atnf' },
      { key: 'age', label: 'Characteristic age (P0 / 2 P1)', unit: 'yr', source: 'atnf', approximate: true },
      { key: 'assoc', label: 'Association', source: 'atnf' },
      { key: 'type', label: 'Type codes', source: 'atnf' },
    ],
    rows,
  });
}
