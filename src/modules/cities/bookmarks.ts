/**
 * Bookmarks of the cities module (sites.json): standing in a city at local midday facing its monument,
 * or looking down on a region from orbit with the city labels of the date.
 */
import type { Bookmark, FrameTree } from '../../core/contracts';
import { qlookRotation, quat, v3scale, vec3 } from '../../core/math64';
import { JD_J2000 } from '../../core/units';
import { siteDirection, sunElevation } from '../atmosphere/public';
import { middayNear } from '../paleo/public';
import sites from './sites.json';

const DEG = Math.PI / 180;
/** Day of the year after 1 January for a June visit (the Sun high at northern sites). */
const JUNE_DAY = 171;

/** JD (TT) of 1 January of a historical year (negative = BC), Julian years from J2000. */
export function jdOfYear(year: number): number {
  const astro = year < 0 ? year + 1 : year;
  return JD_J2000 - 0.5 + (astro - 2000) * 365.25;
}

/** Ellipsoid radius at a unit direction. */
function ellipsoid(up: { x: number; y: number; z: number }, a: number, f: number): number {
  const c2 = (a * (1 - f)) ** 2;
  return 1 / Math.sqrt((up.x * up.x + up.y * up.y) / (a * a) + (up.z * up.z) / c2);
}

export function buildCityBookmarks(
  frames: FrameTree,
  radius: number,
  oblateness: number,
  fixedFrame = 'earth.fixed',
): Bookmark[] {
  const out: Bookmark[] = [];
  for (const s of sites.sites) {
    const up = siteDirection(s.lat, s.lon);
    const r = ellipsoid(up, radius, oblateness);
    const ground = v3scale(vec3(), up, r);
    const elevation = (jd: number) => sunElevation(frames, fixedFrame, ground, jd);
    const jd = middayNear(elevation, jdOfYear(s.year) + JUNE_DAY);
    if (s.mode === 'orbit') {
      const alt = (s.altitudeKm ?? 3000) * 1000;
      out.push({
        id: s.id,
        title: s.title,
        frame: fixedFrame,
        pos: v3scale(vec3(), up, r + alt),
        quat: qlookRotation(quat(), v3scale(vec3(), up, -1), vec3(0, 0, 1)),
        jd,
        ev: 15,
        lookTarget: `${s.title}: labels of the cities that existed then, with approximate populations.`,
      });
      continue;
    }
    // Face the target along the ground, level.
    const t = v3scale(vec3(), siteDirection(s.targetLat, s.targetLon), r);
    const d = vec3(t.x - ground.x, t.y - ground.y, t.z - ground.z);
    const k = d.x * up.x + d.y * up.y + d.z * up.z;
    const h = vec3(d.x - k * up.x, d.y - k * up.y, d.z - k * up.z);
    const hl = Math.hypot(h.x, h.y, h.z) || 1;
    const pitch = 2 * DEG;
    const fwd = vec3(
      (Math.cos(pitch) * h.x) / hl + Math.sin(pitch) * up.x,
      (Math.cos(pitch) * h.y) / hl + Math.sin(pitch) * up.y,
      (Math.cos(pitch) * h.z) / hl + Math.sin(pitch) * up.z,
    );
    out.push({
      id: s.id,
      title: s.title,
      frame: fixedFrame,
      pos: v3scale(vec3(), up, r + 2),
      quat: qlookRotation(quat(), fwd, up),
      jd,
      rate: 1,
      ev: 14.5,
      mode: 'walk',
      fovY: 50 * DEG,
      lookTarget: `${s.title}. Standing in the street at midday among era-styled buildings and people (approximate).`,
    });
  }
  return out;
}
