/**
 * Bookmarks of the oort bodies part (three-free). Positions are ICRF, Sun-centred unless noted; ecliptic
 * directions go through eclToIcrf.
 */
import type { Bookmark, Vec3d } from '../../../core/contracts';
import { qlookRotation, quat, v3cross, v3dot, v3len, v3normalize, v3scale, vec3 } from '../../../core/math64';
import { parseInstant } from '../../../core/time';
import { AU } from '../../../core/units';
import { eclToIcrf, icrfToEcl } from '../shared';
import type { StarMotion } from './flybys';
import type { OortObject } from './objects';

const DEG = Math.PI / 180;

export const SEDNOID_ORBITS_BOOKMARK = 'sednoid-orbits';
export const GLIESE_710_BOOKMARK = 'gliese-710-flyby';
export const SCHOLZ_BOOKMARK = 'scholz-star-flyby';
export const VISITORS_BOOKMARK = 'interstellar-visitors';
export const BB_ORBIT_BOOKMARK = 'bernardinelli-bernstein-orbit';
export const SEDNA_BOOKMARK = 'sedna';
/** Flyby star id -> its bookmark. */
export const FLYBY_BOOKMARKS: Record<string, string> = {
  'gliese-710': GLIESE_710_BOOKMARK,
  'scholz-star': SCHOLZ_BOOKMARK,
};

export const SEDNOID_JD = parseInstant('2026-01-01T00:00:00Z')!;

const sum = (terms: readonly [number, Vec3d][]): Vec3d => {
  const out = vec3();
  for (const [k, v] of terms) {
    out.x += k * v.x;
    out.y += k * v.y;
    out.z += k * v.z;
  }
  return out;
};

/** `up` made perpendicular to `fwd` (both unit). */
function orthoUp(fwd: Vec3d, up: Vec3d): Vec3d {
  const k = v3dot(up, fwd);
  return v3normalize(vec3(), vec3(up.x - k * fwd.x, up.y - k * fwd.y, up.z - k * fwd.z));
}

/** A camera at `pos` looking at `look` with screen-up near `up`. */
function aim(pos: Vec3d, look: Vec3d, up: Vec3d): { pos: Vec3d; quat: ReturnType<typeof quat> } {
  const fwd = v3normalize(vec3(), vec3(look.x - pos.x, look.y - pos.y, look.z - pos.z));
  return { pos, quat: qlookRotation(quat(), fwd, orthoUp(fwd, up)) };
}

const ECL_NORTH = (): Vec3d => eclToIcrf(vec3(), vec3(0, 0, 1));

/** From `dAu` above the ecliptic north pole looking down at the Sun, `inPlaneUp` (ICRF) pointing up. */
function polarView(dAu: number, inPlaneUp: Vec3d): { pos: Vec3d; quat: ReturnType<typeof quat> } {
  return aim(v3scale(vec3(), ECL_NORTH(), dAu * AU), vec3(), inPlaneUp);
}

export function sednoidOrbitsBookmark(lele: OortObject | undefined): Bookmark {
  // Leleakuhonua's long axis runs across the screen, where the frame is widest.
  let up = eclToIcrf(vec3(), vec3(0, 1, 0));
  if (lele) {
    const p = icrfToEcl(vec3(), lele.orbit.P);
    up = eclToIcrf(vec3(), v3normalize(vec3(), vec3(-p.y, p.x, 0)));
  }
  return {
    id: SEDNOID_ORBITS_BOOKMARK,
    title: 'The sednoids: orbits beyond the planets',
    frame: 'sun',
    ...polarView(2500, up),
    jd: SEDNOID_JD,
    ev: -2,
    fovY: 70 * DEG,
    lookTarget:
      'Looking down on the Solar System from 2,500 AU above the ecliptic: the Sun a bright point in the ' +
      'centre inside a small blue ring (the heliopause, 120 AU), a gold ring (550 AU) and a grey ring ' +
      '(1,000 AU), crossed by four red-orange ellipses of the sednoids; the longest, Leleakuhonua, ' +
      'reaches about 2,100 AU across the frame, with the names labelled.',
  };
}

/** Close-approach view of a passing star: from `dAu` off the plane of the Sun and the track. */
function flybyView(
  m: StarMotion,
  dAu: number,
  lookFrac: number,
): { pos: Vec3d; quat: ReturnType<typeof quat> } {
  const p = v3normalize(vec3(), m.closestPoint);
  const t = v3normalize(vec3(), m.v);
  const n = v3normalize(vec3(), v3cross(vec3(), p, t));
  const dir = v3normalize(
    vec3(),
    sum([
      [0.9, n],
      [-0.3, p],
      [0.25, t],
    ]),
  );
  const look = v3scale(vec3(), m.closestPoint, lookFrac);
  return aim(v3scale(vec3(), dir, dAu * AU), look, p);
}

