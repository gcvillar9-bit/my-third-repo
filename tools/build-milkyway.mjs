#!/usr/bin/env node
/**
 * build-milkyway: (1) Celestia globulars.dsc (Baumgardt et al. 2023 parameters) ->
 * public/data/milkyway/globulars.json; (2) the Milky Way atlas: every tools/milkyway/layers/*.mjs
 * and tools/milkyway/features/*.mjs writes its file under public/data/milkyway/atlas/ (schema and
 * evidence rule in tools/milkyway/lib.mjs), then the fetched sources are merged into
 * assets/manifest/milkyway.json. Deterministic and re-runnable.
 *
 *   node tools/build-milkyway.mjs                 # everything
 *   node tools/build-milkyway.mjs cepheids        # only the named layers or feature groups
 *   node tools/build-milkyway.mjs --update-sources  # accept changed upstream files
 *
 * Row: [name, aliases[], raDeg, decDeg, distPc, rcPc, rtPc, absMagV]. Celestia keys: RA in hours,
 * Dec in degrees, Distance and Radius (tidal radius) in light years, CoreRadius in arcminutes.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PUBLIC, ROOT } from './lib/fetch.mjs';
import { ensureModuleAssets, readManifest, writeManifest } from './lib/manifest.mjs';
import { allSources } from './milkyway/lib.mjs';

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

const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
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

// ---------------------------------------------------------------------------------------
// Atlas layers and features
// ---------------------------------------------------------------------------------------
for (const dir of ['layers', 'features']) {
  const abs = join(ROOT, 'tools', 'milkyway', dir);
  if (!existsSync(abs)) continue;
  for (const f of readdirSync(abs).filter((n) => n.endsWith('.mjs')).sort()) {
    if (only.length && !only.includes(f.replace(/\.mjs$/, ''))) continue;
    console.log(`build-milkyway: ${dir}/${f}`);
    const mod = await import(pathToFileURL(join(abs, f)).href);
    await mod.default();
  }
}

// Sources fetched by the atlas build become reference entries of the manifest (credits, licences).
const manifest = readManifest('milkyway');
const kept = manifest.assets.filter((a) => !a.atlas);
const atlas = allSources().map((s) => ({
  id: s.id,
  atlas: true,
  sourceUrl: s.url,
  fetchUrl: s.fetchUrl,
  license: s.license,
  attribution: s.attribution,
  cite: s.cite,
  outputs: s.outputs,
  sha256: s.sha256,
  bytes: s.bytes,
}));
const next = { ...manifest, assets: [...kept, ...atlas] };
if (JSON.stringify(next) !== JSON.stringify(manifest)) await writeManifest(next);
console.log(`build-milkyway: ${atlas.length} atlas sources in assets/manifest/milkyway.json`);
