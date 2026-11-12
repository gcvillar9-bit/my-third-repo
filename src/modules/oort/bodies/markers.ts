/**
 * Scale shells around the Sun (three-free part): the per-shell fade, the per-circle edge-on fade, label
 * placement, shell info cards and the Voyager labels. Each shell is drawn as three great circles (the
 * ecliptic and two perpendicular planes through the ecliptic pole), see render.ts.
 */
import type { InfoCard, Vec3d } from '../../../core/contracts';
import { vec3 } from '../../../core/math64';
import { AU } from '../../../core/units';
import { eclToIcrf, formatAu, smoothstep } from '../shared';
import type { ShellRow } from './data';

/** Labels show when their shell's alpha exceeds this. */
export const SHELL_LABEL_MIN_ALPHA = 0.3;

/**
 * Alpha of a shell of radius `rAu` seen from `dAu` from the Sun: hidden when tiny on screen (R/d small)
 * and when the camera is deep inside it (d/R small), times the global line fade and the markers switch.
 */
export function shellAlpha(rAu: number, dAu: number, lineFade: number, markers: boolean): number {
  if (!markers || !(lineFade > 0)) return 0;
  const d = Math.max(dAu, 1e-9);
  return lineFade * smoothstep(0.008, 0.03, rAu / d) * smoothstep(0.02, 0.2, d / rAu);
}

/**
 * Fade of one great circle with unit normal `n` (ICRF) for a camera at `cam` (Sun → camera, m): a circle
 * whose plane holds the camera projects to a straight line through the view, so it fades out as the camera
 * approaches its plane. Of three orthogonal circles at least one is always at |cos| ≥ 0.577.
 */
export function circleFade(n: Vec3d, cam: Vec3d): number {
  const d = Math.hypot(cam.x, cam.y, cam.z);
  if (!(d > 0)) return 1;
  return smoothstep(0.06, 0.25, Math.abs(n.x * cam.x + n.y * cam.y + n.z * cam.z) / d);
}

/** Normals of the three circles, ecliptic axes: the ecliptic, and the planes x = 0 and y = 0. */
export const CIRCLE_NORMALS_ECL: readonly [number, number, number][] = [
  [0, 0, 1],
  [1, 0, 0],
  [0, 1, 0],
];

/** ICRF normals of the three circles. */
export const circleNormals = (): Vec3d[] =>
  CIRCLE_NORMALS_ECL.map(([x, y, z]) => eclToIcrf(vec3(), vec3(x, y, z)));

/** Ecliptic longitude of shell `i`'s label, radians (spread so neighbouring labels do not pile up). */
export const labelLongitude = (i: number): number => ((35 + 67 * i) % 360) * (Math.PI / 180);

/** Label anchor of shell `i` on its ecliptic circle, Sun-centred, ICRF, m. */
export function labelPoint(i: number, rAu: number, out: Vec3d): Vec3d {
  const l = labelLongitude(i);
  return eclToIcrf(out, vec3(rAu * AU * Math.cos(l), rAu * AU * Math.sin(l), 0));
}

export const shellInfoId = (id: string): string => `oort-shell:${id}`;

export function shellCard(s: ShellRow): InfoCard {
  const days = (s.radiusAu * AU) / 299_792_458 / 86_400;
  return {
    title: s.label,
    subtitle: 'Distance marker around the Sun',
    facts: [
      {
        label: 'Radius',
        value: formatAu(s.radiusAu),
        approximate: !!s.approximate,
        source: s.source,
      },
      {
        label: 'Light travel time from the Sun',
        value:
          days < 1 ? `${Number((days * 24).toPrecision(3))} hours` : `${Number(days.toPrecision(3))} days`,
      },
    ],
    description: s.description,
  };
}

/** 'Voyager 1 · 171 AU'. */
export const voyagerLabel = (name: string, dAu: number): string => `${name} · ${formatAu(dAu)}`;
