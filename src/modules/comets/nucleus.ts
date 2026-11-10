/**
 * Procedural nucleus mesh (three-free): an icosphere whose radius follows the union of one or two
 * ellipsoidal lobes (67P's "duck") roughened by value noise. The mesh is scaled so its largest extent is 1;
 * the renderable scales it by the body radius, so the camera's collision sphere always encloses it.
 */
import type { Quatd } from '../../core/contracts';
import { qfromAxisAngle, vec3 } from '../../core/math64';
import { JD_J2000 } from '../../core/units';
import type { CometShape } from './data';

/** Deterministic 32-bit hash of a string (seed per comet). */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Orientation of a nucleus at `jd` (mesh axes into world axes): a slow spin about a fixed, comet-specific
 * axis with the catalogued period. The real pole directions are not modelled.
 */
export function nucleusSpin(id: string, rotationHours: number | undefined, jd: number, out: Quatd): Quatd {
  const seed = hashString(id);
  const axis = vec3(((seed & 255) / 255 - 0.5) * 0.9, (((seed >> 8) & 255) / 255 - 0.5) * 0.9, 1);
  const turns = ((jd - JD_J2000) * 24) / (rotationHours ?? 12);
  return qfromAxisAngle(out, axis, 2 * Math.PI * (turns - Math.floor(turns)));
}

function hash3(x: number, y: number, z: number, seed: number): number {
  let h = (Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647) ^ seed) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Value noise in [-1, 1]. */
export function valueNoise(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const u = fade(x - xi);
  const v = fade(y - yi);
  const w = fade(z - zi);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (i: number, j: number, k: number) => hash3(xi + i, yi + j, zi + k, seed);
  const n = l(
    l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v),
    l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  );
  return 2 * n - 1;
}

/** Icosphere with `level` subdivisions: unit positions and triangle indices. */
export function icosphere(level: number): { pos: Float32Array; index: Uint16Array } {
  const t = (1 + Math.sqrt(5)) / 2;
  const verts: number[] = [];
  const add = (x: number, y: number, z: number) => {
    const l = Math.hypot(x, y, z);
    verts.push(x / l, y / l, z / l);
    return verts.length / 3 - 1;
  };
  for (const [x, y, z] of [
    [-1, t, 0],
    [1, t, 0],
    [-1, -t, 0],
    [1, -t, 0],
    [0, -1, t],
    [0, 1, t],
    [0, -1, -t],
    [0, 1, -t],
    [t, 0, -1],
    [t, 0, 1],
    [-t, 0, -1],
    [-t, 0, 1],
  ])
    add(x, y, z);
  // prettier-ignore
  let faces = [
    0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
    3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
  ];
  for (let l = 0; l < level; l++) {
    const cache = new Map<number, number>();
    const mid = (a: number, b: number) => {
      const key = a < b ? a * 65536 + b : b * 65536 + a;
      let m = cache.get(key);
      if (m === undefined) {
        m = add(
          verts[3 * a] + verts[3 * b],
          verts[3 * a + 1] + verts[3 * b + 1],
          verts[3 * a + 2] + verts[3 * b + 2],
        );
        cache.set(key, m);
      }
      return m;
    };
    const next: number[] = [];
    for (let i = 0; i < faces.length; i += 3) {
      const [a, b, c] = [faces[i], faces[i + 1], faces[i + 2]];
      const ab = mid(a, b);
      const bc = mid(b, c);
      const ca = mid(c, a);
      next.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
    }
    faces = next;
  }
  return { pos: new Float32Array(verts), index: new Uint16Array(faces) };
}

/** Far intersection of the ray from the origin along unit (dx, dy, dz) with a lobe; 0 when it misses. */
function lobeRadius(dx: number, dy: number, dz: number, lobe: CometShape['lobes'][number]): number {
  const [a, b, c] = lobe.axes;
  const [ox, oy, oz] = lobe.offset;
  const A = (dx * dx) / (a * a) + (dy * dy) / (b * b) + (dz * dz) / (c * c);
  const B = (dx * ox) / (a * a) + (dy * oy) / (b * b) + (dz * oz) / (c * c);
  const C = (ox * ox) / (a * a) + (oy * oy) / (b * b) + (oz * oz) / (c * c) - 1;
  const disc = B * B - A * C;
  if (disc < 0) return 0;
  return Math.max(0, (B + Math.sqrt(disc)) / A);
}

export interface NucleusMesh {
  pos: Float32Array;
  normal: Float32Array;
  index: Uint16Array;
}

/** Builds the nucleus mesh (largest extent 1) for a shape and seed. */
export function buildNucleus(shape: CometShape, seed: number, level: number): NucleusMesh {
  const { pos, index } = icosphere(level);
  const n = pos.length / 3;
  let rMax = 0;
  for (let i = 0; i < n; i++) {
    const [x, y, z] = [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]];
    let r = 0;
    for (const lobe of shape.lobes) r = Math.max(r, lobeRadius(x, y, z, lobe));
    // Hills, pits and a little facet-scale roughness.
    const rough =
      0.11 * valueNoise(1.7 * x + 3.1, 1.7 * y - 1.3, 1.7 * z + 0.7, seed) +
      0.06 * valueNoise(4.1 * x, 4.1 * y, 4.1 * z, seed ^ 0x9e3779b9) +
      0.025 * valueNoise(9.3 * x, 9.3 * y, 9.3 * z, seed ^ 0x51ed270b);
    r *= 1 + rough;
    pos[3 * i] = x * r;
    pos[3 * i + 1] = y * r;
    pos[3 * i + 2] = z * r;
    rMax = Math.max(rMax, r);
  }
  for (let i = 0; i < pos.length; i++) pos[i] /= rMax;
  // Area-weighted vertex normals.
  const normal = new Float32Array(pos.length);
  for (let f = 0; f < index.length; f += 3) {
    const [a, b, c] = [3 * index[f], 3 * index[f + 1], 3 * index[f + 2]];
    const ux = pos[b] - pos[a];
    const uy = pos[b + 1] - pos[a + 1];
    const uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a];
    const vy = pos[c + 1] - pos[a + 1];
    const vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      normal[v] += nx;
      normal[v + 1] += ny;
      normal[v + 2] += nz;
    }
  }
  for (let i = 0; i < n; i++) {
    const l = Math.hypot(normal[3 * i], normal[3 * i + 1], normal[3 * i + 2]) || 1;
    normal[3 * i] /= l;
    normal[3 * i + 1] /= l;
    normal[3 * i + 2] /= l;
  }
  return { pos, normal, index };
}
