/** 'sun-closeup' (three-free): 21,000 km above the photosphere, looking 50 deg off nadir. */
import type { Bookmark } from '../../core/contracts';
import { qlookRotation, quat, vec3 } from '../../core/math64';
import { activeGroups, filamentPoints, filaments, prominences } from './activity';

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
export const HALPHA_DATE = '2024-10-19T12:00:00Z';

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
 * Straight down onto the biggest simulated group at `jd`, centred between its leading spot `leadFixed` and
 * following spot `followFixed` (body-fixed unit vectors) with the group axis horizontal and solar north
 * towards the top. The altitude frames the whole bipolar group (`spanM`, metres, spots included), within
 * 90-160 Mm. `toSun` maps a body-fixed unit vector into 'sun' frame axes at `jd`.
 */
export function buildSunspotBookmark(
  radius: number,
  jd: number,
  leadFixed: V3,
  followFixed: V3,
  spanM: number,
  toSun: (v: V3) => V3,
): Bookmark {
  const mid = norm([0, 1, 2].map((k) => leadFixed[k] + followFixed[k]) as V3);
  const axis = [0, 1, 2].map((k) => leadFixed[k] - followFixed[k]) as V3;
  let upF = cross(mid, Math.hypot(...axis) > 1e-9 ? norm(axis) : [0, 0, 1]);
  if (Math.hypot(...upF) < 1e-9) upF = cross(mid, [1, 0, 0]);
  upF = norm(upF);
  if (upF[2] < 0) upF = upF.map((v) => -v) as V3;
  const c = toSun(mid);
  const fwd: V3 = [-c[0], -c[1], -c[2]];
  const u = toSun(upF);
  const up = norm(cross(cross(fwd, u), fwd));
  const fov = 45 * DEG;
  const width = 2 * Math.tan(fov / 2) * (16 / 9);
  const alt = Math.min(160e6, Math.max(90e6, (1.2 * spanM) / width));
  const pos = c.map((v) => v * (radius + alt)) as V3;
  return {
    id: SUNSPOT_BOOKMARK_ID,
    title: 'Sun: sunspot group close-up',
    frame: 'sun',
    pos: vec3(...pos),
    quat: qlookRotation(quat(), vec3(...fwd), vec3(...up)),
    jd,
    ev: CLOSEUP_EV - 0.3,
    fovY: fov,
    lookTarget:
      'Looking straight down on the biggest simulated sunspot group near the 2024 maximum, a bipolar active ' +
      'region across the frame: a big leading spot and a fragmented following cluster (near-black umbrae in ' +
      'finely filamented penumbrae), small spots and pores between them, granulation all around.',
  };
}

/** H-alpha limb view: camera distance (radii), vertical field of view, aim point height (radii). */
const HA_D = 3.2;
const HA_FOV_DEG = 14;
const HA_AIM_R = 0.95;

/**
 * Camera of the H-alpha limb view for a prominence anchored at `anchor` (any axes; `pole` is solar north
 * in the same axes): the anchor sits exactly on the limb, the aim point just inside it, so the disk fills
 * the lower half of the frame and the prominence rises into the upper half. `side` picks which side of
 * the anchor the camera stands. Positions in solar radii.
 */
export function halphaCamera(anchor: V3, pole: V3, side: 1 | -1): { pos: V3; fwd: V3; up: V3 } {
  const a = norm(anchor);
  let b = cross(a, pole);
  if (Math.hypot(...b) < 1e-3) b = cross(a, [1, 0, 0]);
  b = norm(b).map((v) => v * side) as V3;
  const ca = 1 / HA_D;
  const sa = Math.sqrt(1 - ca * ca);
  const pos = [0, 1, 2].map((k) => (ca * a[k] + sa * b[k]) * HA_D) as V3;
  const fwd = norm([0, 1, 2].map((k) => a[k] * HA_AIM_R - pos[k]) as V3);
  const up = norm([0, 1, 2].map((k) => a[k] - dot(a, fwd) * fwd[k]) as V3);
  return { pos, fwd, up };
}

