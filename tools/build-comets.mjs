#!/usr/bin/env node
/**
 * build-comets: famous comets -> public/data/comets/comets.json (a few KB).
 *
 * Inputs
 *  - Celestia `comets.ssc` (GPL-2.0-or-later; elements from JPL SBDB / Horizons): orbit, radius, albedo,
 *    rotation period and mass of every row of src/modules/comets/catalog.json that names a `celestia` object.
 *  - Stellarium `ssystem_minor.ini` (GPL-2.0-or-later): the 1997-apparition elements of Hale-Bopp (Celestia
 *    ships its 2022 osculating orbit, whose two-body perihelion is 2.5 days early and 0.02 AU too close).
 *  - src/modules/comets/catalog.json: the hand-entered selection, brightness laws, shapes and appearance
 *    weights, plus full hand-entered rows for comets missing upstream (12P/Pons-Brooks) and corrections of
 *    single upstream values (`elementsOverride`). Hand-entered blocks keep their `source` and
 *    `approximate: true`.
 *
 * Output elements are perihelion-based so that near-parabolic orbits stay well conditioned:
 *   { center: 'sun' | 'ssb', q (AU), e, i, node, argPeri (deg, ecliptic J2000), tp (JD TT of the perihelion
 *     nearest the epoch), epoch (JD TT), periodDays (null when unbound), source }.
 * Deterministic and re-runnable: `node tools/build-comets.mjs`.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AU_KM, extractOrbit, extractPhysical, parseSsc } from './lib/celestia.mjs';
import { PUBLIC, ROOT } from './lib/fetch.mjs';
import { writeFormatted } from './lib/format.mjs';
import { ensureModuleAssets } from './lib/manifest.mjs';

const OUT = join(PUBLIC, 'data', 'comets');
const CATALOG = join(ROOT, 'src', 'modules', 'comets', 'catalog.json');
/** Gaussian gravitational constant squared: GM_sun in AU^3/day^2. */
const GM_SUN_AU3_D2 = 0.01720209895 ** 2;

const sig = (v, n = 10) => Number(v.toPrecision(n));
const wrap180 = (deg) => ((((deg + 180) % 360) + 360) % 360) - 180;

/** Sections of an .ini file as Map<name, Record<key, string>>. */
export function parseIni(text) {
  const out = new Map();
  let cur = null;
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#') || s.startsWith(';')) continue;
    const sec = /^\[(.+)\]$/.exec(s);
    if (sec) {
      cur = {};
      out.set(sec[1], cur);
      continue;
    }
    const kv = /^([^=]+?)\s*=\s*(.*)$/.exec(s);
    if (kv && cur) cur[kv[1]] = kv[2];
  }
  return out;
}

/** Keplerian period in days of a bound heliocentric orbit (q in AU). */
const periodDays = (q, e) =>
  e < 1 ? (2 * Math.PI * Math.sqrt((q / (1 - e)) ** 3)) / Math.sqrt(GM_SUN_AU3_D2) : null;

/** Celestia EllipticalOrbit (a, e, M at epoch, period) -> perihelion-based elements. */
export function elementsFromCelestia(obj) {
  const o = extractOrbit(obj);
  if (!o) throw new Error(`comets: ${obj.name} has no EllipticalOrbit`);
  if (o.frame !== 'ecliptic-j2000') throw new Error(`comets: ${obj.name} uses frame ${o.frame}`);
  if (!(o.e < 1) || !o.period) throw new Error(`comets: ${obj.name} is not an ellipse with a period`);
  const aAU = o.a / AU_KM;
  // Perihelion nearest the epoch: M within (-180, 180] of it.
  const tp = o.epoch - (wrap180(o.meanAnomaly) / 360) * o.period;
  return {
    center: o.center === 'SSB' ? 'ssb' : 'sun',
    q: sig(aAU * (1 - o.e)),
    e: o.e,
    i: o.i,
    node: o.node,
    argPeri: o.argPeri,
    tp: sig(tp, 13),
    epoch: o.epoch,
    periodDays: sig(o.period, 12),
    source: `Celestia comets.ssc "${obj.name}" (JPL SBDB / Horizons osculating elements)`,
  };
}

/** Stellarium comet section (q, e, i, node, argPeri, T) -> perihelion-based elements. */
export function elementsFromStellarium(name, sec) {
  const num = (k) => {
    const v = Number(sec[k]);
    if (!Number.isFinite(v)) throw new Error(`comets: Stellarium [${name}] lacks ${k}`);
    return v;
  };
  const q = num('orbit_PericenterDistance');
  const e = num('orbit_Eccentricity');
  const p = periodDays(q, e);
  return {
    center: 'sun',
    q,
    e,
    i: num('orbit_Inclination'),
    node: num('orbit_AscendingNode'),
    argPeri: num('orbit_ArgOfPericenter'),
    tp: num('orbit_TimeAtPericenter'),
    epoch: num('orbit_Epoch'),
    periodDays: p == null ? null : sig(p, 8),
    source: `Stellarium ssystem_minor.ini [${name}] (MPC elements of the apparition)`,
  };
}

