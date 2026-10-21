/**
 * Walk-mode bookmarks of the life module (sites.json): standing on the ground at the date, facing north
 * at local midday (the Sun behind the camera lights the animals), with hand-placed herds in view.
 */
import type { Bookmark, FrameTree } from '../../core/contracts';
import { jdFromYearsBP } from '../../core/geotime';
import { qlookRotation, quat, v3scale, vec3 } from '../../core/math64';
import { siteDirection, sunElevation } from '../atmosphere/public';
import { middayNear, onFoldedDay } from '../paleo/public';
import type { Featured } from './population';
import sites from './sites.json';

export const LIFE_BOOKMARK_IDS = sites.sites.map((s) => s.id);

/** Day of the folded year (days after J2000) for each season. */
const SEASON_DAY: Record<string, number> = { june: 172, december: 355 };
const DEG = Math.PI / 180;
/** Look down a little so the ground and the herds fill the view. */
const PITCH_DEG = -2;
const M_PER_DEG = 111_195;

/** Featured herds of every site (system.ts). */
export function featuredHerds(): Featured[] {
  const out: Featured[] = [];
  for (const s of sites.sites)
    s.herds.forEach((h, i) =>
      out.push({
        id: `${s.id}:${i}`,
        species: h.species,
        ageMa: s.ageMa,
        lat: s.latDeg + h.north / M_PER_DEG,
        lon: s.lonDeg + h.east / (M_PER_DEG * Math.cos(s.latDeg * DEG)),
        count: h.count,
      }),
    );
  return out;
}

export function buildLifeBookmarks(
  frames: FrameTree,
  radius: number,
  fixedFrame = 'earth.fixed',
  oblateness = 0,
): Bookmark[] {
  const out: Bookmark[] = [];
  for (const s of sites.sites) {
    const up = siteDirection(s.latDeg, s.lonDeg);
    // On the ellipsoid (walk mode needs the camera within 10 km of the ground; at 50 deg latitude the
    // surface is 12 km below the equatorial radius).
    const c2 = (radius * (1 - oblateness)) ** 2;
    const rEll = 1 / Math.sqrt((up.x * up.x + up.y * up.y) / (radius * radius) + (up.z * up.z) / c2);
    const ground = v3scale(vec3(), up, rEll);
    const elevation = (jd: number) => sunElevation(frames, fixedFrame, ground, jd);
    const jd0 = onFoldedDay(jdFromYearsBP(s.ageMa * 1e6), SEASON_DAY[s.season]) - 0.5;
    const jd = middayNear(elevation, jd0);
    // North along the ground, pitched down a little.
    const north = vec3(-up.z * up.x, -up.z * up.y, 1 - up.z * up.z);
    const nl = Math.hypot(north.x, north.y, north.z) || 1;
    const c = Math.cos(PITCH_DEG * DEG);
    const sn = Math.sin(PITCH_DEG * DEG);
    const fwd = vec3(
      (c * north.x) / nl + sn * up.x,
      (c * north.y) / nl + sn * up.y,
      (c * north.z) / nl + sn * up.z,
    );
    out.push({
      id: s.id,
      title: s.title,
      frame: fixedFrame,
      pos: v3scale(vec3(), up, rEll + 2),
      quat: qlookRotation(quat(), fwd, up),
      jd,
      rate: 1,
      ev: 14.5,
      mode: 'walk',
      fovY: 40 * DEG,
      lookTarget: `${s.title}. Standing on the ground facing north at midday; the animals walk and graze (approximate, by fossil range and habitat).`,
    });
  }
  return out;
}
