/**
 * Shared GLSL chunks (importable by modules: cross-module imports from src/render/chunks/** are
 * allowed). Include DEPTH_GLSL in both stages of every ShaderMaterial (conventions test).
 */
import { Vector3, Vector4, type IUniform } from 'three';
import { CAMERA_FAR, type Vec3d } from '../../core/contracts';
import { splitDouble } from '../../core/math64';
import blackbody from './blackbody.glsl?raw';
import depth from './depth.glsl?raw';
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
