/**
 * Shared GLSL chunks (importable by modules: cross-module imports from src/render/chunks/** are
 * allowed). Include DEPTH_GLSL in both stages of every ShaderMaterial (conventions test).
 */
import { Vector3, Vector4, type IUniform } from 'three';
import { CAMERA_FAR, type Vec3d } from '../../core/contracts';
import { splitDouble } from '../../core/math64';
import blackbody from './blackbody.glsl?raw';
import depth from './depth.glsl?raw';
import facet from './facet.glsl?raw';
import noise from './noise.glsl?raw';
import phase from './phase.glsl?raw';
import rte from './rte.glsl?raw';
import shadows from './shadows.glsl?raw';

export const DEPTH_GLSL: string = depth;
export const RTE_GLSL: string = rte;
export const NOISE_GLSL: string = noise;
export const BLACKBODY_GLSL: string = blackbody;
export const SHADOWS_GLSL: string = shadows;
export const PHASE_GLSL: string = phase;
/** Exact curved surface under flat facets (include after DEPTH_GLSL in the fragment stage). */
export const FACET_GLSL: string = facet;

/** log2(CAMERA_FAR + 1): the constant baked into depth.glsl. */
export const LOG2_FAR_PLUS_1 = Math.log2(CAMERA_FAR + 1);
/** CPU twin of linearFromLogDepth (depth.glsl). */
export const linearFromLogDepth = (d: number): number => 2 ** (d * LOG2_FAR_PLUS_1) - 1;
export const logDepthFromLinear = (w: number): number => Math.log2(1 + w) / LOG2_FAR_PLUS_1;

export interface RteUniforms {
  uCamHigh: IUniform<Vector3>;
  uCamLow: IUniform<Vector3>;
  [k: string]: IUniform;
}

export function createRteUniforms(): RteUniforms {
  return { uCamHigh: { value: new Vector3() }, uCamLow: { value: new Vector3() } };
}

/** Writes the camera position (relative to the cloud origin, cloud axes, float64) as high/low. */
export function setRteCamera(u: RteUniforms, cam: Vec3d): void {
  const [hx, lx] = splitDouble(cam.x);
  const [hy, ly] = splitDouble(cam.y);
  const [hz, lz] = splitDouble(cam.z);
  u.uCamHigh.value.set(hx, hy, hz);
  u.uCamLow.value.set(lx, ly, lz);
}

export const MAX_OCCLUDERS = 4;

export interface ShadowUniforms {
  uSunSphere: IUniform<Vector4>;
  uOccluders: IUniform<Vector4[]>;
  uOccluderCount: IUniform<number>;
  [k: string]: IUniform;
}

export function createShadowUniforms(): ShadowUniforms {
  return {
    uSunSphere: { value: new Vector4(0, 0, 0, 1) },
    uOccluders: { value: Array.from({ length: MAX_OCCLUDERS }, () => new Vector4()) },
    uOccluderCount: { value: 0 },
  };
}

/**
 * Fills shadow uniforms from camera-relative centres (world axes, m). Extra occluders beyond 4
 * are dropped (callers should pass the most relevant first).
 */
export function setShadowUniforms(
  u: ShadowUniforms,
  sun: Vec3d,
  sunRadius: number,
  occluders: readonly { center: Vec3d; radius: number }[],
): void {
  u.uSunSphere.value.set(sun.x, sun.y, sun.z, sunRadius);
  const n = Math.min(MAX_OCCLUDERS, occluders.length);
  for (let i = 0; i < n; i++) {
    const o = occluders[i];
    u.uOccluders.value[i].set(o.center.x, o.center.y, o.center.z, o.radius);
  }
  u.uOccluderCount.value = n;
}

/** CPU twin of shadows.glsl circleOverlap (tests, CPU eclipse checks). */
export function circleOverlap(r1: number, r2: number, d: number): number {
  if (d >= r1 + r2) return 0;
  const rmin = Math.min(r1, r2);
  if (d <= Math.abs(r1 - r2)) return Math.PI * rmin * rmin;
  const a1 = Math.min(1, Math.max(-1, (d * d + r1 * r1 - r2 * r2) / (2 * d * r1)));
  const a2 = Math.min(1, Math.max(-1, (d * d + r2 * r2 - r1 * r1) / (2 * d * r2)));
  const k = (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2);
  return r1 * r1 * Math.acos(a1) + r2 * r2 * Math.acos(a2) - 0.5 * Math.sqrt(Math.max(k, 0));
}

/**
 * CPU twin of facet.glsl cosmosSphereFactor: the factor k that moves a facet point on the unit
 * sphere's chord (`unit`, |unit| < 1) along the view ray `d` (camera to point, same space) onto
 * the sphere: |unit + (k - 1) d| = 1.
 */
export function sphereFactor(unit: Vec3d, d: Vec3d): number {
  const a = d.x * d.x + d.y * d.y + d.z * d.z;
  const b = unit.x * d.x + unit.y * d.y + unit.z * d.z;
  const c = unit.x * unit.x + unit.y * unit.y + unit.z * unit.z - 1;
  const disc = b * b - a * c;
  if (c >= 0 || disc <= 0 || a <= 0) return 1;
  const s = Math.sqrt(disc);
  const cx = unit.x - d.x;
  const cy = unit.y - d.y;
  const cz = unit.z - d.z;
  const cam2 = cx * cx + cy * cy + cz * cz;
  const outside = cam2 > 1.00001 || (cam2 > 0.99999 && b < 0);
  const t = outside ? c / (s - b) : -c / (s + b);
  return Math.min(4, Math.max(0.02, 1 + t));
}

/**
 * CPU twin of facet.glsl cosmosCurveFactor: P is the camera-relative fragment, u the local
 * vertical (unit), rho the true surface radius there and delta how far P lies below it.
 */
export function curveFactor(P: Vec3d, u: Vec3d, rho: number, delta: number): number {
  const a = P.x * P.x + P.y * P.y + P.z * P.z;
  const b = (rho - delta) * (P.x * u.x + P.y * u.y + P.z * u.z);
  const c = -delta * (2 * rho - delta);
  const disc = b * b - a * c;
  if (delta <= 0 || disc <= 0 || a <= 0 || b >= 0) return 1;
  const s = Math.sqrt(disc);
  return Math.min(1, Math.max(0.02, 1 + c / (s - b)));
}
