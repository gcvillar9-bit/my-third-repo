/**
 * Patch builder (pure; runs in the terrain worker, in the in-process fallback and in tests).
 *
 * A patch is the 33×33 vertex grid of one quadtree node plus 4 skirts. Positions are computed in
 * float64 on a 35×35 grid (1-vertex border so edge normals match the neighbours), then stored as
 * Float32 offsets from the float64 tile centre (the centre vertex). P = d·(r_ell(d) + h(d)).
 */
import type { HeightFunction } from '../../core/contracts';
import { cellSize, ellipsoidRadius, faceCoord, faceDir, PATCH_CELLS, PATCH_N } from './cube';

export interface PatchRequest {
  face: number;
  level: number;
  x: number;
  y: number;
  /** Equatorial and polar radii, m. */
  a: number;
  c: number;
}

export interface PatchData {
  key: number;
  level: number;
  /** Float64 tile centre, body-fixed, m. */
  centre: [number, number, number];
  /** Bounding-sphere radius around `centre` (skirts included), m. */
  radius: number;
  /** Min/max distance of any surface vertex from the body centre, m. */
  rMin: number;
  rMax: number;
  hMin: number;
  hMax: number;
  /** Float32 offsets from `centre`, body-fixed axes (VERTEX_COUNT·3). */
  positions: Float32Array;
  /** Unit normals, body-fixed (VERTEX_COUNT·3). */
  normals: Float32Array;
  /** Radial unit direction xyz and height w (VERTEX_COUNT·4); drives the hand-off morph. */
  upH: Float32Array;
}

const B = PATCH_N + 2; // bordered grid edge
export const SKIRT_COUNT = 4 * PATCH_N;
export const VERTEX_COUNT = PATCH_N * PATCH_N + SKIRT_COUNT;

/** Skirt depth below the edge at `level`, m. */
export const skirtDepth = (a: number, level: number) => 2 * cellSize(a, level) + 0.5;

/** Bordered grid directions (row-major, j outer) for a node. */
export function patchDirs(req: PatchRequest): Float64Array {
  const dirs = new Float64Array(B * B * 3);
  const base = PATCH_CELLS;
  for (let j = -1; j <= PATCH_N; j++) {
    const t = faceCoord(req.y * base + j, req.level);
    for (let i = -1; i <= PATCH_N; i++) {
      const s = faceCoord(req.x * base + i, req.level);
      faceDir(req.face, s, t, dirs, ((j + 1) * B + (i + 1)) * 3);
    }
  }
  return dirs;
}

/** Edge vertex ids (grid indices) in order: bottom (j=0), top (j=32), left (i=0), right (i=32). */
function edgeIndex(e: number, k: number): number {
  const L = PATCH_N - 1;
  if (e === 0) return k;
  if (e === 1) return L * PATCH_N + k;
  if (e === 2) return k * PATCH_N;
  return k * PATCH_N + L;
}

