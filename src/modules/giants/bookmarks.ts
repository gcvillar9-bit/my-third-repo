/**
 * P3-A bookmarks, computed from the live frame tree at their fixed instants so the camera is
 * exactly where the geometry needs it (inertial planet frames, ICRF axes, pole up on screen).
 */
import type { Bookmark, FrameTree, Vec3d } from '../../core/contracts';
import {
  qfromAxisAngle,
  qlookRotation,
  qrotate,
  quat,
  v3cross,
  v3dot,
  v3len,
  v3normalize,
  v3scale,
  v3sub,
  vec3,
} from '../../core/math64';
import { parseInstant } from '../../core/time';
import { fixedFrameId } from '../solar-system/public';

const DEG = Math.PI / 180;
/** Cassini's "Day the Earth Smiled" mosaic, 2013-07-19 ~21:27 UTC (NASA/JPL PIA17172). */
export const SATURN_BACKLIT_UTC = '2013-07-19T21:27:00Z';
/**
 * An Io shadow transit near the middle of Jupiter's disk, found with astronomy-engine
 * JupiterMoons (verified in tests/unit/giants): the shadow passes 0.14 R_J from the sub-solar point.
 */
export const IO_SHADOW_UTC = '2026-01-29T02:35:00Z';
export const URANUS_RINGS_UTC = '2026-01-01T00:00:00Z';
/** Radius at the centre of the uranus-rings view, km (between ring 6 and epsilon). */
export const URANUS_ANSA_KM = 47_500;

const unit = (v: Vec3d): Vec3d => v3normalize(vec3(), v);
const pole = (frames: FrameTree, body: string, jd: number): Vec3d =>
  frames.toWorldDir(fixedFrameId(body), vec3(0, 0, 1), jd, vec3());

/** First intersection of the ray o + t d (t > 0, d unit) with a sphere of radius r at the origin. */
export function raySphere(o: Vec3d, d: Vec3d, r: number): number | null {
  const b = v3dot(o, d);
  const c = v3dot(o, o) - r * r;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? t : null;
}

/** Centre of Io's shadow on Jupiter's sphere at `jd`, jupiter frame (ICRF axes), m; null if none. */
export function ioShadowPoint(frames: FrameTree, jd: number, radius: number): Vec3d | null {
  const s = unit(frames.relative('jupiter', 'sun', jd, vec3()));
  const io = frames.relative('jupiter', 'io', jd, vec3());
  const anti = v3scale(vec3(), s, -1);
  const t = raySphere(io, anti, radius);
  return t === null ? null : v3sub(vec3(), io, v3scale(vec3(), s, t));
}

export function buildGiantBookmarks(frames: FrameTree, radius: (id: string) => number): Bookmark[] {
  const out: Bookmark[] = [];

  // Saturn backlit: camera on the anti-Sun axis inside Saturn's umbra, looking back at the Sun.
  const jdS = parseInstant(SATURN_BACKLIT_UTC)!;
  const sS = unit(frames.relative('saturn', 'sun', jdS, vec3()));
  out.push({
    id: 'saturn-backlit-2013-07-19',
    title: 'Saturn backlit (2013-07-19)',
    frame: 'saturn',
    pos: v3scale(vec3(), sS, -6e8),
    quat: qlookRotation(quat(), sS, pole(frames, 'saturn', jdS)),
    lookAt: 'saturn',
    jd: jdS,
    ev: 5,
    fovY: 30 * DEG,
    lookTarget:
      "Cassini's 'Day the Earth Smiled' geometry: Saturn's night side eclipsing the Sun at the centre, the unlit ring face glowing by forward scattering on both sides, dark where Saturn's shadow crosses the rings.",
  });

  // Io's shadow on Jupiter: camera 25 deg off the Sun direction, aimed at the shadow centre.
  const jdJ = parseInstant(IO_SHADOW_UTC)!;
  const rJ = radius('jupiter');
  const shadow = ioShadowPoint(frames, jdJ, rJ);
  if (shadow) {
    const sJ = unit(frames.relative('jupiter', 'sun', jdJ, vec3()));
    const nJ = pole(frames, 'jupiter', jdJ);
    const c = qrotate(vec3(), qfromAxisAngle(quat(), nJ, 25 * DEG), sJ);
    const cam = v3sub(vec3(), shadow, v3scale(vec3(), c, -3 * rJ));
    out.push({
      id: 'jupiter-io-shadow',
      title: "Io's shadow on Jupiter",
      frame: 'jupiter',
      pos: cam,
      quat: qlookRotation(quat(), v3scale(vec3(), c, -1), nJ),
      lookAt: 'jupiter',
      jd: jdJ,
      ev: 11,
      fovY: 20 * DEG,
      lookTarget:
        "Io's umbra (about 3,000 km across) as a black dot at the screen centre on Jupiter's lit cloud bands.",
    });
  }

  // Uranus: lit ring face 30 deg off the Sun direction, aimed at the east ansa so the bright
  // globe stays just off-screen (its bloom would swamp the dark rings), pole up.
  const jdU = parseInstant(URANUS_RINGS_UTC)!;
  const sU = unit(frames.relative('uranus', 'sun', jdU, vec3()));
  const nU = pole(frames, 'uranus', jdU);
  const side = v3cross(vec3(), nU, sU);
  const axis = v3len(side) > 1e-6 ? unit(side) : vec3(0, 0, 1);
  const cU = qrotate(vec3(), qfromAxisAngle(quat(), axis, 30 * DEG), sU);
  const camU = v3scale(vec3(), cU, 8 * radius('uranus'));
  const ansa = v3scale(vec3(), unit(v3cross(vec3(), nU, cU)), URANUS_ANSA_KM * 1e3);
  out.push({
    id: 'uranus-rings',
    title: "Uranus's rings",
    frame: 'uranus',
    pos: camU,
    quat: qlookRotation(quat(), v3sub(vec3(), ansa, camU), nU),
    lookAt: 'uranus',
    jd: jdU,
    ev: 0,
    fovY: 6 * DEG,
    lookTarget:
      "The east ansa of Uranus's rings as near-vertical arcs, the globe just off-screen to the left: the epsilon ring (outermost, right of centre) is the brightest, the inner rings 6, 5, 4, alpha, beta, eta, gamma, delta are faint hairlines.",
  });
  return out;
}
