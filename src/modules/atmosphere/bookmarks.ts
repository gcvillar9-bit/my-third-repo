/**
 * 'mars-gale-sunset' (three-free): on the ground at Gale crater, 2 m above the collision sphere
 * (equatorial radius; the camera's sphere ground), looking at the Sun when it sets through +3 deg
 * elevation for the first time after the reference instant.
 */
import type { Body, Bookmark, FrameTree, Vec3d } from '../../core/contracts';
import { qlookRotation, quat, v3dot, v3normalize, v3scale, vec3 } from '../../core/math64';
import { findSunCrossing } from './sun-search';

const DEG = Math.PI / 180;
export const GALE_CRATER = { latDeg: -5.4, lonDeg: 137.8 };
export const SUNSET_ELEVATION_DEG = 3;
/** Camera pitch above the horizon, so the horizon sits in the lower third with fovY 60 deg. */
export const SUNSET_PITCH_DEG = 8;
/** Test exposure, EV100 (sky near the Sun around 0.3-0.6 after pre-exposure; twin estimate). */
export const SUNSET_EV = 12;

/** Unit planetocentric direction (body-fixed axes, east-positive longitude). */
export function siteDirection(latDeg: number, lonDeg: number): Vec3d {
  const la = latDeg * DEG;
  const lo = lonDeg * DEG;
  return vec3(Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la));
}

/** Sun elevation (radians) at a body-fixed site position `pos` (local vertical = radial). */
export function sunElevation(frames: FrameTree, fixedFrame: string, pos: Vec3d, jd: number): number {
  const up = frames.toWorldDir(fixedFrame, v3normalize(vec3(), pos), jd, vec3());
  const toSun = v3normalize(vec3(), frames.delta(fixedFrame, pos, 'sun', vec3(), jd, vec3()));
  return Math.asin(Math.max(-1, Math.min(1, v3dot(up, toSun))));
}

export function buildMarsGaleSunset(frames: FrameTree, mars: Body, jd0: number): Bookmark | null {
  const fixed = mars.fixedFrame ?? `${mars.id}.fixed`;
  if (!frames.has(fixed) || !frames.has('sun')) return null;
  const up = siteDirection(GALE_CRATER.latDeg, GALE_CRATER.lonDeg);
  const pos = v3scale(vec3(), up, mars.radius + 2);
  const jd = findSunCrossing((t) => sunElevation(frames, fixed, pos, t), jd0, {
    target: SUNSET_ELEVATION_DEG * DEG,
    setting: true,
    maxDays: 3,
  });
  if (jd === null) return null;
  const sunW = frames.delta(fixed, pos, 'sun', vec3(), jd, vec3());
  const sun = v3normalize(vec3(), frames.fromWorldDir(fixed, sunW, jd, vec3()));
  const h = v3normalize(vec3(), {
    x: sun.x - up.x * v3dot(sun, up),
    y: sun.y - up.y * v3dot(sun, up),
    z: sun.z - up.z * v3dot(sun, up),
  });
  const c = Math.cos(SUNSET_PITCH_DEG * DEG);
  const s = Math.sin(SUNSET_PITCH_DEG * DEG);
  const fwd = vec3(c * h.x + s * up.x, c * h.y + s * up.y, c * h.z + s * up.z);
  return {
    id: 'mars-gale-sunset',
    title: 'Mars: blue sunset at Gale crater',
    frame: fixed,
    pos,
    quat: qlookRotation(quat(), fwd, up),
    jd,
    ev: SUNSET_EV,
    // Walk mode seats the eye 1.7 m above the drawn ground (the Gale floor is ~4.5 km below the
    // reference radius) and keeps the 8 deg pitch.
    mode: 'walk',
    lookTarget:
      'Standing at Gale crater: the small Sun about 3 deg above the horizon, slightly below the image centre, ' +
      'inside a blue glow; the sky turns butterscotch away from the Sun; dim reddish ground in the lower third.',
  };
}
