/**
 * Earth bookmarks (three-free). Orbit views live in 'earth.sunview' (+x Sun, +z ecliptic north,
 * Earth turns towards +y so dawn is on the -y side), so their lighting does not depend on the
 * date; the night-lights view sits over Europe in 'earth.fixed' at a fixed instant.
 */
import type { Bookmark, FrameTree, Quatd, Vec3d } from '../../core/contracts';
import { qlookRotation, quat, v3dot, v3normalize, v3scale, vec3 } from '../../core/math64';
import { findSunCrossing, siteDirection, sunElevation } from '../atmosphere/public';

const DEG = Math.PI / 180;
export const ORBIT_ALTITUDE_M = 400e3;
export const NIGHT_ALTITUDE_M = 2000e3;
/** Europe: 50 N 10 E. */
export const NIGHT_SITE = { latDeg: 50, lonDeg: 10 };

/**
 * Camera at altitude `alt` over the sun-view equator at angle `azDeg` from the subsolar point
 * (negative = morning side), looking along the surface towards ecliptic north yawed `yawDeg`
 * towards the Sun, pitched `pitchDeg` below the local horizontal.
 */
export function limbView(
  radius: number,
  alt: number,
  azDeg: number,
  yawDeg: number,
  pitchDeg: number,
): { pos: Vec3d; quat: Quatd } {
  const up = vec3(Math.cos(azDeg * DEG), Math.sin(azDeg * DEG), 0);
  const pos = v3scale(vec3(), up, radius + alt);
  // horizontal basis: north = +z, "sunward" = component of +x perpendicular to up
  const sx = vec3(1 - up.x * up.x, -up.x * up.y, 0);
  v3normalize(sx, sx);
  const cy = Math.cos(yawDeg * DEG);
  const sy = Math.sin(yawDeg * DEG);
  const h = vec3(sy * sx.x, sy * sx.y, cy);
  const cp = Math.cos(pitchDeg * DEG);
  const sp = Math.sin(pitchDeg * DEG);
  const fwd = vec3(cp * h.x - sp * up.x, cp * h.y - sp * up.y, cp * h.z - sp * up.z);
  return { pos, quat: qlookRotation(quat(), fwd, up) };
}

/** Horizon dip below the local horizontal at altitude alt, degrees. */
export const horizonDipDeg = (radius: number, alt: number): number =>
  Math.acos(radius / (radius + alt)) / DEG;

export function buildEarthBookmarks(radius: number, nightJd: number): Bookmark[] {
  const dip = horizonDipDeg(radius, ORBIT_ALTITUDE_M);
  const dawn = limbView(radius, ORBIT_ALTITUDE_M, -91, 20, dip + 10);
  const limb = limbView(radius, ORBIT_ALTITUDE_M, -30, 0, dip + 10);
  const la = NIGHT_SITE.latDeg * DEG;
  const lo = NIGHT_SITE.lonDeg * DEG;
  const site = vec3(Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la));
  const nightPos = v3scale(vec3(), site, radius + NIGHT_ALTITUDE_M);
  return [
    {
      id: 'earth-dawn-400km',
      title: 'Earth: dawn from 400 km',
      frame: 'earth.sunview',
      ...dawn,
      lookAt: 'earth',
      jd: 'now',
      ev: 13.5,
      lookTarget:
        'From 400 km just inside the night side of the dawn terminator, looking along it: the curved limb in the ' +
        'upper third with a thin blue glow over the sunlit right half and black space above; reddish low-Sun ' +
        'ground with long cloud shadows on the right, the night side fading to dark on the left.',
    },
    {
      id: 'earth-limb-400km',
      title: 'Earth: limb from 400 km',
      frame: 'earth.sunview',
      ...limb,
      lookAt: 'earth',
      jd: 'now',
      ev: 15.5,
      lookTarget:
        'Sunlit Earth from 400 km: clouds and ocean below, the curved limb in the upper third with a blue ' +
        'atmosphere band fading into black space.',
    },
    {
      id: 'earth-night-lights',
      title: 'Earth: city lights over Europe',
      frame: 'earth.fixed',
      pos: nightPos,
      quat: qlookRotation(quat(), v3scale(vec3(), site, -1), vec3(0, 0, 1)),
      jd: nightJd,
      ev: -1,
      lookTarget:
        'Europe at night from 2000 km, looking straight down: warm orange city lights, dark land and sea, north up.',
    },
  ];
}

/** Orbital sunrise demo: over Pennsylvania (40 N 80 W), looking east across the US east coast to the Atlantic. */
export const SUNRISE_SITE = { latDeg: 40, lonDeg: -80 };
export const SUNRISE_ID = 'earth-sunrise-400km';
/** Sun elevation at the nadir point (the Sun is then ~7.8 deg above the limb as seen from 400 km). */
export const SUNRISE_NADIR_SUN_DEG = -12;
/** The limb sits this far above the image centre. */
export const SUNRISE_LIMB_ABOVE_DEG = 12;
export const SUNRISE_EV = 11;

/**
 * Fixed-instant orbital sunrise: the first time after `jd0` that the Sun rises through
 * SUNRISE_NADIR_SUN_DEG at the nadir of a camera 400 km over SUNRISE_SITE. Looks towards the Sun's
 * azimuth with the limb in the upper part of the frame: the night side with the east-coast cities
 * below, the dawn terminator over the Atlantic and the ocean glint at the limb under the Sun.
 */
export function buildEarthSunrise(frames: FrameTree, radius: number, jd0: number): Bookmark | null {
  const fixed = 'earth.fixed';
  if (!frames.has(fixed) || !frames.has('sun')) return null;
  const up = siteDirection(SUNRISE_SITE.latDeg, SUNRISE_SITE.lonDeg);
  const pos = v3scale(vec3(), up, radius + ORBIT_ALTITUDE_M);
  const jd = findSunCrossing((t) => sunElevation(frames, fixed, pos, t), jd0, {
    target: SUNRISE_NADIR_SUN_DEG * DEG,
    setting: false,
    maxDays: 2,
  });
  if (jd === null) return null;
  const sunW = frames.delta(fixed, pos, 'sun', vec3(), jd, vec3());
  const sun = v3normalize(vec3(), frames.fromWorldDir(fixed, sunW, jd, vec3()));
  const k = v3dot(sun, up);
  const h = v3normalize(vec3(), vec3(sun.x - up.x * k, sun.y - up.y * k, sun.z - up.z * k));
  const p = (horizonDipDeg(radius, ORBIT_ALTITUDE_M) + SUNRISE_LIMB_ABOVE_DEG) * DEG;
  const fwd = vec3(
    Math.cos(p) * h.x - Math.sin(p) * up.x,
    Math.cos(p) * h.y - Math.sin(p) * up.y,
    Math.cos(p) * h.z - Math.sin(p) * up.z,
  );
  return {
    id: SUNRISE_ID,
    title: 'Earth: orbital sunrise over the Atlantic',
    frame: fixed,
    pos,
    quat: qlookRotation(quat(), fwd, up),
    lookAt: 'earth',
    jd,
    ev: SUNRISE_EV,
    fovY: 50 * DEG,
    lookTarget:
      'Orbital sunrise from 400 km over Pennsylvania, looking east: the Sun about 8 deg above the curved limb ' +
      'near the top, a thin red-orange-blue atmosphere band, a bright glint on the Atlantic at the limb under ' +
      'the Sun, the dawn terminator across the ocean and the dark night side below.',
  };
}
