/**
 * Comet bookmarks (three-free). Tail views are built in the comet's own axes at the bookmark's date:
 * a = anti-sunward (the ion tail), w = orbit normal, t = w x a (the direction of travel; the dust tail lags
 * towards -t). The camera looks at a point down the tails from above the orbital plane, rolled so that the
 * tails rise to the upper right and the Sun stays out of frame on the left.
 */
import type { Bookmark, Vec3d } from '../../core/contracts';
import { qlookRotation, quat, v3cross, v3dot, v3len, v3normalize, v3scale, vec3 } from '../../core/math64';
import { parseInstant } from '../../core/time';
import { AU } from '../../core/units';
import type { Comet } from './scene';

const DEG = Math.PI / 180;

export const HALLEY_BOOKMARK = 'halley-1986';
export const HALLEY_NUCLEUS_BOOKMARK = 'halley-nucleus';
export const HALE_BOPP_BOOKMARK = 'hale-bopp-1997';
export const NEOWISE_BOOKMARK = 'neowise-2020-sky';

export interface TailView {
  id: string;
  title: string;
  comet: string;
  /** UTC instant. */
  iso: string;
  /** Look point: this far down the anti-sunward axis and this far behind (towards -t), AU. */
  along: number;
  lag: number;
  /** Camera distance from the look point, AU. */
  distance: number;
  /** Elevation above the orbital plane (degrees) and which side of it (+1 = orbit normal). */
  elevation: number;
  side: 1 | -1;
  /** Azimuth of the camera around the look point, degrees from anti-sunward towards the direction of travel. */
  azimuth: number;
  /** Angle of the anti-sunward axis above screen-right, degrees. */
  roll: number;
  fovDeg: number;
  ev: number;
  lookTarget: string;
}

export const TAIL_VIEWS: readonly TailView[] = [
  {
    id: HALLEY_BOOKMARK,
    title: "Halley's Comet, March 1986",
    comet: 'halley',
    iso: '1986-03-08T00:00:00Z',
    along: 0.17,
    lag: 0.03,
    distance: 0.42,
    elevation: 62,
    side: 1,
    azimuth: 200,
    roll: 24,
    fovDeg: 50,
    ev: -8,
    lookTarget:
      "Halley's Comet a month after its 1986 perihelion (the week of the Giotto flyby), seen from 0.4 AU above its " +
      'orbital plane in a long exposure: the bright head at the lower left, a narrow straight blue ion tail ' +
      'rising to the upper right exactly away from the Sun (out of frame on the left), and a broader, pale ' +
      'yellow dust tail fanning out below it and curving back along the orbit; stars behind.',
  },
  {
    id: HALE_BOPP_BOOKMARK,
    title: 'Comet Hale-Bopp, April 1997',
    comet: 'hale-bopp',
    iso: '1997-04-05T00:00:00Z',
    along: 0.3,
    lag: 0.06,
    distance: 0.8,
    elevation: 58,
    side: 1,
    azimuth: 200,
    roll: 24,
    fovDeg: 50,
    ev: -7,
    lookTarget:
      'Comet Hale-Bopp days after its 1997 perihelion, seen from 0.8 AU above its orbital plane: a brilliant ' +
      'white head at the lower left, a straight blue ion tail towards the upper right and a wide, bright, ' +
      'yellow-white dust tail curving away from it; the Sun is out of frame on the left.',
  },
];

const combine = (out: Vec3d, terms: readonly [number, Vec3d][]): Vec3d => {
  out.x = out.y = out.z = 0;
  for (const [k, v] of terms) {
    out.x += k * v.x;
    out.y += k * v.y;
    out.z += k * v.z;
  }
  return out;
};

/** Camera-up vector that puts `axis` at `rollDeg` above screen-right for a camera looking along `fwd`. */
export function rolledUp(fwd: Vec3d, axis: Vec3d, rollDeg: number): Vec3d {
  const k = v3dot(axis, fwd);
  const right = v3normalize(vec3(), vec3(axis.x - k * fwd.x, axis.y - k * fwd.y, axis.z - k * fwd.z));
  const up = v3cross(vec3(), right, fwd);
  const c = Math.cos(rollDeg * DEG);
  const s = Math.sin(rollDeg * DEG);
  return v3normalize(
    vec3(),
    combine(vec3(), [
      [c, up],
      [s, right],
    ]),
  );
}

