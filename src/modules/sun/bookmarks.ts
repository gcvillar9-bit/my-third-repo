/** 'sun-closeup' (three-free): 21,000 km above the photosphere, looking 50 deg off nadir. */
import type { Bookmark } from '../../core/contracts';
import { qlookRotation, quat, vec3 } from '../../core/math64';

const DEG = Math.PI / 180;
export const SUN_CLOSEUP_ID = 'sun-closeup';
/** Camera distance from the Sun's centre, solar radii. */
export const CLOSEUP_DISTANCE_R = 1.03;
/** Look direction, degrees from nadir (the limb sits 76 deg from nadir at 1.03 R). */
export const CLOSEUP_OFF_NADIR_DEG = 50;
/** Test exposure: obliquely viewed photosphere near 0.3 after pre-exposure. */
export const CLOSEUP_EV = 32;

export function buildSunCloseup(radius: number): Bookmark {
  const a = CLOSEUP_OFF_NADIR_DEG * DEG;
  const fwd = vec3(-Math.cos(a), 0, Math.sin(a));
  return {
    id: SUN_CLOSEUP_ID,
    title: 'Sun: granulation close-up',
    frame: 'sun',
    pos: vec3(CLOSEUP_DISTANCE_R * radius, 0, 0),
    quat: qlookRotation(quat(), fwd, vec3(1, 0, 0)),
    ev: CLOSEUP_EV,
    fovY: 60 * DEG,
    lookTarget:
      'Low over the photosphere: the whole frame is granulated orange-white surface (bright cells about ' +
      '1,000 km across with dark lanes, largest at the bottom), darkening towards the limb; black space above ' +
      'the limb along the top edge.',
  };
}

// --- Activity bookmarks (built at init from the simulated activity at a fixed date) -----------------

export const SUNSPOT_BOOKMARK_ID = 'sun-sunspots';
export const HALPHA_BOOKMARK_ID = 'sun-halpha-prominences';
/** Dates near the cycle-25 maximum (TT JDs are derived with parseInstant at init). */
export const SUNSPOT_DATE = '2024-10-10T12:00:00Z';
export const HALPHA_DATE = '2024-11-20T12:00:00Z';

type V3 = [number, number, number];
const norm = (v: V3): V3 => {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Straight down onto the biggest simulated group at `jd`, 130 Mm up. `toSun` maps a body-fixed unit
 * vector into 'sun' frame axes at `jd` (solar north is up).
 */
export function buildSunspotBookmark(
  radius: number,
  jd: number,
  centreFixed: V3,
  leadFixed: V3,
  toSun: (v: V3) => V3,
): Bookmark {
  const c = toSun(norm([0, 1, 2].map((k) => 0.7 * centreFixed[k] + 0.3 * leadFixed[k]) as V3));
  const pole = toSun([0, 0, 1]);
  const pos = c.map((v) => v * (radius + 130e6)) as V3;
  const fwd: V3 = [-c[0], -c[1], -c[2]];
  const up = norm(cross(cross(fwd, pole), fwd));
  return {
    id: SUNSPOT_BOOKMARK_ID,
    title: 'Sun: sunspot group close-up',
    frame: 'sun',
    pos: vec3(...pos),
    quat: qlookRotation(quat(), vec3(...fwd), vec3(...up)),
    jd,
    ev: CLOSEUP_EV + 0.5,
    fovY: 45 * DEG,
    lookTarget:
      'Looking straight down from 130,000 km on a big simulated sunspot group near the 2024 maximum: dark ' +
      'umbrae inside lighter filamentary penumbrae, a leading and a following spot, surrounded by granulation.',
  };
}

/**
 * Limb view of the tallest simulated quiescent prominence at `jd` (anchor `anchor` in 'sun' axes), seen
 * from 3.2 R so the anchor sits exactly on the limb; the disk fills the bottom of the frame.
 */
export function buildHalphaBookmark(radius: number, jd: number, anchor: V3, pole: V3): Bookmark {
  const D = 3.2;
  const a = norm(anchor);
  let b = cross(a, pole);
  if (Math.hypot(...b) < 1e-3) b = cross(a, [1, 0, 0]);
  b = norm(b);
  const ca = 1 / D;
  const sa = Math.sqrt(1 - ca * ca);
  const e: V3 = [0, 1, 2].map((k) => ca * a[k] + sa * b[k]) as V3;
  const pos = e.map((v) => v * D * radius) as V3;
  const target = a.map((v) => v * radius * 1.07) as V3;
  const fwd = norm([0, 1, 2].map((k) => target[k] - pos[k]) as V3);
  const up = norm([0, 1, 2].map((k) => a[k] - dot(a, fwd) * fwd[k]) as V3);
  return {
    id: HALPHA_BOOKMARK_ID,
    title: 'Sun: prominences in H-alpha',
    frame: 'sun',
    pos: vec3(...pos),
    quat: qlookRotation(quat(), vec3(...fwd), vec3(...up)),
    jd,
    ev: CLOSEUP_EV,
    fovY: 10 * DEG,
    lookTarget:
      'Through a narrowband H-alpha filter (switched on): the deep red limb of the Sun across the bottom with ' +
      'a mottled chromosphere, and a simulated prominence rising from the limb into black space above.',
  };
}
