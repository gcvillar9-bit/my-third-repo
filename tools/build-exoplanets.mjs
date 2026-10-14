#!/usr/bin/env node
/**
 * build-exoplanets (P4-C): Open Exoplanet Catalogue table (MIT) -> public/data/exoplanets/systems.json.
 *
 * Only rows whose `list` contains "Confirmed planets" are kept. Planets are grouped into systems by
 * host name (planet name minus its last short token). Each system is linked to a HYG star index
 * (data/stars/stars.bin order) by proper name, else by position (within 90" and a distance within
 * ±40 % when both are known); -1 when HYG has no match (most transit hosts are fainter than HYG).
 * Units: radius R_earth, mass M_earth, period days, a AU, inclination deg, temperatures K,
 * host radius R_sun, host mass M_sun. Missing values are null.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadHyg } from './build-starsystems.mjs';
import { parseCsv } from './lib/csv.mjs';
import { PUBLIC } from './lib/fetch.mjs';
import { ensureModuleAssets } from './lib/manifest.mjs';

const R_JUP_EARTH = 11.209; // equatorial R_J / R_earth (IAU 2015 nominal)
const M_JUP_EARTH = 317.83;
const MATCH_ARCSEC = 90;

const num = (s) => (s === '' || s == null ? null : Number.isFinite(Number(s)) ? Number(s) : null);
/** Rounds to 4 significant digits (keeps the JSON small). */
const sig = (v) => (v == null ? null : Number(v.toPrecision(4)));

function sexagesimal(s, scale) {
  if (!s) return null;
  const m = /^([+-]?)(\d+)\s+(\d+)\s+([\d.]+)$/.exec(s.trim());
  if (!m) return null;
  const v = Number(m[2]) + Number(m[3]) / 60 + Number(m[4]) / 3600;
  return (m[1] === '-' ? -v : v) * scale;
}

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9+]+/g, '-')
    .replace(/^-|-$/g, '');

function hostOf(name) {
  const m = /^(.*\S)\s+(\S{1,3})$/.exec(name.trim());
  return m ? { host: m[1], suffix: m[2] } : { host: name.trim(), suffix: '' };
}

function angSepArcsec(ra1, de1, ra2, de2) {
  const r = Math.PI / 180;
  const s =
    Math.sin(de1 * r) * Math.sin(de2 * r) + Math.cos(de1 * r) * Math.cos(de2 * r) * Math.cos((ra1 - ra2) * r);
  return (Math.acos(Math.min(1, Math.max(-1, s))) / r) * 3600;
}

function matcher(stars) {
  const cells = new Map();
  const key = (raDeg, decDeg) => `${Math.floor(decDeg)}:${Math.floor(((raDeg % 360) + 360) % 360)}`;
  for (const s of stars) {
    if (!Number.isFinite(s.raDeg) || !Number.isFinite(s.decDeg)) continue;
    const k = key(s.raDeg, s.decDeg);
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(s);
  }
  const byName = new Map();
  for (const s of stars) if (s.proper) byName.set(s.proper.toLowerCase(), s);
  return (host, raDeg, decDeg, dist) => {
    const named = byName.get(host.toLowerCase());
    if (named) return named.index;
    if (raDeg == null || decDeg == null) return -1;
    let best = -1;
    let bestSep = MATCH_ARCSEC;
    const dRa = Math.min(180, Math.ceil(1 / Math.max(0.02, Math.cos((decDeg * Math.PI) / 180))));
    for (let dd = -1; dd <= 1; dd++)
      for (let dr = -dRa; dr <= dRa; dr++) {
        for (const s of cells.get(key(raDeg + dr, decDeg + dd)) ?? []) {
          const sep = angSepArcsec(raDeg, decDeg, s.raDeg, s.decDeg);
          if (sep >= bestSep) continue;
          if (dist && !s.distUnknown && Math.abs(Math.log(s.dist / dist)) > 0.34) continue;
          best = s.index;
          bestSep = sep;
        }
      }
    return best;
  };
}

async function main() {
  const paths = await ensureModuleAssets('exoplanets');
  const { rows } = parseCsv(readFileSync(paths.get('oec_table'), 'utf8'));
  const stars = await loadHyg();
  const match = matcher(stars);
  const systems = new Map();
  let count = 0;
  for (const r of rows) {
    if (!/Confirmed planets/.test(r.list ?? '')) continue;
    const { host, suffix } = hostOf(r.name);
    let sys = systems.get(host);
    if (!sys) {
      const ra = sexagesimal(r.system_rightascension, 15);
      const dec = sexagesimal(r.system_declination, 1);
      const dist = num(r.system_distance);
      sys = {
        id: slug(host),
        name: host,
        ra: ra == null ? null : Number(ra.toFixed(5)),
        dec: dec == null ? null : Number(dec.toFixed(5)),
        dist: sig(dist),
        star: match(host, ra, dec, dist),
        teff: sig(num(r.hoststar_temperature)),
        rad: sig(num(r.hoststar_radius)),
        mass: sig(num(r.hoststar_mass)),
        binary: Number(r.binaryflag) || 0,
        planets: [],
      };
      systems.set(host, sys);
    }
    const rJ = num(r.radius);
    const mJ = num(r.mass);
    sys.planets.push([
      suffix || r.name,
      sig(rJ == null ? null : rJ * R_JUP_EARTH),
      sig(mJ == null ? null : mJ * M_JUP_EARTH),
      sig(num(r.period)),
      sig(num(r.semimajoraxis)),
      sig(num(r.eccentricity)),
      sig(num(r.inclination)),
      sig(num(r.temperature)),
      num(r.discoveryyear),
      r.discoverymethod || null,
    ]);
    count++;
  }
  const list = [...systems.values()].sort((a, b) => a.id.localeCompare(b.id));
  // Unique ids (two hosts may slug alike).
  const used = new Set();
  for (const s of list) {
    let id = s.id;
    for (let k = 2; used.has(id); k++) id = `${s.id}-${k}`;
    used.add((s.id = id));
    s.planets.sort((a, b) => (a[4] ?? a[3] ?? 0) - (b[4] ?? b[3] ?? 0));
  }
  const out = {
    version: 1,
    source:
      'Open Exoplanet Catalogue (oec_tables comma_separated, MIT), confirmed planets; host stars linked to HYG v4.1 indices of data/stars/stars.bin',
    planetColumns: [
      'suffix',
      'radiusEarth',
      'massEarth',
      'periodDays',
      'aAU',
      'e',
      'inclDeg',
      'teqK',
      'year',
      'method',
    ],
    count,
    systems: list,
  };
  const dir = join(PUBLIC, 'data', 'exoplanets');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'systems.json'), JSON.stringify(out) + '\n');
  const linked = list.filter((s) => s.star >= 0).length;
  console.log(`exoplanets: ${count} planets in ${list.length} systems, ${linked} hosts linked to HYG`);
}

await main();
