/**
 * Background point sprites for the HYG catalogue (DESIGN 3.2 large point clouds). The cloud
 * origin is the Sun (approximated by the ssb origin, < 0.01 AU off) with ICRS axes; positions
 * stay in pc on the GPU and the camera arrives as an RTE high/low pair, so per-frame apparent
 * magnitudes follow the camera anywhere (fly to α Cen and the sky changes correctly).
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Float16BufferAttribute,
  Points,
  ShaderMaterial,
  type IUniform,
} from 'three';
import {
  SSB_FRAME,
  type Quatd,
  type Renderable,
  type SharedUniforms,
  type Vec3d,
} from '../../core/contracts';
import { quat, vec3 } from '../../core/math64';
import { LUX_MAG0 } from '../../core/photometry';
import { JD_J2000, JULIAN_YEAR, DAY, PC } from '../../core/units';
import { BLACKBODY_GLSL, createRteUniforms, RTE_GLSL, setRteCamera } from '../../render/chunks/index';
import { PM_MAX_YEARS } from './catalog';
import type { StarData } from './format';
import fragmentShader from './stars.frag.glsl?raw';
import vertexBody from './stars.vert.glsl?raw';

/** Cull stars whose pre-exposed core peak is below this (≈ 1/4 of an 8-bit step after AgX). */
export const MIN_PEAK = 2e-4;
/** 1/r² halo strength relative to the one-pixel intensity. */
export const HALO_K = 0.012;
/** Pre-exposed radiance at which the halo is cut. */
export const HALO_FLOOR = 0.002;
export const MAX_RADIUS = 48;
/** Beyond this camera distance from the Sun (pc) the 100 kpc no-parallax placeholder stars are culled. */
export const FAR_CULL_PC = 1000;

/** Years since J2000 for a JD (TT), clamped to the proper-motion validity. */
export const yearsSinceJ2000 = (jd: number): number =>
  Math.max(-PM_MAX_YEARS, Math.min(PM_MAX_YEARS, ((jd - JD_J2000) * DAY) / JULIAN_YEAR));

/** Converts illuminance (lux) into pre-exposed radiance if spread over one pixel. */
export const pixelScale = (exposure: number, pixelAngle: number, gain = 1): number =>
  (LUX_MAG0 * exposure * gain) / (pixelAngle * pixelAngle);

export interface StarPoints extends Renderable {
  /** Linear brightness gain (settings). */
  gain: number;
  setCount(n: number): void;
  /** Hides up to HIDE_MAX star indices (promoted stars drawn by starsystems). */
  setHidden(indices: readonly number[]): void;
}

/**
 * Most star indices `setHidden` accepts: as many as starsystems draws sprites (MAX_SPRITES), so a session-held
 * group (the Orion Nebula's five HYG duplicates) can never be pushed out of the hidden set by nearby promotions.
 */
export const HIDE_MAX = 16;

