/**
 * Measured 3D dust near the Sun for the galaxy volume model: the posterior mean of Edenhofer et
 * al. 2024 (A parsec-scale Galactic 3D dust map out to 1.25 kpc from the Sun; Zenodo
 * 10.5281/zenodo.8187943, CC BY 4.0), resampled to a Cartesian cube in the model's axes.
 *
 * Not part of the default build (it needs 1.6 GB of the 3.3 GB source file):
 *   node tools/build-milkyway.mjs dust
 *
 * Source layout (FITS): extension MEAN is an image [516 distance bins] x [786432 HEALPix pixels,
 * NSIDE 256, NESTED, Galactic coordinates], extinction density in units of the unitless ZGR23
 * extinction per parsec; the table RADIAL PIXEL CENTERS holds the 516 logarithmically spaced
 * distances (69 to 1245 pc); MEAN OF INTEGRATED INNER 68.8 PC is the extinction integrated over the
 * removed inner sphere. A_V = 2.8 x ZGR23 (the paper, checked below).
 *
 * Outputs (public/data/milkyway/atlas/):
 *   dust-cube.png    the cube as an atlas of z slices (8-bit grey, value = 255 sqrt(kappa / kappaMax))
 *   dust-column.png  the vertical optical depth through the map (8-bit grey, 255 sqrt(tau / tauMax))
 *   dust.json        grid, encoding constants, the axes used and the source
 * kappa is the V-band opacity in 1/kpc (A_V per kpc / 1.0857), the unit of the galaxy model.
 * Cube axes: the model frame of src/modules/milkyway/model.ts (x from the Sun towards the Galactic
 * centre, y towards l = 90 deg, z towards the north of the model plane), origin at the Sun.
 */
import { closeSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { checkQuote, ICRS_TO_GALACTIC, OUT_DIR, round, sig, source } from '../lib.mjs';

const ZENODO = 'https://zenodo.org/api/records/8187943/files/mean_and_std_healpix.fits/content';
const CITE =
  'Edenhofer et al. 2024, A&A 685, A82 (arXiv:2308.01295): 3D dust map out to 1.25 kpc, posterior mean';
const COMMON = {
  group: 'dust',
  cite: CITE,
  url: 'https://doi.org/10.5281/zenodo.8187943',
  license: 'CC-BY-4.0',
  attribution:
    'Edenhofer, Zucker, Frank, Saydjari, Speagle, Finkbeiner & Ensslin 2024 (Zenodo 10.5281/zenodo.8187943)',
  outputs: [
    'data/milkyway/atlas/dust-cube.png',
    'data/milkyway/atlas/dust-column.png',
    'data/milkyway/atlas/dust.json',
  ],
};
/** Primary header plus the MEAN image (the first 1.62 GB of the file). */
const MEAN = {
  ...COMMON,
  id: 'edenhofer_2024_mean',
  fetch: { kind: 'file', url: ZENODO, file: 'edenhofer_2024_mean.part', range: '0-1623300000' },
};
/** The small tables at the end of the file: distance bins and the integrated inner sphere. */
const TAIL_START = 3246000000;
const TAIL = {
  ...COMMON,
  id: 'edenhofer_2024_tables',
  fetch: { kind: 'file', url: ZENODO, file: 'edenhofer_2024_tables.part', range: `${TAIL_START}-3252715199` },
};
const PAPER = {
  group: 'dust',
  id: 'edenhofer_2024_paper',
  cite: 'Edenhofer et al. 2024, A&A 685, A82 (arXiv:2308.01295), text',
  url: 'https://arxiv.org/abs/2308.01295',
  license: 'CC-BY-4.0',
  fetch: {
    kind: 'file',
    url: 'https://ar5iv.labs.arxiv.org/html/2308.01295',
    file: 'edenhofer_2024_paper.html',
  },
  outputs: ['data/milkyway/atlas/dust.json'],
};

/** A_V per unit of the map (the paper: "multiplied the unitless ZGR23 extinction by a factor of 2.8"). */
const AV_PER_ZGR23 = 2.8;
const VOXEL = 8; // pc
const HALF = [1252, 1252, 380]; // half extents of the cube, pc
const TILE_COLS = 10;
const R0_KPC = 8.178;
const Z0_KPC = 0.0208;
const SGRA = { ra: 266.41683708, dec: -29.00781056 };

const DEG = Math.PI / 180;

/** mw (Galactic) axes -> model axes, row-major: the construction of MW_TO_MODEL in model.ts. */
function mwToModel() {
  const a = SGRA.ra * DEG;
  const d = SGRA.dec * DEG;
  const icrs = [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
  const G = ICRS_TO_GALACTIC;
  const g = [0, 1, 2].map((r) => G[3 * r] * icrs[0] + G[3 * r + 1] * icrs[1] + G[3 * r + 2] * icrs[2]);
  const s = g.map((v) => -v); // centre -> Sun
  const norm = (v) => {
    const l = Math.hypot(...v);
    return v.map((x) => x / l);
  };
  const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
  const n0 = [0, 0, 1];
  const ym = norm(cross(s, n0));
  const k = s[2];
  const n1 = norm([n0[0] - k * s[0], n0[1] - k * s[1], n0[2] - k * s[2]]);
  const th = Math.asin(Z0_KPC / R0_KPC);
  const zm = [0, 1, 2].map((i) => Math.cos(th) * n1[i] + Math.sin(th) * s[i]);
  const xm = cross(ym, zm);
  return [...xm, ...ym, ...zm];
}

function fitsHeader(fd, offset) {
  const cards = {};
  const buf = Buffer.alloc(2880);
  let pos = offset;
  for (;;) {
    if (readSync(fd, buf, 0, 2880, pos) !== 2880)
      throw new Error('dust: FITS header runs past the downloaded range');
    pos += 2880;
    let end = false;
    for (let i = 0; i < 2880; i += 80) {
      const card = buf.toString('latin1', i, i + 80);
      const key = card.slice(0, 8).trim();
      if (key === 'END') end = true;
      else if (card[8] === '=')
        cards[key] = card.slice(10).split(' /')[0].trim().replace(/^'|'$/g, '').trim();
    }
    if (end) return { cards, data: pos };
  }
}

function readFloatsBE(fd, offset, count) {
  const out = new Float32Array(count);
  const bytes = Buffer.from(out.buffer);
  let done = 0;
  while (done < bytes.length) {
    const n = readSync(fd, bytes, done, Math.min(1 << 26, bytes.length - done), offset + done);
    if (n <= 0) throw new Error('dust: short read');
    done += n;
  }
  bytes.swap32();
  return out;
}

const NSIDE = 256;
const NPIX = 12 * NSIDE * NSIDE;
const SPREAD = new Uint32Array(NSIDE);
for (let v = 0; v < NSIDE; v++) {
  let r = 0;
  for (let i = 0; i < 8; i++) r |= ((v >> i) & 1) << (2 * i);
  SPREAD[v] = r;
}
/** HEALPix NESTED pixel of a direction given by z = cos(colatitude) and the azimuth phi. */
function ang2pixNest(z, phi) {
  const za = Math.abs(z);
  let tt = (phi / (Math.PI / 2)) % 4;
  if (tt < 0) tt += 4;
  let face;
  let ix;
  let iy;
  if (za <= 2 / 3) {
    const t1 = NSIDE * (0.5 + tt);
    const t2 = NSIDE * z * 0.75;
    const jp = Math.floor(t1 - t2);
    const jm = Math.floor(t1 + t2);
    const ifp = Math.floor(jp / NSIDE);
    const ifm = Math.floor(jm / NSIDE);
    face = ifp === ifm ? (ifp & 3) | 4 : ifp < ifm ? ifp & 3 : (ifm & 3) + 8;
    ix = jm & (NSIDE - 1);
    iy = NSIDE - (jp & (NSIDE - 1)) - 1;
  } else {
    const ntt = Math.min(3, Math.floor(tt));
    const tp = tt - ntt;
    const tmp = NSIDE * Math.sqrt(3 * (1 - za));
    const jp = Math.min(Math.floor(tp * tmp), NSIDE - 1);
    const jm = Math.min(Math.floor((1 - tp) * tmp), NSIDE - 1);
    if (z >= 0) {
      face = ntt;
      ix = NSIDE - jm - 1;
      iy = NSIDE - jp - 1;
    } else {
      face = ntt + 8;
      ix = jp;
      iy = jm;
    }
  }
  return face * NSIDE * NSIDE + SPREAD[ix] + 2 * SPREAD[iy];
}

export default async function build() {
  checkQuote(PAPER, 'multiplied the unitless ZGR23 extinction by a factor of 2.8');
  checkQuote(PAPER, '516 logarithmically spaced distance bins spanning 69 pc to 1250 pc');
  checkQuote(PAPER, 'we removed the innermost 69 pc');

  // --- Tables at the end of the file ------------------------------------------------------
  const tfd = openSync(source(TAIL), 'r');
  const tailSize = readFileSync(source(TAIL)).length;
  let radii = null;
  let inner = null;
  let innerPc = 0;
  for (let off = (2880 - (TAIL_START % 2880)) % 2880; off + 2880 <= tailSize; off += 2880) {
    const probe = Buffer.alloc(8);
    readSync(tfd, probe, 0, 8, off);
    if (probe.toString('latin1') !== 'XTENSION') continue;
    const h = fitsHeader(tfd, off);
    const name = h.cards.EXTNAME ?? '';
    if (name === 'RADIAL PIXEL CENTERS') {
      if (h.cards.CUNIT !== 'pc') throw new Error('dust: distance bins are not in pc');
      radii = readFloatsBE(tfd, h.data, Number(h.cards.NAXIS2));
    } else if (name.startsWith('MEAN OF INTEGRATED INNER')) {
      innerPc = Number(/INNER ([\d.]+) PC/.exec(name)[1]);
      inner = readFloatsBE(tfd, h.data, Number(h.cards.NAXIS1));
    }
  }
  closeSync(tfd);
  if (!radii || !inner || inner.length !== NPIX)
    throw new Error('dust: tables not found in the tail of the file');
  const NR = radii.length;
  const lr0 = Math.log(radii[0]);
  const dlr = (Math.log(radii[NR - 1]) - lr0) / (NR - 1);
  for (let k = 0; k < NR; k++)
    if (Math.abs(Math.log(radii[k]) - (lr0 + k * dlr)) > 2e-3)
      throw new Error('dust: distance bins are not logarithmic');

  // --- The mean map ---------------------------------------------------------------------------
  const fd = openSync(source(MEAN), 'r');
  const h = fitsHeader(fd, fitsHeader(fd, 0).data);
  const c = h.cards;
  if (
    c.EXTNAME !== 'MEAN' ||
    Number(c.NAXIS1) !== NPIX ||
    Number(c.NAXIS2) !== NR ||
    c.ORDERING !== 'NEST' ||
    Number(c.NSIDE) !== NSIDE
  )
    throw new Error(`dust: unexpected MEAN extension ${JSON.stringify(c)}`);
  console.log(`  dust: reading ${NR} shells of ${NPIX} pixels`);
  const mean = readFloatsBE(fd, h.data, NR * NPIX);
  closeSync(fd);

  /** Extinction density (map units per pc) at a heliocentric Galactic position, pc. */
  const sample = (gx, gy, gz) => {
    const r = Math.sqrt(gx * gx + gy * gy + gz * gz);
    if (r > radii[NR - 1] || r < 1e-6) return 0;
    const pix = ang2pixNest(gz / r, Math.atan2(gy, gx));
    if (r < radii[0]) return inner[pix] / innerPc;
    const t = (Math.log(r) - lr0) / dlr;
    const k = Math.min(NR - 2, Math.floor(t));
    const f = t - k;
    return mean[k * NPIX + pix] * (1 - f) + mean[(k + 1) * NPIX + pix] * f;
  };
  const KAPPA = (AV_PER_ZGR23 * 1000) / 1.0857; // map units per pc -> V-band opacity per kpc

  // Sanity: the map is in Galactic coordinates and the HEALPix lookup is right when known clouds
  // are dense where they are. [name, l, b, distance pc]
  const ball = (l, b, d, rad) => {
    const cl = [
      d * Math.cos(b * DEG) * Math.cos(l * DEG),
      d * Math.cos(b * DEG) * Math.sin(l * DEG),
      d * Math.sin(b * DEG),
    ];
    let s = 0;
    let n = 0;
    for (let x = -rad; x <= rad; x += 4)
      for (let y = -rad; y <= rad; y += 4)
        for (let z = -rad; z <= rad; z += 4) {
          s += sample(cl[0] + x, cl[1] + y, cl[2] + z);
          n++;
        }
    return (s / n) * AV_PER_ZGR23 * 1000; // A_V per kpc
  };
  const checks = {};
  for (const [name, l, b, d] of [
    ['Taurus', 171, -15, 140],
    ['Ophiuchus', 353.5, 17, 139],
    ['Orion A', 211, -19.5, 420],
    ['Perseus', 159.5, -20, 290],
    ['void towards the north Galactic pole', 0, 90, 400],
  ])
    checks[name] = round(ball(l, b, d, 16), 2);
  console.log(`  dust: mean A_V per kpc in 32 pc boxes: ${JSON.stringify(checks)}`);
  for (const k of ['Taurus', 'Ophiuchus', 'Orion A', 'Perseus'])
    if (!(checks[k] > 3))
      throw new Error(`dust: ${k} is not dense in the map (${checks[k]} mag/kpc): wrong coordinates?`);
  if (!(checks['void towards the north Galactic pole'] < 0.3))
    throw new Error('dust: the Galactic pole is not empty');

  // --- Resample to the cube (model axes, origin at the Sun) ---------------------------------
  const M = mwToModel(); // rows: model x, y, z in Galactic axes; its transpose maps model -> Galactic
  const n = HALF.map((hv) => Math.round((2 * hv) / VOXEL));
  const [nx, ny, nz] = n;
  const kappa = new Float32Array(nx * ny * nz);
  const sub = [-VOXEL / 4, VOXEL / 4];
  let k = 0;
  for (let iz = 0; iz < nz; iz++) {
    const mz = -HALF[2] + (iz + 0.5) * VOXEL;
    for (let iy = 0; iy < ny; iy++) {
      const my = -HALF[1] + (iy + 0.5) * VOXEL;
      for (let ix = 0; ix < nx; ix++, k++) {
        const mx = -HALF[0] + (ix + 0.5) * VOXEL;
        let s = 0;
        for (const dz of sub)
          for (const dy of sub)
            for (const dx of sub) {
              const x = mx + dx;
              const y = my + dy;
              const z = mz + dz;
              s += sample(
                M[0] * x + M[3] * y + M[6] * z,
                M[1] * x + M[4] * y + M[7] * z,
                M[2] * x + M[5] * y + M[8] * z,
              );
            }
        kappa[k] = (s / 8) * KAPPA;
      }
    }
  }
  // Vertical optical depth through the whole map (not only the cube), one sample per 8 pc.
  const tau = new Float32Array(nx * ny);
  for (let iy = 0; iy < ny; iy++) {
    const my = -HALF[1] + (iy + 0.5) * VOXEL;
    for (let ix = 0; ix < nx; ix++) {
      const mx = -HALF[0] + (ix + 0.5) * VOXEL;
      let s = 0;
      for (let z = -1244; z <= 1244; z += VOXEL)
        s += sample(
          M[0] * mx + M[3] * my + M[6] * z,
          M[1] * mx + M[4] * my + M[7] * z,
          M[2] * mx + M[5] * my + M[8] * z,
        );
      tau[iy * nx + ix] = (s * KAPPA * VOXEL) / 1000;
    }
  }

  // --- Encode ---------------------------------------------------------------------------------
  const quantile = (arr, q) => {
    const v = Array.from(arr)
      .filter((x) => x > 0)
      .sort((a, b) => a - b);
    return v[Math.min(v.length - 1, Math.floor(q * v.length))];
  };
  const kappaMax = sig(
    quantile(
      kappa.filter((_, i) => i % 7 === 0),
      0.9995,
    ),
    3,
  );
  const tauMax = sig(quantile(tau, 0.9995), 3);
  const enc = (v, max) => Math.round(255 * Math.sqrt(Math.min(1, Math.max(0, v) / max)));
  const rows = Math.ceil(nz / TILE_COLS);
  const atlas = Buffer.alloc(TILE_COLS * nx * rows * ny);
  const W = TILE_COLS * nx;
  for (let iz = 0; iz < nz; iz++) {
    const ox = (iz % TILE_COLS) * nx;
    const oy = Math.floor(iz / TILE_COLS) * ny;
    for (let iy = 0; iy < ny; iy++)
      for (let ix = 0; ix < nx; ix++)
        atlas[(oy + iy) * W + ox + ix] = enc(kappa[(iz * ny + iy) * nx + ix], kappaMax);
  }
  const column = Buffer.alloc(nx * ny);
  for (let i = 0; i < nx * ny; i++) column[i] = enc(tau[i], tauMax);
  mkdirSync(OUT_DIR, { recursive: true });
  const png = { compressionLevel: 9, adaptiveFiltering: true };
  await sharp(atlas, { raw: { width: W, height: rows * ny, channels: 1 } })
    .toColourspace('b-w')
    .png(png)
    .toFile(join(OUT_DIR, 'dust-cube.png'));
  await sharp(column, { raw: { width: nx, height: ny, channels: 1 } })
    .toColourspace('b-w')
    .png(png)
    .toFile(join(OUT_DIR, 'dust-column.png'));

  // Statistics for the tests and the docs: the local mid-plane opacity and the column at the Sun.
  let s = 0;
  let cnt = 0;
  for (let iz = Math.floor(nz / 2) - 3; iz <= Math.floor(nz / 2) + 3; iz++)
    for (let iy = 0; iy < ny; iy++)
      for (let ix = 0; ix < nx; ix++) {
        const x = -HALF[0] + (ix + 0.5) * VOXEL;
        const y = -HALF[1] + (iy + 0.5) * VOXEL;
        if (x * x + y * y > 500 * 500) continue;
        s += kappa[(iz * ny + iy) * nx + ix];
        cnt++;
      }
  const meta = {
    description:
      'Measured 3D dust near the Sun (Edenhofer et al. 2024, posterior mean), resampled to a cube in the model axes of src/modules/milkyway/model.ts with the Sun at the centre. dust-cube.png: z slices as tiles, row-major, slice 0 = lowest z; grey value g gives the V-band opacity kappa = kappaMax (g / 255)^2 in 1/kpc (A_V per kpc = 1.0857 kappa). dust-column.png: the vertical optical depth through the whole map, tau = tauMax (g / 255)^2.',
    source: { cite: CITE, url: COMMON.url, license: COMMON.license },
    voxelPc: VOXEL,
    size: n,
    halfPc: HALF,
    tileCols: TILE_COLS,
    kappaMax,
    tauMax,
    radiusPc: round(radii[NR - 1], 1),
    innerPc,
    avPerMapUnit: AV_PER_ZGR23,
    mwToModel: M.map((v) => round(v, 9)),
    stats: {
      localAvPerKpc: round((s / cnt) * 1.0857, 3),
      meanTau: round(tau.reduce((a, b) => a + b, 0) / tau.length, 4),
      clipped: round(kappa.reduce((a, v) => a + (v > kappaMax ? 1 : 0), 0) / kappa.length, 6),
      cloudsAvPerKpc: checks,
    },
  };
  writeFileSync(join(OUT_DIR, 'dust.json'), JSON.stringify(meta) + '\n');
  const size = (f) => readFileSync(join(OUT_DIR, f)).length;
  console.log(
    `  dust: cube ${n.join('x')} at ${VOXEL} pc -> dust-cube.png ${(size('dust-cube.png') / 1e6).toFixed(2)} MB, dust-column.png ${(size('dust-column.png') / 1e3).toFixed(0)} KB; kappaMax ${kappaMax} /kpc, tauMax ${tauMax}; local A_V ${meta.stats.localAvPerKpc} mag/kpc`,
  );
}
