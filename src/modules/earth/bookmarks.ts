/**
 * Earth bookmarks (three-free). Orbit views live in 'earth.sunview' (+x Sun, +z ecliptic north,
 * Earth turns towards +y so dawn is on the -y side), so their lighting does not depend on the
 * date; the night-lights view sits over Europe in 'earth.fixed' at a fixed instant.
 */
import type { Bookmark, Quatd, Vec3d } from '../../core/contracts';
import { qlookRotation, quat, v3normalize, v3scale, vec3 } from '../../core/math64';

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