/** Something on the disk that makes an H-alpha view interesting (body-fixed unit direction, weight). */
export interface DiskFeature {
  dir: V3;
  weight: number;
}

/**
 * Picks the H-alpha limb view (body-fixed axes, north = +z): among the tall quiescent prominences (Mm
 * heights `heightMm`), the anchor and camera side whose frame also shows the most disk features
 * (active regions with plage, filaments), preferring taller prominences.
 */
export function chooseHalphaView(
  candidates: readonly { dir: V3; heightMm: number }[],
  features: readonly DiskFeature[],
): { anchor: V3; side: 1 | -1; score: number } | null {
  const tanY = Math.tan((HA_FOV_DEG * DEG) / 2);
  const tanX = (tanY * 16) / 9;
  let best: { anchor: V3; side: 1 | -1; score: number } | null = null;
  let bestScore = -Infinity;
  for (const c of candidates) {
    for (const side of [1, -1] as const) {
      const cam = halphaCamera(c.dir, [0, 0, 1], side);
      const right = cross(cam.fwd, cam.up);
      let score = c.heightMm / 60;
      for (const f of features) {
        const w = [0, 1, 2].map((k) => f.dir[k] - cam.pos[k]) as V3;
        const mu = -dot(f.dir, w) / Math.hypot(...w);
        const z = dot(w, cam.fwd);
        if (mu < 0.2 || z <= 0) continue;
        const x = dot(w, right) / z / tanX;
        const y = dot(w, cam.up) / z / tanY;
        if (Math.abs(x) < 0.85 && Math.abs(y) < 0.9) score += f.weight;
      }
      if (score > bestScore) {
        bestScore = score;
        best = { anchor: c.dir, side, score };
      }
    }
  }
  return best;
}

/**
 * The H-alpha view at `jd` (body-fixed): a quiescent prominence at least 40 Mm tall on the limb, framed
 * so active regions (plage, flares) and filaments show on the disk below it.
 */
export function pickHalphaView(jd: number): { anchor: V3; side: 1 | -1; score: number } | null {
  const groups = activeGroups(jd);
  const proms = prominences(jd, groups);
  const features: DiskFeature[] = [
    ...groups.map((g) => ({ dir: g.centre, weight: 0.6 + 2 * g.size * g.strength })),
    ...filaments(proms).flatMap((f) =>
      filamentPoints(f).map((dir) => ({ dir, weight: (1.2 * f.intensity) / 7 })),
    ),
  ];
  return chooseHalphaView(
    proms
      .filter((p) => p.type === 0 && p.intensity > 0.9 && p.height * R_SUN_MM >= 40)
      .map((p) => ({ dir: p.dir, heightMm: p.height * R_SUN_MM })),
    features,
  );
}

const R_SUN_MM = 695.7;

/**
 * Limb view of a simulated quiescent prominence at `jd` (`anchor` and `pole` in 'sun' axes), seen from
 * 3.2 R with the anchor exactly on the limb; the disk fills the lower half of the frame.
 */
export function buildHalphaBookmark(
  radius: number,
  jd: number,
  anchor: V3,
  pole: V3,
  side: 1 | -1 = 1,
): Bookmark {
  const cam = halphaCamera(anchor, pole, side);
  return {
    id: HALPHA_BOOKMARK_ID,
    title: 'Sun: prominences in H-alpha',
    frame: 'sun',
    pos: vec3(...(cam.pos.map((v) => v * radius) as V3)),
    quat: qlookRotation(quat(), vec3(...cam.fwd), vec3(...cam.up)),
    jd,
    ev: CLOSEUP_EV,
    fovY: HA_FOV_DEG * DEG,
    lookTarget:
      'Through a narrowband H-alpha filter (switched on): the deep red-orange limb of the Sun across the ' +
      'lower half with a mottled chromosphere, dark sinuous filaments and bright plage on the disk, and a ' +
      'simulated hedgerow prominence rising from the limb into black space above.',
  };
}
