/**
 * Oort Cloud bookmarks (three-free), frame 'sun', ICRF coordinates. The whole-cloud view looks along the
 * Galactic pole, with the dark sky of the Galactic poles behind the cloud. The spiral view lies in the
 * ecliptic plane, on the side of the Galactic pole: an untwisted disc would be a thin horizontal bar, and the
 * Galactic tide's twist (about the pole, which leans towards the camera) curls its ends into an S.
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
export const SPIRAL_VIEW_AU = 24_000;
export const INSIDE_VIEW_AU = 30_000;
/** Elevation of the spiral view above the ecliptic plane, rad: exactly in the plane. */
const SPIRAL_ELEVATION = 0;
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
  // The Galactic pole projected onto the ecliptic plane. This exact view once rendered an all-black frame
  // (a shell line fragment with an invalid alpha, see bodies/glsl/line.glsl), so the oort-spiral e2e test
  // doubles as the regression test for that.
  const gl = Math.hypot(g.x, g.y);
  const ce = Math.cos(SPIRAL_ELEVATION);
  const side = vec3((ce * g.x) / gl, (ce * g.y) / gl, Math.sin(SPIRAL_ELEVATION));
  return [
    sunView(
      CLOUD_BOOKMARK_ID,
      'The Oort Cloud (170,000 AU)',
      g,
      CLOUD_VIEW_AU,
      70,
      CLOUD_EV,
      'The whole simulated Oort Cloud from 170,000 AU above the north Galactic pole, looking back at the Sun: ' +
        'a bright but not blown-out glow (the inner cloud, a few thousand AU across) around the Sun at the ' +
        'centre, inside a much fainter, grainy round halo (the outer cloud, out to 100,000 AU) that fades into ' +
        'the dark star field; scale shells ring the cloud.',
    ),
    sunView(
      SPIRAL_BOOKMARK_ID,
      'The Oort spiral (24,000 AU)',
      side,
      SPIRAL_VIEW_AU,
      60,
      0.5,
      'The inner Oort Cloud from 24,000 AU in the ecliptic plane (towards the north Galactic pole), ecliptic ' +
        'north up: a speckled S about 20,000 AU across, a bright bar through the Sun with one arm curling to ' +
        'the upper left and one to the lower right (the inner disc twisted by the Galactic tide), fading ' +
        'into a faint grainy haze and the star field; scale shells and tracks cross it.',
    ),
    sunView(
      INSIDE_BOOKMARK_ID,
      'Inside the Oort Cloud (30,000 AU)',
      south,
      INSIDE_VIEW_AU,
      70,
      0,
      'Inside the outer Oort Cloud, 30,000 AU from the Sun on the south Galactic side, looking back at it: ' +
        'a dark starry sky speckled with small outer-cloud points, each standing for millions of comets, and a ' +
        'soft glow of the inner cloud around the Sun at the centre (dimmed: the camera is inside the cloud).',
    ),
  ];
}
