#!/usr/bin/env node
/**
 * build-galaxies (P5-A): Celestia data/galaxies.dsc (GPL-2.0-or-later) -> public/data/galaxies/galaxies.bin
 * + names.json, src/modules/galaxies/named.json (the ten famous galaxies used for bookmarks) and gallery.json (those ten
 * plus 44 more, for search, info cards and labels). Deterministic and re-runnable. Format: docs/modules/galaxies.md.
 *
 * Celestia keys: RA in hours, Dec in degrees (J2000), Distance and Radius in light years, AbsMag (B),
 * Axis/Angle = orientation in Celestia's ecliptic "universal" axes (x_ecl, z_ecl, -y_ecl). Calibrated on
 * the Milky Way entry: rotating Celestia's template normal (+y) by -Angle about Axis gives the north
 * Galactic pole to 1e-3, and M 31 comes out at 77.8 deg inclination. The Milky Way itself is dropped
 * (the milkyway module draws it).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PUBLIC, ROOT } from './lib/fetch.mjs';
import { writeFormatted } from './lib/format.mjs';
import { ensureModuleAssets } from './lib/manifest.mjs';

export const MAGIC = 0x584c4147; // 'GALX' little-endian
export const VERSION = 1;
export const HEADER_BYTES = 16;
export const NO_NAME = 0xffff;
/** Hubble type codes (index = code). */
export const TYPES = [
  'E0',
  'E1',
  'E2',
  'E3',
  'E4',
  'E5',
  'E6',
  'E7',
  'S0',
  'Sa',
  'Sb',
  'Sc',
  'SBa',
  'SBb',
  'SBc',
  'Irr',
];

const D = Math.PI / 180;
const LY_PER_PC = 3.261563777167433;
const EPS = 23.4392911 * D; // J2000 obliquity (IAU 1976), Celestia's ecliptic
const R0_MPC = 8.178e-3;
// Copies of src/core/frames.ts ICRS_TO_GALACTIC and GALACTIC_TO_SUPERGALACTIC (unit test cross-checks).
const A = [
  -0.0548755604162154, -0.873437090234885, -0.4838350155487132, 0.4941094278755837, -0.4448296299600112,
  0.7469822444972189, -0.8676661490190047, -0.1980763734312015, 0.4559837761750669,
];
const unitLB = (l, b) => [
  Math.cos(b * D) * Math.cos(l * D),
  Math.cos(b * D) * Math.sin(l * D),
  Math.sin(b * D),
];
const SG = (() => {
  const x = unitLB(137.37, 0);
  const z = unitLB(47.37, 6.32);
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  return [...x, ...y, ...z];
})();
const mul = (m, v) => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];
const icrs = (raDeg, decDeg) => [
  Math.cos(decDeg * D) * Math.cos(raDeg * D),
  Math.cos(decDeg * D) * Math.sin(raDeg * D),
  Math.sin(decDeg * D),
];
const SGRA = mul(A, icrs(266.41683708, -29.00781056));
const SSB_IN_MW_MPC = SGRA.map((g) => -g * R0_MPC);

/** ICRS direction + distance (Mpc from the Sun) -> universe frame (supergalactic axes, MW centre), Mpc. */
export function icrsToUniverse(raDeg, decDeg, distMpc) {
  const g = mul(A, icrs(raDeg, decDeg));
  return mul(
    SG,
    [0, 1, 2].map((i) => g[i] * distMpc + SSB_IN_MW_MPC[i]),
  );
}

const rotAxisAngle = (axis, ang, v) => {
  const n = Math.hypot(...axis) || 1;
  const k = axis.map((x) => x / n);
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const kv = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  const kx = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
  return v.map((x, i) => x * c + kx[i] * s + k[i] * kv * (1 - c));
};

/**
 * Galaxy-local -> universe rotation as a unit quaternion [x, y, z, w] (w >= 0). Local axes: disc in the
 * xy-plane, normal +z (Celestia's template: disc in xz, normal +y).
 */
