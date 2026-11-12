/**
 * Bookmarks showing galaxy portraits up close, all from the Milky Way side: 'whirlpool' (M51, ~60% of
 * the width), 'sombrero' (M104), 'm87-jet' (the core of M87, ~6 kpc across), 'inside-m31' (3 kpc above
 * Andromeda's disc, 12 kpc from its centre, looking across the disc at the bulge), 'pinwheel' (M101),
 * 'ngc-1300', 'needle' (NGC 4565), 'centaurus-a', 'cigar' (M82 with its outflow) and 'antennae'.
 */
import { ROOT_FRAME, type Bookmark } from '../../core/contracts';
import { qlookRotation, quat, v3cross, v3normalize, vec3 } from '../../core/math64';
import { KPC, MPC } from '../../core/units';
import { approachBookmark, discNormal, fillDistance, gallery, named } from './named';

const DEG = Math.PI / 180;
/** Horizontal field of view at 16:9 for vertical fovY. */
const hfov169 = (fovY: number) => 2 * Math.atan(Math.tan(fovY / 2) * (16 / 9));
export const PORTRAIT_EV = -11;
/** M87's core is far brighter per pixel at this scale. */
export const M87_JET_EV = -9;
/** Half-width of the m87-jet view, kpc. */
export const M87_JET_HALF_KPC = 3;
/** Camera height above M31's disc and in-plane distance from its centre, kpc. */
export const INSIDE_M31_HEIGHT_KPC = 3;
export const INSIDE_M31_DIST_KPC = 12;

export function portraitBookmarks(): Bookmark[] {
  const fov = 30 * DEG;
  const m51 = named('m51');
  const whirlpool: Bookmark = {
    ...approachBookmark(m51, 'whirlpool', fillDistance(m51.radiusKpc * KPC, 0.6, hfov169(fov)), fov),
    title: 'The Whirlpool Galaxy (M51)',
    ev: PORTRAIT_EV,
    lookTarget:
      'M51 seen from the Milky Way side filling ~60% of the width: two grand-design spiral arms with dark dust lanes on their inner edges and pink star-forming knots; one arm continues outward as a bridge towards the companion NGC 5195.',
  };
  const m104 = named('m104');
  const sombrero: Bookmark = {
    ...approachBookmark(m104, 'sombrero', fillDistance(m104.radiusKpc * KPC, 0.6, hfov169(fov)), fov),
    title: 'The Sombrero Galaxy (M104)',
    ev: PORTRAIT_EV,
    lookTarget:
      'M104 nearly edge-on, major axis horizontal: a dominant bright yellowish bulge crossed by a thin dark dust ring near the rim of the disc.',
  };
  const m87 = named('m87');
  const jetFov = 30 * DEG;
  const m87Jet: Bookmark = {
    ...approachBookmark(m87, 'm87-jet', fillDistance(M87_JET_HALF_KPC * KPC, 1, hfov169(jetFov)), jetFov),
    title: 'The jet of M87',
    ev: M87_JET_EV,
    lookTarget:
      'The core of the giant elliptical M87, ~6 kpc across: a smooth round glow with a narrow blue-white one-sided jet about 1.7 kpc long leaving the nucleus towards the upper right.',
  };
  // Inside M31: in the disc's frame, offset sideways (perpendicular to the Milky Way line of sight).
  const m31 = named('m31');
  const c = vec3(m31.pos[0] * MPC, m31.pos[1] * MPC, m31.pos[2] * MPC);
  const n = discNormal(m31);
  const side = v3normalize(vec3(), v3cross(vec3(), n, v3normalize(vec3(), c)));
  const h = INSIDE_M31_HEIGHT_KPC * KPC;
  const r = INSIDE_M31_DIST_KPC * KPC;
  const pos = vec3(c.x + side.x * r + n.x * h, c.y + side.y * r + n.y * h, c.z + side.z * r + n.z * h);
  const fwd = v3normalize(vec3(), vec3(c.x - pos.x, c.y - pos.y, c.z - pos.z));
  const insideM31: Bookmark = {
    id: 'inside-m31',
    title: 'Inside Andromeda (M31)',
    frame: ROOT_FRAME,
    pos,
    quat: qlookRotation(quat(), fwd, n),
    fovY: 60 * DEG,
    ev: -12,
    lookTarget:
      "Inside Andromeda's disc, 3 kpc above the plane and 12 kpc from the centre: the disc's arms, dust and star-forming ring stretch across the lower view towards the bright bulge at the centre.",
  };
  const view = (
    id: string,
    galaxyId: string,
    title: string,
    frac: number,
    lookTarget: string,
    r?: number,
  ) => {
    const g = gallery(galaxyId);
    return {
      ...approachBookmark(g, id, fillDistance((r ?? g.radiusKpc) * KPC, frac, hfov169(fov)), fov),
      title,
      ev: PORTRAIT_EV,
      lookTarget,
    };
  };
  const more: Bookmark[] = [
    view(
      'pinwheel',
      'm101',
      'The Pinwheel Galaxy (M101)',
      0.6,
      'M101 nearly face-on: a lopsided, many-armed spiral strewn with pink star-forming knots around a small bright core.',
    ),
    view(
      'ngc-1300',
      'ngc1300',
      'NGC 1300',
      0.6,
      'The barred spiral NGC 1300: a long straight bar with dark dust lanes along it and two arms sweeping out from its ends.',
    ),
    view(
      'needle',
      'ngc4565',
      'The Needle Galaxy (NGC 4565)',
      0.75,
      'NGC 4565 exactly edge-on: a long thin needle of light split along its length by a dark dust lane, with a small bulge in the middle.',
    ),
    view(
      'centaurus-a',
      'cena',
      'Centaurus A',
      0.6,
      'Centaurus A: a round yellowish elliptical body crossed by a broad, warped dark dust band lined with blue and pink star formation.',
    ),
    view(
      'cigar',
      'm82',
      'The Cigar Galaxy (M82)',
      0.45,
      'M82 nearly edge-on: a dusty, clumpy starburst disc with red hydrogen-alpha outflow cones rising above and below its centre.',
    ),
    view(
      'antennae',
      'antennae',
      'The Antennae (NGC 4038/4039)',
      0.9,
      'The Antennae: two colliding, distorted galaxy bodies full of pink star-forming knots, with two long curved tidal tails.',
      60,
    ),
  ];
  return [whirlpool, sombrero, m87Jet, insideM31, ...more];
}
