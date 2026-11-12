/**
 * Oort Cloud bookmarks (three-free), frame 'sun', ICRF coordinates. The views look along the Galactic pole:
 * the dark sky of the Galactic poles lies behind the cloud, and the ecliptic pole points up the screen, so
 * an untwisted disc would look mirror-symmetric left to right. The Galactic tide's twist breaks that
 * symmetry: the inner cloud leans from upper left to lower right.
 */
import type { Bookmark, Vec3d } from '../../../core/contracts';
import { qlookRotation, quat, v3scale, vec3 } from '../../../core/math64';
import { parseInstant } from '../../../core/time';
import { AU } from '../../../core/units';
import { GALACTIC_POLE_ECL, eclToIcrf } from '../shared';

export const CLOUD_BOOKMARK_ID = 'oort-cloud';
export const SPIRAL_BOOKMARK_ID = 'oort-spiral';
export const INSIDE_BOOKMARK_ID = 'oort-inside';
/** Distances of the three views from the Sun, AU. */
export const CLOUD_VIEW_AU = 170_000;
export const SPIRAL_VIEW_AU = 22_000;
export const INSIDE_VIEW_AU = 30_000;
/** Night-sky exposure of the whole-cloud view (as the asteroid belt's). */
export const CLOUD_EV = -2;

const DEG = Math.PI / 180;
const ECL_NORTH = Object.freeze(vec3(0, 0, 1));

/** A view from `dirEcl * distAu` looking at the Sun, ecliptic north up. */
function sunView(
  id: string,
  title: string,
  dirEcl: Readonly<Vec3d>,
  distAu: number,
  fovDeg: number,
  ev: number,
  lookTarget: string,
): Bookmark {
  const pos = eclToIcrf(vec3(), v3scale(vec3(), dirEcl, distAu * AU));
  const fwd = eclToIcrf(vec3(), v3scale(vec3(), dirEcl, -1));
  return {
    id,
    title,
    frame: 'sun',
    pos,
    quat: qlookRotation(quat(), fwd, eclToIcrf(vec3(), ECL_NORTH)),
    jd: parseInstant('2026-01-01T00:00:00Z')!,
    ev,
    fovY: fovDeg * DEG,
    lookTarget,
  };
}

export function buildCloudBookmarks(): Bookmark[] {
  const g = GALACTIC_POLE_ECL;
  const south = vec3(-g.x, -g.y, -g.z);
  return [
    sunView(
      CLOUD_BOOKMARK_ID,
      'The Oort Cloud (170,000 AU)',
      g,
      CLOUD_VIEW_AU,
      70,
      CLOUD_EV,
      'The whole simulated Oort Cloud from 170,000 AU above the north Galactic pole, looking back at the Sun: ' +
        'a small white glow (the inner cloud, a few thousand AU across) around the Sun at the centre, inside a ' +
        'much fainter, mottled round halo (the outer cloud, out to 100,000 AU) that fades into the star field.',
    ),
    sunView(
      SPIRAL_BOOKMARK_ID,
      'The Oort spiral (22,000 AU)',
      g,
      SPIRAL_VIEW_AU,
      60,
      0.5,
      'The inner Oort Cloud from 22,000 AU above the north Galactic pole, ecliptic north up: a soft grey haze ' +
        'of overlapping blobs with a bright, flattened core around the Sun; the haze is brighter to the upper ' +
        'left and lower right than to the other two sides, the inner disc twisted by the Galactic tide, and ' +
        'fades towards the corners.',
    ),
    sunView(
      INSIDE_BOOKMARK_ID,
      'Inside the Oort Cloud (30,000 AU)',
      south,
      INSIDE_VIEW_AU,
      70,
      0,
      'Inside the outer Oort Cloud, 30,000 AU from the Sun on the south Galactic side, looking back at it: ' +
        'the glowing inner cloud around the Sun at the centre, and scattered outer-cloud points all around ' +
        'the frame, each standing for millions of comets.',
    ),
  ];
}
