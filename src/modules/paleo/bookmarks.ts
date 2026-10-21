/**
 * Deep-time Earth bookmarks (three-free), in 'earth.fixed' with numeric JDs (e2e cannot use ?t= for
 * deep time). Each date is moved by whole fold periods (4 Julian years, core foldJd) onto the season
 * in sites.json, then the Sun is found at the site with the real (folded) ephemeris: midday for the
 * whole-disc views, setting for the dusk view (on the ground in walk mode, which turns with the Earth).
 */
import type { Bookmark, FrameTree } from '../../core/contracts';
import { jdFromYearsBP } from '../../core/geotime';
import { qlookRotation, quat, v3dot, v3normalize, v3scale, vec3 } from '../../core/math64';
import { FOLD_PERIOD_DAYS } from '../../core/time';
import { JD_J2000 } from '../../core/units';
import { findSunCrossing, siteDirection, sunElevation } from '../atmosphere/public';
import sites from './sites.json';

const DEG = Math.PI / 180;
/** Whole-disc views: camera this many radii from Earth's centre. */
export const DISC_DISTANCE_RADII = 3.2;
/** Dusk view: standing on the ground (walk mode), looking towards the setting Sun this far up. */
export const DUSK_PITCH_DEG = 8;
/** Day of the folded J2000 +- 2 yr window (days after J2000, noon UT) for each season. */
const SEASON_DAY: Record<string, number> = { march: 79, june: 172, september: 265, december: 355 };

export const PALEO_BOOKMARK_IDS = sites.sites.map((s) => s.id);

/** `jd` moved by whole fold periods so that its folded instant falls on `dayAfterJ2000`. */
export function onFoldedDay(jd: number, dayAfterJ2000: number): number {
  const k = Math.round((jd - JD_J2000 - dayAfterJ2000) / FOLD_PERIOD_DAYS);
  return JD_J2000 + dayAfterJ2000 + k * FOLD_PERIOD_DAYS;
}

/** The instant of highest Sun within a day after jd0 (10-minute scan, 1-minute refine). */
export function middayNear(elevation: (jd: number) => number, jd0: number): number {
  let best = jd0;
  let bestE = -Infinity;
  for (let t = 0; t <= 1; t += 10 / 1440) {
    const e = elevation(jd0 + t);
    if (e > bestE) [best, bestE] = [jd0 + t, e];
  }
  const c = best;
  for (let t = -10; t <= 10; t++) {
    const e = elevation(c + t / 1440);
    if (e > bestE) [best, bestE] = [c + t / 1440, e];
  }
  return best;
}

export function buildPaleoBookmarks(
  frames: FrameTree,
  radius: number,
  fixedFrame = 'earth.fixed',
): Bookmark[] {
  const out: Bookmark[] = [];
  for (const s of sites.sites) {
    const up = siteDirection(s.latDeg, s.lonDeg);
    const ground = v3scale(vec3(), up, radius);
    const elevation = (jd: number) => sunElevation(frames, fixedFrame, ground, jd);
    // Start half a day early so the search window holds the wanted Sun.
    const jd0 = onFoldedDay(jdFromYearsBP(s.ageMa * 1e6), SEASON_DAY[s.season]) - 0.5;
    const look = qlookRotation(quat(), v3scale(vec3(), up, -1), vec3(0, 0, 1));
    if (s.id === 'earth-dusk-66ma') {
      const jd = findSunCrossing(elevation, jd0, { target: 8 * DEG, setting: true, maxDays: 2 });
      if (jd === null) continue;
      // Face the Sun's azimuth, pitched up; walk mode rides the turning ground, so the Sun sets.
      const sunW = frames.delta(fixedFrame, ground, 'sun', vec3(), jd, vec3());
      const sun = v3normalize(vec3(), frames.fromWorldDir(fixedFrame, sunW, jd, vec3()));
      const d = v3dot(sun, up);
      const h = v3normalize(vec3(), vec3(sun.x - up.x * d, sun.y - up.y * d, sun.z - up.z * d));
      const c = Math.cos(DUSK_PITCH_DEG * DEG);
      const sn = Math.sin(DUSK_PITCH_DEG * DEG);
      out.push({
        id: s.id,
        title: 'Earth 66 million years ago: sunset in the Late Cretaceous',
        frame: fixedFrame,
        pos: v3scale(vec3(), up, radius + 2),
        quat: qlookRotation(quat(), vec3(c * h.x + sn * up.x, c * h.y + sn * up.y, c * h.z + sn * up.z), up),
        jd,
        rate: 3600,
        ev: 12,
        mode: 'walk',
        lookTarget:
          'Standing on the ground 66 million years ago facing the Sun 8 deg up in a bright sky; with time at 1 h/s ' +
          'the Sun sets within a few seconds and the night that follows has no city lights.',
      });
      continue;
    }
    const jd = middayNear(elevation, jd0);
    const title =
      s.id === 'earth-pangaea-250ma'
        ? 'Earth 250 million years ago: Pangaea'
        : s.id === 'earth-seaway-90ma'
          ? 'Earth 90 million years ago: the Western Interior Seaway'
          : 'Earth 21,000 years ago: the Last Glacial Maximum';
    const target =
      s.id === 'earth-pangaea-250ma'
        ? 'The supercontinent Pangaea filling the sunlit disc, a dry interior around the centre where the South Atlantic is today.'
        : s.id === 'earth-seaway-90ma'
          ? 'A narrow shallow sea running north-south through the centre of the disc between two halves of North America (Laramidia to the west, Appalachia to the east).'
          : 'An ice sheet covering Canada down to the Great Lakes, with exposed continental shelves along the coasts.';
    out.push({
      id: s.id,
      title,
      frame: fixedFrame,
      pos: v3scale(vec3(), up, radius * DISC_DISTANCE_RADII),
      quat: look,
      jd,
      ev: 15,
      lookTarget: target,
    });
  }
  return out;
}
