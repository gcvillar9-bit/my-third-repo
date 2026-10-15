/**
 * Orion Nebula bookmarks (EV -5, the dark-adapted night sky, unless noted):
 * - 'm42-telescope': from Earth through a 2.5° field, north up (the photo the volume reproduces);
 * - 'm42-from-20ly': 20 light-years from θ¹ Ori C on the Earth side, 20° off our line of sight;
 * - 'trapezium-inside': inside the nebula just in front of the Trapezium, the glowing bowl behind it;
 * - 'm42-astrophoto': a closer oblique view that switches the "Nebula style" setting to Astrophoto on arrival.
 */
import { SSB_FRAME, type Bookmark, type Vec3d } from '../../core/contracts';
import { qlookRotation, quat, vec3 } from '../../core/math64';
import { AU, LY, PC } from '../../core/units';
import { NEBULA_FRAME } from './frame';
import { D_PC, MODEL } from './model';
import { unitIcrs } from './trapezium';

export const TELESCOPE_ID = 'm42-telescope';
export const FROM_20LY_ID = 'm42-from-20ly';
export const INSIDE_ID = 'trapezium-inside';
export const ASTROPHOTO_ID = 'm42-astrophoto';
export const M43_VIEW_ID = 'm43-close';
export const NEBULA_EV = -5;
/** Exposure of 'trapezium-inside' (see nebulaBookmarks). */
export const INSIDE_EV = -1.5;
/**
 * Exposure of 'm42-telescope': the dark-adapted night sky like the others. A longer exposure (EV -6 to -7) would
 * show the faint wings (μ ≈ 21.6 at 8-10') further out, but it lifts the Milky Way panorama around Orion (stars
 * module, ~20.4 mag/arcsec² there after its 8x display boost) into a blue-grey sky that still outshines the wings,
 * and merges the Orion Bar into the blown core; at EV -5 the core keeps its structure on a dark sky.
 */
export const TELESCOPE_EV = NEBULA_EV;
/** Bookmarks that switch the Astrophoto style on when reached. */
export const STYLE_BOOKMARKS: readonly string[] = [ASTROPHOTO_ID];

const DEG = Math.PI / 180;
const NORTH_ICRS = vec3(0, 0, 1);
/** Local north (the frame's +y). */
const NORTH = vec3(0, 1, 0);

/** Telescope view centre: between the Huygens region and M43. */
export const TELESCOPE_CENTRE = { raDeg: 83.83, decDeg: -5.35 };

const m = (v: Vec3d, s: number) => vec3(v.x * s, v.y * s, v.z * s);
const sub = (a: Vec3d, b: Vec3d) => vec3(a.x - b.x, a.y - b.y, a.z - b.z);
const norm = (a: Vec3d) => m(a, 1 / Math.hypot(a.x, a.y, a.z));

/** A bookmark in the nebula frame: camera at `pos` (local pc) looking at `look` (local pc), north up. */
function localView(
  id: string,
  title: string,
  pos: Vec3d,
  look: Vec3d,
  fovDeg: number,
  lookTarget: string,
): Bookmark {
  return {
    id,
    title,
    frame: NEBULA_FRAME,
    pos: m(pos, PC),
    quat: qlookRotation(quat(), norm(sub(look, pos)), NORTH),
    fovY: fovDeg * DEG,
    ev: NEBULA_EV,
    lookTarget,
  };
}

/** Camera position (local pc) at `dist` pc from `target` along a direction `tiltDeg` off the Earth line, towards `azDeg` (0 = east). */
export function offAxis(target: Vec3d, dist: number, tiltDeg: number, azDeg: number): Vec3d {
  const t = tiltDeg * DEG;
  const a = azDeg * DEG;
  return vec3(
    target.x + dist * Math.sin(t) * Math.cos(a),
    target.y + dist * Math.sin(t) * Math.sin(a),
    target.z - dist * Math.cos(t),
  );
}

export function nebulaBookmarks(): Bookmark[] {
  const c = unitIcrs(TELESCOPE_CENTRE.raDeg, TELESCOPE_CENTRE.decDeg);
  const core = vec3(0, 0.25, 0);
  const ly20 = (20 * LY) / PC;
  return [
    {
      id: TELESCOPE_ID,
      title: 'The Orion Nebula through a telescope',
      frame: SSB_FRAME,
      pos: m(c, AU),
      quat: qlookRotation(quat(), c, NORTH_ICRS),
      fovY: 2.5 * DEG,
      ev: TELESCOPE_EV,
      lookTarget:
        'M42 from Earth in a 2.5° field, north up: the bright Huygens region just below centre with the dark Dark Bay ' +
        'notch to its upper left, M43 as a small round glow just above it, the red-pink wings spreading to the ' +
        'lower right, the four Trapezium stars in the core.',
    },
    localView(
      FROM_20LY_ID,
      'The Orion Nebula from 20 light-years',
      offAxis(core, ly20, 20, 200),
      core,
      55,
      'The nebula from 20 ly, 20° off the Earth line: a glowing bowl opening towards us, brightest around the ' +
        'Trapezium, M43 as a separate ball to the upper left, dark dust lanes across the front.',
    ),
    {
      ...localView(
        INSIDE_ID,
        'Inside the Orion Nebula, at the Trapezium',
        vec3(0.05, -0.04, -0.32),
        vec3(-0.01, 0.0, 0.2),
        70,
        'Inside the nebula 0.3 pc in front of the Trapezium: the four θ¹ Ori stars in a small trapezoid against the ' +
          'glowing ionization front that fills the view behind them, brightest around the stars.',
      ),
      // Inside the Huygens region the whole sky glows at ~0.05 cd/m² (four stops above the night-sky EV -5); this is
      // the exposure the eye adaptation settles at there (LIT_FLOOR is exceeded over most of the frame).
      ev: INSIDE_EV,
    },
    localView(
      ASTROPHOTO_ID,
      'The Orion Nebula, astrophoto style',
      // Nearly on the Earth line: the Veil 2 pc in front shifts its dust lanes by 2 pc · tan(tilt) against the
      // emission (0.1 pc at 3°), so the Dark Bay and the lane between M42 and M43 stay where the photos show them.
      offAxis(core, 3.2, 3, 330),
      core,
      65,
      'Astrophoto style from 10 ly, nearly along our line of sight: a teal oxygen core around the Trapezium, ' +
        'magenta-red hydrogen wings, the Dark Bay notch and M43 above, stretched faint outskirts.',
    ),
    localView(
      M43_VIEW_ID,
      "De Mairan's Nebula (M43)",
      offAxis(vec3(MODEL.m43.x, MODEL.m43.y, 0), 2.2, 15, 120),
      vec3(MODEL.m43.x, MODEL.m43.y, 0),
      45,
      'M43, the round H II region around NU Ori, with the edge of the Orion Nebula below it.',
    ),
  ];
}

/** Distance (pc) of the m42-telescope camera from the nebula: Earth's. */
export const TELESCOPE_DISTANCE_PC = D_PC;
