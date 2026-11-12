/**
 * Cloud renderable: one THREE.Points cloud, GPU Kepler propagation with the Galactic-tide twist
 * (glsl/cloud.vert.glsl). Generation is lazy and time-sliced: nothing is generated until the camera is
 * 100 AU from the Sun (the cloud fades in from 200 AU), then batches of 2,000 points within a 4 ms budget
 * per frame (at most 20,000), growing the draw range; only the new range is uploaded. Under ?test=1
 * everything is generated in one update.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Points,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  type IUniform,
} from 'three';
import type { QualityPreset, Renderable, ViewState } from '../../../core/contracts';
import { DEPTH_GLSL, RTE_GLSL, createRteUniforms, setRteCamera } from '../../../render/chunks';
import { OBLIQUITY_J2000 } from '../../solar-system/public';
import { FAR_FADE_AU, GALACTIC_POLE_ECL, type OortShared } from '../shared';
import {
  DAYS_PER_KYR,
  GPU_FLOATS_PER_POINT,
  createCloud,
  generateMore,
  rebase,
  type Cloud,
} from './generate';
import fragGlsl from './glsl/cloud.frag.glsl?raw';
import vertGlsl from './glsl/cloud.vert.glsl?raw';
import model from './model.json';

export const CLOUD_ID = 'oort.cloud';
/**
 * Generation starts once the camera is this far from the Sun, AU (the fade-in starts at 200), and not from
 * beyond twice the far fade (views of other stars and galaxies never pay for it).
 */
export const GENERATE_FROM_AU = 100;
export const GENERATE_TO_AU = 2 * FAR_FADE_AU[1];
/** Time budget for generation per frame, ms, and the largest batch per frame. */
export const GENERATE_BUDGET_MS = 4;
export const GENERATE_MAX_PER_FRAME = 20_000;
/**
 * Rebase the float32 epoch once the sim time drifts this many kyr from it. At a = 250 AU (n = 1.6 rad/kyr)
 * the shader's mean anomaly then stays below 1,600 rad, where float32 rounding of n * dt, the sum and the
 * wrap stays below 1e-3 rad (unit-tested); the tide's angles are thousands of times smaller.
 */
export const REBASE_KYR = 1000;

const D = model.display;

export const countFor = (p: QualityPreset): number =>
  (model.counts as Record<string, number>)[p] ?? model.counts.medium;

/** Tint normalised to luminance 1 (linear RGB). */
export function unitTint(rgb: readonly number[]): Vector3 {
  const v = new Vector3(rgb[0], rgb[1], rgb[2]);
  return v.multiplyScalar(1 / (0.2126 * v.x + 0.7152 * v.y + 0.0722 * v.z));
}

export interface CloudDeps {
  exposure: IUniform<number>;
  count: number;
  seed: number;
  shared: OortShared;
}

export interface CloudRenderable extends Renderable {
  setCount(n: number): void;
  /** The generated cloud (null until generation starts). */
  readonly cloud: Cloud | null;
}

