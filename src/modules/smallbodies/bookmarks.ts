/** 'asteroid-belt-3au' (three-free): inside the main belt, 3 AU from the Sun, looking prograde. */
import type { Bookmark, Vec3d } from '../../core/contracts';
import { qlookRotation, quat, v3normalize, vec3 } from '../../core/math64';
import { parseInstant } from '../../core/time';
import { AU } from '../../core/units';
import { OBLIQUITY_J2000 } from '../solar-system/public';

export const BELT_BOOKMARK_ID = 'asteroid-belt-3au';
/** Night-sky test exposure (enhanced belt points near 0.05-1 after pre-exposure). */
export const BELT_EV = -2;

const c = Math.cos(OBLIQUITY_J2000);
const s = Math.sin(OBLIQUITY_J2000);
/** Ecliptic -> ICRF (Rx(obliquity)). */
export const eclToIcrf = (v: Vec3d): Vec3d => vec3(v.x, c * v.y - s * v.z, s * v.y + c * v.z);

export function buildBeltBookmark(): Bookmark {
  const fwd = v3normalize(vec3(), vec3(-0.35, 1, -0.16));
  return {
    id: BELT_BOOKMARK_ID,
    title: 'Inside the asteroid belt (3 AU)',
    frame: 'sun',
    pos: eclToIcrf(vec3(3 * AU, 0, 0.12 * AU)),
    quat: qlookRotation(quat(), eclToIcrf(fwd), eclToIcrf(vec3(0, 0, 1))),
    jd: parseInstant('2026-01-01T00:00:00Z')!,
    ev: BELT_EV,
    lookTarget:
      'Inside the main belt 0.12 AU above the ecliptic, looking prograde and slightly sunward: thousands of ' +
      'grey-white points (visibility-enhanced asteroids), densest in the upper left where the line of sight runs ' +
      'along the inner belt, thinning to the right over the star field; planet orbit lines cross the lower left.',
  };
}
