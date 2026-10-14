/**
 * Constellation bookmarks (P4-C): Orion's lines from Earth, Orion from 200 ly (the figure falls apart),
 * and the Big Dipper 100 kyr from now (proper motion deforms it).
 */
import { SSB_FRAME, type Bookmark } from '../../core/contracts';
import { qlookRotation, quat, vec3 } from '../../core/math64';
import { DAY, JD_J2000, JULIAN_YEAR, LY, PC } from '../../core/units';
import type { StarCatalog } from '../stars/public';
import {
  figureBookmarkFromEarth,
  figureCentre,
  figureStars,
  type ConstellationsFile,
} from './constellations';

/** Big Dipper asterism (HIP): Dubhe, Merak, Phecda, Megrez, Alioth, Mizar, Alkaid. */
export const BIG_DIPPER_HIP = [54061, 53910, 58001, 59774, 62956, 65378, 67301];
export const BIG_DIPPER_JD = JD_J2000 + (1e5 * JULIAN_YEAR) / DAY;
/** Camera offset of 'orion-from-200ly' from the Sun, pc (perpendicular to the Orion direction). */
export const ORION_OFFSET_PC = (200 * LY) / PC;
/** Bookmarks that switch the constellation lines on when opened as the initial view. */
export { LINE_BOOKMARKS } from './public';

const NORTH = vec3(0, 0, 1);

export function constellationBookmarks(cat: StarCatalog, file: ConstellationsFile): Bookmark[] {
  const out: Bookmark[] = [];
  const ori = file.figures.find((f) => f.id === 'Ori');
  if (ori) {
    out.push(
      figureBookmarkFromEarth(cat, ori, {
        id: 'orion-lines-from-earth',
        title: 'Orion: constellation lines from Earth',
        fovDeg: 50,
        lookTarget:
          "Orion's stick figure in faint blue lines, north up: Betelgeuse upper left, Rigel lower right, the belt between them.",
      }),
    );
    // 200 ly sideways (perpendicular to the line of sight and to north): Bellatrix (77 pc) and the belt
    // (~380 pc) shift by very different angles, so the figure is broken.
    const fromSun = vec3();
    figureCentre(cat, figureStars(ori), vec3(), 0, fromSun);
    const side = vec3(
      fromSun.y * NORTH.z - fromSun.z * NORTH.y,
      fromSun.z * NORTH.x - fromSun.x * NORTH.z,
      0,
    );
    const sl = Math.hypot(side.x, side.y, side.z);
    const cam = vec3((side.x / sl) * ORION_OFFSET_PC, (side.y / sl) * ORION_OFFSET_PC, 0);
    const look = vec3();
    figureCentre(cat, figureStars(ori), cam, 0, look);
    out.push({
      id: 'orion-from-200ly',
      title: 'Orion from 200 light-years away',
      frame: SSB_FRAME,
      pos: vec3(cam.x * PC, cam.y * PC, cam.z * PC),
      quat: qlookRotation(quat(), look, NORTH),
      fovY: (70 * Math.PI) / 180,
      ev: -4,
      lookTarget:
        "Orion's lines seen from 200 ly to the side of the Sun: the hourglass is sheared apart because its stars lie between 77 and 400 pc from us.",
    });
  }
  const dipper = BIG_DIPPER_HIP.map((h) => cat.findByHip(h)).filter((i) => i >= 0);
  if (dipper.length === BIG_DIPPER_HIP.length) {
    const years = 1e5;
    const dir = vec3();
    figureCentre(cat, dipper, vec3(), years, dir);
    out.push({
      id: 'big-dipper-100kyr',
      title: 'The Big Dipper 100 000 years from now',
      frame: SSB_FRAME,
      pos: vec3(dir.x * 1.5e11, dir.y * 1.5e11, dir.z * 1.5e11),
      quat: qlookRotation(quat(), dir, NORTH),
      jd: BIG_DIPPER_JD,
      fovY: (50 * Math.PI) / 180,
      ev: -4,
      lookTarget:
        'Ursa Major lines at J2000 + 100 kyr: Dubhe and Alkaid have drifted away from the five co-moving middle stars, so the dipper is bent out of shape.',
    });
  }
  return out;
}
