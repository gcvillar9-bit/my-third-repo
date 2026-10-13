/**
 * Photometric point LOD (DESIGN 3.2 Photometry): bodies under ~2 px are drawn as points whose
 * illuminance at the camera is E_sun(r)·p·πR²·LambertPhase(α)/(π·Δ²) (the Sun: E_sun(Δ)),
 * crossfading with the sphere between 1.5 and 3 px so the total flux stays continuous.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Points,
  ShaderMaterial,
  type IUniform,
} from 'three';
import type { Renderable, ViewState } from '../../../core/contracts';
import { v3dot } from '../../../core/math64';
import { SUN_RGB, planetPointIlluminance, solarIlluminance } from '../../../core/photometry';
import { DEPTH_GLSL } from '../../../render/chunks/index';
import pointsGlsl from '../glsl/points.glsl?raw';
import { sphereWeight, type BodyView, type SceneState } from './scene-state';

/** Illuminance (lux) a body delivers at the camera when drawn as a point. */
export function pointIlluminance(v: BodyView): number {
  const b = v.body;
  if (v.dist <= b.radius) return 0;
  if (b.id === 'sun') return solarIlluminance(v.dist);
  const cosA = -v3dot(v.toSun, v.rel) / Math.max(v.rSun * v.dist, 1e-30);
  return planetPointIlluminance({
    rSun: v.rSun,
    distance: v.dist,
    radius: b.radius,
    albedo: b.albedo ?? 0.3,
    phaseAngle: Math.acos(Math.min(1, Math.max(-1, cosA))),
  });
}

export function createPoints(
  scene: SceneState,
  exposure: IUniform<number>,
  tints: Map<string, [number, number, number]>,
): Renderable {
  const views = [...scene.views.values()];
  const n = views.length;
  const pos = new Float32Array(3 * n);
  const flux = new Float32Array(3 * n);
  const geometry = new BufferGeometry();
  const posAttr = new BufferAttribute(pos, 3).setUsage(DynamicDrawUsage);
  const fluxAttr = new BufferAttribute(flux, 3).setUsage(DynamicDrawUsage);
  geometry.setAttribute('position', posAttr);
  geometry.setAttribute('aFlux', fluxAttr);
  const [vs, fs] = pointsGlsl.split(/^\/\/#fragment$/m);
  const uniforms = {
    uPointSize: { value: 5 },
    uSigma: { value: 0.75 },
    uPixelAngle: { value: 1e-3 },
    uExposure: exposure,
  };
  const material = new ShaderMaterial({
    vertexShader: `${DEPTH_GLSL}\n${vs}`,
    fragmentShader: `${DEPTH_GLSL}\n${fs}`,
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: AdditiveBlending,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.name = 'solar-system.points';
  return {
    id: 'solar-system.points',
    layer: 'transparent',
    object: points,
    update(view: ViewState) {
      uniforms.uPixelAngle.value = view.pixelAngle;
      for (let i = 0; i < n; i++) {
        const v = views[i];
        const w = 1 - sphereWeight(v.pxDiam);
        const E = w > 0 ? pointIlluminance(v) * w : 0;
        // Sit on the near surface so the body's own sphere never hides its point.
        const k = v.dist > 0 ? Math.max(0, 1 - v.body.radius / v.dist) : 0;
        pos[3 * i] = v.rel.x * k;
        pos[3 * i + 1] = v.rel.y * k;
        pos[3 * i + 2] = v.rel.z * k;
        const t = tints.get(v.body.id) ?? [1, 1, 1];
        flux[3 * i] = E * SUN_RGB[0] * t[0];
        flux[3 * i + 1] = E * SUN_RGB[1] * t[1];
        flux[3 * i + 2] = E * SUN_RGB[2] * t[2];
      }
      posAttr.needsUpdate = true;
      fluxAttr.needsUpdate = true;
    },
    memoryBytes() {
      return pos.byteLength + flux.byteLength;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
