#!/usr/bin/env node
/**
 * build-milkyway (P4-A): Celestia globulars.dsc (Baumgardt et al. 2023 parameters) ->
 * public/data/milkyway/globulars.json. Deterministic and re-runnable.
 *
 * Row: [name, aliases[], raDeg, decDeg, distPc, rcPc, rtPc, absMagV]. Celestia keys: RA in hours,
 * Dec in degrees, Distance and Radius (tidal radius) in light years, CoreRadius in arcminutes.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PUBLIC } from './lib/fetch.mjs';
import { ensureModuleAssets } from './lib/manifest.mjs';

const LY_PER_PC = 3.261563777167433;
const ARCMIN = Math.PI / (180 * 60);
const round = (v, d) => Number(v.toFixed(d));

export function parseGlobulars(text) {
  const rows = [];
  for (const m of text.matchAll(/Globular\s+"([^"]+)"\s*\{([^}]*)\}/g)) {
    const kv = {};
    for (const f of m[2].matchAll(/^\s*(\w+)\s+([-+0-9.eE]+)\s*$/gm)) kv[f[1]] = Number(f[2]);
    const names = m[1].split(':').map((s) => s.trim());
    const distPc = kv.Distance / LY_PER_PC;
    if (![kv.RA, kv.Dec, distPc, kv.CoreRadius, kv.Radius, kv.AbsMag].every(Number.isFinite)) continue;
    rows.push([
      names[0],
      names.slice(1, 4),
      round(kv.RA * 15, 5),
      round(kv.Dec, 5),
      round(distPc, 1),
      round(distPc * kv.CoreRadius * ARCMIN, 4),
      round(kv.Radius / LY_PER_PC, 3),
      round(kv.AbsMag, 3),
    ]);
  }
  return rows;
}

const paths = await ensureModuleAssets('milkyway');
const rows = parseGlobulars(readFileSync(paths.get('celestia_globulars'), 'utf8'));
const out = join(PUBLIC, 'data', 'milkyway');
mkdirSync(out, { recursive: true });
writeFileSync(
  join(out, 'globulars.json'),
  JSON.stringify({
    source:
      'CelestiaContent data/globulars.dsc (GPL-2.0-or-later), from Baumgardt et al. 2023, MNRAS: Fundamental parameters of Galactic globular clusters',
    columns: ['name', 'aliases', 'raDeg', 'decDeg', 'distPc', 'rcPc', 'rtPc', 'absMagV'],
    rows,
  }) + '\n',
);
console.log(`build-milkyway: ${rows.length} globular clusters -> public/data/milkyway/globulars.json`);
