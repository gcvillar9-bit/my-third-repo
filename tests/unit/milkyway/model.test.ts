import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MW_FRAME, SSB_FRAME, type QualityKnobs } from '../../../src/core/contracts';
import { addStandardFrames, FrameTreeImpl, ICRS_TO_GALACTIC } from '../../../src/core/frames';
import { vec3 } from '../../../src/core/math64';
import { galacticToIcrs, milkyWayBookmarks } from '../../../src/modules/milkyway/bookmarks';
import { marchSteps, skyWeight } from '../../../src/modules/milkyway/galaxy';
import {
  apply3,
  armDistance,
  armField,
  armRadius,
  ARMS,
  barFrame,
  components,
  dustKappa,
  galacticDir,
  MODEL,
  modelGlslDefines,
  MW_TO_MODEL,
  skyLuminance,
  SUN_MODEL,
  sunSkyLuminance,
  type ArmField,
  type Components,
} from '../../../src/modules/milkyway/model';
import { PC } from '../../../src/core/units';

const root = (p: string) => new URL(`../../../${p}`, import.meta.url);
const DEG = Math.PI / 180;
const noField = (): ArmField => ({ young: 0, old: 0, dust: 0, hii: 0 });
const comps = (x: number, y: number, z: number, f = noField()): Components =>
  components(x, y, z, f, { thin: 0, thick: 0, bulge: 0, bar: 0, young: 0, hii: 0 });

describe('milkyway-model.json', () => {
  it('gives every parameter row a source', () => {
    for (const [k, v] of Object.entries(MODEL)) {
      if (k === 'description') continue;
      if (Array.isArray(v)) for (const row of v) expect((row as { source?: string }).source, k).toBeTruthy();
      else expect((v as { source?: string }).source, k).toBeTruthy();
    }
  });

  it('holds the Reid 2019 Table 2 arm parameters', () => {
    // [segment, betaKink, rKink, psi<, psi>] from Reid et al. 2019, ApJ 885, 131, Table 2.
    const reid: [string, number, number, number, number][] = [
      ['Norma', 18, 4.46, -1.0, 19.5],
      ['Outer', 18, 12.24, 3.0, 9.4],
      ['Scutum-Centaurus', 23, 4.91, 14.1, 12.1],
      ['Sagittarius-Carina', 24, 6.04, 17.1, 1.0],
      ['Local', 9, 8.26, 11.4, 11.4],
      ['Perseus', 40, 8.87, 10.3, 8.7],
    ];
    expect(MODEL.arms.map((a) => a.segment)).toEqual(reid.map((r) => r[0]));
    for (const [i, [, bk, rk, lt, gt]] of reid.entries()) {
      const a = MODEL.arms[i];
      expect([a.betaKink, a.rKink, a.psiLt, a.psiGt]).toEqual([bk, rk, lt, gt]);
      // The measured range lies inside the rendered (extrapolated) range.
      expect(a.betaRender[0]).toBeLessThanOrEqual(a.betaMeasured[0]);
      expect(a.betaRender[1]).toBeGreaterThanOrEqual(a.betaMeasured[1]);
    }
  });
});

