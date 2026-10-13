/**
 * Cube-sphere quadtree addressing (pure, shared by the worker, the main thread and the tests).
 *
 * A node is (face, level, x, y) with x, y in [0, 2^level). Its 33×33 vertex grid uses exact
 * dyadic face coordinates s = (x·32 + i) / (16·2^level) − 1 in [−1, 1], warped by
 * a = sign(s)·tan(|s|·π/4) (odd-exact, ±1 exact) so shared edges, inside a face and across cube
 * edges, produce bitwise-identical directions and therefore identical heights.
 */
import type { Vec3d } from '../../core/contracts';

/** Vertices per patch edge (32 cells). */
export const PATCH_N = 33;
export const PATCH_CELLS = PATCH_N - 1;
/** Deepest quadtree level. */
export const MAX_LEVEL = 22;

/** Face frames: centre c, axes u, v with u × v = c (outward), matching the sphere provider. */
export const FACES: readonly (readonly [Vec3d, Vec3d, Vec3d])[] = [
  [
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: 0, z: 1 },
  ],
  [
    { x: -1, y: 0, z: 0 },
    { x: 0, y: -1, z: 0 },
    { x: 0, y: 0, z: 1 },
  ],
  [
    { x: 0, y: 1, z: 0 },
    { x: -1, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 },
  ],
  [
    { x: 0, y: -1, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 },
  ],
  [
    { x: 0, y: 0, z: 1 },
    { x: 0, y: 1, z: 0 },
    { x: -1, y: 0, z: 0 },
  ],
  [
    { x: 0, y: 0, z: -1 },
    { x: 0, y: 1, z: 0 },
    { x: 1, y: 0, z: 0 },
  ],
];

const QPI = Math.PI / 4;

/** Face coordinate → cube-plane coordinate. Odd-exact; ±1 map to ±1 exactly. */
export function warp(s: number): number {
  const m = Math.abs(s);
  const w = m === 1 ? 1 : Math.tan(m * QPI);
  return s < 0 ? -w : w;
}

/** Inverse of warp. */
export function unwarp(a: number): number {
  const m = Math.abs(a);
  const s = m === 1 ? 1 : Math.atan(m) / QPI;
  return a < 0 ? -s : s;
}

/** Exact dyadic face coordinate of grid index g (= x·32 + i) at `level`. */
export function faceCoord(g: number, level: number): number {
  return g / (16 * 2 ** level) - 1;
}

/** Unit direction for face coordinates (s, t), written to out[o..o+2]. */
export function faceDir(face: number, s: number, t: number, out: Float64Array, o: number): void {
  const [c, u, v] = FACES[face];
  const a = warp(s);
  const b = warp(t);
  const x = c.x + a * u.x + b * v.x;
  const y = c.y + a * u.y + b * v.y;
  const z = c.z + a * u.z + b * v.z;
  const l = 1 / Math.sqrt(x * x + y * y + z * z);
  out[o] = x * l;
  out[o + 1] = y * l;
  out[o + 2] = z * l;
}

/** Face and face coordinates (s, t) in [−1, 1] of a (not necessarily unit) direction. */
export function dirToFace(d: Vec3d): { face: number; s: number; t: number } {
  const ax = Math.abs(d.x);
  const ay = Math.abs(d.y);
  const az = Math.abs(d.z);
  let face: number;
  if (ax >= ay && ax >= az) face = d.x >= 0 ? 0 : 1;
  else if (ay >= az) face = d.y >= 0 ? 2 : 3;
  else face = d.z >= 0 ? 4 : 5;
  const [c, u, v] = FACES[face];
  const k = d.x * c.x + d.y * c.y + d.z * c.z;
  const a = (d.x * u.x + d.y * u.y + d.z * u.z) / k;
  const b = (d.x * v.x + d.y * v.y + d.z * v.z) / k;
  const cl = (x: number) => Math.max(-1, Math.min(1, x));
  return { face, s: cl(unwarp(a)), t: cl(unwarp(b)) };
}

/** Packs a node id below 2^53: ((face·32 + level)·2^22 + x)·2^22 + y. */
export function nodeKey(face: number, level: number, x: number, y: number): number {
  return ((face * 32 + level) * 4194304 + x) * 4194304 + y;
}

export interface NodeId {
  face: number;
  level: number;
  x: number;
  y: number;
}

export function unpackKey(key: number): NodeId {
  const y = key % 4194304;
  const r = (key - y) / 4194304;
  const x = r % 4194304;
  const fl = (r - x) / 4194304;
  return { face: Math.floor(fl / 32), level: fl % 32, x, y };
}

export function childKeys(n: NodeId): number[] {
  const l = n.level + 1;
  const x = n.x * 2;
  const y = n.y * 2;
  return [nodeKey(n.face, l, x, y), nodeKey(n.face, l, x + 1, y), nodeKey(n.face, l, x, y + 1), nodeKey(n.face, l, x + 1, y + 1)];
}

export const ROOT_KEYS: readonly number[] = [0, 1, 2, 3, 4, 5].map((f) => nodeKey(f, 0, 0, 0));

/** Approximate vertex spacing at `level` for equatorial radius a, m. */
export function cellSize(a: number, level: number): number {
  return (Math.PI / 2) * a / (PATCH_CELLS * 2 ** level);
}

/** Geometric error attributed to a level (drives the screen-space error), m. */
export function levelError(a: number, level: number): number {
  return 0.5 * cellSize(a, level);
}

/** Radius of the reference ellipsoid (a, a, c) along unit direction d. */
export function ellipsoidRadius(a: number, c: number, dx: number, dy: number, dz: number): number {
  return 1 / Math.sqrt((dx * dx + dy * dy) / (a * a) + (dz * dz) / (c * c));
}
