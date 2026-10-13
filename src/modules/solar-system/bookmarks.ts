/**
 * Bookmarks (three-free). Body views live in `<id>.sunview` frames (+x towards the Sun, +z
 * towards ecliptic north) so the lighting of a bookmark does not depend on the date; the camera
 * re-anchors to the body frame on arrival. Exposure (`ev`, tests only) follows the body's
 * sunlit radiance at the init instant.
 */
import type { Bookmark, Quatd, Vec3d } from '../../core/contracts';
import {
  qlookRotation,
  qrotate,
  qrotateInv,
  quat,
  v3cross,
  v3dot,
  v3len,
  v3normalize,
  v3scale,
  vec3,
} from '../../core/math64';
import { SUN_DISK_LUMINANCE, solarIlluminance } from '../../core/photometry';
import { AU } from '../../core/units';
import { BOOKMARKED_BODIES, equatorialRadius, type BodyRow } from './data';
import type { SolarEphemeris } from './ephemeris';
import { sunviewFrameId, sunviewQuat } from './frames';
import { ECLIPTIC_TO_ICRF, mat3Apply } from './kepler';

const DEG = Math.PI / 180;
const UP: Vec3d = vec3(0, 0, 1);

/** Direction in sun-view axes: azimuth from the Sun direction towards +y, elevation towards +z. */
export function viewDir(azDeg: number, elDeg: number): Vec3d {
  const az = azDeg * DEG;
  const el = elDeg * DEG;
  return vec3(Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el));
}

/** Camera quaternion looking from `pos` at the origin with `up`. */
export function lookAtOrigin(pos: Vec3d, up: Vec3d = UP): Quatd {
  return qlookRotation(quat(), v3scale(vec3(), pos, -1), up);
}

/** EV100 that puts the body's brightest sunlit radiance at about 0.35 after pre-exposure. */
export function bodyEv(row: BodyRow, rSun: number): number {
  const L =
    row.id === 'sun'
      ? SUN_DISK_LUMINANCE
      : (solarIlluminance(rSun) * 1.2 * Math.min(1, row.albedoGeometric ?? 0.3)) / Math.PI;
  return Math.round(2 * Math.log2(L / (1.2 * 0.35))) / 2;
}

interface ViewSpec {
  az: number;
  el: number;
  /** Distance from the centre, body radii. */
  dist: number;
}

const DEFAULT_VIEW: ViewSpec = { az: 50, el: 15, dist: 4 };
const VIEWS: Record<string, ViewSpec> = {
  sun: { az: 0, el: 20, dist: 5 },
};

function bodyBookmark(row: BodyRow, rSun: number, spec: ViewSpec, id = row.id, title = row.name): Bookmark {
  const pos = v3scale(vec3(), viewDir(spec.az, spec.el), spec.dist * equatorialRadius(row));
  return {
    id,
    title,
    frame: sunviewFrameId(row.id),
    pos,
    quat: lookAtOrigin(pos),
    lookAt: row.id,
    ev: bodyEv(row, rSun),
  };
}

/**
 * View over a body's equator (ring plane) from its sunlit side: azimuth from the Sun's direction
 * projected on the equator, elevation above it. Returns [position (sun-view axes), up = north].
 */
export function equatorView(eph: SolarEphemeris, id: string, jd: number, spec: ViewSpec): [Vec3d, Vec3d] {
  const pole = qrotate(vec3(), eph.orientationAt(id, jd, quat()), vec3(0, 0, 1));
  const p = qrotateInv(vec3(), sunviewQuat(eph, id, jd, quat()), pole);
  const side = p.x >= 0 ? 1 : -1;
  const k = v3dot(vec3(1, 0, 0), p);
  const hx = v3normalize(vec3(), vec3(1 - k * p.x, -k * p.y, -k * p.z));
  const hy = v3cross(vec3(), p, hx);
  const [az, el] = [spec.az * DEG, spec.el * DEG];
  const d = vec3(
    Math.cos(el) * (Math.cos(az) * hx.x + Math.sin(az) * hy.x) + Math.sin(el) * side * p.x,
    Math.cos(el) * (Math.cos(az) * hx.y + Math.sin(az) * hy.y) + Math.sin(el) * side * p.y,
    Math.cos(el) * (Math.cos(az) * hx.z + Math.sin(az) * hy.z) + Math.sin(el) * side * p.z,
  );
  const row = eph.row(id)!;
  return [v3scale(d, d, spec.dist * equatorialRadius(row)), p];
}