export function orientationQuat(axis, angleDeg) {
  const toUniverse = (v) => {
    const cel = rotAxisAngle(axis, -angleDeg * D, [v[0], v[2], -v[1]]);
    const ecl = [cel[0], -cel[2], cel[1]];
    const eq = [
      ecl[0],
      Math.cos(EPS) * ecl[1] - Math.sin(EPS) * ecl[2],
      Math.sin(EPS) * ecl[1] + Math.cos(EPS) * ecl[2],
    ];
    return mul(SG, mul(A, eq));
  };
  const [cx, cy, cz] = [toUniverse([1, 0, 0]), toUniverse([0, 1, 0]), toUniverse([0, 0, 1])];
  // Row-major m with columns = images of the local axes.
  const m = [cx[0], cy[0], cz[0], cx[1], cy[1], cz[1], cx[2], cy[2], cz[2]];
  const tr = m[0] + m[4] + m[8];
  let q;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    q = [(m[7] - m[5]) * s, (m[2] - m[6]) * s, (m[3] - m[1]) * s, 0.25 / s];
  } else if (m[0] > m[4] && m[0] > m[8]) {
    const s = 2 * Math.sqrt(1 + m[0] - m[4] - m[8]);
    q = [0.25 * s, (m[1] + m[3]) / s, (m[2] + m[6]) / s, (m[7] - m[5]) / s];
  } else if (m[4] > m[8]) {
    const s = 2 * Math.sqrt(1 + m[4] - m[0] - m[8]);
    q = [(m[1] + m[3]) / s, 0.25 * s, (m[5] + m[7]) / s, (m[2] - m[6]) / s];
  } else {
    const s = 2 * Math.sqrt(1 + m[8] - m[0] - m[4]);
    q = [(m[2] + m[6]) / s, (m[5] + m[7]) / s, 0.25 * s, (m[3] - m[1]) / s];
  }
  const n = Math.hypot(...q) * (q[3] < 0 ? -1 : 1);
  return q.map((x) => x / n);
}

/** Parses every `Galaxy "<names>" { ... }` block. */
export function parseGalaxies(text) {
  const rows = [];
  for (const m of text.matchAll(/Galaxy\s+"([^"]+)"\s*\{([^}]*)\}/g)) {
    const body = m[2];
    const num = (k) => {
      const r = body.match(new RegExp(`^\\s*${k}\\s+([-+0-9.eE]+)`, 'm'));
      return r ? Number(r[1]) : NaN;
    };
    const type = body.match(/Type\s+"([^"]+)"/)?.[1] ?? 'Irr';
    const ax = body.match(/Axis\s*\[\s*([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s*\]/);
    rows.push({
      names: m[1].split(':').map((s) => s.trim()),
      type,
      raDeg: num('RA') * 15,
      decDeg: num('Dec'),
      distLy: num('Distance'),
      radiusLy: num('Radius'),
      absMag: num('AbsMag'),
      axis: ax ? [Number(ax[1]), Number(ax[2]), Number(ax[3])] : [0, 0, 1],
      angleDeg: num('Angle') || 0,
    });
  }
  return rows;
}

/** Packs galaxy records into the GALX v1 layout (see docs/modules/galaxies.md). */
export function encodeGalaxies(recs) {
  const n = recs.length;
  const buf = new ArrayBuffer(HEADER_BYTES + 27 * n);
  const h = new Uint32Array(buf, 0, 4);
  h.set([MAGIC, VERSION, n, 0]);
  let o = HEADER_BYTES;
  const pos = new Float32Array(buf, o, 3 * n);
  o += 12 * n;
  const radius = new Float32Array(buf, o, n);
  o += 4 * n;
  const absMag = new Float32Array(buf, o, n);
  o += 4 * n;
  const quat = new Int8Array(buf, o, 4 * n);
  o += 4 * n;
  const nameIdx = new Uint16Array(buf, o, n);
  o += 2 * n;
  const type = new Uint8Array(buf, o, n);
  recs.forEach((r, i) => {
    pos.set(r.pos, 3 * i);
    radius[i] = r.radiusKpc;
    absMag[i] = r.absMag;
    for (let k = 0; k < 4; k++) quat[4 * i + k] = Math.max(-127, Math.min(127, Math.round(r.quat[k] * 127)));
    nameIdx[i] = r.nameIdx;
    type[i] = r.type;
  });
  return new Uint8Array(buf);
}

