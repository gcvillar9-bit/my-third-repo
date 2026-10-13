#!/usr/bin/env node
/**
 * Asset size guard (DESIGN 4.4 / 7). Fails (exit 1) when:
 *  - public/ exceeds 60 MB in total,
 *  - any single file in public/ or dist/ exceeds 15 MB,
 *  - the initial JS of dist/index.html (entry + modulepreloads) exceeds 600 KB gzip,
 *  - the boot critical path (initial JS gzip + BOOT_PATH files) exceeds 8 MB.
 * Run after `pnpm build`. Missing public/ or dist/ count as empty (warning for dist/).
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const ROOT = resolve(import.meta.dirname, '..');
const MB = 1024 * 1024;
const LIMITS = {
  publicTotal: 60 * MB,
  singleFile: 15 * MB,
  initialJsGzip: 600 * 1024,
  bootPath: 8 * MB,
};

/**
 * Boot critical path: public/ paths loaded before the first good frame.
 * TODO(R1 integrator): fill in once P1-B lands assets, e.g.
 *   'textures/solar-system/earth-2k.webp', 'data/stars/stars.bin', 'textures/stars/milkyway-2k.webp'.
 */
const BOOT_PATH = [];

const fmt = (b) => (b >= MB ? `${(b / MB).toFixed(2)} MB` : `${(b / 1024).toFixed(1)} KB`);

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.isFile()) out.push({ path: p, size: statSync(p).size });
  }
  return out;
}

const failures = [];
const report = [];

// 1. public/ total and per-file limits.
const publicDir = join(ROOT, 'public');
const publicFiles = walk(publicDir);
const publicTotal = publicFiles.reduce((s, f) => s + f.size, 0);
report.push(
  `public/ total: ${fmt(publicTotal)} (limit ${fmt(LIMITS.publicTotal)}, ${publicFiles.length} files)`,
);
if (publicTotal > LIMITS.publicTotal)
  failures.push(`public/ is ${fmt(publicTotal)} > ${fmt(LIMITS.publicTotal)}`);

const distDir = join(ROOT, 'dist');
const distFiles = walk(distDir);
for (const f of [...publicFiles, ...distFiles]) {
  if (f.size > LIMITS.singleFile)
    failures.push(`${relative(ROOT, f.path)} is ${fmt(f.size)} > ${fmt(LIMITS.singleFile)}`);
}

// 2. Initial JS (entry script + modulepreload links in dist/index.html), gzip.
let initialJsGzip = 0;
const indexHtml = join(distDir, 'index.html');
if (existsSync(indexHtml)) {
  const html = readFileSync(indexHtml, 'utf8');
  const urls = new Set();
  for (const m of html.matchAll(/<script[^>]+type="module"[^>]+src="([^"]+)"/g)) urls.add(m[1]);
  for (const m of html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g)) urls.add(m[1]);
  for (const url of urls) {
    // Strip the base path (e.g. /my-third-repo/) to map the URL onto dist/.
    const idx = url.indexOf('assets/');
    const file = join(distDir, idx >= 0 ? url.slice(idx) : url.replace(/^\/+/, ''));
    if (!existsSync(file)) {
      failures.push(`initial script ${url} not found in dist/`);
      continue;
    }
    const gz = gzipSync(readFileSync(file), { level: 9 }).length;
    initialJsGzip += gz;
    report.push(`  initial JS ${relative(ROOT, file)}: ${fmt(gz)} gzip`);
  }
  report.push(`initial JS gzip: ${fmt(initialJsGzip)} (limit ${fmt(LIMITS.initialJsGzip)})`);
  if (initialJsGzip > LIMITS.initialJsGzip)
    failures.push(`initial JS is ${fmt(initialJsGzip)} gzip > ${fmt(LIMITS.initialJsGzip)}`);
} else {
  console.warn('size-guard: dist/index.html not found; run `pnpm build` first (JS checks skipped).');
}

// 3. Boot critical path.
let bootBytes = initialJsGzip;
for (const p of BOOT_PATH) {
  const file = join(publicDir, p);
  if (!existsSync(file)) {
    console.warn(`size-guard: boot-path file missing: public/${p}`);
    continue;
  }
  bootBytes += statSync(file).size;
}
report.push(
  `boot path: ${fmt(bootBytes)} (limit ${fmt(LIMITS.bootPath)}, ${BOOT_PATH.length} listed assets)`,
);
if (bootBytes > LIMITS.bootPath) failures.push(`boot path is ${fmt(bootBytes)} > ${fmt(LIMITS.bootPath)}`);

console.log(report.join('\n'));
if (failures.length) {
  console.error(`\nsize-guard FAILED:\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
console.log('size-guard OK');
