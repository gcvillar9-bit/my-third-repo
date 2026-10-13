#!/usr/bin/env node
/**
 * Generates public/data/render/bluenoise64.png: a 64×64 8-bit tiling blue-noise mask using
 * Ulichney's void-and-cluster method (toroidal Gaussian energy, sigma 1.5). Deterministic: a
 * seeded PRNG picks the initial pattern, so reruns produce identical bytes.
 *
 *   node tools/gen-bluenoise.mjs [outPath]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encode } from 'fast-png';

const N = 64;
const SIGMA = 1.5;
const SEED = 1;
const INITIAL_FRACTION = 0.1;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, process.argv[2] ?? 'public/data/render/bluenoise64.png');

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Toroidal Gaussian kernel K[dy * N + dx] for wrapped offsets. */
const K = new Float64Array(N * N);
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const dx = Math.min(x, N - x);
    const dy = Math.min(y, N - y);
    K[y * N + x] = Math.exp(-(dx * dx + dy * dy) / (2 * SIGMA * SIGMA));
  }
}

class Field {
  constructor(bits) {
    this.bits = Uint8Array.from(bits);
    this.energy = new Float64Array(N * N);
    for (let i = 0; i < N * N; i++) if (this.bits[i]) this.splat(i, 1);
  }
  splat(i, sign) {
    const px = i % N;
    const py = (i / N) | 0;
    const e = this.energy;
    for (let y = 0; y < N; y++) {
      const ky = ((y - py + N) % N) * N;
      const row = y * N;
      for (let x = 0; x < N; x++) e[row + x] += sign * K[ky + ((x - px + N) % N)];
    }
  }
  set(i, v) {
    if (this.bits[i] === v) return;
    this.bits[i] = v;
    this.splat(i, v ? 1 : -1);
  }
  /** Index of the 1 with the highest energy (tightest cluster). */
  tightestCluster() {
    let best = -1;
    for (let i = 0; i < N * N; i++)
      if (this.bits[i] && (best < 0 || this.energy[i] > this.energy[best])) best = i;
    return best;
  }
  /** Index of the 0 with the lowest energy (largest void). */
  largestVoid() {
    let best = -1;
    for (let i = 0; i < N * N; i++)
      if (!this.bits[i] && (best < 0 || this.energy[i] < this.energy[best])) best = i;
    return best;
  }
}

// Initial pattern: random 10% ones, then relaxed until stable.
const rand = mulberry32(SEED);
const initial = new Uint8Array(N * N);
const ones = Math.round(N * N * INITIAL_FRACTION);
for (let placed = 0; placed < ones;) {
  const i = Math.floor(rand() * N * N);
  if (!initial[i]) {
    initial[i] = 1;
    placed++;
  }
}
const f = new Field(initial);
for (let iter = 0; iter < 10 * N * N; iter++) {
  const c = f.tightestCluster();
  f.set(c, 0);
  const v = f.largestVoid();
  if (v === c) {
    f.set(c, 1);
    break;
  }
  f.set(v, 1);
}
const prototype = f.bits.slice();

const rank = new Int32Array(N * N).fill(-1);
// Phase 1: remove tightest clusters from the prototype, ranking downwards.
{
  const g = new Field(prototype);
  for (let r = ones - 1; r >= 0; r--) {
    const c = g.tightestCluster();
    g.set(c, 0);
    rank[c] = r;
  }
}
// Phases 2-3: fill largest voids from the prototype upwards.
{
  const g = new Field(prototype);
  for (let r = ones; r < N * N; r++) {
    const v = g.largestVoid();
    g.set(v, 1);
    rank[v] = r;
  }
}

const data = new Uint8Array(N * N);
for (let i = 0; i < N * N; i++) data[i] = Math.floor((rank[i] * 256) / (N * N));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, encode({ width: N, height: N, data, channels: 1, depth: 8 }));
console.log(`gen-bluenoise: wrote ${out} (${N}x${N})`);
