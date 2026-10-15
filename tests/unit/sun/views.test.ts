import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SUN_DISK_LUMINANCE } from '../../../src/core/photometry';
import { qrotate, vec3 } from '../../../src/core/math64';
import { parseInstant } from '../../../src/core/time';
import {
  MAX_FILAMENTS,
  MAX_PROMINENCES,
  MAX_REGIONS,
  MAX_SPOTS,
  activeGroups,
  filamentPoints,
  filaments,
  prominences,
} from '../../../src/modules/sun/activity';
import {
  HALPHA_DATE,
  SUNSPOT_DATE,
  buildSunspotBookmark,
  halphaCamera,
  pickHalphaView,
} from '../../../src/modules/sun/bookmarks';
import { activityFacts, withActivity } from '../../../src/modules/sun/info';
import { halphaI0 } from '../../../src/modules/sun/shading';
import data from '../../../src/modules/sun/sun-data.json';

type V3 = [number, number, number];
const R = 6.957e8;
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const GLSL = (f: string) =>
  readFileSync(new URL(`../../../src/modules/sun/glsl/${f}`, import.meta.url), 'utf8');

describe('sun views and labels', () => {
  it('H-alpha view: a tall prominence on the limb, regions and filaments on the disk below', () => {
    const t = parseInstant(HALPHA_DATE)!;
    const pick = pickHalphaView(t)!;
    expect(pick).not.toBeNull();
    const groups = activeGroups(t);
    const pr = prominences(t, groups);
    const p = pr.find((q) => q.dir.every((v, k) => v === pick.anchor[k]))!;
    expect(p.type).toBe(0);
    expect(p.height * 695.7).toBeGreaterThanOrEqual(40);
    const cam = halphaCamera(pick.anchor, [0, 0, 1], pick.side);
    const D = Math.hypot(...cam.pos);
    expect(dot(pick.anchor, cam.pos) / D).toBeCloseTo(1 / D, 9); // exactly on the limb
    const right = cross(cam.fwd, cam.up);
    const tanY = Math.tan((14 * Math.PI) / 360);
    const inFrame = (d: V3) => {
      const w = [0, 1, 2].map((k) => d[k] - cam.pos[k]) as V3;
      const z = dot(w, cam.fwd);
      const mu = -dot(d, w) / Math.hypot(...w);
      return (
        mu > 0.2 &&
        Math.abs(dot(w, right) / z / ((tanY * 16) / 9)) < 0.9 &&
        Math.abs(dot(w, cam.up) / z / tanY) < 0.9
      );
    };
    expect(groups.filter((g) => inFrame(g.centre)).length).toBeGreaterThanOrEqual(1);
    const filPts = filaments(pr)
      .flatMap((f) => filamentPoints(f))
      .filter(inFrame);
    expect(filPts.length).toBeGreaterThanOrEqual(5);
  });

  it('sunspot view frames the whole bipolar group, axis horizontal', () => {
    const t = parseInstant(SUNSPOT_DATE)!;
    const g = activeGroups(t)[0];
    const [lead, follow] = g.spots;
    const span = Math.acos(dot(lead.dir, follow.dir)) * R + 2.4 * (lead.umbraM + follow.umbraM);
    const bm = buildSunspotBookmark(R, t, lead.dir, follow.dir, span, (v) => v);
    const fwd = qrotate(vec3(), bm.quat!, vec3(0, 0, -1));
    const up = qrotate(vec3(), bm.quat!, vec3(0, 1, 0));
    const rt = qrotate(vec3(), bm.quat!, vec3(1, 0, 0));
    const tanY = Math.tan(bm.fovY! / 2);
    for (const s of [lead, follow]) {
      const w = s.dir.map((v, k) => v * R - [bm.pos.x, bm.pos.y, bm.pos.z][k]) as V3;
      const z = dot(w, [fwd.x, fwd.y, fwd.z]);
      const x = dot(w, [rt.x, rt.y, rt.z]) / z / ((tanY * 16) / 9);
      const y = dot(w, [up.x, up.y, up.z]) / z / tanY;
      expect(Math.abs(x)).toBeGreaterThan(0.3);
      expect(Math.abs(x)).toBeLessThan(0.9);
      expect(Math.abs(y)).toBeLessThan(0.15);
    }
  });

  it('the info card labels the activity as simulated', () => {
    const t = parseInstant('2024-10-10T12:00:00Z')!;
    const facts = activityFacts(t, 'off');
    expect(facts.some((f) => String(f.value).includes('simulated'))).toBe(true);
    expect(facts.find((f) => f.label.startsWith('Sunspot number'))!.approximate).toBe(true);
    const card = withActivity(
      { title: 'Sun', facts: [{ label: 'Radius', value: '696,000 km' }] },
      t,
      'halpha',
    );
    expect(card.facts[0].label).toBe('Radius');
    expect(card.facts.length).toBe(1 + facts.length);
    expect(card.description).toMatch(/simulated/);
    expect(card.facts.at(-1)!.value).toMatch(/H-alpha/);
  });

  it('H-alpha disk-mean luminance is luminanceScale x the white-light mean', () => {
    const [r, g, b] = halphaI0(SUN_DISK_LUMINANCE);
    const [a, k] = data.halpha.limb;
    const mean = (0.2126 * r + 0.7152 * g + 0.0722 * b) * (a + (2 * k) / 3);
    expect(mean / SUN_DISK_LUMINANCE).toBeCloseTo(data.halpha.luminanceScale, 9);
    expect(r).toBeGreaterThan(8 * g);
  });

  it('GLSL arrays and twins match activity.ts', () => {
    const ph = GLSL('photosphere.glsl');
    expect(ph).toContain(`uniform vec4 uSpot[${MAX_SPOTS}];`);
    expect(ph).toContain(`for (int i = 0; i < ${MAX_SPOTS}; i++)`);
    expect(ph).toContain(`uniform vec4 uRegion[${MAX_REGIONS}];`);
    expect(ph).toContain(`uniform vec4 uFil[${MAX_FILAMENTS}];`);
    expect(ph).toContain('(fract(k * 0.618034) - 0.5) * 1.4'); // filamentAngle()
    const co = GLSL('corona.glsl');
    expect(co).toContain(`uniform vec4 uProm[${MAX_PROMINENCES}];`);
    expect(co).toContain(`for (int i = 0; i < ${MAX_PROMINENCES}; i++)`);
  });
});
