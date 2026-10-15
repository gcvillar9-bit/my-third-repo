#!/usr/bin/env node
/**
 * build-stars (P1-B, DESIGN 4.1): HYG v4.1 -> public/data/stars/{stars.bin,names.json};
 * Solar System Scope Milky Way panorama -> public/textures/stars/milkyway_diffuse_{2k,4k}.webp with point
 * stars suppressed (HYG supplies the stars); three.js MilkyWay cube -> fallback_{px,nx,py,ny,pz,nz}.webp.
 * Formats: docs/modules/data-formats.md. Deterministic and re-runnable.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv } from './lib/csv.mjs';
import { PUBLIC } from './lib/fetch.mjs';
import sharp from 'sharp';
import { img, morph, writeWebp } from './lib/image.mjs';
import { ensureModuleAssets } from './lib/manifest.mjs';
import {
  FLAG_DIST_UNKNOWN,
  FLAG_HIPPARCOS,
  FLAG_MULTIPLE,
  FLAG_NAMED,
  FLAG_VARIABLE,
  NAME_NONE,
  encodeStars,
} from './lib/stars-format.mjs';

const PC_PER_YR_TO_KMS = 3.0856775814913673e13 / 31557600; // 977792.2 km/s per pc/yr
const VEL_CLAMP = 60000; // km/s, inside binary16 range
const DIST_PLACEHOLDER = 100000; // HYG: no usable parallax

/** Hand-entered corrections where HYG (Hipparcos) photometry is off for a famous star. */
const BV_OVERRIDES = [
  {
    hip: 27989,
    name: 'Betelgeuse',
    bv: 1.85,
    source: 'Yale Bright Star Catalogue 5th ed., HR 2061: B-V = +1.85 (HYG/Hipparcos lists 1.500)',
  },
];

const GREEK = {
  Alp: 'α',
  Bet: 'β',
  Gam: 'γ',
  Del: 'δ',
  Eps: 'ε',
  Zet: 'ζ',
  Eta: 'η',
  The: 'θ',
  Iot: 'ι',
  Kap: 'κ',
  Lam: 'λ',
  Mu: 'μ',
  Nu: 'ν',
  Xi: 'ξ',
  Omi: 'ο',
  Pi: 'π',
  Rho: 'ρ',
  Sig: 'σ',
  Tau: 'τ',
  Ups: 'υ',
  Phi: 'φ',
  Chi: 'χ',
  Psi: 'ψ',
  Ome: 'ω',
};
const SUP = { 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };

const CONSTELLATIONS = {
  And: 'Andromeda',
  Ant: 'Antlia',
  Aps: 'Apus',
  Aqr: 'Aquarius',
  Aql: 'Aquila',
  Ara: 'Ara',
  Ari: 'Aries',
  Aur: 'Auriga',
  Boo: 'Boötes',
  Cae: 'Caelum',
  Cam: 'Camelopardalis',
  Cnc: 'Cancer',
  CVn: 'Canes Venatici',
  CMa: 'Canis Major',
  CMi: 'Canis Minor',
  Cap: 'Capricornus',
  Car: 'Carina',
  Cas: 'Cassiopeia',
  Cen: 'Centaurus',
  Cep: 'Cepheus',
  Cet: 'Cetus',
  Cha: 'Chamaeleon',
  Cir: 'Circinus',
  Col: 'Columba',
  Com: 'Coma Berenices',
  CrA: 'Corona Australis',
  CrB: 'Corona Borealis',
  Crv: 'Corvus',
  Crt: 'Crater',
  Cru: 'Crux',
  Cyg: 'Cygnus',
  Del: 'Delphinus',
  Dor: 'Dorado',
  Dra: 'Draco',
  Equ: 'Equuleus',
  Eri: 'Eridanus',
  For: 'Fornax',
  Gem: 'Gemini',
  Gru: 'Grus',
  Her: 'Hercules',
  Hor: 'Horologium',
  Hya: 'Hydra',
  Hyi: 'Hydrus',
  Ind: 'Indus',
  Lac: 'Lacerta',
  Leo: 'Leo',
  LMi: 'Leo Minor',
  Lep: 'Lepus',
  Lib: 'Libra',
  Lup: 'Lupus',
  Lyn: 'Lynx',
  Lyr: 'Lyra',
  Men: 'Mensa',
  Mic: 'Microscopium',
  Mon: 'Monoceros',
  Mus: 'Musca',
  Nor: 'Norma',
  Oct: 'Octans',
  Oph: 'Ophiuchus',
  Ori: 'Orion',
  Pav: 'Pavo',
  Peg: 'Pegasus',
  Per: 'Perseus',
  Phe: 'Phoenix',
  Pic: 'Pictor',
  Psc: 'Pisces',
  PsA: 'Piscis Austrinus',
  Pup: 'Puppis',
  Pyx: 'Pyxis',
  Ret: 'Reticulum',
  Sge: 'Sagitta',
  Sgr: 'Sagittarius',
  Sco: 'Scorpius',
  Scl: 'Sculptor',
  Sct: 'Scutum',
  Ser: 'Serpens',
  Sex: 'Sextans',
  Tau: 'Taurus',
  Tel: 'Telescopium',
  Tri: 'Triangulum',
  TrA: 'Triangulum Australe',
  Tuc: 'Tucana',
  UMa: 'Ursa Major',
  UMi: 'Ursa Minor',
  Vel: 'Vela',
  Vir: 'Virgo',
  Vol: 'Volans',
  Vul: 'Vulpecula',
};