/** Tail-view bookmark in the comet's frame (ICRF axes, origin at the nucleus). */
export function tailBookmark(comet: Comet, view: TailView): Bookmark {
  const jd = parseInstant(view.iso)!;
  const p = comet.orbit.stateAt(jd, vec3());
  const a = v3normalize(vec3(), p);
  const w = comet.orbit.W;
  const t = v3cross(vec3(), w, a);
  const look = combine(vec3(), [
    [view.along * AU, a],
    [-view.lag * AU, t],
  ]);
  const el = view.elevation * DEG;
  const az = view.azimuth * DEG;
  const offset = combine(vec3(), [
    [Math.sin(el) * view.side, w],
    [Math.cos(el) * Math.cos(az), a],
    [Math.cos(el) * Math.sin(az), t],
  ]);
  const pos = combine(vec3(), [
    [1, look],
    [view.distance * AU, offset],
  ]);
  const fwd = v3scale(vec3(), offset, -1);
  return {
    id: view.id,
    title: view.title,
    frame: comet.body.frame,
    pos,
    quat: qlookRotation(quat(), fwd, rolledUp(fwd, a, view.roll)),
    lookAt: comet.body.id,
    jd,
    ev: view.ev,
    fovY: view.fovDeg * DEG,
    lookTarget: view.lookTarget,
  };
}

export const HALLEY_NUCLEUS_ISO = '1986-03-14T00:03:00Z';
/** Close-up of Halley's nucleus at the time of the Giotto flyby: sunlit from the right, coma glow around it. */
export function nucleusBookmark(comet: Comet): Bookmark {
  const jd = parseInstant(HALLEY_NUCLEUS_ISO)!;
  const p = comet.orbit.stateAt(jd, vec3());
  const sun = v3scale(vec3(), v3normalize(vec3(), p), -1);
  const w = comet.orbit.W;
  const t = v3cross(vec3(), w, sun);
  // 55 degrees of phase, a little above the orbital plane, 4.5 radii out.
  const dir = v3normalize(
    vec3(),
    combine(vec3(), [
      [Math.cos(55 * DEG), sun],
      [Math.sin(55 * DEG), t],
      [0.3, w],
    ]),
  );
  const pos = v3scale(vec3(), dir, 4.5 * comet.body.radius);
  const fwd = v3scale(vec3(), dir, -1);
  return {
    id: HALLEY_NUCLEUS_BOOKMARK,
    title: "Halley's nucleus (Giotto flyby, 14 March 1986)",
    frame: comet.body.frame,
    pos,
    quat: qlookRotation(quat(), fwd, rolledUp(fwd, sun, 0)),
    lookAt: comet.body.id,
    jd,
    ev: 9.5,
    fovY: 50 * DEG,
    lookTarget:
      "Halley's nucleus from 32 km at the time of the Giotto flyby: a dark, elongated, lumpy rock about 15 km long " +
      'at the centre, lit by the Sun from the right with a rough terminator and its night side on the left, ' +
      'silhouetted against the faint glow of the inner coma.',
  };
}

export const NEOWISE_ISO = '2020-07-14T03:00:00Z';
/**
 * Comet NEOWISE in the sky from 60,000 km out from Earth (so no atmosphere and no Earth in frame), tails up.
 * `earthToComet` is the vector Earth → comet at the bookmark's date, m.
 */
export function skyBookmark(comet: Comet, earthToComet: Vec3d): Bookmark {
  const jd = parseInstant(NEOWISE_ISO)!;
  const p = comet.orbit.stateAt(jd, vec3());
  const a = v3normalize(vec3(), p);
  const toComet = v3normalize(vec3(), earthToComet);
  // Look a little way up the tail so that the head sits low in the frame.
  const aim = combine(vec3(), [
    [1, earthToComet],
    [0.11 * AU, a],
  ]);
  const fwd = v3normalize(vec3(), aim);
  return {
    id: NEOWISE_BOOKMARK,
    title: 'Comet NEOWISE in the sky, July 2020',
    frame: 'earth',
    pos: v3scale(vec3(), toComet, 6e7),
    quat: qlookRotation(quat(), fwd, rolledUp(fwd, a, 90)),
    jd,
    ev: -5.5,
    fovY: 30 * DEG,
    lookTarget:
      `Comet NEOWISE as a naked-eye object in the night sky seen from just outside Earth (${(v3len(earthToComet) / AU).toFixed(2)} AU away) ` +
      'in mid-July 2020: a star-like head low in the frame with a pale yellow dust tail fanning upwards and ' +
      'curving to one side, a fainter straight blue ion tail beside it, among the stars.',
  };
}

export function buildBookmarks(
  comets: readonly Comet[],
  earthToComet: (id: string, jd: number) => Vec3d | null,
): Bookmark[] {
  const byId = new Map(comets.map((c) => [c.row.id, c]));
  const out: Bookmark[] = [];
  for (const view of TAIL_VIEWS) {
    const c = byId.get(view.comet);
    if (c) out.push(tailBookmark(c, view));
  }
  const halley = byId.get('halley');
  if (halley) out.push(nucleusBookmark(halley));
  const neowise = byId.get('neowise');
  if (neowise) {
    const rel = earthToComet('neowise', parseInstant(NEOWISE_ISO)!);
    if (rel) out.push(skyBookmark(neowise, rel));
  }
  return out;
}
