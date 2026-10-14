import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Body, Registry, SharedUniforms, SurfaceShading } from '../../../src/core/contracts';
import { addStandardFrames, FrameTreeImpl } from '../../../src/core/frames';
import { vec3 } from '../../../src/core/math64';
import { AU, PC, R_SUN } from '../../../src/core/units';
import { StarCatalog, type StarNames } from '../../../src/modules/stars/catalog';
import { decodeStarsBin } from '../../../src/modules/stars/format';
import {
  BIG_DIPPER_HIP,
  BIG_DIPPER_JD,
  constellationBookmarks,
} from '../../../src/modules/starsystems/bookmarks';
import { figureStars, type ConstellationsFile } from '../../../src/modules/starsystems/constellations';
import { solveKepler } from '../../../src/modules/starsystems/orbit';
import { Promoter, SYSTEM_ROWS } from '../../../src/modules/starsystems/promotion';
import { yearsSinceJ2000 } from '../../../src/modules/stars/points';

const ROOT = new URL('../../../', import.meta.url).pathname;
const json = <T>(p: string): T => JSON.parse(readFileSync(`${ROOT}public/${p}`, 'utf8')) as T;
let cat: StarCatalog;
let file: ConstellationsFile;

beforeAll(() => {
  const buf = readFileSync(`${ROOT}public/data/stars/stars.bin`);
  cat = new StarCatalog(
    decodeStarsBin(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)),
    json<StarNames>('data/stars/names.json'),
  );
  file = json<ConstellationsFile>('data/starsystems/constellations.json');
});

const sep = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => {
  const la = Math.hypot(a.x, a.y, a.z);
  const lb = Math.hypot(b.x, b.y, b.z);
  return Math.acos(Math.min(1, (a.x * b.x + a.y * b.y + a.z * b.z) / (la * lb)));
};
const dirFrom = (i: number, cam: { x: number; y: number; z: number }, years = 0) => {
  const p = cat.positionPc(i, years, vec3());
  return vec3(p.x - cam.x, p.y - cam.y, p.z - cam.z);
};

describe('constellations', () => {
  it('has all 88 IAU figures and every segment references a valid star index', () => {
    expect(file.figures).toHaveLength(88);
    for (const f of file.figures) {
      expect(f.segments.length % 2).toBe(0);
      for (const i of f.segments) {
        expect(Number.isInteger(i)).toBe(true);
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(cat.count);
      }
    }
    const ori = file.figures.find((f) => f.id === 'Ori')!;
    const stars = figureStars(ori);
    for (const hip of [27989, 24436, 25336, 26727, 25930]) expect(stars).toContain(cat.findByHip(hip));
    expect(file.missingHip).toEqual([]);
  });

  it('Orion is broken from 200 ly away but intact from Earth', () => {
    const bm = constellationBookmarks(cat, file).find((b) => b.id === 'orion-from-200ly')!;
    const cam = vec3(bm.pos.x / PC, bm.pos.y / PC, bm.pos.z / PC);
    expect(Math.hypot(cam.x, cam.y, cam.z)).toBeCloseTo(61.33, 1);
    const bet = cat.findByHip(27989);
    const bel = cat.findByHip(25336);
    const rig = cat.findByHip(24436);
    // Celestial east at the view direction; from Earth Bellatrix is west of Betelgeuse (right shoulder).
    const eastOf = (c: { x: number; y: number; z: number }, i: number) => {
      const look = dirFrom(rig, c);
      const e = vec3(-look.y, look.x, 0);
      const d = dirFrom(i, c);
      return (d.x * e.x + d.y * e.y) / (Math.hypot(d.x, d.y, d.z) * Math.hypot(e.x, e.y));
    };
    const sun = vec3();
    expect(eastOf(sun, bel)).toBeLessThan(eastOf(sun, bet));
    // From 200 ly to the side the near shoulder (77 pc) swings past the far one (150 pc): the figure breaks.
    expect(eastOf(cam, bel)).toBeGreaterThan(eastOf(cam, bet));
    expect(sep(dirFrom(bel, cam), dirFrom(rig, cam))).toBeGreaterThan(
      1.5 * sep(dirFrom(bel, sun), dirFrom(rig, sun)),
    );
  });

  it('the Big Dipper deforms after 100 kyr of proper motion', () => {
    const [dubhe, , , megrez, , , alkaid] = BIG_DIPPER_HIP.map((h) => cat.findByHip(h));
    const years = yearsSinceJ2000(BIG_DIPPER_JD);
    expect(years).toBeCloseTo(1e5, 0);
    const sun = vec3();
    const shape = (y: number) =>
      sep(dirFrom(dubhe, sun, y), dirFrom(megrez, sun, y)) /
      sep(dirFrom(megrez, sun, y), dirFrom(alkaid, sun, y));
    expect(Math.abs(shape(years) / shape(0) - 1)).toBeGreaterThan(0.1);
    expect(constellationBookmarks(cat, file).find((b) => b.id === 'big-dipper-100kyr')?.jd).toBe(
      BIG_DIPPER_JD,
    );
  });
});