export function buildPatch(fn: HeightFunction, req: PatchRequest, key = 0): PatchData {
  const { a, c, level } = req;
  const dirs = patchDirs(req);
  const n = B * B;
  const h = new Float64Array(n);
  fn.sample(dirs, h, n, level);
  const P = new Float64Array(n * 3);
  for (let k = 0; k < n; k++) {
    const dx = dirs[3 * k];
    const dy = dirs[3 * k + 1];
    const dz = dirs[3 * k + 2];
    const r = ellipsoidRadius(a, c, dx, dy, dz) + h[k];
    P[3 * k] = dx * r;
    P[3 * k + 1] = dy * r;
    P[3 * k + 2] = dz * r;
  }
  const mid = ((PATCH_N >> 1) + 1) * B + ((PATCH_N >> 1) + 1);
  const cx = P[3 * mid];
  const cy = P[3 * mid + 1];
  const cz = P[3 * mid + 2];
  const positions = new Float32Array(VERTEX_COUNT * 3);
  const normals = new Float32Array(VERTEX_COUNT * 3);
  const upH = new Float32Array(VERTEX_COUNT * 4);
  let rad2 = 0;
  let rMin = Infinity;
  let rMax = 0;
  let hMin = Infinity;
  let hMax = -Infinity;
  for (let j = 0; j < PATCH_N; j++) {
    for (let i = 0; i < PATCH_N; i++) {
      const k = (j + 1) * B + (i + 1);
      const v = j * PATCH_N + i;
      const px = P[3 * k];
      const py = P[3 * k + 1];
      const pz = P[3 * k + 2];
      const ox = px - cx;
      const oy = py - cy;
      const oz = pz - cz;
      positions[3 * v] = ox;
      positions[3 * v + 1] = oy;
      positions[3 * v + 2] = oz;
      rad2 = Math.max(rad2, ox * ox + oy * oy + oz * oz);
      const r = Math.sqrt(px * px + py * py + pz * pz);
      rMin = Math.min(rMin, r);
      rMax = Math.max(rMax, r);
      hMin = Math.min(hMin, h[k]);
      hMax = Math.max(hMax, h[k]);
      // Central differences: (P[i+1] − P[i−1]) × (P[j+1] − P[j−1]) is outward (u × v = c).
      const kr = k + 1;
      const kl = k - 1;
      const ku = k + B;
      const kd = k - B;
      const ux = P[3 * kr] - P[3 * kl];
      const uy = P[3 * kr + 1] - P[3 * kl + 1];
      const uz = P[3 * kr + 2] - P[3 * kl + 2];
      const vx = P[3 * ku] - P[3 * kd];
      const vy = P[3 * ku + 1] - P[3 * kd + 1];
      const vz = P[3 * ku + 2] - P[3 * kd + 2];
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const nl = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx *= nl;
      ny *= nl;
      nz *= nl;
      normals[3 * v] = nx;
      normals[3 * v + 1] = ny;
      normals[3 * v + 2] = nz;
      upH[4 * v] = dirs[3 * k];
      upH[4 * v + 1] = dirs[3 * k + 1];
      upH[4 * v + 2] = dirs[3 * k + 2];
      upH[4 * v + 3] = h[k];
    }
  }
  // Skirts: copies of the edge vertices pushed down along the radial direction.
  const depth = skirtDepth(a, level);
  let s = PATCH_N * PATCH_N;
  for (let e = 0; e < 4; e++) {
    for (let k = 0; k < PATCH_N; k++, s++) {
      const v = edgeIndex(e, k);
      const dx = upH[4 * v];
      const dy = upH[4 * v + 1];
      const dz = upH[4 * v + 2];
      const ox = positions[3 * v] - dx * depth;
      const oy = positions[3 * v + 1] - dy * depth;
      const oz = positions[3 * v + 2] - dz * depth;
      positions[3 * s] = ox;
      positions[3 * s + 1] = oy;
      positions[3 * s + 2] = oz;
      rad2 = Math.max(rad2, ox * ox + oy * oy + oz * oz);
      normals.copyWithin(3 * s, 3 * v, 3 * v + 3);
      upH.copyWithin(4 * s, 4 * v, 4 * v + 4);
    }
  }
  return {
    key,
    level,
    centre: [cx, cy, cz],
    radius: Math.sqrt(rad2) * 1.001 + 1e-3,
    rMin,
    rMax,
    hMin,
    hMax,
    positions,
    normals,
    upH,
  };
}

let sharedIndex: Uint16Array | null = null;

/** Triangle list shared by every patch: grid cells split along p00–p11, then the 4 skirts. */
export function patchIndex(): Uint16Array {
  if (sharedIndex) return sharedIndex;
  const C = PATCH_CELLS;
  const out = new Uint16Array(C * C * 6 + 4 * C * 6);
  let t = 0;
  for (let j = 0; j < C; j++) {
    for (let i = 0; i < C; i++) {
      const p00 = j * PATCH_N + i;
      const p10 = p00 + 1;
      const p01 = p00 + PATCH_N;
      const p11 = p01 + 1;
      out[t++] = p00;
      out[t++] = p10;
      out[t++] = p11;
      out[t++] = p00;
      out[t++] = p11;
      out[t++] = p01;
    }
  }
  const skirt0 = PATCH_N * PATCH_N;
  for (let e = 0; e < 4; e++) {
    for (let k = 0; k < C; k++) {
      const a0 = edgeIndex(e, k);
      const a1 = edgeIndex(e, k + 1);
      const b0 = skirt0 + e * PATCH_N + k;
      const b1 = b0 + 1;
      out[t++] = a0;
      out[t++] = b0;
      out[t++] = a1;
      out[t++] = a1;
      out[t++] = b0;
      out[t++] = b1;
    }
  }
  sharedIndex = out;
  return out;
}

/** Transferable buffers of a patch (comlink transfer list). */
export const patchBuffers = (p: PatchData): ArrayBuffer[] => [
  p.positions.buffer as ArrayBuffer,
  p.normals.buffer as ArrayBuffer,
  p.upH.buffer as ArrayBuffer,
];

/** CPU bytes of one patch (GPU bytes are the same plus the shared index). */
export const PATCH_BYTES = VERTEX_COUNT * (12 + 12 + 16) + patchIndexLength() * 2;
function patchIndexLength(): number {
  return PATCH_CELLS * PATCH_CELLS * 6 + 4 * PATCH_CELLS * 6;
}
