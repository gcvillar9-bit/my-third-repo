#!/usr/bin/env node
/**
 * Downloads and verifies every asset listed in assets/manifest/*.json (DESIGN 4.1).
 *
 *   node tools/fetch-assets.mjs                  # all modules
 *   node tools/fetch-assets.mjs solar-system     # only these modules
 *   node tools/fetch-assets.mjs --force          # re-download even when cached
 *
 * First run records sha256 (and size, license sidecar text) into the manifest; later runs verify
 * against it and exit 1 on any mismatch.
 */
import { ensureModuleAssets, listManifests } from './lib/manifest.mjs';

const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.filter((a) => !a.startsWith('--'));

let failed = 0;
for (const manifest of listManifests()) {
  if (only.length && !only.includes(manifest.module)) continue;
  console.log(`[${manifest.module}] ${manifest.assets.length} entries`);
  try {
    const paths = await ensureModuleAssets(manifest.module, { force });
    console.log(`[${manifest.module}] ok: ${paths.size} files verified`);
  } catch (err) {
    failed++;
    console.error(`[${manifest.module}] FAILED: ${err.message}`);
  }
}
process.exit(failed ? 1 : 0);
