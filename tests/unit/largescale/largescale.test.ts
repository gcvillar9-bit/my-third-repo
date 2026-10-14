import { describe, expect, it } from 'vitest';
import { v3dist, v3dot, v3len, vec3 } from '../../../src/core/math64';
import { NAMED_GALAXIES } from '../../../src/modules/galaxies/public';
import {
  GA_POS,
  generateFlows,
  galacticToUniverse,
  insideLaniakea,
  LANIAKEA,
  MW_FLOW,
  NORMA_POS,
  row,
  seedPoints,
  SHAPLEY_POS,
  shellMesh,
  STRUCTURES,
  streamlineEnd,
  universeToGalacticLB,
  VIRGO_POS,
} from '../../../src/modules/largescale/model';

const angle = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  (Math.acos(Math.min(1, v3dot(a, b) / (v3len(a) * v3len(b)))) * 180) / Math.PI;
const galaxy = (id: string) => {
  const g = NAMED_GALAXIES.find((x) => x.id === id)!;
  return { pos: vec3(g.pos[0], g.pos[1], g.pos[2]), d: g.distSunMpc };
};

describe('largescale: coordinates', () => {
  it('every row has a source and an approximate flag', () => {
    for (const s of STRUCTURES) {
      expect(s.source.length).toBeGreaterThan(10);
      expect(typeof s.approximate).toBe('boolean');
    }
  });

  it('galactic → universe matches the galaxies module (M31 and M87) within a few percent', () => {
    for (const [id, l, b] of [
      ['m31', 121.1743, -21.5733],
      ['m87', 283.7778, 74.4912],
    ] as const) {
      const g = galaxy(id);
      const p = galacticToUniverse(l, b, g.d);
      expect(v3dist(p, g.pos) / v3len(g.pos), id).toBeLessThan(0.03);
    }
    expect(v3dist(VIRGO_POS, galaxy('m87').pos)).toBe(0);
  });

  it('places Norma ~68-70 Mpc away, near the Great Attractor on the sky; Shapley ~200 Mpc', () => {
    expect(v3len(NORMA_POS)).toBeGreaterThan(67);
    expect(v3len(NORMA_POS)).toBeLessThan(71);
    expect(angle(NORMA_POS, GA_POS)).toBeLessThan(26); // 24.5° for (307, 9) vs (325.3, −7.3)
    expect(v3len(GA_POS)).toBeCloseTo(70, 0);
    expect(v3len(SHAPLEY_POS)).toBeGreaterThan(195);
    const lb = universeToGalacticLB(GA_POS);
    expect(lb.l).toBeCloseTo(307, 0);
    expect(lb.b).toBeCloseTo(9, 0);
  });
});

describe('largescale: flow model', () => {
  it("points the Milky Way's flow within ~30° of the observed Local Group–CMB direction", () => {
    const lg = row('lg-motion');
    const dipole = galacticToUniverse(lg.l!, lg.b!, 1e6);
    expect(angle(MW_FLOW, dipole)).toBeLessThan(30);
    expect(angle(MW_FLOW, GA_POS)).toBeLessThan(35);
  });

  it('Laniakea contains the Milky Way, Virgo, Norma and the Great Attractor but not Shapley', () => {
    for (const p of [vec3(), VIRGO_POS, NORMA_POS, GA_POS]) expect(insideLaniakea(p)).toBe(true);
    expect(insideLaniakea(SHAPLEY_POS)).toBe(false);
    const extent = 2 * Math.max(...LANIAKEA.semi);
    expect(extent).toBeGreaterThan(150);
    expect(extent).toBeLessThan(200);
  });

  it('streamlines seeded inside Laniakea converge on the Great Attractor', () => {
    const seeds = seedPoints(300, 5);
    let closer = 0;
    let arrived = 0;
    for (const s of seeds) {
      const end = streamlineEnd(s, 32);
      if (v3dist(end, GA_POS) < v3dist(s, GA_POS)) closer++;
      if (v3dist(streamlineEnd(s, 150), GA_POS) < 10) arrived++;
    }
    expect(closer / seeds.length).toBeGreaterThan(0.9);
    expect(arrived / seeds.length).toBeGreaterThan(0.8);
    // Our path: the Milky Way's streamline reaches the Great Attractor.
    expect(v3dist(streamlineEnd(vec3(), 64), GA_POS)).toBeLessThan(5);
  });

  it('generates identical geometry for the same seed, different for another', () => {
    const a = generateFlows(200, 1);
    const b = generateFlows(200, 1);
    const c = generateFlows(200, 2);
    expect(Buffer.from(a.pos.buffer).equals(Buffer.from(b.pos.buffer))).toBe(true);
    expect(Buffer.from(a.flow.buffer).equals(Buffer.from(b.flow.buffer))).toBe(true);
    expect(Buffer.from(a.pos.buffer).equals(Buffer.from(c.pos.buffer))).toBe(false);
    expect(a.lines).toBe(201);
    expect(a.index.length % 2).toBe(0);
    expect(Math.max(...a.index)).toBeLessThan(a.vertices);
    expect(a.path[1]).toBeGreaterThan(20);
    for (const v of a.flow) expect(Number.isFinite(v)).toBe(true);
    const m = shellMesh(16, 32);
    expect(m.pos.length).toBe(17 * 33 * 3);
    expect(Math.max(...m.index)).toBeLessThan(17 * 33);
  });
});