/** The ten named galaxies: [id, title, catalogue designation (first match), aliases, subtitle]. */
export const NAMED = [
  ['m31', 'Andromeda Galaxy', 'M 31', ['M31', 'NGC 224', 'Andromeda'], 'Spiral galaxy, Local Group'],
  ['m33', 'Triangulum Galaxy', 'M 33', ['M33', 'NGC 598', 'Triangulum'], 'Spiral galaxy, Local Group'],
  ['lmc', 'Large Magellanic Cloud', 'LMC', ['LMC'], 'Satellite of the Milky Way'],
  ['smc', 'Small Magellanic Cloud', 'SMC', ['SMC', 'NGC 292'], 'Satellite of the Milky Way'],
  ['m87', 'M87 (Virgo A)', 'M 87', ['M87', 'Virgo A', 'NGC 4486'], 'Giant elliptical, Virgo Cluster'],
  ['m81', "Bode's Galaxy (M81)", 'M 81', ['M81', 'NGC 3031', "Bode's Galaxy"], 'Spiral galaxy, M81 Group'],
  ['m82', 'Cigar Galaxy (M82)', 'M 82', ['M82', 'NGC 3034', 'Cigar Galaxy'], 'Starburst galaxy, M81 Group'],
  ['m104', 'Sombrero Galaxy (M104)', 'M 104', ['M104', 'NGC 4594', 'Sombrero'], 'Spiral galaxy, Virgo'],
  ['m51', 'Whirlpool Galaxy (M51)', 'M 51', ['M51', 'NGC 5194', 'Whirlpool'], 'Interacting spiral galaxy'],
  ['cena', 'Centaurus A', 'NGC 5128', ['NGC 5128', 'Cen A'], 'Peculiar galaxy, radio source'],
];