/** Body ids that need a `.sunview` frame. */
export const SUNVIEW_BODIES: readonly string[] = BOOKMARKED_BODIES;

export function buildBookmarks(eph: SolarEphemeris, jd: number): Bookmark[] {
  const out: Bookmark[] = [];
  const rSun = (id: string) => (id === 'sun' ? AU : v3len(eph.relative('sun', id, jd, vec3())));
  for (const id of BOOKMARKED_BODIES) {
    const row = eph.row(id);
    if (!row) continue;
    const bm = bodyBookmark(row, rSun(id), VIEWS[id] ?? DEFAULT_VIEW);
    if (id === 'saturn') {
      const [pos, up] = equatorView(eph, id, jd, { az: 35, el: 25, dist: 7 });
      bm.pos = pos;
      bm.quat = lookAtOrigin(pos, up);
    }
    if (id === 'saturn')
      bm.lookTarget =
        'Saturn centred, north up, lit from the front-left, rings opened about 25 deg on their sunlit face (grazing sunlight in 2026, so the rings are dimmer than the globe), black space.';
    if (id === 'titan')
      bm.lookTarget = 'Titan as a featureless orange-tan globe filling the centre, lit from the front-left.';
    out.push(bm);
  }

  const earth = eph.row('earth');
  if (earth) {
    // Over the dawn terminator: +x is the Sun, Earth spins towards +y, so dawn is at -y.
    const pos = v3scale(vec3(), viewDir(-80, 20), 3 * equatorialRadius(earth));
    out.push({
      id: 'earth-now',
      title: 'Earth now: dawn terminator',
      frame: sunviewFrameId('earth'),
      pos,
      quat: lookAtOrigin(pos),
      lookAt: 'earth',
      jd: 'now',
      ev: 15,
      lookTarget:
        'Earth centred, about 60% of the frame high: sunlit day side with clouds on the right, the dawn terminator near the middle, the night side dark on the left.',
    });
  }

  const jupiter = eph.row('jupiter');
  if (jupiter) {
    const pos = v3scale(vec3(), viewDir(20, 50), 60 * equatorialRadius(jupiter));
    out.push({
      id: 'jupiter-moons',
      title: 'Jupiter and the Galilean moons',
      frame: sunviewFrameId('jupiter'),
      pos,
      quat: lookAtOrigin(pos),
      lookAt: 'jupiter',
      ev: 7,
      lookTarget:
        'Jupiter as a small overexposed disk at the centre (exposed for the moons), the Galilean moons as faint points on grey orbit ellipses (Amalthea innermost, Callisto outermost).',
    });
  }

  if (eph.has('sun')) {
    // 70 AU from the Sun, 50 deg above the ecliptic: the whole planetary system in view.
    const ecl = viewDir(-90, 50);
    const pos = v3scale(vec3(), mat3Apply(ECLIPTIC_TO_ICRF, ecl, vec3()), 70 * AU);
    const up = mat3Apply(ECLIPTIC_TO_ICRF, vec3(0, 0, 1), vec3());
    out.push({
      id: 'solar-system-overview',
      title: 'Solar System overview',
      frame: 'sun',
      pos,
      quat: lookAtOrigin(pos, up),
      lookAt: 'sun',
      ev: 10,
      lookTarget:
        'The Sun as a brilliant point at the centre, blue planetary orbit ellipses (Jupiter to Neptune clearly) and brown dwarf-planet orbits on black.',
    });
  }
  return out;
}
