/**
 * Asset manifest fragments: assets/manifest/<module>.json (schema in docs/modules/data-formats.md).
 *
 * {
 *   "module": "solar-system",
 *   "assets": [{
 *     "id": "io", "url": "https://...", "file"?: "local cache name (default: URL basename)",
 *     "sha256": "<recorded on first fetch>", "bytes": 123,
 *     "license": "CC-BY-4.0", "attribution": "...", "copyright"?: ["..."],
 *     "licenseSidecar"?: { "url": "...", "sha256": "...", "text": "<sidecar text, recorded on fetch>" },
 *     "flags"?: ["non-commercial"], "outputs": ["textures/solar-system/io_2k.webp"]
 *   }]
 * }
 *
 * Entries without `url` are references (hand-curated data sources) used only for credits.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { CACHE_RAW, ROOT, curlDownload, sha256File } from './fetch.mjs';
import { writeFormatted } from './format.mjs';

export const MANIFEST_DIR = join(ROOT, 'assets', 'manifest');

export function manifestPath(module) {
  return join(MANIFEST_DIR, `${module}.json`);
}

export function readManifest(module) {
  return JSON.parse(readFileSync(manifestPath(module), 'utf8'));
}

export async function writeManifest(manifest) {
  await writeFormatted(manifestPath(manifest.module), JSON.stringify(manifest, null, 2));
}

/** All manifest fragments, sorted by module name. */
export function listManifests() {
  if (!existsSync(MANIFEST_DIR)) return [];
  return readdirSync(MANIFEST_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(MANIFEST_DIR, f), 'utf8')));
}

export function assetCachePath(module, asset) {
  return join(CACHE_RAW, module, asset.file ?? basename(new URL(asset.url).pathname));
}

/** Parses REUSE/SPDX sidecar text into { license, copyright[] }. */
export function parseSpdx(text) {
  const license = /SPDX-License-Identifier:\s*(.+)/.exec(text)?.[1].trim() ?? null;
  const copyright = [...text.matchAll(/SPDX-FileCopyrightText:\s*(.+)/g)].map((m) => m[1].trim());
  return { license, copyright };
}

function ensureFile(url, dest, expected, { force, log }) {
  let downloaded = false;
  if (force || !existsSync(dest)) {
    log?.(`  download ${url}`);
    curlDownload(url, dest);
    downloaded = true;
  }
  const sha = sha256File(dest);
  if (expected && expected !== sha) {
    throw new Error(`sha256 mismatch for ${url}\n  expected ${expected}\n  actual   ${sha}\n  file ${dest}`);
  }
  return { sha, downloaded };
}

/**
 * Makes one asset (and its license sidecar) available in .cache/raw/<module>/ and verifies sha256.
 * Missing sha256 values are recorded into `asset` (caller writes the manifest). Returns the local path,
 * or null for reference entries without a URL.
 */
export function ensureAsset(module, asset, { force = false, log = console.log } = {}) {
  if (!asset.url) return null;
  const dest = assetCachePath(module, asset);
  const { sha } = ensureFile(asset.url, dest, asset.sha256, { force, log });
  if (!asset.sha256) {
    asset.sha256 = sha;
    log?.(`  recorded sha256 ${asset.id} ${sha.slice(0, 12)}`);
  }
  asset.bytes = readFileSync(dest).length;
  const side = asset.licenseSidecar;
  if (side?.url) {
    const sdest = `${dest}.license`;
    const r = ensureFile(side.url, sdest, side.sha256, { force, log });
    side.sha256 ??= r.sha;
    side.text = readFileSync(sdest, 'utf8').trim();
    const spdx = parseSpdx(side.text);
    if (spdx.license) asset.license = spdx.license;
    if (spdx.copyright.length) asset.copyright = spdx.copyright;
  }
  return dest;
}

/**
 * Ensures every asset of a module (or only `ids`) is cached and verified. Writes the manifest back
 * (recorded hashes, sizes, sidecar texts). Returns Map<id, localPath>.
 */
export async function ensureModuleAssets(module, { ids = null, force = false, log = console.log } = {}) {
  const manifest = readManifest(module);
  const before = JSON.stringify(manifest);
  const paths = new Map();
  for (const asset of manifest.assets) {
    if (ids && !ids.includes(asset.id)) continue;
    const p = ensureAsset(module, asset, { force, log });
    if (p) paths.set(asset.id, p);
  }
  if (JSON.stringify(manifest) !== before) await writeManifest(manifest);
  return paths;
}