/** HYG Bayer code ('Alp', 'Gam1', 'Gam-1', 'b') -> display ('α', 'γ¹', 'b'). */
function bayerDisplay(code) {
  if (!code) return null;
  const m = /^([A-Z][a-z]{1,2})-?(\d)?$/.exec(code);
  if (m && GREEK[m[1]]) return GREEK[m[1]] + (m[2] ? SUP[m[2]] : '');
  return code;
}

const num = (s) => (s === '' || s == null ? NaN : Number(s));

function buildCatalog(csvPath) {
  const { rows } = parseCsv(readFileSync(csvPath, 'utf8'));
  const overrides = new Map(BV_OVERRIDES.map((o) => [o.hip, o]));
  const stars = [];
  for (const r of rows) {
    if (r.id === '0') continue; // the Sun
    const dist = num(r.dist);
    const distUnknown = !(dist > 0) || dist >= DIST_PLACEHOLDER;
    const hip = r.hip ? Number(r.hip) : null;
    let bv = num(r.ci);
    if (hip != null && overrides.has(hip)) bv = overrides.get(hip).bv;
    const clampV = (v) =>
      distUnknown || !Number.isFinite(v)
        ? 0
        : Math.max(-VEL_CLAMP, Math.min(VEL_CLAMP, v * PC_PER_YR_TO_KMS));
    const flam = r.flam ? Number(r.flam) : null;
    const named = !!(r.proper || r.bayer || flam);
    let flags = 0;
    if (r.var) flags |= FLAG_VARIABLE;
    if (r.base) flags |= FLAG_MULTIPLE;
    if (distUnknown) flags |= FLAG_DIST_UNKNOWN;
    if (hip != null) flags |= FLAG_HIPPARCOS;
    stars.push({
      id: Number(r.id),
      mag: num(r.mag),
      x: num(r.x),
      y: num(r.y),
      z: num(r.z),
      absMag: num(r.absmag),
      vx: clampV(num(r.vx)),
      vy: clampV(num(r.vy)),
      vz: clampV(num(r.vz)),
      bv: Number.isFinite(bv) ? bv : null,
      flags,
      named,
      hip,
      proper: r.proper || null,
      bayer: bayerDisplay(r.bayer),
      flam,
      con: r.con || null,
    });
  }
  // Brightest first; ties by HYG id for determinism.
  stars.sort((a, b) => a.mag - b.mag || a.id - b.id);
  const names = [];
  stars.forEach((s, i) => {
    s.nameIndex = NAME_NONE;
    if (s.named && names.length < NAME_NONE) {
      s.nameIndex = names.length;
      s.flags |= FLAG_NAMED;
      names.push([i, s.hip, s.proper, s.bayer, s.flam, s.con]);
    }
  });
  return { stars, names };
}

