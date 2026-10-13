/**
 * CPU ground query identical to the mesh: same height function, same dyadic grid, same triangle
 * split (p00–p11). Intersects the radial ray with the triangle of the leaf cell under `dir`.
 */
import type { HeightFunction, Vec3d } from '../../core/contracts';
import { dirToFace, ellipsoidRadius, faceCoord, faceDir, PATCH_CELLS } from './cube';

const dirs = new Float64Array(12);
const hs = new Float64Array(4);
const P = new Float64Array(12);

/**
 * Distance from the body centre to the mesh surface along unit body-fixed `dir`, m, for a patch
 * grid at `level`. Subtract the equatorial radius to get a GroundProvider height.
 */
export function groundRadius(fn: HeightFunction, a: number, c: number, dir: Vec3d, level: number): number {
  const { face, s, t } = dirToFace(dir);
  const n = PATCH_CELLS * 2 ** level; // cells per face edge
  const gs = (s + 1) * 16 * 2 ** level;
  const gt = (t + 1) * 16 * 2 ** level;
  const i0 = Math.min(n - 1, Math.max(0, Math.floor(gs)));
  const j0 = Math.min(n - 1, Math.max(0, Math.floor(gt)));
  const s0 = faceCoord(i0, level);
  const s1 = faceCoord(i0 + 1, level);
  const t0 = faceCoord(j0, level);
  const t1 = faceCoord(j0 + 1, level);
  faceDir(face, s0, t0, dirs, 0); // p00
  faceDir(face, s1, t0, dirs, 3); // p10
  faceDir(face, s1, t1, dirs, 6); // p11
  faceDir(face, s0, t1, dirs, 9); // p01
  fn.sample(dirs, hs, 4, level);
  for (let k = 0; k < 4; k++) {
    const dx = dirs[3 * k];
    const dy = dirs[3 * k + 1];
    const dz = dirs[3 * k + 2];
    const r = ellipsoidRadius(a, c, dx, dy, dz) + hs[k];
    P[3 * k] = dx * r;
    P[3 * k + 1] = dy * r;
    P[3 * k + 2] = dz * r;
  }
  // Which side of the plane (origin, p00, p11) is dir on? p10 side → triangle (p00, p10, p11).
  const nx = P[1] * P[8] - P[2] * P[7];
  const ny = P[2] * P[6] - P[0] * P[8];
  const nz = P[0] * P[7] - P[1] * P[6];
  const sd = nx * dir.x + ny * dir.y + nz * dir.z;
  const s10 = nx * P[3] + ny * P[4] + nz * P[5];
  const o = sd * s10 >= 0 ? 3 : 9; // p10 or p01
  return rayTriangle(dir, 0, o, 6);
}

function rayTriangle(d: Vec3d, ia: number, ib: number, ic: number): number {
  const ax = P[ia];
  const ay = P[ia + 1];
  const az = P[ia + 2];
  const e1x = P[ib] - ax;
  const e1y = P[ib + 1] - ay;
  const e1z = P[ib + 2] - az;
  const e2x = P[ic] - ax;
  const e2y = P[ic + 1] - ay;
  const e2z = P[ic + 2] - az;
  const nx = e1y * e2z - e1z * e2y;
  const ny = e1z * e2x - e1x * e2z;
  const nz = e1x * e2y - e1y * e2x;
  const den = nx * d.x + ny * d.y + nz * d.z;
  return (nx * ax + ny * ay + nz * az) / den;
}

/** Ground normal (body-fixed, unit) of the same triangle, by finite differences of groundRadius. */
export function groundNormal(
  fn: HeightFunction,
  a: number,
  c: number,
  dir: Vec3d,
  level: number,
  out: Vec3d,
): Vec3d {
  const r0 = groundRadius(fn, a, c, dir, level);
  // Two tangents of ~half a cell.
  const e = Math.max(1e-9, (0.25 * (Math.PI / 2)) / (PATCH_CELLS * 2 ** level));
  const tx = Math.abs(dir.z) < 0.9 ? { x: -dir.y, y: dir.x, z: 0 } : { x: 0, y: -dir.z, z: dir.y };
  const tl = Math.hypot(tx.x, tx.y, tx.z);
  tx.x /= tl;
  tx.y /= tl;
  tx.z /= tl;
  const ty = {
    x: dir.y * tx.z - dir.z * tx.y,
    y: dir.z * tx.x - dir.x * tx.z,
    z: dir.x * tx.y - dir.y * tx.x,
  };
  const pt = (u: number, v: number) => {
    const q = {
      x: dir.x + u * tx.x + v * ty.x,
      y: dir.y + u * tx.y + v * ty.y,
      z: dir.z + u * tx.z + v * ty.z,
    };
    const l = Math.hypot(q.x, q.y, q.z);
    q.x /= l;
    q.y /= l;
    q.z /= l;
    const r = groundRadius(fn, a, c, q, level);
    return { x: q.x * r, y: q.y * r, z: q.z * r };
  };
  const p1 = pt(e, 0);
  const p2 = pt(0, e);
  const p0 = { x: dir.x * r0, y: dir.y * r0, z: dir.z * r0 };
  const ux = p1.x - p0.x;
  const uy = p1.y - p0.y;
  const uz = p1.z - p0.z;
  const vx = p2.x - p0.x;
  const vy = p2.y - p0.y;
  const vz = p2.z - p0.z;
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  if (nx * dir.x + ny * dir.y + nz * dir.z < 0) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  const l = Math.hypot(nx, ny, nz) || 1;
  out.x = nx / l;
  out.y = ny / l;
  out.z = nz / l;
  return out;
}