export function gliese710Bookmark(m: StarMotion): Bookmark {
  return {
    id: GLIESE_710_BOOKMARK,
    title: 'Gliese 710 passes the Sun (in 1.3 million years)',
    frame: 'sun',
    ...flybyView(m, 40_000, 0.5),
    jd: m.closestJd,
    ev: -2,
    fovY: 55 * DEG,
    lookTarget:
      'The Solar System from 40,000 AU at the moment Gliese 710 passes closest, about 1.3 million years from ' +
      'now: the Sun a bright point below the centre inside a grey ring (10,000 AU), the orange star just ' +
      'outside that ring at the top end of a short radial tick, on a straight pale track running across ' +
      'the frame; larger rings (one light-year, 100,000 AU) arc around the edges.',
  };
}

export function scholzBookmark(m: StarMotion): Bookmark {
  return {
    id: SCHOLZ_BOOKMARK,
    title: "Scholz's Star grazes the Oort Cloud (80,000 years ago)",
    frame: 'sun',
    ...flybyView(m, 185_000, 0.2),
    jd: m.closestJd,
    ev: -2,
    fovY: 65 * DEG,
    lookTarget:
      "The outer Oort Cloud from 185,000 AU about 80,000 years ago, when Scholz's Star passed: the Sun a " +
      'point near the centre inside the rings at one light-year and 100,000 AU, the faint red dwarf a dim ' +
      'dot on a straight track crossing the frame between those two rings, a tick marking its closest point.',
  };
}

export function visitorsBookmark(): Bookmark {
  return {
    id: VISITORS_BOOKMARK,
    title: 'Interstellar visitors: three paths through the Solar System',
    frame: 'sun',
    ...polarView(650, eclToIcrf(vec3(), vec3(0, 1, 0))),
    jd: SEDNOID_JD,
    ev: -2,
    fovY: 85 * DEG,
    lookTarget:
      "From 650 AU above the ecliptic, looking down at the Sun: three violet hyperbolic paths ('Oumuamua, " +
      'Borisov and 3I/ATLAS) sweep in from across the frame, turn sharply near the Sun in the centre and ' +
      'leave in other directions; a blue ring (heliopause, 120 AU) and a gold ring (550 AU) around the Sun.',
  };
}

export function bbOrbitBookmark(bb: OortObject): Bookmark {
  const { orbit } = bb;
  const a = orbit.a;
  const centre = v3scale(vec3(), orbit.P, -a * orbit.e);
  const pos = sum([
    [1, centre],
    [28_000 * AU, orbit.W],
  ]);
  return {
    id: BB_ORBIT_BOOKMARK,
    title: "Comet Bernardinelli-Bernstein's 40,000 AU orbit",
    frame: 'sun',
    ...aim(pos, centre, v3cross(vec3(), orbit.W, orbit.P)),
    jd: SEDNOID_JD,
    ev: -2,
    fovY: 50 * DEG,
    lookTarget:
      'Face-on view of the orbit of comet Bernardinelli-Bernstein: a very long, thin pale-cyan ellipse ' +
      'stretching across the frame from the Sun (a bright point near one end) to its aphelion about ' +
      '40,000 AU away, with grey distance rings (10,000 AU, one light-year) around the Sun.',
  };
}

export function sednaBookmark(sedna: OortObject): Bookmark {
  const jd = SEDNOID_JD;
  const p = sedna.orbit.stateAt(jd, vec3());
  const sun = v3scale(vec3(), v3normalize(vec3(), p), -1);
  const side = v3normalize(vec3(), v3cross(vec3(), sedna.orbit.W, sun));
  const dir = sum([
    [Math.cos(50 * DEG), sun],
    [Math.sin(50 * DEG), side],
  ]);
  const pos = v3scale(vec3(), dir, 3.2 * sedna.body.radius);
  return {
    id: SEDNA_BOOKMARK,
    title: `Sedna, ${Math.round(v3len(p) / AU)} AU from the Sun`,
    frame: sedna.body.frame,
    ...aim(pos, vec3(), sedna.orbit.W),
    lookAt: sedna.body.id,
    jd,
    ev: 3,
    fovY: 40 * DEG,
    lookTarget:
      'Sedna from 1,100 km above its surface: a reddish, softly mottled sphere filling most of the frame, ' +
      'lit by the distant Sun from one side (a gibbous phase), its night side black against the stars.',
  };
}

export function buildBookmarks(
  objects: ReadonlyMap<string, OortObject>,
  motions: ReadonlyMap<string, StarMotion>,
): Bookmark[] {
  const out: Bookmark[] = [sednoidOrbitsBookmark(objects.get('leleakuhonua'))];
  const g = motions.get('gliese-710');
  if (g) out.push(gliese710Bookmark(g));
  const s = motions.get('scholz-star');
  if (s) out.push(scholzBookmark(s));
  out.push(visitorsBookmark());
  const bb = objects.get('bernardinelli-bernstein');
  if (bb) out.push(bbOrbitBookmark(bb));
  const sedna = objects.get('sedna');
  if (sedna) out.push(sednaBookmark(sedna));
  return out;
}