/** Shared star-sprite material (HYG points and promoted-star sprites use the same photometry). */
function starMaterial(shared: SharedUniforms, bvMin: number, bvStep: number) {
  const rte = createRteUniforms();
  const uniforms: Record<string, IUniform> = {
    ...rte,
    uBlackbodyLut: shared.uBlackbodyLut,
    uYears: { value: 0 },
    uScale: { value: 1 },
    uMinPeak: { value: MIN_PEAK },
    uHaloK: { value: HALO_K },
    uHaloFloor: { value: HALO_FLOOR },
    uMaxRadius: { value: MAX_RADIUS },
    uBvMin: { value: bvMin },
    uBvStep: { value: bvStep },
    uHide: { value: new Int32Array(HIDE_MAX).fill(-1) },
    uFarCull: { value: 0 },
  };
  // cosmos:no-depth (background layer: stars are drawn at infinity without depth, DESIGN 3.2)
  const material = new ShaderMaterial({
    vertexShader: `#define HIDE_MAX ${HIDE_MAX}\n${RTE_GLSL}\n${BLACKBODY_GLSL}\n${vertexBody}`,
    fragmentShader,
    uniforms,
    blending: AdditiveBlending,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  return { rte, uniforms, material };
}

/**
 * A few photometric star sprites at camera-relative positions (pc, float64 on the CPU), drawn with
 * the HYG point shader. Used for promoted stars whose disk is still below a pixel or two.
 */
export interface StarSprites extends Renderable {
  gain: number;
  /** Sets sprite k: camera-relative position (pc, world axes), absolute V magnitude, B-V (null = unknown). */
  write(k: number, rel: Vec3d, absMag: number, bv: number | null): void;
  setCount(n: number): void;
}

export function createStarSprites(id: string, shared: SharedUniforms, max: number): StarSprites {
  const bvMin = -0.5;
  const bvStep = 0.014;
  const pos = new Float32Array(3 * max);
  const mag = new Float32Array(max).fill(99);
  const bvCode = new Float32Array(max).fill(255);
  const geometry = new BufferGeometry();
  const posAttr = new BufferAttribute(pos, 3);
  const magAttr = new BufferAttribute(mag, 1);
  const bvAttr = new BufferAttribute(bvCode, 1);
  geometry.setAttribute('position', posAttr);
  geometry.setAttribute('absMag', magAttr);
  geometry.setAttribute('velocity', new BufferAttribute(new Float32Array(3 * max), 3));
  geometry.setAttribute('bvCode', bvAttr);
  geometry.setDrawRange(0, 0);
  const { uniforms, material } = starMaterial(shared, bvMin, bvStep);
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  const self: StarSprites = {
    id,
    layer: 'background',
    object: points,
    gain: 1,
    write(k, rel, absMag, bv) {
      pos[3 * k] = rel.x;
      pos[3 * k + 1] = rel.y;
      pos[3 * k + 2] = rel.z;
      mag[k] = absMag;
      bvCode[k] = bv === null ? 255 : Math.max(0, Math.min(254, Math.round((bv - bvMin) / bvStep)));
      posAttr.needsUpdate = magAttr.needsUpdate = bvAttr.needsUpdate = true;
    },
    setCount(n) {
      geometry.setDrawRange(0, Math.max(0, Math.min(n, max)));
    },
    update(view) {
      // Positions are already camera-relative in world axes: identity orientation, RTE camera at 0.
      uniforms.uScale.value = pixelScale(view.exposure, view.pixelAngle, self.gain);
    },
    memoryBytes: () => 32 * max,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
  return self;
}

export function createStarPoints(data: StarData, shared: SharedUniforms, count: number): StarPoints {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(data.position, 3));
  geometry.setAttribute('absMag', new Float16BufferAttribute(data.absMagHalf, 1));
  geometry.setAttribute('velocity', new Float16BufferAttribute(data.velocityHalf, 3));
  geometry.setAttribute('bvCode', new BufferAttribute(data.bv, 1));
  geometry.setDrawRange(0, Math.min(count, data.count));
  const { rte, uniforms, material } = starMaterial(shared, data.bvMin, data.bvStep);
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  const bytes =
    data.position.byteLength + data.absMagHalf.byteLength + data.velocityHalf.byteLength + data.bv.byteLength;
  const toSun: Vec3d = vec3();
  const camPc: Vec3d = vec3();
  const q: Quatd = quat();
  const self: StarPoints = {
    id: 'stars.points',
    layer: 'background',
    object: points,
    gain: 1,
    setCount(n: number) {
      geometry.setDrawRange(0, Math.max(0, Math.min(n, data.count)));
    },
    setHidden(indices) {
      const h = uniforms.uHide.value as Int32Array;
      for (let k = 0; k < HIDE_MAX; k++) h[k] = k < indices.length ? indices[k] : -1;
    },
    update(view) {
      view.toCamera(SSB_FRAME, vec3(), toSun);
      camPc.x = -toSun.x / PC;
      camPc.y = -toSun.y / PC;
      camPc.z = -toSun.z / PC;
      setRteCamera(rte, camPc);
      view.frameQuat(SSB_FRAME, q);
      points.quaternion.set(q.x, q.y, q.z, q.w);
      uniforms.uYears.value = yearsSinceJ2000(view.jd);
      uniforms.uScale.value = pixelScale(view.exposure, view.pixelAngle, self.gain);
      uniforms.uFarCull.value = Math.hypot(camPc.x, camPc.y, camPc.z) > FAR_CULL_PC ? 1 : 0;
    },
    memoryBytes: () => bytes,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
  return self;
}
