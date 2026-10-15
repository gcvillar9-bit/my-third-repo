import { describe, expect, it } from 'vitest';
import { SSB_FRAME } from '../../../src/core/contracts';
import { qrotate, vec3 } from '../../../src/core/math64';
import { PC, R_SUN } from '../../../src/core/units';
import {
  ASTROPHOTO_ID,
  FROM_20LY_ID,
  INSIDE_ID,
  nebulaBookmarks,
  NEBULA_EV,
  TELESCOPE_EV,
  STYLE_BOOKMARKS,
  TELESCOPE_ID,
} from '../../../src/modules/nebulae/bookmarks';
import { NEBULA_FRAME, ORIGIN_PC } from '../../../src/modules/nebulae/frame';
import { D_PC } from '../../../src/modules/nebulae/model';
import {
  absMagAtNebula,
  customStar,
  DISTANCE_MODULUS,
  findHygIndex,
  NEBULA_STARS,
  unitIcrs,
} from '../../../src/modules/nebulae/trapezium';
import {
  createSearch,
  info,
  SEARCH_M42,
  SEARCH_M43,
  SEARCH_TRAPEZIUM,
} from '../../../src/modules/nebulae/ui';
import type { StarCatalog } from '../../../src/modules/stars/public';

const row = (id: string) => NEBULA_STARS.find((s) => s.id === id)!;

describe('Trapezium promotion', () => {
  it('uses absMag = V - 8.01 at 400 pc, so the view from Earth keeps V', () => {
    expect(DISTANCE_MODULUS).toBeCloseTo(8.0103, 4);
    for (const s of NEBULA_STARS) {
      const c = customStar(s, -1);
      expect(c.absMag).toBeCloseTo(s.v - 8.0103, 4);
      expect(absMagAtNebula(s.v)).toBe(c.absMag);
      const d = Math.hypot(c.positionPc.x, c.positionPc.y, c.positionPc.z);
      expect(d).toBeCloseTo(D_PC, 9);
      // Apparent magnitude from the Sun = V.
      expect(c.absMag + 5 * Math.log10(d / 10)).toBeCloseTo(s.v, 9);
      expect(c.radius).toBeCloseTo(s.radiusRsun * R_SUN, 0);
      // Held all session: from Earth the labels yield to named stars brighter than m 2.5 (priority 30 - 4 m).
      expect(c.labelPriority).toBeLessThan(20);
      expect(s.source.length).toBeGreaterThan(10);
    }
  });

  it('includes θ¹ Ori A-E, θ² Ori A and NU Ori, θ¹ Ori C at the frame origin', () => {
    const ids = NEBULA_STARS.map((s) => s.id);
    for (const k of ['a', 'b', 'c', 'd', 'e']) expect(ids).toContain(`theta1-ori-${k}`);
    expect(ids).toContain('theta2-ori-a');
    expect(ids).toContain('nu-ori');
    const c = customStar(row('theta1-ori-c'), -1).positionPc;
    expect(c.x).toBeCloseTo(ORIGIN_PC.x, 9);
    expect(c.y).toBeCloseTo(ORIGIN_PC.y, 9);
    expect(c.z).toBeCloseTo(ORIGIN_PC.z, 9);
    expect(row('theta1-ori-c').teff).toBeGreaterThan(35000);
  });

  it('finds the HYG duplicates by HIP or position and none for θ¹ Ori B and E', () => {
    // A fake catalogue: θ¹ C at the 100 kpc placeholder (HIP 26221), NU Ori unnamed at 444 pc, a field star.
    const stars = [
      { hip: 26221, ...unitIcrs(row('theta1-ori-c').raDeg, row('theta1-ori-c').decDeg), d: 1e5, abs: -14.87 },
      { hip: null, ...unitIcrs(row('nu-ori').raDeg, row('nu-ori').decDeg), d: 444, abs: -1.49 },
      { hip: null, ...unitIcrs(84, -5), d: 300, abs: 0 },
    ];
    const cat = {
      count: stars.length,
      data: { absMag: Float32Array.from(stars.map((s) => s.abs)) },
      findByHip: (h: number) => stars.findIndex((s) => s.hip === h),
      positionPc: (i: number, _y: number, out: { x: number; y: number; z: number }) => {
        const s = stars[i];
        out.x = s.x * s.d;
        out.y = s.y * s.d;
        out.z = s.z * s.d;
        return out;
      },
    } as unknown as StarCatalog;
    expect(findHygIndex(cat, row('theta1-ori-c'))).toBe(0);
    expect(findHygIndex(cat, row('nu-ori'))).toBe(1);
    expect(findHygIndex(cat, row('theta1-ori-b'), 3)).toBe(-1);
    expect(findHygIndex(cat, row('theta1-ori-e'), 3)).toBe(-1);
  });
});

