/**
 * Bookmarks (three-free). Each view is written in the craft's `<id>.fixed` frame (its body axes),
 * so the composition does not depend on where the craft happens to be; the camera re-anchors to
 * the craft's inertial frame on arrival and rides along. Every bookmark sets a 2026 date.
 */
import type { Bookmark, JD, Vec3d } from '../../core/contracts';
import { qlookRotation, quat, v3dot, v3len, v3normalize, v3sub, vec3 } from '../../core/math64';
import { solarIlluminance } from '../../core/photometry';
import { AU, DAY } from '../../core/units';
import { jdFromUtc } from './data';
import { fixedFrameId, type Craft } from './fleet';
import { LeoMotion, type Ephemeris } from './trajectory';

/** Fraction of direct sunlight the craft shader adds as fill light on every face (see craft.frag.glsl). */
export const FILL_LIGHT = 0.08;

/** EV100 that puts a white sunlit face (albedo 0.8) at `level` after pre-exposure, `rSun` m from the Sun. */
export function sunlitEv(rSun: number, level = 0.45, albedo = 0.8): number {
  const L = (albedo * solarIlluminance(rSun)) / Math.PI;
  return Math.round(2 * Math.log2(L / (1.2 * level))) / 2;
}

/**
 * The instant within one revolution after `jd0` when the Sun stands highest over a LEO craft: the
 * craft and the ground below it are in daylight (how high depends on the orbit's angle to the Sun).
 */
export function daylightJd(motion: LeoMotion, eph: Ephemeris, jd0: JD): JD {
  const r = vec3();
  const s = vec3();
  let best = jd0;
  let bestCos = -2;
  const steps = 240;
  for (let k = 0; k < steps; k++) {
    const jd = jd0 + ((k / steps) * motion.period) / DAY;
    v3normalize(r, motion.position(jd, r));
    v3normalize(s, v3sub(s, eph('sun', jd, s), eph('earth', jd, vec3())));
    const c = v3dot(r, s);
    if (c > bestCos) {
      bestCos = c;
      best = jd;
    }
  }
  return best;
}

/** EV100 for a face that only the fill light reaches (a craft seen from its shadowed side). */
export const fillEv = (rSun: number): number =>
  sunlitEv(rSun) + Math.round(2 * (Math.log2(FILL_LIGHT) + 1)) / 2;

interface View {
  /** Camera position in body axes, m. */
  pos: Vec3d;
  /** Point looked at, body axes, m. */
  target: Vec3d;
  up: Vec3d;
}

function bookmark(
  craft: Craft,
  id: string,
  title: string,
  jd: JD,
  ev: number,
  view: View,
  lookTarget: string,
  fovDeg = 60,
): Bookmark {
  return {
    id,
    title,
    frame: fixedFrameId(craft.row.id),
    pos: view.pos,
    quat: qlookRotation(quat(), v3sub(vec3(), view.target, view.pos), view.up),
    lookAt: craft.row.id,
    jd,
    ev,
    fovY: (fovDeg * Math.PI) / 180,
    lookTarget,
  };
}

export function buildBookmarks(fleet: readonly Craft[], eph: Ephemeris): Bookmark[] {
  const byId = new Map(fleet.map((c) => [c.row.id, c]));
  const out: Bookmark[] = [];
  const rSun = (c: Craft, jd: JD) =>
    v3len(v3sub(vec3(), c.motion.ssbPosition(jd, vec3()), eph('sun', jd, vec3())));

  const iss = byId.get('iss');
  if (iss && iss.motion instanceof LeoMotion) {
    // Body axes: +x flight direction, +y starboard, +z nadir. From behind, starboard and above, looking
    // 20° below the horizontal: the limb of Earth (20° below it from 420 km) runs behind the station.
    const jd = daylightJd(iss.motion, eph, iss.motion.epochJd);
    out.push(
      bookmark(
        iss,
        'iss-over-earth',
        'International Space Station over Earth',
        jd,
        14,
        { pos: vec3(-84, 62, -42), target: vec3(4, 0, -2), up: vec3(0, 0, -1) },
        'The whole station large in the frame, seen from behind and above: the truss with eight dark solar array wings and white radiators, the cluster of white modules below it, and behind it the sunlit blue-white limb of Earth against black space.',
      ),
    );
  }

  const hubble = byId.get('hubble');
  if (hubble && hubble.motion instanceof LeoMotion) {
    // Body axes: +x aperture, +z to the Sun. From the sunny side, a little ahead: silver tube, blue panels.
    const jd = daylightJd(hubble.motion, eph, hubble.motion.epochJd);
    out.push(
      bookmark(
        hubble,
        'hubble-over-earth', // not 'hubble': camera.goto resolves bookmark ids before body ids
        'Hubble Space Telescope over Earth',
        jd,
        14.5,
        { pos: vec3(13, -15, 17), target: vec3(0.5, 0, 0), up: vec3(1, 0, 0) },
        'Hubble filling the middle of the frame: a silver tube with its aperture door open at the top, two blue solar panels on either side, and sunlit Earth (ocean and cloud) filling the background.',
      ),
    );
  }

  const jwst = byId.get('jwst');
  if (jwst) {
    // Body axes: +x where the telescope looks, +z up from the sunshield (away from the Sun). From the
    // cold side, ahead and to one side. That side is in permanent shadow: exposed for the fill light.
    const jd = jdFromUtc('2026-06-30T00:00:00Z');
    out.push(
      bookmark(
        jwst,
        'jwst-l2',
        'James Webb Space Telescope at L2',
        jd,
        fillEv(1.01 * AU) - 1.5,
        { pos: vec3(16, -10, 8), target: vec3(0.5, 0, 2.4), up: vec3(0, 0, 1) },
        'Webb from its cold side: the gold honeycomb of 18 hexagonal mirror segments standing on the silver kite-shaped sunshield, the secondary mirror on its tripod in front; black space behind (this side never sees the Sun, so it is lit by fill light only).',
        56,
      ),
    );
  }

  const v1 = byId.get('voyager1');
  if (v1) {
    // Body axes: +z to Earth and, from 170 AU, to the Sun within a third of a degree. From behind and
    // to one side, looking past the craft at the Sun.
    const jd = jdFromUtc('2026-02-14T00:00:00Z');
    out.push(
      bookmark(
        v1,
        'voyager1-looking-back',
        'Voyager 1 looking back at the Sun',
        jd,
        sunlitEv(rSun(v1, jd)) - 1,
        { pos: vec3(2.1, 6.7, -1.9), target: vec3(-2.15, -6.77, 12.24), up: vec3(0.954, -0.3, 0) },
        'Voyager 1 on the left seen from behind: the back of the white dish, the dark ten-sided bus, the RTG boom, the long lattice magnetometer boom and two thin whip antennas; far to the right the Sun, 170 AU away: a brilliant star in a wide glare that hides Earth (the craft shows its shadowed side, so the view is exposed for the fill light).',
        75,
      ),
    );
  }

  const nh = byId.get('newhorizons');
  if (nh) {
    const jd = jdFromUtc('2026-07-14T00:00:00Z');
    out.push(
      bookmark(
        nh,
        'new-horizons',
        'New Horizons in the Kuiper belt',
        jd,
        sunlitEv(rSun(nh, jd)) - 1,
        { pos: vec3(2.4, -3.3, 2.9), target: vec3(0.5, 0, -0.2), up: vec3(0, 0, 1) },
        'New Horizons from its sunlit side: the white dish on a gold-foil triangular body, the dark finned RTG sticking out to one side; stars and the Milky Way behind.',
      ),
    );
  }
  return out;
}
