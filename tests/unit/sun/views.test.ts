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
  POLE_U,
  SPOT_KIND_CODE,
  SPOT_SEEDS,
  activeGroups,
  filamentPoints,
  filaments,
  groupAxes,
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

  it('GLSL arrays, loop bounds and twins match activity.ts', () => {
    const ph = GLSL('photosphere.glsl');
    expect(ph).toContain(`#define SUN_MAX_SPOTS ${MAX_SPOTS}\n`);
    expect(ph).toContain(`#define SUN_MAX_REGIONS ${MAX_REGIONS}\n`);
    expect(ph).toContain(`#define SUN_MAX_FILAMENTS ${MAX_FILAMENTS}\n`);
    expect(ph).toContain('uniform vec4 uSpot[SUN_MAX_SPOTS];');
    expect(ph).toContain('uniform vec4 uRegion[SUN_MAX_REGIONS];');
    expect(ph).toContain('uniform vec4 uRegionB[SUN_MAX_REGIONS];');
    expect(ph).toContain('uniform vec4 uFil[SUN_MAX_FILAMENTS];');
    // Every loop over the arrays uses the defines (no stray literal bounds).
    const loops = [...ph.matchAll(/for \(int i = 0; i < (\w+); i\+\+\)/g)].map((m) => m[1]);
    expect(loops.length).toBeGreaterThanOrEqual(4);
    for (const b of loops) expect(b).toMatch(/^SUN_MAX_(SPOTS|REGIONS|FILAMENTS)$/);
    expect(ph).toContain('(fract(k * 0.618034) - 0.5) * 1.4'); // filamentAngle()
    // Spot codes (packSpotW) and the polarity centres of the pore field (+/-POLE_U, following a bit closer).
    for (const [kind, code] of Object.entries(SPOT_KIND_CODE))
      expect(ph).toContain(`#define SPOT_${kind.toUpperCase()} ${code}.0`);
    expect(ph).toContain(`float code = floor(k / ${SPOT_SEEDS}.0);`);
    expect(ph).toContain(`(un.x - ${POLE_U}) / 0.11`);
    expect(ph).toContain(`(un.x + ${POLE_U - 0.02}) / 0.18`);
    const co = GLSL('corona.glsl');
    expect(co).toContain(`uniform vec4 uProm[${MAX_PROMINENCES}];`);
    const coLoops = [...co.matchAll(/for \(int i = 0; i < (\w+); i\+\+\)/g)].map((m) => m[1]);
    expect(coLoops.length).toBeGreaterThanOrEqual(2);
    for (const b of coLoops) expect(b).toBe(String(MAX_PROMINENCES));
  });

  it('GLSL never raises a possibly negative base to a constant power (undefined in GLSL ES)', () => {
    for (const f of ['photosphere.glsl', 'corona.glsl']) {
      expect(GLSL(f)).not.toMatch(/pow\([^;]*,\s*2\.0\)/);
    }
  });

  it('sunRegionLocal (GLSL) matches groupAxes(): axis towards the leading spot, Joy tilt sign', () => {
    const t = parseInstant(SUNSPOT_DATE)!;
    const groups = activeGroups(t);
    const north = groups.find((g) => g.latDeg > 12)!;
    const south = groups.find((g) => g.latDeg < -12)!;
    for (const g of [north, south]) {
      // JS transcription of the shader: e = normalize(z x c), n = c x e, ax = cos(t) e - sin(t) n with
      // t = sign(lat) * tilt (activity.ts packs regionsB.x that way).
      const c = g.centre;
      const el = Math.hypot(c[0], c[1]);
      const e: V3 = [-c[1] / el, c[0] / el, 0];
      const n = cross(c, e);
      const tt = Math.sign(g.latDeg) * g.tiltDeg * (Math.PI / 180);
      const ax = [0, 1, 2].map((k) => Math.cos(tt) * e[k] - Math.sin(tt) * n[k]) as V3;
      const across = cross(c, ax);
      const ref = groupAxes(g);
      for (let k = 0; k < 3; k++) {
        expect(ax[k]).toBeCloseTo(ref.axis[k], 9);
        expect(across[k]).toBeCloseTo(ref.across[k], 9);
      }
      // Joy's law: the leading (prograde, +axis) end is nearer the equator.
      expect(Math.abs(ax[2])).toBeGreaterThan(0);
      expect(Math.sign(ax[2])).toBe(-Math.sign(g.latDeg));
      const lead = g.spots[0];
      expect(dot(lead.dir.map((v, k) => v - c[k]) as V3, ax)).toBeGreaterThan(0);
    }
  });
});
