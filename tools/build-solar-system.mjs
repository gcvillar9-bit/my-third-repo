#!/usr/bin/env node
/**
 * build-solar-system (P1-B, DESIGN 4.1): planet/moon textures -> public/textures/solar-system/ and
 * public/data/solar-system/bodies.json (physical data, IAU rotation, Celestia Keplerian elements).
 * Formats: docs/modules/data-formats.md. Deterministic and re-runnable.
 *
 *   node tools/build-solar-system.mjs            # textures + bodies.json
 *   node tools/build-solar-system.mjs --data     # bodies.json only
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { G_KM, extractOrbit, extractPhysical, parseSsc } from './lib/celestia.mjs';
import { PUBLIC, ROOT } from './lib/fetch.mjs';
import { img, writeTiers, writeWebp } from './lib/image.mjs';
import { ensureModuleAssets } from './lib/manifest.mjs';

const TEX = join(PUBLIC, 'textures', 'solar-system');
const DATA = join(PUBLIC, 'data', 'solar-system');
const T = (f) => `textures/solar-system/${f}`;
const QUALITY = { '2k': 85, '4k': 80 };

const SSS_BODIES = ['sun', 'mercury', 'moon', 'mars', 'jupiter', 'saturn'];
const CELESTIA_MOONS = [
  'io',
  'europa',
  'ganymede',
  'callisto',
  'titan',
  'enceladus',
  'mimas',
  'tethys',
  'dione',
  'rhea',
  'iapetus',
  'miranda',
  'ariel',
  'triton',
  'phobos',
  'deimos',
  'ceres',
  'vesta',
  'pluto',
  'charon',
];

/** Texture references per body id (paths relative to public/), filled by buildTextures or listTextures. */
function textureTable() {
  const tiers = (name, list = ['2k', '4k']) =>
    Object.fromEntries(list.map((t) => [t, T(`${name}_${t}.webp`)]));
  const tex = {
    earth: {
      diffuse: tiers('earth_day'),
      night: tiers('earth_night'),
      brc: tiers('earth_brc'),
      normal: { '2k': T('earth_normal_2k.webp') },
      specular: { '2k': T('earth_spec_2k.webp') },
    },
    venus: { diffuse: tiers('venus'), surface: tiers('venus_surface') },
    uranus: { diffuse: tiers('uranus', ['2k']), ringProfile: T('uranus_rings_profile.png') },
    neptune: { diffuse: tiers('neptune', ['2k']) },
  };
  for (const b of SSS_BODIES) tex[b] = { diffuse: tiers(b) };
  tex.saturn.ring = T('saturn_ring_sss.png');
  tex.saturn.ringProfile = T('saturn_rings_profile.png');
  for (const m of CELESTIA_MOONS) tex[m] = { diffuse: tiers(m, ['2k']) };
  return tex;
}

async function buildTextures(p) {
  mkdirSync(TEX, { recursive: true });
  const log = (...a) => console.log('  ', ...a);
  // Earth (three.js examples set).
  log(await writeTiers(p.get('earth_day_4096'), TEX, 'earth_day', ['2k', '4k'], { quality: QUALITY }));
  log(await writeTiers(p.get('earth_night_4096'), TEX, 'earth_night', ['2k', '4k'], { quality: QUALITY }));
  // Channel-packed bump/roughness/clouds: near-lossless keeps channels independent at a fraction of
  // the lossless size (4k: 4.5 MB vs 9.1 MB lossless; no 4:2:0 chroma bleed between data channels).
  log(await writeTiers(p.get('earth_brc_4096'), TEX, 'earth_brc', ['2k', '4k'], { nearLossless: 40 }));
  log(
    await writeWebp(p.get('earth_normal_2048'), join(TEX, 'earth_normal_2k.webp'), {
      width: 2048,
      quality: 90,
    }),
  );
  log(
    await writeWebp(p.get('earth_specular_2048'), join(TEX, 'earth_spec_2k.webp'), {
      width: 2048,
      quality: 85,
    }),
  );
  // Solar System Scope set.
  for (const b of SSS_BODIES)
    log(await writeTiers(p.get(`sss_${b}`), TEX, b, ['2k', '4k'], { quality: QUALITY }));
  log(await writeTiers(p.get('sss_venus_surface'), TEX, 'venus_surface', ['2k', '4k'], { quality: QUALITY }));
  // Saturn ring colour+alpha strip (8192x500, radial along x) -> 4096x1 RGBA PNG.
  await img(p.get('sss_saturn_ring_alpha'))
    .resize(4096, 1, { fit: 'fill', kernel: 'cubic' })
    .png({ compressionLevel: 9 })
    .toFile(join(TEX, 'saturn_ring_sss.png'));
  // Celestia.
  for (const m of CELESTIA_MOONS)
    log(await writeTiers(p.get(`celestia_${m}`), TEX, m, ['2k'], { quality: QUALITY }));
  log(await writeTiers(p.get('celestia_venus'), TEX, 'venus', ['2k', '4k'], { quality: QUALITY }));
  log(await writeTiers(p.get('celestia_uranus'), TEX, 'uranus', ['2k'], { quality: QUALITY }));
  log(await writeTiers(p.get('celestia_neptune'), TEX, 'neptune', ['2k'], { quality: QUALITY }));
  // 1D ring profiles (4096x1 RGBA): copied byte-exact.
  copyFileSync(p.get('celestia_saturn-rings'), join(TEX, 'saturn_rings_profile.png'));
  copyFileSync(p.get('celestia_uranus-rings'), join(TEX, 'uranus_rings_profile.png'));
}