describe('GalaxyModel (TypeScript twin)', () => {
  it('puts the Sun at R0 = 8.178 kpc, z0 = 20.8 pc in the mw frame', () => {
    expect(Math.hypot(SUN_MODEL.x, SUN_MODEL.y, SUN_MODEL.z)).toBeCloseTo(8.178, 6);
    expect(SUN_MODEL.z).toBeCloseTo(0.0208, 6);
    expect(Math.abs(SUN_MODEL.y)).toBeLessThan(1e-9);
    expect(SUN_MODEL.x).toBeLessThan(0);
    // MW_TO_MODEL is a proper rotation.
    const m = MW_TO_MODEL;
    const det =
      m[0] * (m[4] * m[8] - m[5] * m[7]) -
      m[1] * (m[3] * m[8] - m[5] * m[6]) +
      m[2] * (m[3] * m[7] - m[4] * m[6]);
    expect(det).toBeCloseTo(1, 12);
  });

  it('sees Sgr A* from the Sun at RA 17h45m40s, Dec -29 00 28 (via frames)', () => {
    const frames = new FrameTreeImpl();
    addStandardFrames(frames);
    const v = frames.relative(SSB_FRAME, MW_FRAME, 2451545.0, vec3());
    const d = Math.hypot(v.x, v.y, v.z);
    const ra = (Math.atan2(v.y, v.x) / DEG + 360) % 360;
    const dec = Math.asin(v.z / d) / DEG;
    const raExpected = (17 + 45 / 60 + 40.04 / 3600) * 15;
    const decExpected = -(29 + 0 / 60 + 28.1 / 3600);
    expect(Math.abs(ra - raExpected) * 3600 * Math.cos(dec * DEG)).toBeLessThan(1);
    expect(Math.abs(dec - decExpected) * 3600).toBeLessThan(1);
    expect(d / PC / 1000).toBeCloseTo(8.178, 6);
    // In model axes the centre lies along +x from the Sun (tilted by z0 / R0).
    const g = apply3(ICRS_TO_GALACTIC, vec3(v.x / d, v.y / d, v.z / d), vec3());
    const mdir = apply3(MW_TO_MODEL, g, vec3());
    expect(mdir.x).toBeCloseTo(-SUN_MODEL.x / 8.178, 9);
    expect(mdir.z).toBeCloseTo(-0.0208 / 8.178, 9);
  });

  it('orients the bar at 27 deg with its near end at positive longitude', () => {
    // Brightest direction of bar + bulge on a 3.5 kpc circle in the plane.
    let best = -1;
    let bestPhi = 0;
    for (let a = 0; a < 360; a += 0.25) {
      const c = comps(3.5 * Math.cos(a * DEG), 3.5 * Math.sin(a * DEG), 0);
      if (c.bar + c.bulge > best) [best, bestPhi] = [c.bar + c.bulge, a];
    }
    // Angle of the bar axis to the Sun-centre line (the -x axis of the model frame).
    const axis = ((bestPhi % 180) + 180) % 180; // 0..180
    expect(Math.min(Math.abs(180 - axis), axis)).toBeCloseTo(27, 0);
    // Near end (5 kpc along the axis on the Sun's side) seen from the Sun.
    const ends = [bestPhi, bestPhi + 180].map((a) => [5 * Math.cos(a * DEG), 5 * Math.sin(a * DEG)]);
    const near = ends.reduce((p, q) =>
      Math.hypot(p[0] - SUN_MODEL.x, p[1]) < Math.hypot(q[0] - SUN_MODEL.x, q[1]) ? p : q,
    );
    const l = Math.atan2(near[1], near[0] - SUN_MODEL.x) / DEG;
    expect(l).toBeGreaterThan(25);
    expect(l).toBeLessThan(40);
    // The long bar ends near its 5 kpc half-length: strong at 4 kpc, faint beyond 6 kpc.
    const along = (s: number) => comps(-s * Math.cos(27 * DEG), s * Math.sin(27 * DEG), 0).bar;
    expect(along(4) / along(0)).toBeGreaterThan(0.6);
    expect(along(6.5) / along(0)).toBeLessThan(0.02);
    expect(barFrame(-Math.cos(27 * DEG), Math.sin(27 * DEG))[0]).toBeCloseTo(1, 12);
  });

  it('follows the Reid 2019 pitch angles on both sides of each kink', () => {
    for (const [i, arm] of ARMS.entries()) {
      const row = MODEL.arms[i];
      const pitch = (b: number) => {
        const h = 1e-4;
        return (
          Math.atan(-(Math.log(armRadius(arm, b + h)) - Math.log(armRadius(arm, b - h))) / (2 * h)) / DEG
        );
      };
      expect(pitch(arm.bk - 0.2)).toBeCloseTo(row.psiLt, 6);
      expect(pitch(arm.bk + 0.2)).toBeCloseTo(row.psiGt, 6);
      expect(armRadius(arm, arm.bk)).toBeCloseTo(row.rKink, 9);
      // The arm field is centred on the kink point: zero signed distance, one winding only.
      expect(armDistance(arm, row.rKink, arm.bk).d).toBeCloseTo(0, 9);
      expect(armDistance(arm, row.rKink + 0.5, arm.bk).d).toBeCloseTo(0.5, 1);
    }
  });

  it('has the thin/thick disc and dust scale heights and the 12% thick-disc normalisation', () => {
    const [x, y] = [SUN_MODEL.x, 0];
    const c0 = comps(x, y, 0);
    expect(comps(x, y, 0.3).thin / c0.thin).toBeCloseTo(Math.exp(-1), 9);
    expect(comps(x, y, 0.9).thick / c0.thick).toBeCloseTo(Math.exp(-1), 9);
    expect(c0.thick / c0.thin).toBeCloseTo(0.12, 2);
    const f = noField();
    expect(dustKappa(x, y, 0.1, f) / dustKappa(x, y, 0, f)).toBeCloseTo(Math.exp(-1), 9);
    // Radial scale lengths, inwards (the thin disc's inner hole costs < 2% here).
    const thinRatio = comps(x + 2.6, y, 0).thin / c0.thin / Math.E;
    expect(thinRatio).toBeGreaterThan(0.97);
    expect(thinRatio).toBeLessThan(1.001);
    expect(comps(x + 2.0, y, 0).thick / c0.thick).toBeCloseTo(Math.E, 9);
    // Local dust: 0.5-2.5 mag/kpc in the mid-plane; A_V 15-60 mag towards Sgr A*.
    const fs = armField(SUN_MODEL.x, 0, noField());
    const kLocal = dustKappa(SUN_MODEL.x, 0, 0, fs) * 1.086;
    expect(kLocal).toBeGreaterThan(0.5);
    expect(kLocal).toBeLessThan(2.5);
    let tau = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) {
      const s = (i + 0.5) / n;
      const px = SUN_MODEL.x * (1 - s);
      const pz = SUN_MODEL.z * (1 - s);
      tau += dustKappa(px, 0, pz, armField(px, 0, noField())) * (8.178 / n);
    }
    expect(tau * 1.086).toBeGreaterThan(15);
    expect(tau * 1.086).toBeLessThan(60);
  });

  it('gives plausible sky brightness from the Sun (cd/m²)', () => {
    const pole = sunSkyLuminance(0, 90);
    const southPole = sunSkyLuminance(0, -90);
    // Pioneer 10 integrated starlight: ~30-40 S10(V) at the poles, ~1e3 in the Sagittarius clouds.
    expect(pole).toBeGreaterThan(1.5e-5);
    expect(pole).toBeLessThan(8e-5);
    expect(southPole / pole).toBeGreaterThan(0.9); // z0 = 20.8 pc: nearly symmetric
    const sgr = sunSkyLuminance(5, -5);
    expect(sgr).toBeGreaterThan(3e-4);
    expect(sgr).toBeLessThan(3e-3);
    expect(sgr / sunSkyLuminance(5, 30)).toBeGreaterThan(3);
    // Face-on from outside: the centre outshines the disc at the solar circle by > 10x.
    const face = (x: number) => {
      const [r, g, b] = skyLuminance({ x, y: 0, z: 50 }, { x: 0, y: 0, z: -1 }, 300);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    expect(face(0) / face(-8.2)).toBeGreaterThan(10);
  });

  it('centres the band within 3 deg of the d3-celestial mw.json outline', () => {
    type Ring = [number, number][];
    const mw = JSON.parse(readFileSync(root('node_modules/d3-celestial/data/mw.json'), 'utf8')) as {
      features: { id: string; geometry: { coordinates: Ring[][] } }[];
    };
    const outline = mw.features.find((f) => f.id === 'ol1')!;
    // Outline edges in galactic (l, b) degrees.
    const edges: [number, number, number, number][] = [];
    for (const poly of outline.geometry.coordinates)
      for (const ring of poly) {
        const lb = ring.map(([ra, dec]) => {
          const d = vec3(
            Math.cos(dec * DEG) * Math.cos(ra * DEG),
            Math.cos(dec * DEG) * Math.sin(ra * DEG),
            Math.sin(dec * DEG),
          );
          const g = apply3(ICRS_TO_GALACTIC, d, vec3());
          return [Math.atan2(g.y, g.x) / DEG, Math.asin(g.z) / DEG];
        });
        for (let i = 0; i + 1 < lb.length; i++) edges.push([lb[i][0], lb[i][1], lb[i + 1][0], lb[i + 1][1]]);
      }
    const wrap = (a: number) => ((a + 540) % 360) - 180;
    // Inside test along the meridian l0: odd number of outline crossings north of b (ray to the pole).
    const coverageCentre = (l0: number): number => {
      const cross: number[] = [];
      for (const [l1, b1, l2, b2] of edges) {
        const d1 = wrap(l1 - l0);
        const d2 = wrap(l2 - l0);
        if (d1 === d2 || Math.abs(d1 - d2) > 90 || d1 < 0 === d2 < 0) continue;
        cross.push(b1 + ((b2 - b1) * (0 - d1)) / (d2 - d1));
      }
      let sum = 0;
      let n = 0;
      for (let b = -30; b <= 30; b += 0.25) {
        if (cross.filter((c) => c > b).length % 2 === 1) {
          sum += b;
          n++;
        }
      }
      return n ? sum / n : NaN;
    };
    let checked = 0;
    let worst = 0;
    const rows: string[] = [];
    for (let l = -120; l <= 120; l += 15) {
      const data = [-6, -3, 0, 3, 6].reduce((s, dl) => s + coverageCentre(l + dl), 0) / 5;
      if (!Number.isFinite(data)) continue;
      // Model: centre of the region brighter than a quarter of the way from the floor to the peak
      // (an iso-luminance outline, like the mw.json contour), sampled every 0.5 deg.
      const lum: number[] = [];
      for (let b = -20; b <= 20; b += 0.5) lum.push(sunSkyLuminance(l, b, 96));
      const lo = Math.min(...lum);
      const cut = lo + 0.25 * (Math.max(...lum) - lo);
      let sum = 0;
      let n = 0;
      lum.forEach((v, i) => {
        if (v > cut) {
          sum += -20 + 0.5 * i;
          n++;
        }
      });
      const model = sum / n;
      rows.push(`l=${l} model ${model.toFixed(2)} data ${data.toFixed(2)}`);
      // Inner Galaxy (|l| <= 60): within 3 deg. Towards Cygnus-Cassiopeia the model band sits up to
      // ~3 deg south (no warp, nearby disc light with the Sun 20.8 pc above the plane): 3.5 deg there.
      worst = Math.max(worst, Math.abs(model - data) - (Math.abs(l) > 60 ? 0.5 : 0));
      checked++;
    }
    expect(worst, rows.join('; ')).toBeLessThan(3);
    expect(checked).toBeGreaterThanOrEqual(10);
  });

  it('shares every model constant with the GLSL twin', () => {
    const defines = modelGlslDefines();
    const glsl =
      readFileSync(root('src/modules/milkyway/galaxy.glsl'), 'utf8') +
      readFileSync(root('src/modules/milkyway/armfield.glsl'), 'utf8');
    const defined = [...defines.matchAll(/(?:#define|const \w+) (MW_\w+)/g)].map((m) => m[1]);
    const used = new Set([...glsl.matchAll(/\bMW_\w+/g)].map((m) => m[0]));
    for (const d of defined) expect(used.has(d), d).toBe(true);
    for (const u of used) expect(defined.includes(u), u).toBe(true);
    expect(defines).toContain(`#define MW_NARMS ${MODEL.arms.length}`);
  });
});

describe('rendering knobs and bookmarks', () => {
  it('crossfades with the panorama around 300 pc and steps by preset', () => {
    expect(skyWeight(100 * PC)).toBe(0);
    expect(skyWeight(300 * PC)).toBeCloseTo(0.5, 9);
    expect(skyWeight(500 * PC)).toBe(1);
    const k = (preset: QualityKnobs['preset'], volumeSteps: number) =>
      ({ preset, volumeSteps }) as QualityKnobs;
    expect(
      [k('potato', 24), k('low', 24), k('medium', 48), k('high', 96), k('ultra', 160)].map(marchSteps),
    ).toEqual([16, 24, 48, 96, 160]);
  });

  it('defines the three Milky Way bookmarks', () => {
    const b = milkyWayBookmarks();
    expect(b.map((x) => x.id)).toEqual(['mw-outside-100kpc', 'mw-edge-on', 'mw-band-from-earth']);
    expect(Math.hypot(b[0].pos.x, b[0].pos.y, b[0].pos.z) / PC / 1000).toBeCloseTo(100, 6);
    const ngp = galacticToIcrs(galacticDir(0, 90));
    expect(Math.atan2(ngp.y, ngp.x) / DEG + 360).toBeCloseTo(192.86, 1);
    for (const x of b) expect(x.ev).toBeDefined();
  });
});
