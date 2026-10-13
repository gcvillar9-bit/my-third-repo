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
}

export function createStarPoints(data: StarData, shared: SharedUniforms, count: number): StarPoints {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(data.position, 3));
  geometry.setAttribute('absMag', new Float16BufferAttribute(data.absMagHalf, 1));
  geometry.setAttribute('velocity', new Float16BufferAttribute(data.velocityHalf, 3));
  geometry.setAttribute('bvCode', new BufferAttribute(data.bv, 1));
  geometry.setDrawRange(0, Math.min(count, data.count));
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
    uBvMin: { value: data.bvMin },
    uBvStep: { value: data.bvStep },
  };
  // cosmos:no-depth (background layer: stars are drawn at infinity without depth, DESIGN 3.2)
  const material = new ShaderMaterial({
    vertexShader: `${RTE_GLSL}\n${BLACKBODY_GLSL}\n${vertexBody}`,
    fragmentShader,
    uniforms,
    blending: AdditiveBlending,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
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
    },
    memoryBytes: () => bytes,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
  return self;
}