const round = (x, d = 6) => (x == null ? undefined : Number(x.toFixed(d)));

function buildBodies(p) {
  const curated = JSON.parse(readFileSync(join(ROOT, 'tools/lib/data/bodies-physical.json'), 'utf8'));
  const files = ['solarsys', 'minormoons', 'outersys', 'dwarfplanets', 'asteroids'];
  const byPath = new Map();
  for (const f of files) {
    for (const o of parseSsc(readFileSync(p.get(`celestia_${f}_ssc`), 'utf8'))) {
      o.file = `${f}.ssc`;
      for (const alias of o.names)
        if (!byPath.has(`${o.parent}/${alias}`)) byPath.set(`${o.parent}/${alias}`, o);
    }
  }
  const pathToId = new Map([
    ['Sol', 'sun'],
    ['SSB', 'ssb'],
  ]);
  for (const c of curated.bodies) if (c.celestia) pathToId.set(c.celestia, c.id);
  const gmOf = new Map();
  const tex = textureTable();
  const warnings = [];
  const out = [];

  for (const c of curated.bodies) {
    const obj = c.celestia ? byPath.get(c.celestia) : null;
    if (c.celestia && !obj) throw new Error(`Celestia object ${c.celestia} not found`);
    const phys = obj ? extractPhysical(obj) : null;
    const srcParts = [c.source];
    const r = { ...(c.radius ?? {}) };
    if (r.mean == null && phys?.radius) {
      r.mean = round(phys.radius, 3);
      srcParts.push(`radius Celestia ${obj.file}${phys.radiusIsMax ? ' (maximum semi-axis)' : ''}`);
    }
    if (
      r.equatorial == null &&
      phys?.semiAxes &&
      phys.semiAxes[0] === phys.semiAxes[1] &&
      phys.semiAxes[2] < phys.semiAxes[0]
    ) {
      r.equatorial = phys.semiAxes[0];
      r.polar = phys.semiAxes[2];
    }
    let gm = c.gm;
    const celestiaGm = phys?.massKg ? phys.massKg * G_KM : null;
    if (gm == null && celestiaGm) {
      gm = Number(celestiaGm.toPrecision(5));
      srcParts.push(`GM from Celestia ${obj.file} mass`);
    } else if (gm != null && celestiaGm && Math.abs(celestiaGm - gm) / gm > 0.05) {
      warnings.push(`${c.id}: curated GM ${gm} vs Celestia ${celestiaGm.toPrecision(5)}`);
    }
    gmOf.set(c.id, gm);
    const albedo = {
      geometric: c.albedo?.geometric ?? phys?.geomAlbedo ?? undefined,
      bond: c.albedo?.bond ?? phys?.bondAlbedo ?? undefined,
    };
    if (!c.albedo && (phys?.geomAlbedo != null || phys?.bondAlbedo != null))
      srcParts.push(`albedo Celestia ${obj.file}`);

    const row = {
      id: c.id,
      name: c.name,
      kind: c.kind,
      parent: c.parent,
      ephemeris: c.ephemeris,
      radius: r.mean,
      radiusEquatorial: r.equatorial,
      radiusPolar: r.polar,
      oblateness: r.equatorial && r.polar ? round((r.equatorial - r.polar) / r.equatorial, 6) : undefined,
      gm,
      albedoGeometric: albedo.geometric,
      albedoBond: albedo.bond,
      teff: c.teff,
      absMag: c.absMag,
      approximate: r.approximate || undefined,
    };
    if (c.rotation) {
      const rot = { ...c.rotation };
      if (rot.wdot != null) rot.periodHours = round((24 * 360) / rot.wdot, 6);
      row.rotation = rot;
    }
    // Keplerian elements for bodies not covered by astronomy-engine (and Pluto's barycentre as a fallback).
    if (c.ephemeris === 'kepler' || c.id === 'pluto') {
      const el = orbitFor(c, obj, byPath);
      const center = pathToId.get(el.center) ?? el.center;
      row.elements = {
        epoch: el.epoch,
        frame: el.frame,
        axes: el.axes,
        center,
        a: round(el.a, 3),
        e: el.e,
        i: el.i,
        node: round(el.node, 6),
        argPeri: round(el.argPeri, 6),
        meanAnomaly: round(el.meanAnomaly, 6),
        period: round(el.period, 8),
        source: el.source,
      };
    }
    if (phys?.rings) row.rings = { ...phys.rings, source: `Celestia ${obj.file} Rings` };
    if (tex[c.id]) row.textures = tex[c.id];
    row.source = srcParts.join('; ');
    out.push(JSON.parse(JSON.stringify(row))); // drop undefined
  }

  // Sanity: Kepler period from GM vs the .ssc period.
  for (const b of out) {
    if (!b.elements) continue;
    const centerGm = b.elements.center === 'ssb' ? gmOf.get('sun') : gmOf.get(b.elements.center);
    const mu = (centerGm ?? 0) + (b.gm ?? 0);
    if (!mu || !b.elements.period) continue;
    const t = (2 * Math.PI * Math.sqrt(b.elements.a ** 3 / mu)) / 86400;
    const d = Math.abs(t / b.elements.period - 1);
    if (d > 0.01)
      warnings.push(
        `${b.id}: period from GM ${t.toFixed(4)} d vs .ssc ${b.elements.period} d (${(d * 100).toFixed(2)}%)`,
      );
  }
  return { bodies: out, warnings };
}