/** Linear -> sRGB transfer (IEC 61966-2-1). */
const linearToSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** Panorama WebP quality (sRGB-encoded storage keeps the dark sky above a few DN, so it needs the bits). */
const MILKY_WAY_QUALITY = 90;

async function buildMilkyWay(src, outDir) {
  // 0. Upstream rows run from the south galactic pole (top) to the north; flip so north is up (checked
  // against HYG: bright-star pixel score 226 vs 13 for every other convention).
  // 1. 5x5 median at 8k removes isolated point stars; 2. morphological opening (min then max, radius 2)
  // removes residual bright specks while keeping the extended glow; 3. box-downsample to 4k/2k in float.
  // The runtime treats the upstream 8-bit values as linear light (stars/milkyway.ts MILKY_WAY_LUMINANCE), so the
  // tiers store those same linear values sRGB-encoded (the GPU decodes them back): the dark sky (0-10 of 255
  // upstream) keeps the sub-DN precision of the downsampling instead of being quantised to a few DN, and the
  // encoder spends bits there instead of leaving flat blocks.
  const med = await img(src).removeAlpha().flip().median(5).raw().toBuffer({ resolveWithObject: true });
  const opened = morph(morph(med, 'min', 2), 'max', 2);
  const { width: W, channels: C } = opened.info;
  const out = {};
  for (const [tier, w] of [
    ['2k', 2048],
    ['4k', 4096],
  ]) {
    const f = W / w;
    const h = w / 2;
    const buf = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        for (let k = 0; k < 3; k++) {
          let s = 0;
          for (let j = 0; j < f; j++)
            for (let i = 0; i < f; i++) s += opened.data[((y * f + j) * W + x * f + i) * C + k];
          buf[(y * w + x) * 3 + k] = Math.round(255 * linearToSrgb(s / (f * f * 255)));
        }
    const path = join(outDir, `milkyway_diffuse_${tier}.webp`);
    await sharp(buf, { raw: { width: w, height: h, channels: 3 } })
      .webp({ quality: MILKY_WAY_QUALITY, effort: 6, smartSubsample: true })
      .toFile(path);
    out[tier] = `textures/stars/milkyway_diffuse_${tier}.webp`;
  }
  return out;
}

async function main() {
  const paths = await ensureModuleAssets('stars');
  const dataDir = join(PUBLIC, 'data', 'stars');
  const texDir = join(PUBLIC, 'textures', 'stars');
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(texDir, { recursive: true });

  const { stars, names } = buildCatalog(paths.get('hyg_v41'));
  const bin = encodeStars(stars, { namesCount: names.length, epochYear: 2000 });
  writeFileSync(join(dataDir, 'stars.bin'), bin);
  const namesJson = {
    version: 1,
    source: 'HYG Database v4.1 (CC BY-SA 4.0); see docs/modules/data-formats.md',
    columns: ['star', 'hip', 'proper', 'bayer', 'flamsteed', 'con'],
    rows: names,
    constellations: CONSTELLATIONS,
    overrides: BV_OVERRIDES,
  };
  writeFileSync(join(dataDir, 'names.json'), JSON.stringify(namesJson) + '\n');
  console.log(
    `stars.bin: ${stars.length} stars, ${(bin.length / 1e6).toFixed(2)} MB; names: ${names.length}`,
  );

  const mw = await buildMilkyWay(paths.get('sss_milky_way'), texDir);
  console.log('milky way:', Object.values(mw).join(', '));
  for (const f of ['px', 'nx', 'py', 'ny', 'pz', 'nz']) {
    await writeWebp(paths.get(`three_milkyway_${f}`), join(texDir, `fallback_${f}.webp`), {
      width: 512,
      height: 512,
      quality: 80,
    });
  }
  console.log('fallback cube: 6 faces');
}

await main();
