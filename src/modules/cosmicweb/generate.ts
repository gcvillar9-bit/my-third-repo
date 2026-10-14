/**
 * Procedural cosmic web (P5-A), deterministic. Cluster nodes are scattered uniformly through a sphere
 * around the Milky Way; each node is joined to its three nearest neighbours by filaments. Tracer points
 * are drawn 30% in Gaussian node blobs (weighted by a Pareto richness), 60% along filaments (Gaussian
 * cross-section) and 10% uniformly in the voids. Positions are Mpc in the `universe` frame. This is a
 * statistical illustration, not a map: it is labelled "simulated".
 */
import type { QualityPreset } from '../../core/contracts';

export const WEB_RADIUS_MPC = 800;
export const WEB_NODES = 2400;
export const WEB_COUNT: Record<QualityPreset, number> = {
  potato: 50_000,
  low: 100_000,
  medium: 200_000,
  high: 300_000,
  ultra: 400_000,
};
/** Absolute magnitude of one tracer at 200k points (~1e12 L☉ per tracer, B-band luminosity density
 * ~1e8 L☉/Mpc³); scaled by count so the total light does not depend on the preset. Approximate. */
export const TRACER_ABSMAG_200K = -24.5;
export const tracerAbsMag = (count: number): number => TRACER_ABSMAG_200K - 2.5 * Math.log10(200_000 / count);

/** mulberry32 PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

function inSphere(rand: () => number, r: number, out: number[], o: number): void {
  for (;;) {
    const x = 2 * rand() - 1;
    const y = 2 * rand() - 1;
    const z = 2 * rand() - 1;
    if (x * x + y * y + z * z <= 1) {
      out[o] = x * r;
      out[o + 1] = y * r;
      out[o + 2] = z * r;
      return;
    }
  }
}

export interface WebData {
  pos: Float32Array;
  count: number;
  nodes: number;
  filaments: number;
}

/** Generates `count` tracers (deterministic for a given seed, radius and node count). */
export function generateWeb(
  count: number,
  seed = 1,
  radius = WEB_RADIUS_MPC,
  nodeCount = WEB_NODES,
): WebData {
  const rand = mulberry32(seed);
  const nodes: number[] = new Array<number>(3 * nodeCount);
  const rich = new Float64Array(nodeCount);
  for (let i = 0; i < nodeCount; i++) {
    inSphere(rand, radius, nodes, 3 * i);
    rich[i] = Math.min(20, Math.pow(Math.max(rand(), 1e-6), -0.6));
  }
  // Three nearest neighbours per node (brute force, O(N²) once).
  const edges: [number, number, number][] = [];
  const seen = new Set<number>();
  const best = [0, 0, 0];
  const bestD = [0, 0, 0];
  for (let i = 0; i < nodeCount; i++) {
    bestD.fill(Infinity);
    for (let j = 0; j < nodeCount; j++) {
      if (j === i) continue;
      const dx = nodes[3 * j] - nodes[3 * i];
      const dy = nodes[3 * j + 1] - nodes[3 * i + 1];
      const dz = nodes[3 * j + 2] - nodes[3 * i + 2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d >= bestD[2]) continue;
      let k = 2;
      while (k > 0 && bestD[k - 1] > d) {
        bestD[k] = bestD[k - 1];
        best[k] = best[k - 1];
        k--;
      }
      bestD[k] = d;
      best[k] = j;
    }
    for (let k = 0; k < 3; k++) {
      const a = Math.min(i, best[k]);
      const b = Math.max(i, best[k]);
      const key = a * nodeCount + b;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push([a, b, Math.sqrt(bestD[k])]);
    }
  }
  // Cumulative weights for node and filament selection.
  const nodeCdf = new Float64Array(nodeCount);
  for (let i = 0, s = 0; i < nodeCount; i++) nodeCdf[i] = s += rich[i];
  const edgeCdf = new Float64Array(edges.length);
  for (let i = 0, s = 0; i < edges.length; i++) edgeCdf[i] = s += edges[i][2];
  const pick = (cdf: Float64Array): number => {
    const u = rand() * cdf[cdf.length - 1];
    let lo = 0;
    let hi = cdf.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < u) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  const pos = new Float32Array(3 * count);
  const tmp = [0, 0, 0];
  const nNode = Math.round(0.3 * count);
  const nFil = Math.round(0.6 * count);
  for (let p = 0; p < count; p++) {
    let x: number;
    let y: number;
    let z: number;
    if (p < nNode) {
      const i = pick(nodeCdf);
      const s = 1.5 * Math.cbrt(rich[i]);
      x = nodes[3 * i] + s * gauss(rand);
      y = nodes[3 * i + 1] + s * gauss(rand);
      z = nodes[3 * i + 2] + s * gauss(rand);
    } else if (p < nNode + nFil) {
      const [a, b] = edges[pick(edgeCdf)];
      const t = rand();
      const s = 1.2;
      x = nodes[3 * a] + t * (nodes[3 * b] - nodes[3 * a]) + s * gauss(rand);
      y = nodes[3 * a + 1] + t * (nodes[3 * b + 1] - nodes[3 * a + 1]) + s * gauss(rand);
      z = nodes[3 * a + 2] + t * (nodes[3 * b + 2] - nodes[3 * a + 2]) + s * gauss(rand);
    } else {
      inSphere(rand, radius, tmp, 0);
      [x, y, z] = tmp;
    }
    pos[3 * p] = x;
    pos[3 * p + 1] = y;
    pos[3 * p + 2] = z;
  }
  return { pos, count, nodes: nodeCount, filaments: edges.length };
}

/**
 * Pairs closer than r among the first `n` tracers taken with a stride over the whole set, divided by the
 * expectation for the same number of uniform points in the sphere (edge effects ignored). > 1 = clustered.
 */
export function pairExcess(pos: Float32Array, n: number, r: number, radius = WEB_RADIUS_MPC): number {
  const total = pos.length / 3;
  const stride = Math.max(1, Math.floor(total / n));
  const idx: number[] = [];
  for (let i = 0; i < total && idx.length < n; i += stride) idx.push(i);
  const r2 = r * r;
  let pairs = 0;
  for (let a = 0; a < idx.length; a++)
    for (let b = a + 1; b < idx.length; b++) {
      const i = 3 * idx[a];
      const j = 3 * idx[b];
      const dx = pos[i] - pos[j];
      const dy = pos[i + 1] - pos[j + 1];
      const dz = pos[i + 2] - pos[j + 2];
      if (dx * dx + dy * dy + dz * dz < r2) pairs++;
    }
  const m = idx.length;
  const expected = ((m * (m - 1)) / 2) * Math.pow(r / radius, 3);
  return pairs / expected;
}