function orbitFor(c, obj, byPath) {
  if (c.id === 'pluto') {
    const bary = byPath.get('Sol/Pluto-Charon');
    const el = extractOrbit(bary);
    return {
      ...el,
      source: 'Celestia dwarfplanets.ssc ReferencePoint Pluto-Charon (system barycentre, heliocentric)',
    };
  }
  const el = extractOrbit(obj);
  if (!el) throw new Error(`no orbit for ${c.id}`);
  let source = `Celestia ${obj.file} EllipticalOrbit${el.fromComment ? ' (commented fallback of CustomOrbit)' : ''}`;
  if (c.id === 'charon') {
    // Celestia gives Pluto and Charon barycentric orbits; the Pluto-relative orbit has a = a_P + a_C.
    const pl = extractOrbit(byPath.get('Sol/Pluto'));
    el.a += pl.a;
    el.center = 'Sol/Pluto';
    source += ' converted to Pluto-relative (a = aPluto + aCharon about the barycentre)';
  }
  return { ...el, source };
}

async function main() {
  const dataOnly = process.argv.includes('--data');
  const p = await ensureModuleAssets('solar-system');
  if (!dataOnly) await buildTextures(p);
  const { bodies, warnings } = buildBodies(p);
  mkdirSync(DATA, { recursive: true });
  const doc = {
    version: 1,
    units: {
      radius: 'km',
      gm: 'km^3/s^2',
      angles: 'deg',
      raRate: 'deg per Julian century from J2000 TDB',
      decRate: 'deg per Julian century from J2000 TDB',
      wdot: 'deg per day from J2000 TDB',
      periodHours: 'hours (negative = retrograde)',
      'elements.a': 'km',
      'elements.period': 'days',
      'elements.epoch': 'JD (TDB ~ TT)',
    },
    frames: {
      'ecliptic-j2000': 'mean ecliptic and equinox of J2000, centred on elements.center',
      'equator-j2000': 'ICRF/J2000 Earth equator and equinox, centred on elements.center',
      'icrf-axes':
        'explicit orthonormal axes elements.axes.{x,y,z} given as ICRF unit vectors (Celestia TwoVector frame)',
      'parent-equator':
        "the parent's IAU equator at J2000 (pole from its rotation.ra0/dec0); x axis = ascending node of that equator on the ICRF equator (RA = ra0 + 90 deg). Celestia's default frame for satellites.",
    },
    bodies,
  };
  writeFileSync(join(DATA, 'bodies.json'), JSON.stringify(doc, null, 1) + '\n');
  console.log(`bodies.json: ${bodies.length} bodies`);
  for (const w of warnings) console.warn('  warn:', w);
}

await main();