export function createCloudRenderable(deps: CloudDeps): CloudRenderable {
  const { shared } = deps;
  const rte = createRteUniforms();
  const regions = model.regions;
  const lnEdge = (a: number, f: number) => Math.log(a * f);
  const uniforms = {
    ...rte,
    uDt: { value: 0 },
    uGalPole: { value: new Vector3(GALACTIC_POLE_ECL.x, GALACTIC_POLE_ECL.y, GALACTIC_POLE_ECL.z) },
    uExposure: deps.exposure,
    uPixelAngle: { value: 1e-3 },
    uPointSize: { value: D.pointSizePx },
    uMaxPointSize: { value: D.maxPointSizePx },
    uCellFrac: { value: 0 },
    uE0: { value: 0 },
    uD0: { value: D.referenceDistanceAu },
    uCapLux: { value: D.capLux },
    uFade: { value: 0 },
    uNearFade: { value: new Vector2(D.nearFadeAu[0], D.nearFadeAu[1]) },
    uTint0: { value: unitTint(regions[0].tint) },
    uTint1: { value: unitTint(regions[1].tint) },
    uTint2: { value: unitTint(regions[2].tint) },
    uTintLnA: {
      value: new Vector4(
        lnEdge(regions[0].aMaxAu, Math.SQRT1_2),
        lnEdge(regions[0].aMaxAu, Math.SQRT2),
        lnEdge(regions[1].aMaxAu, Math.SQRT1_2),
        lnEdge(regions[1].aMaxAu, Math.SQRT2),
      ),
    },
  };
  const material = new ShaderMaterial({
    vertexShader: `${DEPTH_GLSL}\n${RTE_GLSL}\n${vertGlsl}`,
    fragmentShader: `${DEPTH_GLSL}\n${fragGlsl}`,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  let geometry = new BufferGeometry();
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.visible = false;
  points.name = CLOUD_ID;
  points.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), OBLIQUITY_J2000); // ecliptic -> ICRF

  let count = deps.count;
  let cloud: Cloud | null = null;
  let attrs: { el0: BufferAttribute; quat: BufferAttribute; el1: BufferAttribute } | null = null;
  // Points generated since the GPU last received the buffers, and a pending whole-buffer upload (rebase).
  let pendingFrom = 0;
  let fullPending = false;
  points.onBeforeRender = () => {
    if (cloud) pendingFrom = cloud.generated;
    fullPending = false;
  };

  const start = (jd: number) => {
    cloud = createCloud(count, deps.seed, jd);
    geometry.dispose();
    geometry = new BufferGeometry();
    attrs = {
      el0: new BufferAttribute(cloud.el0, 4).setUsage(DynamicDrawUsage),
      quat: new BufferAttribute(cloud.quat, 4).setUsage(DynamicDrawUsage),
      el1: new BufferAttribute(cloud.el1, 2),
    };
    geometry.setAttribute('aEl0', attrs.el0);
    geometry.setAttribute('aQuat', attrs.quat);
    geometry.setAttribute('aEl1', attrs.el1);
    geometry.setDrawRange(0, 0);
    points.geometry = geometry;
    pendingFrom = 0;
    fullPending = false;
  };

  const grow = (test: boolean) => {
    if (!cloud || !attrs || cloud.generated >= cloud.count) return;
    if (test) generateMore(cloud, cloud.count);
    else {
      const t0 = performance.now();
      let made = 0;
      while (made < GENERATE_MAX_PER_FRAME && cloud.generated < cloud.count) {
        made += generateMore(cloud, 2000);
        if (performance.now() - t0 > GENERATE_BUDGET_MS) break;
      }
    }
    geometry.setDrawRange(0, cloud.generated);
    const n = cloud.generated - pendingFrom;
    for (const [attr, size] of [
      [attrs.el0, 4],
      [attrs.quat, 4],
      [attrs.el1, 2],
    ] as const) {
      if (fullPending && attr !== attrs.el1) continue;
      attr.clearUpdateRanges();
      attr.addUpdateRange(pendingFrom * size, n * size);
      attr.needsUpdate = true;
    }
  };

  return {
    id: CLOUD_ID,
    layer: 'transparent',
    object: points,
    get cloud() {
      return cloud;
    },
    setCount(n: number) {
      if (n === count) return;
      count = n;
      if (cloud) {
        cloud = null;
        attrs = null;
        geometry.dispose();
        geometry = new BufferGeometry();
        points.geometry = geometry;
        points.visible = false;
      }
    },
    update(view: ViewState) {
      if (!cloud && shared.sunDistAu > GENERATE_FROM_AU && shared.sunDistAu < GENERATE_TO_AU) start(view.jd);
      if (!cloud || !attrs) return;
      grow(view.test);
      points.visible = shared.cloudFade > 0 && shared.brightness > 0 && cloud.generated > 0;
      if (!points.visible) return;
      if (Math.abs(view.jd - cloud.baseJd) > REBASE_KYR * DAYS_PER_KYR) {
        rebase(cloud, view.jd);
        for (const attr of [attrs.el0, attrs.quat]) {
          attr.clearUpdateRanges();
          attr.needsUpdate = true;
        }
        fullPending = true;
      }
      setRteCamera(rte, shared.camEcl);
      uniforms.uDt.value = (view.jd - cloud.baseJd) / DAYS_PER_KYR;
      uniforms.uFade.value = shared.cloudFade;
      uniforms.uPixelAngle.value = view.pixelAngle;
      // Points stand for many comets: the integrated brightness does not depend on the preset.
      uniforms.uE0.value = D.referenceLux * (D.referenceCount / cloud.count) * shared.brightness;
      // Fewer points stand for bigger patches (spacing ~ count^(-1/3)).
      uniforms.uCellFrac.value = D.cellFraction * Math.cbrt(D.referenceCount / cloud.count);
    },
    memoryBytes() {
      return cloud ? cloud.count * GPU_FLOATS_PER_POINT * 4 : 0;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
