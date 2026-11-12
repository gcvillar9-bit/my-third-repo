/**
 * Real objects on the Oort Cloud's scale (three-free): one two-body orbit, frame and Body per row of
 * objects.json, the per-frame float64 view of each, and the pure brightness and line-alpha rules.
 */
import { SSB_FRAME, type Body, type FrameId, type Vec3d, type ViewState } from '../../../core/contracts';
import { v3len, v3set, v3sub, vec3 } from '../../../core/math64';
import { planetPointIlluminance } from '../../../core/photometry';
import { AU, DAY } from '../../../core/units';
import { CometOrbit } from '../../comets/public';
import type { OortObjectRow } from './data';

/** Camera anchoring radius: about 200 body radii, clamped to [1e6, 2e8] m. */
export const influenceRadius = (radius: number): number => Math.min(2e8, Math.max(1e6, 200 * radius));

export interface OortObject {
  row: OortObjectRow;
  orbit: CometOrbit;
  body: Body;
  /** Frame the orbit is expressed in ('sun' or the barycentre). */
  center: FrameId;
}

export function makeObject(row: OortObjectRow, hasSun = true): OortObject {
  const center: FrameId = row.elements.center === 'sun' && hasSun ? 'sun' : SSB_FRAME;
  const radius = row.physical.radiusKm * 1e3;
  return {
    row,
    orbit: new CometOrbit(row.elements),
    center,
    body: {
      id: row.id,
      name: row.name,
      kind: row.kind,
      frame: row.id,
      parent: 'sun',
      radius,
      influenceRadius: influenceRadius(radius),
      albedo: row.physical.albedo,
      simulated: true,
    },
  };
}

/**
 * State of an object at `jd` relative to its orbit centre (m, m/s). Bound orbits use CometOrbit. Unbound
 * ones are solved here in the hyperbolic anomaly F (e sinh F − F = M) with Newton's method from
 * asinh(M / e): CometOrbit's universal-variable iteration stops converging hundreds of thousands of years
 * from perihelion (its positions overflow by the Gliese 710 flyby), which these bookmarks reach.
 */
export function objectState(o: OortObject, jd: number, pos: Vec3d, vel?: Vec3d): Vec3d {
  const { orbit } = o;
  if (orbit.e < 1) return orbit.stateAt(jd, pos, vel);
  const { e, q, mu, P, Q } = orbit;
  const A = q / (e - 1);
  const n = Math.sqrt(mu / (A * A * A));
  const M = n * (jd - orbit.tp) * DAY;
  let F = Math.asinh(M / e);
  for (let k = 0; k < 60; k++) {
    const dF = (e * Math.sinh(F) - F - M) / (e * Math.cosh(F) - 1);
    F -= dF;
    if (Math.abs(dF) <= 1e-14 * (1 + Math.abs(F))) break;
  }
  const B = A * Math.sqrt(e * e - 1);
  const ch = Math.cosh(F);
  const sh = Math.sinh(F);
  const x = A * (e - ch);
  const y = B * sh;
  if (vel) {
    const Fdot = n / (e * ch - 1);
    const vx = -A * sh * Fdot;
    const vy = B * ch * Fdot;
    v3set(vel, vx * P.x + vy * Q.x, vx * P.y + vy * Q.y, vx * P.z + vy * Q.z);
  }
  return v3set(pos, x * P.x + y * Q.x, x * P.y + y * Q.y, x * P.z + y * Q.z);
}

/** Hyperbolic excess speed of an unbound orbit, m/s (0 when bound): v∞² = μ (e − 1) / q. */
export const speedAtInfinity = (orbit: CometOrbit): number =>
  orbit.e > 1 ? Math.sqrt((orbit.mu * (orbit.e - 1)) / orbit.q) : 0;

/** Alpha of an object's orbit line before its per-vertex shaping (the brief's fade rule). */
export const lineAlpha = (emphasised: boolean, lineFade: number, orbitLines: boolean): number =>
  orbitLines ? Math.max(emphasised ? 1 : 0, lineFade) : 0;

/** Illuminance at the camera from an unresolved object (lux): sunlight reflected by a Lambert sphere. */
export function pointIlluminance(o: OortObject, rSun: number, dist: number, phaseAngle: number): number {
  return planetPointIlluminance({
    rSun,
    distance: dist,
    radius: o.body.radius,
    albedo: o.row.physical.albedo,
    phaseAngle,
  });
}

export interface ObjectView {
  obj: OortObject;
  /** Camera → object, world axes, m. */
  rel: Vec3d;
  dist: number;
  /** Object → Sun, world axes, m. */
  toSun: Vec3d;
  rSun: number;
  /** Sun–object–camera angle, radians. */
  phase: number;
  /** Apparent diameter, device px. */
  px: number;
}

/** Per-frame float64 view of every object, computed in render.onBeforeFrame. */
export class ObjectScene {
  readonly views: ObjectView[];
  readonly sunRel = vec3();
  frameIndex = -1;

  constructor(objects: readonly OortObject[]) {
    this.views = objects.map((obj) => ({
      obj,
      rel: vec3(),
      dist: 0,
      toSun: vec3(),
      rSun: AU,
      phase: 0,
      px: 0,
    }));
  }

  update(view: ViewState): void {
    this.frameIndex = view.frameIndex;
    view.sunToCamera(this.sunRel);
    const zero = vec3();
    for (const v of this.views) {
      view.toCamera(v.obj.body.frame, zero, v.rel);
      v.dist = v3len(v.rel);
      v3sub(v.toSun, this.sunRel, v.rel);
      v.rSun = Math.max(v3len(v.toSun), 1e6);
      const cosA =
        v.dist > 0
          ? -(v.toSun.x * v.rel.x + v.toSun.y * v.rel.y + v.toSun.z * v.rel.z) / (v.rSun * v.dist)
          : 1;
      v.phase = Math.acos(Math.min(1, Math.max(-1, cosA)));
      const R = v.obj.body.radius;
      v.px = v.dist > R ? (2 * R) / (v.dist * view.pixelAngle) : Infinity;
    }
  }
}
