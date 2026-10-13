/**
 * Per-frame atmosphere geometry (three-free, float64): the world -> atmosphere-space transform,
 * the camera position and height, the Sun direction and illuminance, and the choice of the one
 * atmosphere drawn this frame.
 */
import type { Quatd, Vec3d } from '../../core/contracts';

export interface AtmosphereFrame {
  /** World axes -> atmosphere space (body-fixed, z scaled by a/c), row-major 3x3. */
  w2a: number[];
  /** Camera position in atmosphere space, km. */
  cam: [number, number, number];
  /** |cam|, km. */
  camR: number;
  /** Unit Sun direction from the body centre, atmosphere space. */
  sun: [number, number, number];
  /** Body-Sun distance, m. */
  sunDist: number;
}

/** Row-major rotation matrix of a unit quaternion. */
export function quatToMat(q: Quatd): number[] {
  const { x, y, z, w } = q;
  return [
    1 - 2 * (y * y + z * z),
    2 * (x * y - z * w),
    2 * (x * z + y * w),
    2 * (x * y + z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z - x * w),
    2 * (x * z - y * w),
    2 * (y * z + x * w),
    1 - 2 * (x * x + y * y),
  ];
}

const apply = (m: number[], v: [number, number, number]): [number, number, number] => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];

/**
 * @param rel camera -> body centre, world axes, m
 * @param fixedToWorld rotation of the body-fixed frame into world axes
 * @param flattening (a - c) / a
 * @param sunRel camera -> Sun centre, world axes, m
 */
export function atmosphereFrame(rel: Vec3d, fixedToWorld: Quatd, flattening: number, sunRel: Vec3d): AtmosphereFrame {
  const R = quatToMat(fixedToWorld);
  const s = 1 / (1 - flattening);
  // w2a = diag(1, 1, a/c) * R^T
  const w2a = [R[0], R[3], R[6], R[1], R[4], R[7], s * R[2], s * R[5], s * R[8]];
  const cam = apply(w2a, [-rel.x / 1000, -rel.y / 1000, -rel.z / 1000]);
  const toSun: [number, number, number] = [sunRel.x - rel.x, sunRel.y - rel.y, sunRel.z - rel.z];
  const sunDist = Math.hypot(...toSun);
  const sa = apply(w2a, toSun);
  const sl = Math.hypot(...sa);
  return {
    w2a,
    cam,
    camR: Math.hypot(...cam),
    sun: [sa[0] / sl, sa[1] / sl, sa[2] / sl],
    sunDist,
  };
}

export interface AtmosphereCandidate {
  id: string;
  /** Camera distance to the body centre, m. */
  dist: number;
  /** Top-of-atmosphere radius, m. */
  topM: number;
}

/** Minimum apparent diameter of the atmosphere shell, px, before the pass runs. */
export const MIN_ATMOSPHERE_PX = 4;

/**
 * One atmosphere per frame: the one the camera is inside (deepest), otherwise the largest on screen
 * above MIN_ATMOSPHERE_PX.
 */
export function selectAtmosphere(cands: readonly AtmosphereCandidate[], pixelAngle: number): string | null {
  let inside: AtmosphereCandidate | null = null;
  for (const c of cands) {
    if (c.dist < c.topM && (!inside || c.dist / c.topM < inside.dist / inside.topM)) inside = c;
  }
  if (inside) return inside.id;
  let best: string | null = null;
  let bestPx = MIN_ATMOSPHERE_PX;
  for (const c of cands) {
    const px = (2 * Math.asin(Math.min(1, c.topM / c.dist))) / pixelAngle;
    if (px > bestPx) {
      bestPx = px;
      best = c.id;
    }
  }
  return best;
}

/** Raymarch step counts from the preset's atmosphereSteps knob (8/16/32/48/64). */
export function stepCounts(knob: number): { sky: number; aerial: number; march: number } {
  const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, Math.round(x)));
  return { sky: clamp(2 * knob, 24, 64), aerial: clamp(knob, 8, 32), march: clamp(knob + 16, 24, 48) };
}
