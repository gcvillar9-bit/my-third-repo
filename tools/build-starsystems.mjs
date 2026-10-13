#!/usr/bin/env node
/**
 * build-starsystems (P4-C): Stellarium 'modern' sky culture (CC BY-SA 4.0) HIP polylines ->
 * public/data/starsystems/constellations.json with star indices into data/stars/stars.bin.
 *
 * The HIP -> stars.bin index map is rebuilt from the HYG v4.1 CSV (the stars manifest asset) with the
 * documented stars.bin order (docs/modules/data-formats.md): the Sun (id 0) dropped, then sorted by
 * HYG `mag`, ties by HYG `id`. The map is checked against the committed stars.bin positions.
 * `loadHyg()` is shared with tools/build-exoplanets.mjs (host-star matching).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseCsv } from './lib/csv.mjs';
import { PUBLIC } from './lib/fetch.mjs';
import { ensureModuleAssets } from './lib/manifest.mjs';
import { decodeStars } from './lib/stars-format.mjs';

const num = (s) => (s === '' || s == null ? NaN : Number(s));

/**
 * HYG rows in stars.bin order: { index, id, hip, proper, raDeg, decDeg, dist, mag, distUnknown }.
 * Verifies the order against public/data/stars/stars.bin when it exists.
 */
export async function loadHyg() {
  const paths = await ensureModuleAssets('stars', { ids: ['hyg_v41'], log: null });
  const { rows } = parseCsv(readFileSync(paths.get('hyg_v41'), 'utf8'));
  const stars = [];
  for (const r of rows) {
    if (r.id === '0') continue;
    const dist = num(r.dist);
    stars.push({
      id: Number(r.id),
      hip: r.hip ? Number(r.hip) : null,
      proper: r.proper || null,
      raDeg: num(r.ra) * 15,
      decDeg: num(r.dec),
      dist,
      distUnknown: !(dist > 0) || dist >= 100000,
      mag: num(r.mag),
      x: num(r.x),
      y: num(r.y),
      z: num(r.z),
    });
  }
  stars.sort((a, b) => a.mag - b.mag || a.id - b.id);
  stars.forEach((s, i) => (s.index = i));
  try {
    const bin = decodeStars(readFileSync(join(PUBLIC, 'data', 'stars', 'stars.bin')));
    if (bin.count !== stars.length) throw new Error(`count ${bin.count} != ${stars.length}`);
    for (let i = 0; i < stars.length; i += 997) {
      const s = stars[i];
      const d = Math.hypot(
        bin.positions[3 * i] - s.x,
        bin.positions[3 * i + 1] - s.y,
        bin.positions[3 * i + 2] - s.z,
      );
      if (d > 1e-3 * Math.max(1, Math.hypot(s.x, s.y, s.z))) throw new Error(`star ${i} position mismatch`);
    }
  } catch (e) {
    throw new Error(`HYG order does not match stars.bin (rebuild stars first): ${e.message}`);
  }
  return stars;
}

async function main() {
  const paths = await ensureModuleAssets('starsystems');
  const culture = JSON.parse(readFileSync(paths.get('stellarium_modern'), 'utf8'));
  const stars = await loadHyg();
  const byHip = new Map();
  for (const s of stars) if (s.hip != null && !byHip.has(s.hip)) byHip.set(s.hip, s.index);

  const missing = new Set();
  const figures = [];
  for (const c of culture.constellations) {
    const id = c.id.replace(/^CON modern /, '');
    const seen = new Set();
    const segments = [];
    for (const line of c.lines) {
      for (let k = 0; k + 1 < line.length; k++) {
        const a = byHip.get(line[k]);
        const b = byHip.get(line[k + 1]);
        if (a === undefined || b === undefined) {
          for (const h of [line[k], line[k + 1]]) if (!byHip.has(h)) missing.add(h);
          continue;
        }
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        if (a === b || seen.has(key)) continue;
        seen.add(key);
        segments.push(a, b);
      }
    }
    if (segments.length) figures.push({ id, name: c.common_name?.english ?? id, segments });
  }
  figures.sort((a, b) => a.id.localeCompare(b.id));
  const out = {
    version: 1,
    source:
      'Stellarium sky culture "modern" (skycultures/modern/index.json, CC BY-SA 4.0); HIP ids mapped to data/stars/stars.bin indices (HYG v4.1 order)',
    license: 'CC-BY-SA-4.0',
    figures,
    missingHip: [...missing].sort((a, b) => a - b),
  };
  const dir = join(PUBLIC, 'data', 'starsystems');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'constellations.json'), JSON.stringify(out) + '\n');
  const nSeg = figures.reduce((n, f) => n + f.segments.length / 2, 0);
  console.log(
    `constellations: ${figures.length} figures, ${nSeg} segments, ${missing.size} HIP ids not in HYG`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
