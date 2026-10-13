/**
 * Ground eclipse bookmarks (three-free): the eye 1.7 m above the reference ellipsoid at a
 * geodetic site, in walk mode, looking at the Sun (solar) or the Moon (lunar) at an instant.
 */
import type { Body, Bookmark, FrameTree, Vec3d } from '../../core/contracts';
import { qlookRotation, quat, v3dot, v3normalize, vec3 } from '../../core/math64';
import { parseInstant } from '../../core/time';
import { localSolarEclipse } from './search';

const DEG = Math.PI / 180;
export const EYE_HEIGHT_M = 1.7;
export const LUXOR = { latDeg: 25.7, lonDeg: 32.6, heightM: 75 };
export const LUXOR_BOOKMARK_ID = 'eclipse-2027-luxor';
/** Test exposure in totality: the inner corona (~2,000 cd/m2) lands near 1-2 after pre-exposure. */
export const TOTALITY_EV = 9.5;

/** Point on the ellipsoid (a, flattening f) at geodetic latitude/longitude plus height h, body-fixed. */
export function ellipsoidPoint(latDeg: number, lonDeg: number, a: number, f: number, h: number): Vec3d {
  const la = latDeg * DEG;
  const lo = lonDeg * DEG;
  const e2 = f * (2 - f);
  const N = a / Math.sqrt(1 - e2 * Math.sin(la) ** 2);
  return vec3(
    (N + h) * Math.cos(la) * Math.cos(lo),
    (N + h) * Math.cos(la) * Math.sin(lo),
    (N * (1 - e2) + h) * Math.sin(la),
  );
}

/** Geodetic up (ellipsoid normal), body-fixed. */
export function geodeticUp(latDeg: number, lonDeg: number): Vec3d {
  const la = latDeg * DEG;
  const lo = lonDeg * DEG;
  return vec3(Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la));
}

export interface GroundBookmarkOptions {
  id: string;
  title: string;
  latDeg: number;
  lonDeg: number;
  jd: number;
  target: 'sun' | 'moon';
  ev: number;
  fovY: number;
  lookTarget: string;
}

export function buildGroundBookmark(
  frames: FrameTree,
  earth: Body,
  o: GroundBookmarkOptions,
): Bookmark | null {
  const fixed = earth.fixedFrame ?? `${earth.id}.fixed`;
  if (!frames.has(fixed) || !frames.has(o.target)) return null;
  const pos = ellipsoidPoint(o.latDeg, o.lonDeg, earth.radius, earth.oblateness ?? 0, EYE_HEIGHT_M);
  const w = frames.delta(fixed, pos, o.target, vec3(), o.jd, vec3());
  const fwd = v3normalize(vec3(), frames.fromWorldDir(fixed, w, o.jd, vec3()));
  const up = geodeticUp(o.latDeg, o.lonDeg);
  const la = o.latDeg * DEG;
  const lo = o.lonDeg * DEG;
  const north = vec3(-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la));
  const hint = Math.abs(v3dot(fwd, up)) > 0.995 ? north : up;
  return {
    id: o.id,
    title: o.title,
    frame: fixed,
    pos,
    quat: qlookRotation(quat(), fwd, hint),
    jd: o.jd,
    ev: o.ev,
    fovY: o.fovY,
    mode: 'walk',
    lookTarget: o.lookTarget,
  };
}

/** Sub-lunar (or sub-solar) geocentric latitude/longitude at jd, degrees. */
export function subPoint(
  frames: FrameTree,
  earth: Body,
  target: 'sun' | 'moon',
  jd: number,
): [number, number] {
  const fixed = earth.fixedFrame ?? `${earth.id}.fixed`;
  const d = v3normalize(
    vec3(),
    frames.fromWorldDir(fixed, frames.relative(earth.frame, target, jd, vec3()), jd, vec3()),
  );
  return [Math.asin(d.z) / DEG, Math.atan2(d.y, d.x) / DEG];
}

/** 'eclipse-2027-luxor': totality of 2027-08-02 seen from Luxor at the local peak. */
export function buildLuxorBookmark(frames: FrameTree, earth: Body): Bookmark | null {
  const local = localSolarEclipse(
    parseInstant('2027-07-01T00:00:00Z')!,
    LUXOR.latDeg,
    LUXOR.lonDeg,
    LUXOR.heightM,
  );
  if (local.kind !== 'total') return null;
  return buildGroundBookmark(frames, earth, {
    id: LUXOR_BOOKMARK_ID,
    title: 'Total solar eclipse, Luxor, 2 Aug 2027',
    latDeg: LUXOR.latDeg,
    lonDeg: LUXOR.lonDeg,
    jd: local.peakJd,
    target: 'sun',
    ev: TOTALITY_EV,
    fovY: 6 * DEG,
    lookTarget:
      'Standing in Luxor at mid-totality, looking up at the Sun (about 80 deg high): a black lunar disk at the ' +
      'centre ringed by the pearly corona with radial streamers, inside a dark sky.',
  });
}
