/** 'sun-closeup' (three-free): 21,000 km above the photosphere, looking 50 deg off nadir. */
import type { Bookmark } from '../../core/contracts';
import { qlookRotation, quat, vec3 } from '../../core/math64';

const DEG = Math.PI / 180;
export const SUN_CLOSEUP_ID = 'sun-closeup';
/** Camera distance from the Sun's centre, solar radii. */
export const CLOSEUP_DISTANCE_R = 1.03;
/** Look direction, degrees from nadir (the limb sits 76 deg from nadir at 1.03 R). */
export const CLOSEUP_OFF_NADIR_DEG = 50;
/** Test exposure: obliquely viewed photosphere near 0.3 after pre-exposure. */
export const CLOSEUP_EV = 32;

export function buildSunCloseup(radius: number): Bookmark {
  const a = CLOSEUP_OFF_NADIR_DEG * DEG;
  const fwd = vec3(-Math.cos(a), 0, Math.sin(a));
  return {
    id: SUN_CLOSEUP_ID,
    title: 'Sun: granulation close-up',
    frame: 'sun',
    pos: vec3(CLOSEUP_DISTANCE_R * radius, 0, 0),
    quat: qlookRotation(quat(), fwd, vec3(1, 0, 0)),
    ev: CLOSEUP_EV,
    fovY: 60 * DEG,
    lookTarget:
      'Low over the photosphere: the whole frame is granulated orange-white surface (bright cells about ' +
      '1,000 km across with dark lanes, largest at the bottom), darkening towards the limb; black space above ' +
      'the limb along the top edge.',
  };
}
