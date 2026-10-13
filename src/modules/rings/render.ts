/** Ring renderable: one quad in the equatorial plane, premultiplied-alpha blended after the globes. */
import {
  CustomBlending,
  DoubleSide,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PlaneGeometry,
  ShaderMaterial,
  Vector2,
  Vector3,
  type IUniform,
} from 'three';
import type { Body, Renderable, ViewState } from '../../core/contracts';
import { quat } from '../../core/math64';
import { SUN_RGB } from '../../core/photometry';
import { R_SUN } from '../../core/units';
import {
  DEPTH_GLSL,
  PHASE_GLSL,
  SHADOWS_GLSL,
  createShadowUniforms,
  setShadowUniforms,
} from '../../render/chunks/index';
import ringsGlsl from './glsl/rings.glsl?raw';
import { G_BACK, G_DUST } from './model';
import { PROFILE_BYTES, type RingState } from './state';

/** Rings are drawn once their outer diameter exceeds this many pixels (full weight at twice). */
export const RING_MIN_PX = 3;

export function ringWeight(px: number): number {
  const t = Math.min(1, Math.max(0, (px - RING_MIN_PX) / RING_MIN_PX));
  return t * t * (3 - 2 * t);
}

export function createRingRenderable(body: Body, state: RingState, exposure: IUniform<number>): Renderable {
  const [vs, fs] = ringsGlsl.split(/^\/\/#fragment$/m);
  const spec = state.spec;
  const outerM = spec.outer * 1e3;
  const geometry = new PlaneGeometry(2, 2);
  const shadow = createShadowUniforms();
  const uniforms: Record<string, IUniform> = {
    ...shadow,
    uOuterM: { value: outerM },
    uProfile: state.uniforms.uRingShadowProfile,
    uRange: { value: new Vector2(spec.inner * 1e3, outerM) },
    uNormal: state.uniforms.uRingShadowNormal,
    uSunPos: { value: new Vector3() },
    uSunIlluminance: { value: new Vector3() },
    uTint: { value: new Vector3(...spec.tint) },
    uG: { value: new Vector2(G_BACK, G_DUST) },
    uExposure: exposure,
    uFade: { value: 1 },
  };
  const material = new ShaderMaterial({
    vertexShader: `${DEPTH_GLSL}\n${vs}`,
    fragmentShader: `${DEPTH_GLSL}\n${SHADOWS_GLSL}\n${PHASE_GLSL}\n${fs}`,
    uniforms,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneMinusSrcAlphaFactor,
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.name = `rings.${body.id}`;
  const q = quat();
  const occluder = [{ center: state.rel, radius: body.radius }];
  return {
    id: `rings.${body.id}`,
    layer: 'transparent',
    object: mesh,
    update(view: ViewState) {
      const r = state.rel;
      const dist = Math.hypot(r.x, r.y, r.z);
      const px = dist > outerM ? (2 * Math.asin(outerM / dist)) / view.pixelAngle : Infinity;
      const w = ringWeight(px);
      mesh.visible = w > 0;
      if (!mesh.visible) return;
      uniforms.uFade.value = w;
      mesh.position.set(r.x, r.y, r.z);
      view.frameQuat(body.fixedFrame ?? body.frame, q);
      mesh.quaternion.set(q.x, q.y, q.z, q.w);
      mesh.scale.setScalar(outerM);
      const s = state.sunRel;
      (uniforms.uSunPos.value as Vector3).set(s.x, s.y, s.z);
      const E = state.illuminance;
      (uniforms.uSunIlluminance.value as Vector3).set(E * SUN_RGB[0], E * SUN_RGB[1], E * SUN_RGB[2]);
      setShadowUniforms(shadow, s, R_SUN, occluder);
    },
    memoryBytes() {
      return 4 * 5 * 4 + 6 * 2 + PROFILE_BYTES;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
