/**
 * Milky Way bookmarks (P4-A). Outside views use the `mw` frame (IAU galactic axes, origin Sgr A*);
 * the band view looks towards Sagittarius from 0.2 pc out on the Sgr side (Sun behind the camera), just
 * beyond the far fade of the boosted asteroid-belt points, so the sky is Earth's without the belt
 * streaking along the ecliptic across it.
 */
import { MW_FRAME, SSB_FRAME, type Bookmark, type Vec3d } from '../../core/contracts';
import { ICRS_TO_GALACTIC } from '../../core/frames';
import { qlookRotation, quat, vec3 } from '../../core/math64';
import { KPC, PC } from '../../core/units';
import { galacticDir } from './model';

const DEG = Math.PI / 180;

/** Galactic → ICRS for a direction (transpose of ICRS_TO_GALACTIC). */
export function galacticToIcrs(g: Vec3d): Vec3d {
  const a = ICRS_TO_GALACTIC;
  return vec3(
    a[0] * g.x + a[3] * g.y + a[6] * g.z,
    a[1] * g.x + a[4] * g.y + a[7] * g.z,
    a[2] * g.x + a[5] * g.y + a[8] * g.z,
  );
}

/** Bookmark ids, view parameters and exposures (EV100 in tests). */
export const OUTSIDE_TILT_DEG = 20;
export const OUTSIDE_DIST = 100 * KPC;
export const BAND_LOOK = { l: 8, b: -2 };
export const OUTSIDE_EV = -10.5;
export const EDGE_EV = -9.5;
export const BAND_EV = -8.5;
/** Distance of the band viewpoint from the Sun (beyond the asteroid-belt far fade at 30000 AU). */
export const BAND_DIST = 0.2 * PC;

export function milkyWayBookmarks(): Bookmark[] {
  const t = OUTSIDE_TILT_DEG * DEG;
  const outside = vec3(-Math.sin(t) * OUTSIDE_DIST, 0, Math.cos(t) * OUTSIDE_DIST);
  const toCentre = (p: Vec3d) => {
    const d = Math.hypot(p.x, p.y, p.z);
    return vec3(-p.x / d, -p.y / d, -p.z / d);
  };
  const edge = vec3(0, 60 * KPC, 1.0 * KPC);
  const look = galacticToIcrs(galacticDir(BAND_LOOK.l, BAND_LOOK.b));
  const ngp = galacticToIcrs(vec3(0, 0, 1));
  return [
    {
      id: 'mw-outside-100kpc',
      title: 'The Milky Way from 100 kpc',
      frame: MW_FRAME,
      pos: outside,
      quat: qlookRotation(quat(), toCentre(outside), vec3(1, 0, 0)),
      fovY: 30 * DEG,
      ev: OUTSIDE_EV,
      lookTarget:
        'Our barred spiral seen nearly face-on from above the north Galactic pole: a bright yellow bar and bulge at the centre, the bar tilted 27 deg from the vertical Sun-centre line, bluish arms with pink HII knots and dark dust lanes winding outwards; a cyan "You are here" ring below the centre, 8.2 kpc out.',
    },
    {
      id: 'mw-edge-on',
      title: 'The Milky Way edge-on',
      frame: MW_FRAME,
      pos: edge,
      quat: qlookRotation(quat(), toCentre(edge), vec3(0, 0, 1)),
      fovY: 30 * DEG,
      ev: EDGE_EV,
      lookTarget:
        'The disc seen edge-on from 60 kpc, 1 deg above the plane: a thin bright disc with a boxy yellow bulge at the centre, split along its length by a dark, reddened dust lane.',
    },
    {
      id: 'mw-band-from-earth',
      title: 'The Milky Way band towards Sagittarius',
      frame: SSB_FRAME,
      pos: vec3(look.x * BAND_DIST, look.y * BAND_DIST, look.z * BAND_DIST),
      quat: qlookRotation(quat(), look, ngp),
      fovY: 80 * DEG,
      ev: BAND_EV,
      lookTarget:
        'The sky Earth sees towards the Galactic centre in Sagittarius (from 0.2 pc, Sun behind the camera), Galactic north up: the bright Milky Way band runs horizontally across the middle (star clouds of Sagittarius and Scutum, dark rift lanes), darker sky above and below; stars stay point-like.',
    },
  ];
}