function classify(el) {
  if (el.periodDays == null) return 'non-periodic';
  const years = el.periodDays / 365.25;
  return years < 200 ? 'periodic' : years < 1000 ? 'long-period' : 'non-periodic';
}

async function main() {
  const p = await ensureModuleAssets('comets');
  const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'));
  const ssc = new Map(parseSsc(readFileSync(p.get('celestia_comets_ssc'), 'utf8')).map((o) => [o.name, o]));
  const ini = parseIni(readFileSync(p.get('stellarium_ssystem_minor'), 'utf8'));

  const comets = catalog.comets.map((row) => {
    const obj = row.celestia ? ssc.get(row.celestia) : null;
    if (row.celestia && !obj) throw new Error(`comets: "${row.celestia}" not found in comets.ssc`);
    let elements;
    if (row.elements) {
      const el = row.elements;
      if (!el.source || el.approximate !== true)
        throw new Error(`comets: hand-entered elements of ${row.id} need a source and approximate: true`);
      elements = { ...el, periodDays: el.periodDays ?? sig(periodDays(el.q, el.e), 8) };
    } else if (row.stellarium) {
      const sec = ini.get(row.stellarium);
      if (!sec) throw new Error(`comets: [${row.stellarium}] not found in ssystem_minor.ini`);
      elements = elementsFromStellarium(row.stellarium, sec);
    } else if (obj) elements = elementsFromCelestia(obj);
    else throw new Error(`comets: ${row.id} has no orbit source`);
    if (row.elementsOverride) {
      // Hand-entered corrections of single upstream values: the whole block becomes approximate.
      const { source, approximate, ...values } = row.elementsOverride;
      if (!source || approximate !== true)
        throw new Error(`comets: elementsOverride of ${row.id} needs a source and approximate: true`);
      elements = { ...elements, ...values, source: `${elements.source}. ${source}`, approximate: true };
    }

    let physical;
    if (row.physical) physical = row.physical;
    else {
      const ph = extractPhysical(obj);
      if (!ph.radius) throw new Error(`comets: ${row.id} has no radius`);
      physical = {
        radiusKm: ph.radius,
        albedo: ph.geomAlbedo ?? 0.04,
        ...(ph.rotationPeriodHours ? { rotationHours: ph.rotationPeriodHours } : {}),
        ...(ph.massKg ? { massKg: ph.massKg } : {}),
        source: `Celestia comets.ssc "${obj.name}" (radius, albedo, rotation; see the references in that file)`,
      };
    }
    for (const key of ['photometry', 'look', 'shape']) {
      if (!row[key]?.source || row[key].approximate !== true)
        throw new Error(`comets: ${row.id}.${key} needs a source and approximate: true`);
    }
    // Catalogue names become search aliases (old-style designations such as "P 1682 Q1" are kept).
    const upstream = obj ? obj.names.slice(1).filter((n) => !/^\d{4} [IVX]+$|^\d{4}[a-z]$/.test(n)) : [];
    const aliases = [...new Set([...row.aliases, ...upstream.map((n) => n.replace(/^([PCD]) /, '$1/'))])];
    return {
      id: row.id,
      name: row.name,
      short: row.short,
      designation: row.designation,
      class: classify(elements),
      apparition: row.apparition,
      aliases,
      elements,
      physical,
      photometry: row.photometry,
      look: row.look,
      shape: row.shape,
    };
  });

  const doc = {
    about:
      'Famous comets for the comets module. Generated by tools/build-comets.mjs from Celestia comets.ssc, ' +
      'Stellarium ssystem_minor.ini (both GPL-2.0-or-later, see CREDITS.md) and the hand-entered ' +
      'src/modules/comets/catalog.json. Elements: heliocentric (or barycentric) ecliptic J2000, q in AU, ' +
      'angles in degrees, tp and epoch as JD TT. Blocks marked approximate are hand-entered.',
    display: catalog.display,
    comets,
  };
  mkdirSync(OUT, { recursive: true });
  await writeFormatted(join(OUT, 'comets.json'), JSON.stringify(doc));
  for (const c of comets) {
    const el = c.elements;
    console.log(
      `  ${c.id.padEnd(18)} q ${el.q.toFixed(4)} AU  e ${el.e.toFixed(6)}  tp JD ${el.tp.toFixed(3)}  ` +
        `${el.periodDays ? (el.periodDays / 365.25).toFixed(1) + ' yr' : 'unbound'}  R ${c.physical.radiusKm} km`,
    );
  }
  console.log(`comets.json: ${comets.length} comets`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
