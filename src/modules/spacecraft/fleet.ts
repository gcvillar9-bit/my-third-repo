/**
 * The fleet (three-free): for every craft.json row its motion model, its two frames, its Body and
 * the rules for when it exists and how strongly its marker, label and trajectory show.
 *
 * Frames: `<id>` (origin at the craft, ICRF axes; parent 'earth' for LEO craft, 'ssb' otherwise)
 * and `<id>.fixed` (the craft's body axes: local vertical for the station, pointed at the Sun or
 * Earth for the others). A craft that does not exist at the clock's date has no Body and its frame
 * has influence radius 0, so nothing can collide with it or anchor to it.
 */
import {
  FIXED_SUFFIX,
  SSB_FRAME,
  type Body,
  type FrameDef,
  type FrameTree,
  type JD,
  type ValidityRange,
  type Vec3d,
  type ViewState,
} from '../../core/contracts';
import { v3len, v3set, v3sub, vec3 } from '../../core/math64';
import { PLANETS_WINDOW_DAYS } from '../../core/time';
import { JD_J2000 } from '../../core/units';
import { displayName, type CraftRow } from './data';
import { astronomyEphemeris, createMotion, type CraftMotion, type Ephemeris } from './trajectory';

export const MODULE_ID = 'spacecraft';
export const fixedFrameId = (id: string): string => `${id}${FIXED_SUFFIX}`;

/** Craft are hidden after this instant: Earth's place (and with it every Earth-relative model) folds beyond it. */
export const FLEET_JD_MAX = JD_J2000 + PLANETS_WINDOW_DAYS;
/** The published coast states are trusted this long around their epoch; farther away positions are flagged approximate. */
export const COAST_TRUST_DAYS = 100 * 365.25;

export interface Craft {
  row: CraftRow;
  motion: CraftMotion;
  body: Body;
  frame: FrameDef;
  fixedFrame: FrameDef;
  /** Registered right now (exists at the clock's date and the module is enabled). */
  active: boolean;
}

/** Ephemeris backed by the app's frame tree (the same Sun and planets that are drawn). */
export function framesEphemeris(frames: FrameTree): Ephemeris {
  const fallback = astronomyEphemeris();
  return (body, jd, out) =>
    frames.has(body) ? frames.relative(SSB_FRAME, body, jd, out) : fallback(body, jd, out);
}

export function buildFleet(rows: readonly CraftRow[], eph: Ephemeris): Craft[] {
  return rows.map((row) => {
    const motion = createMotion(row, eph);
    const frame: FrameDef = {
      id: row.id,
      parent: motion.parentFrame,
      influenceRadius: 0,
      positionAt: (jd, out) => motion.position(jd, out),
    };
    const fixedFrame: FrameDef = {
      id: fixedFrameId(row.id),
      parent: row.id,
      influenceRadius: 0,
      positionAt: (_jd: JD, out: Vec3d) => v3set(out, 0, 0, 0),
      orientationAt: (jd, out) => motion.orientation(jd, out),
    };
    const body: Body = {
      id: row.id,
      name: displayName(row),
      kind: 'spacecraft',
      frame: row.id,
      fixedFrame: fixedFrame.id,
      parent: row.kind === 'leo' ? 'earth' : 'sun',
      radius: row.radiusM,
      influenceRadius: row.influenceRadiusM,
      simulated: true,
      labelPriority: 36,
    };
    return { row, motion, body, frame, fixedFrame, active: false };
  });
}

/** True from launch until the end of the fleet's validity range. */
export const existsAt = (craft: Craft, jd: JD): boolean => jd >= craft.motion.launchJd && jd <= FLEET_JD_MAX;

/** True when the position shown at `jd` deserves the "approximate" badge. */
export function positionApproximate(craft: Craft, jd: JD): boolean {
  const { row, motion } = craft;
  if (row.kind !== 'probe') return true; // circular LEO stand-in, fitted halo
  if (jd < motion.settledJd) return true; // cruise arcs and the blend after the last flyby
  if (row.silentSinceUtc) return true; // no tracking: the published trajectory is an extrapolation
  return Math.abs(jd - (row.trajectory?.coast.epochJd ?? jd)) > COAST_TRUST_DAYS;
}

export function fleetValidity(fleet: readonly Craft[]): ValidityRange {
  return {
    id: 'spacecraft.positions',
    appliesTo: 'spacecraft',
    model: 'two-body arcs, circular low orbits, L2 halo',
    jdMin: Math.min(...fleet.map((c) => c.motion.launchJd)),
    jdMax: FLEET_JD_MAX,
    beyond: 'hidden',
    source:
      'JPL Horizons states and CelesTrak element sets (craft.json); each craft appears at its launch, and all ' +
      'are hidden once the planet ephemerides fold (J2000 + 10 kyr)',
  };
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * How strongly a craft's marker, label and trajectory show, 0..1: they appear once the craft's
 * surroundings (`scale` m: its orbit radius, its distance from Earth or from the Sun) span enough
 * pixels seen from `dCentre` m away, so the low orbits show near Earth and the probes from
 * anywhere inside the Solar System, and none of them clutters a view from the stars.
 */
export function contextWeight(scale: number, dCentre: number, pixelAngle: number): number {
  return smooth(8, 20, scale / Math.max(dCentre, 1) / pixelAngle);
}

/** Marker opacity factor from the model's apparent diameter in pixels: gone once the model is resolved. */
export const markerFade = (pxDiam: number): number => 1 - smooth(5, 14, pxDiam);

/** Body whose distance sets the context of a craft ('earth' for LEO and L2 craft, 'sun' for probes). */
export const contextBody = (row: CraftRow): 'earth' | 'sun' => (row.kind === 'probe' ? 'sun' : 'earth');

const ZERO: Readonly<Vec3d> = Object.freeze(vec3());

/** What one frame needs to know about a craft: where it is from the camera and how to show it. */
export interface CraftView {
  /** Camera → craft, world axes, m. */
  rel: Vec3d;
  dist: number;
  /** Apparent diameter of the craft's radius sphere, pixels. */
  pxDiam: number;
  /** contextWeight for this view, 0..1. */
  weight: number;
}

/** Fills `out` for `craft`; `centreRel` is camera → context body (Earth or the Sun), world axes. */
export function craftView(craft: Craft, view: ViewState, centreRel: Vec3d, out: CraftView): CraftView {
  view.toCamera(craft.frame.id, ZERO, out.rel);
  out.dist = v3len(out.rel);
  out.pxDiam = (2 * craft.row.radiusM) / Math.max(out.dist, 1e-3) / view.pixelAngle;
  const scale = v3len(v3sub(vec3(), out.rel, centreRel));
  out.weight = contextWeight(scale, v3len(centreRel), view.pixelAngle);
  return out;
}