/** The 44 galaxies added to the ten: [id, title, catalogue designation, aliases, subtitle]. */
const EXTRA = [
  ['m32', 'M32', 'M 32', ['M32', 'NGC 221'], 'Compact elliptical, satellite of Andromeda'],
  ['m110', 'M110', 'M 110', ['M110', 'NGC 205'], 'Dwarf elliptical, satellite of Andromeda'],
  ['m49', 'M49', 'M 49', ['M49', 'NGC 4472'], 'Giant elliptical, Virgo Cluster'],
  ['ngc5195', 'NGC 5195', 'NGC 5195', ['NGC 5195', 'M51b'], 'Companion of the Whirlpool Galaxy'],
  ['m58', 'M58', 'M 58', ['M58', 'NGC 4579'], 'Barred spiral galaxy, Virgo Cluster'],
  ['m59', 'M59', 'M 59', ['M59', 'NGC 4621'], 'Elliptical galaxy, Virgo Cluster'],
  ['m60', 'M60', 'M 60', ['M60', 'NGC 4649'], 'Giant elliptical, Virgo Cluster'],
  ['m61', 'M61', 'M 61', ['M61', 'NGC 4303'], 'Barred spiral galaxy, Virgo Cluster'],
  [
    'm63',
    'Sunflower Galaxy (M63)',
    'M 63',
    ['M63', 'NGC 5055', 'Sunflower Galaxy'],
    'Flocculent spiral galaxy',
  ],
  [
    'm64',
    'Black Eye Galaxy (M64)',
    'M 64',
    ['M64', 'NGC 4826', 'Black Eye Galaxy'],
    'Spiral galaxy with a dark dust band',
  ],
  ['m65', 'M65', 'M 65', ['M65', 'NGC 3623'], 'Spiral galaxy, Leo Triplet'],
  ['m66', 'M66', 'M 66', ['M66', 'NGC 3627'], 'Barred spiral galaxy, Leo Triplet'],
  ['m74', 'Phantom Galaxy (M74)', 'M 74', ['M74', 'NGC 628', 'Phantom Galaxy'], 'Grand-design spiral galaxy'],
  ['m77', 'M77', 'M 77', ['M77', 'NGC 1068', 'Cetus A'], 'Barred spiral galaxy, active nucleus'],
  [
    'm83',
    'Southern Pinwheel Galaxy (M83)',
    'M 83',
    ['M83', 'NGC 5236', 'Southern Pinwheel'],
    'Barred spiral galaxy',
  ],
  ['m84', 'M84', 'M 84', ['M84', 'NGC 4374'], 'Elliptical galaxy, Virgo Cluster'],
  ['m85', 'M85', 'M 85', ['M85', 'NGC 4382'], 'Lenticular galaxy, Virgo Cluster'],
  ['m86', 'M86', 'M 86', ['M86', 'NGC 4406'], 'Elliptical galaxy, Virgo Cluster'],
  ['m88', 'M88', 'M 88', ['M88', 'NGC 4501'], 'Spiral galaxy, Virgo Cluster'],
  ['m89', 'M89', 'M 89', ['M89', 'NGC 4552'], 'Elliptical galaxy, Virgo Cluster'],
  ['m90', 'M90', 'M 90', ['M90', 'NGC 4569'], 'Spiral galaxy, Virgo Cluster'],
  ['m91', 'M91', 'M 91', ['M91', 'NGC 4548'], 'Barred spiral galaxy, Virgo Cluster'],
  ['m94', 'M94', 'M 94', ['M94', 'NGC 4736'], 'Ringed spiral galaxy'],
  ['m95', 'M95', 'M 95', ['M95', 'NGC 3351'], 'Barred spiral galaxy, Leo I Group'],
  ['m96', 'M96', 'M 96', ['M96', 'NGC 3368'], 'Spiral galaxy, Leo I Group'],
  ['m98', 'M98', 'M 98', ['M98', 'NGC 4192'], 'Spiral galaxy, Virgo Cluster'],
  ['m99', 'M99', 'M 99', ['M99', 'NGC 4254', 'Coma Pinwheel'], 'Spiral galaxy, Virgo Cluster'],
  ['m100', 'M100', 'M 100', ['M100', 'NGC 4321'], 'Grand-design spiral galaxy, Virgo Cluster'],
  ['m101', 'Pinwheel Galaxy (M101)', 'M 101', ['M101', 'NGC 5457', 'Pinwheel Galaxy'], 'Spiral galaxy'],
  [
    'm102',
    'Spindle Galaxy (M102)',
    'M 102',
    ['M102', 'NGC 5866', 'Spindle Galaxy'],
    'Edge-on lenticular galaxy',
  ],
  ['m105', 'M105', 'M 105', ['M105', 'NGC 3379'], 'Elliptical galaxy, Leo I Group'],
  ['m106', 'M106', 'M 106', ['M106', 'NGC 4258'], 'Spiral galaxy, active nucleus'],
  ['m108', 'M108', 'M 108', ['M108', 'NGC 3556', 'Surfboard Galaxy'], 'Barred spiral galaxy, nearly edge-on'],
  ['m109', 'M109', 'M 109', ['M109', 'NGC 3992'], 'Barred spiral galaxy'],
  [
    'ngc253',
    'Sculptor Galaxy (NGC 253)',
    'NGC 253',
    ['NGC 253', 'Sculptor Galaxy', 'Silver Coin'],
    'Starburst spiral galaxy',
  ],
  ['ngc1300', 'NGC 1300', 'NGC 1300', ['NGC 1300'], 'Barred spiral galaxy'],
  [
    'ngc1365',
    'Great Barred Spiral (NGC 1365)',
    'NGC 1365',
    ['NGC 1365', 'Great Barred Spiral'],
    'Barred spiral galaxy, Fornax Cluster',
  ],
  ['ngc4565', 'Needle Galaxy (NGC 4565)', 'NGC 4565', ['NGC 4565', 'Needle Galaxy'], 'Edge-on spiral galaxy'],
  ['ngc891', 'NGC 891', 'NGC 891', ['NGC 891', 'Silver Sliver'], 'Edge-on spiral galaxy'],
  ['ngc6946', 'Fireworks Galaxy (NGC 6946)', 'NGC 6946', ['NGC 6946', 'Fireworks Galaxy'], 'Spiral galaxy'],
  [
    'antennae',
    'Antennae Galaxies (NGC 4038/4039)',
    'NGC 4038',
    ['NGC 4038', 'NGC 4039', 'Antennae'],
    'Merging pair of galaxies',
  ],
  [
    'ngc4631',
    'Whale Galaxy (NGC 4631)',
    'NGC 4631',
    ['NGC 4631', 'Whale Galaxy'],
    'Edge-on barred spiral galaxy',
  ],
  [
    'ngc6822',
    "Barnard's Galaxy (NGC 6822)",
    'NGC 6822',
    ['NGC 6822', "Barnard's Galaxy"],
    'Dwarf irregular galaxy, Local Group',
  ],
  [
    'ngc3628',
    'Hamburger Galaxy (NGC 3628)',
    'NGC 3628',
    ['NGC 3628', 'Hamburger Galaxy'],
    'Edge-on spiral galaxy, Leo Triplet',
  ],
];