describe('nebula bookmarks, search and info', () => {
  const bms = nebulaBookmarks();
  const bm = (id: string) => bms.find((b) => b.id === id)!;

  it('registers the four design bookmarks', () => {
    for (const id of [TELESCOPE_ID, FROM_20LY_ID, INSIDE_ID, ASTROPHOTO_ID]) expect(bm(id)).toBeDefined();
    expect(bm(TELESCOPE_ID).ev).toBe(TELESCOPE_EV);
    expect(TELESCOPE_EV).toBe(NEBULA_EV);
    expect(bm(FROM_20LY_ID).ev).toBe(-5);
    expect(bm(ASTROPHOTO_ID).ev).toBe(-5);
    expect(STYLE_BOOKMARKS).toEqual([ASTROPHOTO_ID]);
    for (const b of bms) expect(b.lookTarget).toBeTruthy();
  });

  it('looks at M42 from Earth through 2.5°, north up', () => {
    const t = bm(TELESCOPE_ID);
    expect(t.frame).toBe(SSB_FRAME);
    expect(t.fovY).toBeCloseTo((2.5 * Math.PI) / 180, 9);
    const f = qrotate(vec3(), t.quat!, vec3(0, 0, -1));
    const c = unitIcrs(row('theta1-ori-c').raDeg, row('theta1-ori-c').decDeg);
    const sep = Math.acos(f.x * c.x + f.y * c.y + f.z * c.z);
    expect((sep * 180) / Math.PI).toBeLessThan(0.1);
    const up = qrotate(vec3(), t.quat!, vec3(0, 1, 0));
    expect(up.z).toBeGreaterThan(0.99);
  });

  it('keeps m42-astrophoto near the Earth line, so the Veil lanes stay on the emission (parallax ≤ 0.15 pc)', () => {
    const p = bm(ASTROPHOTO_ID).pos;
    const core = { x: 0, y: 0.25 * PC, z: 0 };
    const v = { x: core.x - p.x, y: core.y - p.y, z: core.z - p.z };
    const tilt = Math.acos(v.z / Math.hypot(v.x, v.y, v.z));
    // The Veil sits ~2.2 pc in front of the bowl: its lanes shift by 2.2 pc · tan(tilt) against the emission.
    expect(2.2 * Math.tan(tilt)).toBeLessThan(0.15);
  });

  it('puts m42-from-20ly 20 light-years from θ¹ Ori C and the inside view inside the nebula', () => {
    const p = bm(FROM_20LY_ID).pos;
    const d = Math.hypot(p.x, p.y, p.z) / PC;
    expect(bm(FROM_20LY_ID).frame).toBe(NEBULA_FRAME);
    expect(d).toBeGreaterThan(5.9);
    expect(d).toBeLessThan(6.4);
    const q = bm(INSIDE_ID).pos;
    expect(Math.hypot(q.x, q.y, q.z) / PC).toBeLessThan(0.5);
  });

  it('answers neb:m42, neb:m43 and neb:trapezium with sourced cards', () => {
    const search = createSearch({ m42: bm(FROM_20LY_ID), m43: bm(FROM_20LY_ID), trapezium: bm(INSIDE_ID) });
    const ids = search.entries().map((e) => e.id);
    expect(ids).toEqual([SEARCH_M42, SEARCH_M43, SEARCH_TRAPEZIUM]);
    expect(search.entries()[0].aliases).toContain('M42');
    expect(search.entries()[1].aliases).toContain('NGC 1982');
    for (const id of ids) {
      const card = info(id)!;
      expect(card.title.length).toBeGreaterThan(3);
      expect(card.facts.some((f) => f.source)).toBe(true);
      expect(card.facts.some((f) => f.approximate)).toBe(true);
    }
    const c = info('neb-theta1-ori-c')!;
    expect(c.title).toBe('θ¹ Ori C');
    expect(info('nope')).toBeNull();
  });
});
