/**
 * Per-frame float64 view of every Solar System body, computed once in render.onBeforeFrame and
 * read by the surface provider, shadings, points, orbits, glow and rings.
 */
import type { Body, ViewState, Vec3d } from '../../../core/contracts';
import { v3len, v3sub, vec3 } from '../../../core/math64';
import { solarIlluminance } from '../../../core/photometry';

export interface BodyView {
  body: Body;
  /** Camera → body centre, world axes, m. */
  rel: Vec3d;
  dist: number;
  /** Apparent diameter in device pixels. */
  pxDiam: number;
  /** Body → Sun, world axes, m. */
  toSun: Vec3d;
  rSun: number;
  /** Solar illuminance at the body, lux. */
  illuminance: number;
}

/** Points below this apparent diameter (px), spheres above SPHERE_FULL_PX, crossfade between. */
export const POINT_MAX_PX = 1.5;
export const SPHERE_FULL_PX = 3;

export function apparentDiameterPx(radius: number, dist: number, pixelAngle: number): number {
  if (dist <= radius) return Infinity;
  return (2 * Math.asin(radius / dist)) / pixelAngle;
}

/** Sphere weight in the point/sphere crossfade (0 = point only, 1 = sphere only). */
export function sphereWeight(pxDiam: number): number {
  const t = Math.min(1, Math.max(0, (pxDiam - POINT_MAX_PX) / (SPHERE_FULL_PX - POINT_MAX_PX)));
  return t * t * (3 - 2 * t);
}

export class SceneState {
  readonly views = new Map<string, BodyView>();
  readonly sunRel = vec3();
  pixelAngle = 1e-3;
  frameIndex = -1;

  constructor(bodies: readonly Body[]) {
    for (const body of bodies) {
      this.views.set(body.id, {
        body,
        rel: vec3(),
        dist: 0,
        pxDiam: 0,
        toSun: vec3(),
        rSun: 0,
        illuminance: 0,
      });
    }
  }

  update(view: ViewState): void {
    this.frameIndex = view.frameIndex;
    this.pixelAngle = view.pixelAngle;
    view.sunToCamera(this.sunRel);
    const zero = vec3();
    for (const v of this.views.values()) {
      view.toCamera(v.body.frame, zero, v.rel);
      v.dist = v3len(v.rel);
      v.pxDiam = apparentDiameterPx(v.body.radius, v.dist, view.pixelAngle);
      v3sub(v.toSun, this.sunRel, v.rel);
      v.rSun = v3len(v.toSun);
      v.illuminance = v.body.id === 'sun' ? 0 : solarIlluminance(Math.max(v.rSun, 1e6));
    }
  }

  get(id: string): BodyView | undefined {
    return this.views.get(id);
  }
}
