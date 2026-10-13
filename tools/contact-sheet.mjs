#!/usr/bin/env node
/**
 * Contact sheet: tiles every e2e screenshot under artifacts/ (artifacts/<module>/<name>.png) into one labelled PNG
 * for the phase review. Skips Playwright's own output (test-results, report) and earlier contact sheets.
 *
 *   node tools/contact-sheet.mjs [phase-label]   ->  artifacts/contact-sheet-<phase-label>.png (default phase-1)
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import sharp from 'sharp';

const ROOT = 'artifacts';
const SKIP = new Set(['test-results', 'report']);
const TILE_W = 480;
const TILE_H = 270;
const LABEL_H = 22;
const COLS = 3;
const GAP = 4;

const label = process.argv[2] ?? 'phase-1';
const out = join(ROOT, `contact-sheet-${label}.png`);

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (!SKIP.has(name)) files.push(...walk(p));
    } else if (name.endsWith('.png') && !name.startsWith('contact-sheet')) files.push(p);
  }
  return files;
}

const escapeXml = (s) => s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);

if (!existsSync(ROOT)) {
  console.error('contact-sheet: no artifacts/ directory (run pnpm e2e first)');
  process.exit(1);
}
const files = walk(ROOT);
if (!files.length) {
  console.error('contact-sheet: no screenshots found under artifacts/');
  process.exit(1);
}

const rows = Math.ceil(files.length / COLS);
const width = COLS * TILE_W + (COLS + 1) * GAP;
const height = rows * (TILE_H + LABEL_H) + (rows + 1) * GAP;
const composites = [];
for (const [i, file] of files.entries()) {
  const x = GAP + (i % COLS) * (TILE_W + GAP);
  const y = GAP + Math.floor(i / COLS) * (TILE_H + LABEL_H + GAP);
  const name = relative(ROOT, file).replace(/\.png$/, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE_W}" height="${LABEL_H}">
    <rect width="100%" height="100%" fill="#222"/>
    <text x="6" y="16" font-family="sans-serif" font-size="14" fill="#eee">${escapeXml(name)}</text></svg>`;
  composites.push({ input: Buffer.from(svg), left: x, top: y });
  const tile = await sharp(file)
    .resize(TILE_W, TILE_H, { fit: 'contain', background: '#000' })
    .png()
    .toBuffer();
  composites.push({ input: tile, left: x, top: y + LABEL_H });
}

await sharp({ create: { width, height, channels: 3, background: '#555' } })
  .composite(composites)
  .png()
  .toFile(out);
console.log(`contact-sheet: ${files.length} screenshots -> ${out} (${width}x${height})`);