/** The gallery: the ten named galaxies first (same order), then 44 more. */
export const GALLERY = [...NAMED, ...EXTRA];

const r6 = (v) => Number(v.toFixed(6));

export function buildGalaxies(text) {
  const rows = parseGalaxies(text).filter((r) => r.names[0] !== 'Milky Way');
  const recs = [];
  const names = [];
  for (const r of rows) {
    if (![r.raDeg, r.decDeg, r.distLy, r.absMag].every(Number.isFinite)) continue;
    const distMpc = r.distLy / LY_PER_PC / 1e6;
    const code = TYPES.indexOf(r.type);
    recs.push({
      pos: icrsToUniverse(r.raDeg, r.decDeg, distMpc),
      radiusKpc: Number.isFinite(r.radiusLy) ? r.radiusLy / LY_PER_PC / 1e3 : 5,
      absMag: r.absMag,
      quat: orientationQuat(r.axis, r.angleDeg),
      nameIdx: names.length,
      type: code < 0 ? TYPES.length - 1 : code,
    });
    names.push(r.names.slice(0, 3).join(':'));
  }
  const rowsOf = (list, withKey) =>
    list.map(([id, title, key, aliases, subtitle]) => {
      const i = names.findIndex((n) => n.split(':').includes(key));
      if (i < 0) throw new Error(`build-galaxies: ${key} not found`);
      const rec = recs[i];
      const row = rows.find((x) => x.names.includes(key));
      return {
        id,
        ...(withKey ? { key } : {}),
        title,
        aliases,
        subtitle,
        index: i,
        type: TYPES[rec.type],
        pos: rec.pos.map(r6),
        distSunMpc: r6(row.distLy / LY_PER_PC / 1e6),
        radiusKpc: Number(rec.radiusKpc.toFixed(3)),
        absMag: rec.absMag,
        quat: rec.quat.map(r6),
        source: 'CelestiaContent data/galaxies.dsc (GPL-2.0-or-later)',
      };
    });
  const named = rowsOf(NAMED, false);
  const gallery = rowsOf(GALLERY, true);
  return { recs, names, named, gallery };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const paths = await ensureModuleAssets('galaxies');
  const { recs, names, named, gallery } = buildGalaxies(readFileSync(paths.get('celestia_galaxies'), 'utf8'));
  const out = join(PUBLIC, 'data', 'galaxies');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'galaxies.bin'), encodeGalaxies(recs));
  writeFileSync(
    join(out, 'names.json'),
    JSON.stringify({
      source: 'CelestiaContent data/galaxies.dsc (GPL-2.0-or-later); up to three designations per galaxy',
      names,
    }) + '\n',
  );
  await writeFormatted(
    join(ROOT, 'src', 'modules', 'galaxies', 'named.json'),
    JSON.stringify({ source: 'tools/build-galaxies.mjs', galaxies: named }),
  );
  await writeFormatted(
    join(ROOT, 'src', 'modules', 'galaxies', 'gallery.json'),
    JSON.stringify({ source: 'tools/build-galaxies.mjs', galaxies: gallery }),
  );
  const m31 = named[0];
  console.log(
    `build-galaxies: ${recs.length} galaxies -> public/data/galaxies/galaxies.bin; M31 ${m31.distSunMpc} Mpc, R ${m31.radiusKpc} kpc, M ${m31.absMag}`,
  );
}
