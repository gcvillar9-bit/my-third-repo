/**
 * Float64 vector and quaternion helpers for the frame tree (DESIGN 3.2). All functions
 * write into `out` (which may alias an input) and return it, so hot paths allocate nothing.
 */
import type { Quatd, Vec3d } from './contracts';

export const vec3 = (x = 0, y = 0, z = 0): Vec3d => ({ x, y, z });
export const quat = (x = 0, y = 0, z = 0, w = 1): Quatd => ({ x, y, z, w });

export function v3set(out: Vec3d, x: number, y: number, z: number): Vec3d {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}
export const v3copy = (out: Vec3d, a: Vec3d): Vec3d => v3set(out, a.x, a.y, a.z);
export const v3clone = (a: Vec3d): Vec3d => ({ x: a.x, y: a.y, z: a.z });
export const v3add = (out: Vec3d, a: Vec3d, b: Vec3d): Vec3d => v3set(out, a.x + b.x, a.y + b.y, a.z + b.z);
export const v3sub = (out: Vec3d, a: Vec3d, b: Vec3d): Vec3d => v3set(out, a.x - b.x, a.y - b.y, a.z - b.z);
export const v3scale = (out: Vec3d, a: Vec3d, s: number): Vec3d => v3set(out, a.x * s, a.y * s, a.z * s);
/** out = a + b·s */
export const v3addScaled = (out: Vec3d, a: Vec3d, b: Vec3d, s: number): Vec3d =>
  v3set(out, a.x + b.x * s, a.y + b.y * s, a.z + b.z * s);
export const v3dot = (a: Vec3d, b: Vec3d): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const v3cross = (out: Vec3d, a: Vec3d, b: Vec3d): Vec3d =>
  v3set(out, a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const v3len = (a: Vec3d): number => Math.hypot(a.x, a.y, a.z);
export const v3dist = (a: Vec3d, b: Vec3d): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export function v3normalize(out: Vec3d, a: Vec3d): Vec3d {
  const l = v3len(a);
  return l > 0 ? v3scale(out, a, 1 / l) : v3set(out, 0, 0, 0);
}
export const v3lerp = (out: Vec3d, a: Vec3d, b: Vec3d, t: number): Vec3d =>
  v3set(out, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);

export function qset(out: Quatd, x: number, y: number, z: number, w: number): Quatd {
  out.x = x;
  out.y = y;
  out.z = z;
  out.w = w;
  return out;
}
export const qidentity = (out: Quatd): Quatd => qset(out, 0, 0, 0, 1);
export const qcopy = (out: Quatd, a: Quatd): Quatd => qset(out, a.x, a.y, a.z, a.w);
export const qclone = (a: Quatd): Quatd => ({ x: a.x, y: a.y, z: a.z, w: a.w });
export const qconj = (out: Quatd, a: Quatd): Quatd => qset(out, -a.x, -a.y, -a.z, a.w);

/** out = a·b (apply b first, then a). */
export function qmul(out: Quatd, a: Quatd, b: Quatd): Quatd {
  const { x: ax, y: ay, z: az, w: aw } = a;
  const { x: bx, y: by, z: bz, w: bw } = b;
  return qset(
    out,
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  );
}

export function qnormalize(out: Quatd, a: Quatd): Quatd {
  const l = Math.hypot(a.x, a.y, a.z, a.w) || 1;
  return qset(out, a.x / l, a.y / l, a.z / l, a.w / l);
}

/** Rotates v by q: out = q v q*. */
export function qrotate(out: Vec3d, q: Quatd, v: Vec3d): Vec3d {
  const { x: qx, y: qy, z: qz, w: qw } = q;
  const { x, y, z } = v;
  // t = 2 q.xyz × v ; v' = v + w t + q.xyz × t
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  return v3set(
    out,
    x + qw * tx + (qy * tz - qz * ty),
    y + qw * ty + (qz * tx - qx * tz),
    z + qw * tz + (qx * ty - qy * tx),
  );
}

/** Rotates v by q⁻¹. */
export function qrotateInv(out: Vec3d, q: Quatd, v: Vec3d): Vec3d {
  return qrotate(out, { x: -q.x, y: -q.y, z: -q.z, w: q.w }, v);
}

export function qfromAxisAngle(out: Quatd, axis: Vec3d, angle: number): Quatd {
  const l = v3len(axis) || 1;
  const s = Math.sin(angle / 2) / l;
  return qset(out, axis.x * s, axis.y * s, axis.z * s, Math.cos(angle / 2));
}

/** Quaternion of a row-major 3×3 rotation matrix m = [m00, m01, m02, m10, ...]. */
export function qfromMatrix(out: Quatd, m: readonly number[]): Quatd {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m;
  const tr = m00 + m11 + m22;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    return qset(out, (m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s);
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    return qset(out, 0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s);
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    return qset(out, (m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s);
  }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
  return qset(out, (m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s);
}

/**
 * Camera-style look rotation (three.js convention): the rotated -Z axis points along
 * `forward` and +Y is as close as possible to `up`.
 */
export function qlookRotation(out: Quatd, forward: Vec3d, up: Vec3d): Quatd {
  const z = v3normalize(vec3(), { x: -forward.x, y: -forward.y, z: -forward.z });
  let x = v3cross(vec3(), up, z);
  if (v3len(x) < 1e-9) {
    // up parallel to forward: pick any perpendicular.
    x = v3cross(vec3(), Math.abs(z.y) < 0.9 ? vec3(0, 1, 0) : vec3(1, 0, 0), z);
  }
  v3normalize(x, x);
  const y = v3cross(vec3(), z, x);
  return qnormalize(out, qfromMatrix(out, [x.x, y.x, z.x, x.y, y.y, z.y, x.z, y.z, z.z]));
}

export function qslerp(out: Quatd, a: Quatd, b: Quatd, t: number): Quatd {
  let { x: bx, y: by, z: bz, w: bw } = b;
  let cos = a.x * bx + a.y * by + a.z * bz + a.w * bw;
  if (cos < 0) {
    cos = -cos;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let k0 = 1 - t;
  let k1 = t;
  if (cos < 0.9999) {
    const th = Math.acos(cos);
    const s = Math.sin(th);
    k0 = Math.sin((1 - t) * th) / s;
    k1 = Math.sin(t * th) / s;
  }
  return qnormalize(
    out,
    qset(out, a.x * k0 + bx * k1, a.y * k0 + by * k1, a.z * k0 + bz * k1, a.w * k0 + bw * k1),
  );
}

/** Angle between two unit quaternions, radians. */
export function qangle(a: Quatd, b: Quatd): number {
  const d = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
  return 2 * Math.acos(Math.min(1, d));
}

/**
 * Splits a float64 into a float32 high part and a float32 low remainder (rte.glsl).
 * high + low reproduces the value to about 2^-48 relative.
 */
export function splitDouble(v: number): [number, number] {
  const high = Math.fround(v);
  return [high, Math.fround(v - high)];
}
