/** Belt renderable: one THREE.Points cloud, GPU Kepler propagation (glsl/belt.vert.glsl). */
import {
  AdditiveBlending,
  BufferGeometry,
  Float32BufferAttribute,
  Points,
  ShaderMaterial,
  Vector2,
  Vector3,
  type IUniform,
} from 'three';
import type { Renderable, ViewState } from '../../core/contracts';
import { v3len, v3set, vec3 } from '../../core/math64';
import { AU } from '../../core/units';
import { DEPTH_GLSL, RTE_GLSL, createRteUniforms, setRteCamera } from '../../render/chunks';
import { OBLIQUITY_J2000 } from '../solar-system/public';
import fragGlsl from './glsl/belt.frag.glsl?raw';
import vertGlsl from './glsl/belt.vert.glsl?raw';
import { generateBelts, rebase, type BeltElements } from './generate';
import data from './populations.json';

export const BELT_ID = 'smallbodies.belts';
/** Rebase the float32 epoch once the sim time drifts this many days from it. */
export const REBASE_DAYS = 200;

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface BeltDeps {
  exposure: IUniform<number>;
  count: number;
  seed: number;
  /** Jupiter's true minus mean heliocentric ecliptic longitude at jd, rad (Trojans follow it). */
  trojanShift(jd: number): number;
}

export interface BeltRenderable extends Renderable {
  setCount(n: number): void;
  setBoost(mag: number): void;
  readonly elements: BeltElements;
}

export function createBelt(deps: BeltDeps): BeltRenderable {
  const d = data.display;
  const rte = createRteUniforms();
  const tint = new Vector3(1.08, 0.98, 0.86);
  tint.multiplyScalar(1 / (0.2126 * tint.x + 0.7152 * tint.y + 0.0722 * tint.z));
  const uniforms = {
    ...rte,
    uDt: { value: 0 },
    uLibFreq: { value: 0 },
    uTrojanShift: { value: 0 },
    uExposure: deps.exposure,
    uPixelAngle: { value: 1e-3 },
    uPointSize: { value: d.pointSizePx },
    uBoostMag: { value: 0 },
    uFade: { value: 1 },
    uNearFade: { value: new Vector2(d.nearFadeM[0], d.nearFadeM[1]) },
    uTint: { value: tint },
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
  points.name = BELT_ID;
  points.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), OBLIQUITY_J2000); // ecliptic -> ICRF
  let boostMag = d.boostMag;
  let belts!: BeltElements;
  let attrs: Float32BufferAttribute[] = [];

  const build = (count: number) => {
    geometry.dispose();
    belts = generateBelts(count, deps.seed);
    geometry = new BufferGeometry();
    attrs = [
      new Float32BufferAttribute(belts.el0, 4),
      new Float32BufferAttribute(belts.el1, 4),
      new Float32BufferAttribute(belts.lib, 2),
    ];
    geometry.setAttribute('aEl0', attrs[0]);
    geometry.setAttribute('aEl1', attrs[1]);
    geometry.setAttribute('aLib', attrs[2]);
    geometry.setDrawRange(0, count);
    points.geometry = geometry;
    uniforms.uLibFreq.value = belts.libFreq;
    // Points stand for many bodies: keep the integrated brightness independent of the preset.
    uniforms.uBoostMag.value = boostMag + 2.5 * Math.log10(d.referenceCount / count);
  };
  build(deps.count);

  const toSun = vec3();
  const ORIGIN = vec3();
  const camEcl = vec3();
  const c = Math.cos(OBLIQUITY_J2000);
  const s = Math.sin(OBLIQUITY_J2000);

  return {
    id: BELT_ID,
    layer: 'transparent',
    object: points,
    get elements() {
      return belts;
    },
    setCount(n: number) {
      if (n !== belts.count) build(n);
    },
    setBoost(mag: number) {
      boostMag = mag;
      uniforms.uBoostMag.value = boostMag + 2.5 * Math.log10(d.referenceCount / belts.count);
    },
    update(view: ViewState) {
      view.toCamera('sun', ORIGIN, toSun);
      const dAu = v3len(toSun) / AU;
      const fade = 1 - smoothstep(d.farFadeAu[0], d.farFadeAu[1], dAu);
      points.visible = fade > 0;
      if (!points.visible) return;
      uniforms.uFade.value = fade;
      // Camera relative to the Sun, ecliptic axes (inverse of Rx(obliquity)).
      const x = -toSun.x;
      const y = -toSun.y;
      const z = -toSun.z;
      setRteCamera(rte, v3set(camEcl, x, c * y + s * z, -s * y + c * z));
      if (Math.abs(view.jd - belts.baseJd) > REBASE_DAYS) {
        rebase(belts, view.jd);
        attrs[1].needsUpdate = true;
        attrs[2].needsUpdate = true;
      }
      uniforms.uDt.value = view.jd - belts.baseJd;
      uniforms.uTrojanShift.value = deps.trojanShift(view.jd);
      uniforms.uPixelAngle.value = view.pixelAngle;
    },
    memoryBytes() {
      return belts.count * 10 * 4;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