describe('star systems', () => {
  it("binary rows obey Kepler's third law within 5 %", () => {
    for (const r of SYSTEM_ROWS) {
      if (!r.orbit) continue;
      const a = r.orbit.aArcsec * r.distancePc;
      const m = r.components.reduce((s, c) => s + c.massMsun, 0);
      expect(Math.abs(a ** 3 / r.orbit.periodYr ** 2 / m - 1)).toBeLessThan(0.05);
    }
    expect(solveKepler(1, 0.5) - 0.5 * Math.sin(solveKepler(1, 0.5))).toBeCloseTo(1, 12);
  });

  it('promotes Sirius AB into Float64 frames with mm precision near the star', () => {
    const frames = new FrameTreeImpl();
    addStandardFrames(frames);
    const bodies = new Map<string, Body>();
    const shadings: SurfaceShading[] = [];
    const registry = {
      addFrame: (f: Parameters<Registry['addFrame']>[0]) => frames.addFrame(f),
      body: (id: string) => bodies.get(id),
      addBody: (b: Body) => void bodies.set(b.id, b),
      removeBody: (id: string) => void bodies.delete(id),
      setSurfaceShading: (s: SurfaceShading) => void shadings.push(s),
    } as unknown as Registry;
    const shared = { uBlackbodyLut: { value: null } } as unknown as SharedUniforms;
    const promoter = new Promoter(cat, frames, registry, shared);
    const sirius = cat.findByHip(32349);
    const frameA = promoter.promoteIndex(sirius, 'test')!;
    expect(frameA).toBe('star:32349');
    expect(frames.has('sys:sirius') && frames.has('star:sirius-b')).toBe(true);
    expect([...bodies.keys()].sort()).toEqual(['hip:32349', 'sirius-b']);
    expect(bodies.get('hip:32349')!.radius).toBeCloseTo(1.711 * R_SUN, -3);
    expect(shadings).toHaveLength(2);

    const jd = 2461041.5; // 2026-01-01
    // A-B separation stays between periastron and apastron of the 19.9 AU orbit.
    const ab = frames.relative('star:32349', 'star:sirius-b', jd, vec3());
    const abAU = Math.hypot(ab.x, ab.y, ab.z) / AU;
    expect(abAU).toBeGreaterThan(19.9 * (1 - 0.5915) - 0.1);
    expect(abAU).toBeLessThan(19.9 * (1 + 0.5915) + 0.1);
    // The barycentre sits at the row distance (2.6548 pc) from the Sun.
    const bary = frames.relative('ssb', 'sys:sirius', jd, vec3());
    expect(Math.hypot(bary.x, bary.y, bary.z) / PC).toBeCloseTo(2.6548, 3);

    // A camera anchored in the star frame, 1.001 R from the centre: exact to well under a millimetre.
    const r = bodies.get('hip:32349')!.radius;
    const local = vec3(1.001 * r, 0, 0);
    expect(frames.findAnchor('ssb', frames.convertPoint('star:32349', local, 'ssb', jd, vec3()), jd)).toBe(
      'star:32349',
    );
    const toStar = frames.toCamera({ frame: 'star:32349', local }, 'star:32349', vec3(), jd, vec3());
    expect(Math.abs(toStar.x + 1.001 * r)).toBeLessThan(1e-3);
    expect(Math.hypot(toStar.y, toStar.z)).toBeLessThan(1e-3);
    // Sirius B seen from there: the frame chain keeps metre precision across 20 AU.
    const toB = frames.toCamera({ frame: 'star:32349', local }, 'star:sirius-b', vec3(), jd, vec3());
    expect(Math.abs(Math.hypot(toB.x - ab.x + local.x, toB.y - ab.y, toB.z - ab.z))).toBeLessThan(1);

    promoter.release('test');
    expect(bodies.size).toBe(0);

    // A plain named HYG star (51 Peg, no system row): one frame, radius estimated from M_V and B-V Teff.
    const peg = cat.findByHip(113357);
    expect(promoter.promoteIndex(peg, 'test')).toBe('star:113357');
    const body = bodies.get('hip:113357')!;
    expect(body.radius / R_SUN).toBeGreaterThan(0.8);
    expect(body.radius / R_SUN).toBeLessThan(1.6);
    const p = frames.relative('ssb', 'star:113357', jd, vec3());
    const c = cat.positionPc(peg, yearsSinceJ2000(jd), vec3());
    expect(Math.hypot(p.x / PC - c.x, p.y / PC - c.y, p.z / PC - c.z)).toBeLessThan(1e-9);
    promoter.release('test');
  });
});
