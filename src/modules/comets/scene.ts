/**
 * Per-frame float64 view of every comet (three-free), computed once in render.onBeforeFrame and read by the
 * renderables and the label source.
 */
import type { Body, FrameId, Vec3d, ViewState } from '../../core/contracts';
import { v3len, v3sub, vec3 } from '../../core/math64';
import { LUX_MAG0 } from '../../core/photometry';
import { AU } from '../../core/units';
import type { CometDisplay, CometRow } from './data';
import { activityFade, comaIntensity, comaRadius, smoothstep } from './model';
import type { CometOrbit } from './orbit';

/** One comet as registered: catalogue row, orbit and registry body. */
export interface Comet {
  row: CometRow;
  orbit: CometOrbit;
  body: Body;
  /** Frame the orbit is expressed in ('sun' or the barycentre). */
  center: FrameId;
}

export interface CometView {
  comet: Comet;
  /** Camera → nucleus, world axes, m. */
  rel: Vec3d;
  dist: number;
  /** Nucleus → Sun, world axes, m. */
  toSun: Vec3d;
  rSun: number;
  /** Activity switch 0..1 (zero beyond about 5 AU). */
  activity: number;
  /** Luminous intensity of the coma, cd. */
  intensity: number;
  /** Coma radius, m. */
  comaRadius: number;
  /** Weight of the resolved coma (the rest of the light goes to the photometric point). */
  resolved: number;
  /** Total visual magnitude from the camera (Infinity when inactive). */
  magnitude: number;
}

/** Coma radius in pixels below which it is drawn as a point only, and above which as a volume only. */
/** The coma glow reaches this many coma radii (exponential outskirts). */
export const COMA_EXTENT = 3;
export const COMA_POINT_PX = 1;
export const COMA_FULL_PX = 3;

export class CometScene {
  readonly views: CometView[];
  readonly sunRel = vec3();
  enabled = true;
  frameIndex = -1;

  constructor(
    comets: readonly Comet[],
    readonly display: CometDisplay,
  ) {
    this.views = comets.map((comet) => ({
      comet,
      rel: vec3(),
      dist: 0,
      toSun: vec3(),
      rSun: AU,
      activity: 0,
      intensity: 0,
      comaRadius: 1,
      resolved: 0,
      magnitude: Infinity,
    }));
  }

  update(view: ViewState): void {
    this.frameIndex = view.frameIndex;
    view.sunToCamera(this.sunRel);
    const zero = vec3();
    for (const v of this.views) {
      const { row, body } = v.comet;
      view.toCamera(body.frame, zero, v.rel);
      v.dist = v3len(v.rel);
      v3sub(v.toSun, this.sunRel, v.rel);
      v.rSun = Math.max(v3len(v.toSun), 1e6);
      const rAU = v.rSun / AU;
      v.activity = activityFade(rAU, this.display);
      v.intensity = comaIntensity(row, rAU, this.display);
      v.comaRadius = comaRadius(row, rAU, this.display);
      const px = (COMA_EXTENT * v.comaRadius) / (Math.max(v.dist, 1) * view.pixelAngle);
      v.resolved = smoothstep(COMA_POINT_PX, COMA_FULL_PX, px);
      const e = v.intensity / Math.max(v.dist * v.dist, 1);
      v.magnitude = e > 0 ? -2.5 * Math.log10(e / LUX_MAG0) : Infinity;
    }
  }

  get(id: string): CometView | undefined {
    return this.views.find((v) => v.comet.row.id === id);
  }
}
