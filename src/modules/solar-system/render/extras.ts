/** Sun v1 glow billboard and Saturn's rings v1. */
import {
  AdditiveBlending,
  DoubleSide,
  Mesh,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  ShaderMaterial,
  Texture,
  Vector3,
  type IUniform,
} from 'three';
import type { AssetLoader, Body, Renderable, ViewState } from '../../../core/contracts';
import { qrotate, quat, vec3 } from '../../../core/math64';
import { SUN_DISK_LUMINANCE, SUN_RGB } from '../../../core/photometry';
import { R_SUN } from '../../../core/units';
import {
  DEPTH_GLSL,
  SHADOWS_GLSL,
  createShadowUniforms,
  setShadowUniforms,
} from '../../../render/chunks/index';
import glowGlsl from '../glsl/glow.glsl?raw';
import ringsGlsl from '../glsl/rings.glsl?raw';
import { MODULE_ID } from './shading';
import { SPHERE_FULL_PX, sphereWeight, type SceneState } from './scene-state';

/** Glow quad half-size, Sun radii. */
export const GLOW_SCALE = 12;
/** Glow radiance just outside the limb as a fraction of the disk luminance. */
export const GLOW_FRACTION = 2e-4;

export function createSunGlow(scene: SceneState, exposure: IUniform<number>): Renderable {
  const [vs, fs] = glowGlsl.split(/^\/\/#fragment$/m);
  const geometry = new PlaneGeometry(2, 2);
  const L = SUN_DISK_LUMINANCE * GLOW_FRACTION;
  const uniforms = {
    uExposure: exposure,
    uFade: { value: 0 },
    uGlowScale: { value: GLOW_SCALE },
    uGlowRadiance: { value: new Vector3(L * SUN_RGB[0], L * SUN_RGB[1], L * SUN_RGB[2]) },
  };
  const material = new ShaderMaterial({
    vertexShader: `${DEPTH_GLSL}\n${vs}`,
    fragmentShader: `${DEPTH_GLSL}\n${fs}`,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.name = 'solar-system.sun-glow';
  return {
    id: 'solar-system.sun-glow',
    layer: 'transparent',
    object: mesh,
    update(view: ViewState) {
      const v = scene.get('sun');
      const fade = v ? sphereWeight(v.pxDiam) : 0;
      uniforms.uFade.value = fade;
      mesh.visible = !!v && fade > 0 && v.dist > 1.5 * R_SUN;
      if (!v || !mesh.visible) return;
      mesh.position.set(v.rel.x, v.rel.y, v.rel.z);
      const q = view.worldQuat;
      mesh.quaternion.set(q.x, q.y, q.z, q.w);
      mesh.scale.setScalar(GLOW_SCALE * R_SUN);
    },
    memoryBytes() {
      return 4 * 5 * 4 + 6 * 2;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

export function createRings(
  body: Body,
  rings: { inner: number; outer: number },
  ringPath: string | undefined,
  scene: SceneState,
  exposure: IUniform<number>,
  assets: AssetLoader,
): Renderable {
  const [vs, fs] = ringsGlsl.split(/^\/\/#fragment$/m);
  const inner = rings.inner * 1e3;
  const outer = rings.outer * 1e3;
  const geometry = new RingGeometry(inner, outer, 256, 1);
  const shadow = createShadowUniforms();
  const uniforms: Record<string, IUniform> = {
    ...shadow,
    uRingMap: { value: new Texture() },
    uHasMap: { value: 0 },
    uInner: { value: inner },
    uOuter: { value: outer },
    uNormal: { value: new Vector3(0, 0, 1) },
    uSunPos: { value: new Vector3() },
    uSunIlluminance: { value: new Vector3() },
    uExposure: exposure,
    uFade: { value: 1 },
  };
  const material = new ShaderMaterial({
    vertexShader: `${DEPTH_GLSL}\n${vs}`,
    fragmentShader: `${DEPTH_GLSL}\n${SHADOWS_GLSL}\n${fs}`,
    uniforms,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.name = `solar-system.rings.${body.id}`;
  let state: 'idle' | 'loading' | 'done' = ringPath ? 'idle' : 'done';
  const q = quat();
  const n = vec3();
  return {
    id: `solar-system.rings.${body.id}`,
    layer: 'transparent',
    object: mesh,
    update(view: ViewState) {
      const v = scene.get(body.id);
      const ringPx = v ? (v.pxDiam * outer) / body.radius : 0;
      mesh.visible = !!v && ringPx > SPHERE_FULL_PX;
      if (!v || !mesh.visible) return;
      if (state === 'idle' && ringPath) {
        state = 'loading';
        void assets
          .track(assets.texture(ringPath, { colorSpace: 'srgb', mipmaps: true, owner: MODULE_ID }), ringPath)
          .then(
            (t) => {
              uniforms.uRingMap.value = t;
              uniforms.uHasMap.value = 1;
              state = 'done';
            },
            () => (state = 'done'),
          );
      }
      mesh.position.set(v.rel.x, v.rel.y, v.rel.z);
      view.frameQuat(body.fixedFrame ?? body.frame, q);
      mesh.quaternion.copy(new Quaternion(q.x, q.y, q.z, q.w));
      qrotate(n, q, vec3(0, 0, 1));
      (uniforms.uNormal.value as Vector3).set(n.x, n.y, n.z);
      (uniforms.uSunPos.value as Vector3).set(scene.sunRel.x, scene.sunRel.y, scene.sunRel.z);
      const E = v.illuminance;
      (uniforms.uSunIlluminance.value as Vector3).set(E * SUN_RGB[0], E * SUN_RGB[1], E * SUN_RGB[2]);
      uniforms.uFade.value = sphereWeight(ringPx);
      setShadowUniforms(shadow, scene.sunRel, R_SUN, [{ center: v.rel, radius: body.radius }]);
    },
    memoryBytes() {
      const p = geometry.getAttribute('position');
      return p.count * 8 * 4 + (geometry.index?.count ?? 0) * 2;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      (uniforms.uRingMap.value as Texture).dispose();
    },
  };
}
