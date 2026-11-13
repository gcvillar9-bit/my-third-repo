#!/usr/bin/env node
/**
 * Runs single atlas builders without touching the manifest (safe to run in parallel with others):
 *   node tools/milkyway/run.mjs layers/cepheids features/local [--update-sources]
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

for (const name of process.argv.slice(2).filter((a) => !a.startsWith('--'))) {
  console.log(`milkyway: ${name}`);
  const mod = await import(pathToFileURL(join(import.meta.dirname, `${name}.mjs`)).href);
  await mod.default();
}
