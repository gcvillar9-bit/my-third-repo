import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Vec3d } from '../../../src/core/contracts';
import { v3cross, v3dot, v3len, v3normalize, v3sub, vec3 } from '../../../src/core/math64';
import { parseInstant } from '../../../src/core/time';
import { AU, DAY, GM_SUN } from '../../../src/core/units';
import {
  HALE_BOPP_BOOKMARK,
  HALLEY_BOOKMARK,
  HALLEY_NUCLEUS_BOOKMARK,
  NEOWISE_BOOKMARK,
  buildBookmarks,
} from '../../../src/modules/comets/bookmarks';
import type { CometRow, CometsFile } from '../../../src/modules/comets/data';
import { cometFacts, infoCard, perihelia, searchEntries } from '../../../src/modules/comets/facts';
import { makeComet } from '../../../src/modules/comets/index';
import {
  DUST_BETAS,
  activityFade,
  antiSunward,
  apparentMagnitude,
  comaIntensity,
  comaRadius,
  dustTail,
  dustTailLength,
  integrateGrain,
  ionTail,
  ionTailLength,
} from '../../../src/modules/comets/model';
import { buildNucleus, hashString, icosphere } from '../../../src/modules/comets/nucleus';
import { CometOrbit, solveUniversal, stumpffC, stumpffS } from '../../../src/modules/comets/orbit';
import { solveKepler } from '../../../src/modules/solar-system/public';

const file = JSON.parse(readFileSync('public/data/comets/comets.json', 'utf8')) as CometsFile;
const catalog = JSON.parse(readFileSync('src/modules/comets/catalog.json', 'utf8')) as {
  comets: Record<string, unknown>[];
};
const rows = file.comets;
const display = file.display;
const row = (id: string): CometRow => rows.find((r) => r.id === id)!;
const comets = rows.map((r) => makeComet(r));
const comet = (id: string) => comets.find((c) => c.row.id === id)!;
const jdOf = (iso: string) => parseInstant(iso)!;
/** Perihelion date and distance by a golden-section search on r(jd) around the catalogued passage. */
function perihelion(orbit: CometOrbit): { jd: number; qAU: number } {
  let lo = orbit.tp - 30;
  let hi = orbit.tp + 30;
  for (let k = 0; k < 80; k++) {
    const a = lo + (hi - lo) * 0.382;
    const b = lo + (hi - lo) * 0.618;
    if (orbit.radiusAt(a) < orbit.radiusAt(b)) hi = b;
    else lo = a;
  }
  const jd = (lo + hi) / 2;
  return { jd, qAU: orbit.radiusAt(jd) / AU };
}

describe('comets data', () => {
  it('ships the famous comets with unique lowercase ids', () => {
    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of [
      'halley',
      'hale-bopp',
      'hyakutake',
      'neowise',
      'encke',
      '67p',
      'swift-tuttle',
      'pons-brooks',
    ])
      expect(ids).toContain(id);
    expect(ids.length).toBeGreaterThanOrEqual(8);
    expect(ids.length).toBeLessThanOrEqual(12);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it('gives every row and every hand-entered block a source', () => {
    for (const r of rows) {
      expect(r.elements.source, r.id).toMatch(/\S{3}/);
      expect(r.physical.source, r.id).toMatch(/\S{3}/);
      for (const block of [r.photometry, r.look, r.shape]) {
        expect(block.source, r.id).toMatch(/\S{3}/);
        expect(block.approximate, r.id).toBe(true);
      }
      expect(r.aliases.length).toBeGreaterThan(0);
    }
    // Rows that are not in the downloaded catalogues are flagged approximate as a whole.
    const pb = row('pons-brooks');
    expect(pb.elements.approximate).toBe(true);
    expect(pb.physical.approximate).toBe(true);
    expect(row('halley').elements.approximate).toBeUndefined();
    expect(row('halley').elements.source).toContain('Celestia');
    expect(row('hale-bopp').elements.source).toContain('Stellarium');
    expect(display.source).toMatch(/\S{3}/);
    for (const c of catalog.comets) {
      for (const key of ['photometry', 'look', 'shape', 'elements', 'physical']) {
        const block = c[key] as { source?: string; approximate?: boolean } | undefined;
        if (!block) continue;
        expect(block.source, `${String(c.id)}.${key}`).toMatch(/\S{3}/);
        expect(block.approximate, `${String(c.id)}.${key}`).toBe(true);
      }
    }
  });

  it('has plausible elements and sizes', () => {
    for (const r of rows) {
      const el = r.elements;
      expect(el.q, r.id).toBeGreaterThan(0.1);
      expect(el.q, r.id).toBeLessThan(2);
      expect(el.e, r.id).toBeGreaterThan(0.5);
      expect(el.e, r.id).toBeLessThan(1.01);
      expect(Math.abs(el.tp - el.epoch), r.id).toBeLessThan(400 * 30);
      expect(r.physical.radiusKm, r.id).toBeGreaterThan(0.5);
      expect(r.physical.radiusKm, r.id).toBeLessThan(80);
      expect(r.physical.albedo, r.id).toBeLessThan(0.1);
    }
  });
});

describe('comet orbits', () => {
  it('evaluates the Stumpff functions continuously through zero', () => {
    for (const z of [-30, -2, -0.5, -0.49, -1e-9, 0, 1e-9, 0.49, 0.5, 2, 9, 30]) {
      const s = Math.sqrt(Math.abs(z));
      const C = z > 1e-6 ? (1 - Math.cos(s)) / z : z < -1e-6 ? (Math.cosh(s) - 1) / -z : 0.5;
      const S = z > 1e-6 ? (s - Math.sin(s)) / (z * s) : z < -1e-6 ? (Math.sinh(s) - s) / (-z * s) : 1 / 6;
      expect(stumpffC(z)).toBeCloseTo(C, 9);
      expect(stumpffS(z)).toBeCloseTo(S, 9);
    }
  });

  it('solves the universal Kepler equation at high eccentricity, for parabolas and for hyperbolas', () => {
    const q = 0.3 * AU;
    let worst = 0;
    let maxIter = 0;
    for (const e of [0, 0.3, 0.9, 0.97, 0.999, 0.9999, 0.999999, 1, 1.0001, 1.2, 3]) {
      const half = e < 1 ? Math.PI * Math.sqrt((q / (1 - e)) ** 3 / GM_SUN) : 400 * 365.25 * DAY;
      for (const f of [-1, -0.7, -0.2, -1e-3, -1e-7, 0, 1e-9, 1e-4, 0.01, 0.1, 0.5, 0.9, 0.999999, 1]) {
        const dt = f * Math.min(half, 400 * 365.25 * DAY);
        const { chi, z, iterations } = solveUniversal(q, e, GM_SUN, dt);
        const T = Math.sqrt(GM_SUN) * dt;
        const resid = e * chi ** 3 * stumpffS(z) + q * chi - T;
        // Residual relative to the size of the terms: converged to rounding.
        worst = Math.max(worst, Math.abs(resid) / Math.max(Math.abs(T), q * Math.abs(chi), 1));
        maxIter = Math.max(maxIter, iterations);
        expect(Math.sign(chi) === Math.sign(dt) || dt === 0).toBe(true);
      }
    }
    expect(worst).toBeLessThan(1e-12);
    expect(maxIter).toBeLessThan(60);
  });

  it('agrees with the eccentric-anomaly solution on an ordinary ellipse', () => {
    const el = { ...row('encke').elements };
    const orbit = new CometOrbit(el);
    const a = orbit.q / (1 - orbit.e);
    const n = (2 * Math.PI) / orbit.periodDays!;
    for (const d of [-600, -100, -3, 0, 5, 77, 300, 590]) {
      const E = solveKepler(n * d, orbit.e);
      const x = a * (Math.cos(E) - orbit.e);
      const y = a * Math.sqrt(1 - orbit.e ** 2) * Math.sin(E);
      const p = orbit.stateAt(orbit.tp + d, vec3());
      expect(v3dot(p, orbit.P) / AU).toBeCloseTo(x / AU, 9);
      expect(v3dot(p, orbit.Q) / AU).toBeCloseTo(y / AU, 9);
      expect(v3dot(p, orbit.W) / AU).toBeCloseTo(0, 12);
    }
  });

  it('conserves energy and angular momentum on every catalogued orbit, e up to 0.9999', () => {
    expect(Math.max(...rows.map((r) => r.elements.e))).toBeGreaterThan(0.9998);
    const p = vec3();
    const v = vec3();
    for (const c of comets) {
      const o = c.orbit;
      const h0 = Math.sqrt(o.mu * o.q * (1 + o.e));
      const energy = (-o.mu * (1 - o.e)) / (2 * o.q);
      for (const d of [-3000, -400, -30, -1, 0, 0.5, 12, 200, 2500]) {
        o.stateAt(o.tp + d, p, v);
        const r = v3len(p);
        const h = v3len(v3cross(vec3(), p, v));
        expect(h / h0, `${c.row.id} h at ${d} d`).toBeCloseTo(1, 10);
        const vEsc2 = (2 * o.mu) / r;
        expect((v3dot(v, v) / 2 - o.mu / r - energy) / vEsc2, `${c.row.id} E at ${d} d`).toBeCloseTo(0, 10);
        expect(o.radiusAt(o.tp + d) / r).toBeCloseTo(1, 12);
        // The velocity is the time derivative of the position.
        const dtDays = 1e-3;
        const p1 = o.stateAt(o.tp + d + dtDays, vec3());
        const p0 = o.stateAt(o.tp + d - dtDays, vec3());
        const fd = v3len(
          v3sub(
            vec3(),
            v3sub(vec3(), p1, p0),
            vec3(v.x * 2 * dtDays * DAY, v.y * 2 * dtDays * DAY, v.z * 2 * dtDays * DAY),
          ),
        );
        expect(fd / (v3len(v) * 2 * dtDays * DAY)).toBeLessThan(1e-4);
      }
    }
  });

  it('handles an unbound orbit', () => {
    const el = { ...row('mcnaught').elements, e: 1.000019, periodDays: null };
    const o = new CometOrbit(el);
    expect(o.periodDays).toBeNull();
    expect(o.aphelion).toBe(Infinity);
    const before = o.radiusAt(o.tp - 400) / AU;
    const after = o.radiusAt(o.tp + 400) / AU;
    expect(before).toBeCloseTo(after, 9);
    expect(before).toBeGreaterThan(5);
    expect(o.radiusAt(o.tp) / AU).toBeCloseTo(el.q, 12);
    expect(o.radiusAt(o.tp + 4e5) / AU).toBeGreaterThan(500); // never comes back
  });

  it("puts Halley's perihelion on 1986-02-09 at 0.587 AU", () => {
    const { jd, qAU } = perihelion(comet('halley').orbit);
    expect(Math.abs(jd - jdOf('1986-02-09T12:00:00Z'))).toBeLessThan(1);
    expect(Math.abs(qAU - 0.587)).toBeLessThan(0.005);
  });

  it('reproduces the other famous perihelia', () => {
    const cases: [string, string, number, number][] = [
      ['hale-bopp', '1997-04-01T03:00:00Z', 0.914, 1],
      ['hyakutake', '1996-05-01T09:00:00Z', 0.23, 1],
      ['neowise', '2020-07-03T16:00:00Z', 0.295, 1],
      ['67p', '2015-08-13T02:00:00Z', 1.243, 1],
      ['swift-tuttle', '1992-12-12T00:00:00Z', 0.958, 2],
      ['encke', '2023-10-22T00:00:00Z', 0.337, 2],
      ['pons-brooks', '2024-04-21T03:00:00Z', 0.781, 1],
      ['mcnaught', '2007-01-12T18:00:00Z', 0.171, 1],
      ['tsuchinshan-atlas', '2024-09-27T18:00:00Z', 0.391, 1.5],
    ];
    for (const [id, iso, q, tolDays] of cases) {
      const { jd, qAU } = perihelion(comet(id).orbit);
      expect(Math.abs(jd - jdOf(iso)), `${id} date`).toBeLessThan(tolDays);
      expect(Math.abs(qAU - q), `${id} q`).toBeLessThan(0.008);
    }
  });

  it('brings Hyakutake within 0.11 AU of where the Earth was on 1996-03-25', () => {
    // Earth's heliocentric position that day from its mean elements (good to about 0.01 AU).
    const jd = jdOf('1996-03-25T07:00:00Z');
    const d = jd - 2451545;
    const L = ((100.46435 + 0.9856091 * d) * Math.PI) / 180;
    const M = ((357.52911 + 0.98560028 * d) * Math.PI) / 180;
    const lon = L + 0.03342 * Math.sin(M) + 0.00035 * Math.sin(2 * M);
    const r = 1.00014 - 0.01671 * Math.cos(M) - 0.00014 * Math.cos(2 * M);
    const eps = (23.4393 * Math.PI) / 180;
    const earth = vec3(
      r * Math.cos(lon) * AU,
      r * Math.sin(lon) * Math.cos(eps) * AU,
      r * Math.sin(lon) * Math.sin(eps) * AU,
    );
    const p = comet('hyakutake').orbit.stateAt(jd, vec3());
    const delta = v3len(v3sub(vec3(), p, earth)) / AU;
    expect(delta).toBeGreaterThan(0.08);
    expect(delta).toBeLessThan(0.125);
    expect(v3len(p) / AU).toBeCloseTo(1.07, 1);
  });

  it('orients orbits in ICRF: Halley is retrograde and Hale-Bopp nearly polar', () => {
    const pole = vec3(0, -Math.sin((23.4393 * Math.PI) / 180), Math.cos((23.4393 * Math.PI) / 180));
    expect((Math.acos(v3dot(comet('halley').orbit.W, pole)) * 180) / Math.PI).toBeCloseTo(162.24, 1);
    expect((Math.acos(v3dot(comet('hale-bopp').orbit.W, pole)) * 180) / Math.PI).toBeCloseTo(89.43, 1);
    for (const c of comets) {
      const { P, Q, W } = c.orbit;
      expect(v3len(P)).toBeCloseTo(1, 12);
      expect(v3dot(P, Q)).toBeCloseTo(0, 12);
      expect(v3len(W)).toBeCloseTo(1, 12);
    }
  });
});

describe('comet activity and tails', () => {
  it('brightens monotonically towards the Sun and switches off far out', () => {
    for (const r of rows) {
      let prevI = Infinity;
      let prevIon = Infinity;
      let prevDust = Infinity;
      for (let rAU = 0.15; rAU <= 8; rAU += 0.05) {
        const I = comaIntensity(r, rAU, display);
        const ion = ionTailLength(r, rAU, display);
        const dust = dustTailLength(r, rAU, display);
        expect(I, `${r.id} at ${rAU}`).toBeLessThanOrEqual(prevI);
        expect(ion).toBeLessThanOrEqual(prevIon);
        expect(dust).toBeLessThanOrEqual(prevDust);
        if (rAU < display.activityFadeAU[0]) expect(I).toBeGreaterThan(0);
        prevI = I;
        prevIon = ion;
        prevDust = dust;
      }
      for (const far of [5, 5.5, 10, 35]) {
        expect(comaIntensity(r, far, display)).toBe(0);
        expect(ionTailLength(r, far, display)).toBe(0);
        expect(dustTailLength(r, far, display)).toBe(0);
        expect(apparentMagnitude(r, far, 1, display)).toBe(Infinity);
      }
      expect(activityFade(1, display)).toBe(1);
    }
    // Roughly r^-2 or steeper: halving the distance at least quadruples the light.
    const hb = row('hale-bopp');
    expect(comaIntensity(hb, 0.5, display) / comaIntensity(hb, 1, display)).toBeGreaterThan(4);
    // Tens of millions of km of ion tail near perihelion.
    expect(ionTailLength(row('halley'), 0.6, display)).toBeGreaterThan(3e10);
    expect(ionTailLength(row('halley'), 0.6, display)).toBeLessThan(1.3 * AU);
  });

  it('matches the famous peak magnitudes within a magnitude', () => {
    // Hale-Bopp at perihelion, Hyakutake at its close approach, NEOWISE in early July 2020.
    expect(apparentMagnitude(row('hale-bopp'), 0.914, 1.36, display)).toBeCloseTo(-0.8, 0);
    expect(Math.abs(apparentMagnitude(row('hyakutake'), 1.07, 0.102, display) - 0)).toBeLessThan(1);
    expect(Math.abs(apparentMagnitude(row('neowise'), 0.32, 1.1, display) - 1.2)).toBeLessThan(1);
    expect(Math.abs(apparentMagnitude(row('halley'), 0.8, 0.9, display) - 3)).toBeLessThan(1);
    // The coma is tens to hundreds of thousands of km across.
    for (const r of rows) {
      const rc = comaRadius(r, 1, display);
      expect(rc).toBeGreaterThan(2e7);
      expect(rc).toBeLessThan(1e9);
    }
  });

  it('points the ion tail exactly away from the Sun', () => {
    for (const c of comets) {
      const jd = c.orbit.tp + 20;
      const sunToComet = c.orbit.stateAt(jd, vec3());
      const away = antiSunward(sunToComet, vec3());
      expect(v3dot(away, v3normalize(vec3(), sunToComet))).toBeCloseTo(1, 12);
      const curve = ionTail(c.row, sunToComet, display);
      const rAU = v3len(sunToComet) / AU;
      let last = 0;
      for (let k = 1; k < curve.count; k++) {
        const p = vec3(curve.pos[3 * k], curve.pos[3 * k + 1], curve.pos[3 * k + 2]);
        const s = v3len(p);
        expect(s).toBeGreaterThan(last);
        // On the Sun-comet line, on the far side from the Sun.
        expect(v3dot(p, away) / s).toBeCloseTo(1, 12);
        expect(v3len(vec3(sunToComet.x + p.x, sunToComet.y + p.y, sunToComet.z + p.z))).toBeGreaterThan(
          v3len(sunToComet),
        );
        last = s;
      }
      expect(last).toBeCloseTo(ionTailLength(c.row, rAU, display), -3);
      expect(curve.lum[0]).toBeGreaterThanOrEqual(0);
      expect(curve.lum[curve.count - 1]).toBe(0); // fades out: no hard end
      expect(Math.max(...curve.lum)).toBeGreaterThan(0);
    }
  });

  it('integrates grains: beta 0 follows the comet, beta 1 flies straight', () => {
    const o = comet('halley').orbit;
    const p = vec3();
    const v = vec3();
    const jd = o.tp + 10;
    const days = 30;
    o.stateAt(jd - days, p, v);
    const start = { ...p };
    const vel = { ...v };
    integrateGrain(p, v, GM_SUN, days * DAY, 48, vec3());
    const now = o.stateAt(jd, vec3());
    // The elements imply GM within 1e-4 of the Sun's, so the paths agree to a small fraction of an AU.
    expect(v3len(v3sub(vec3(), p, now)) / AU).toBeLessThan(2e-3);
    const q: Vec3d = { ...start };
    integrateGrain(q, vel, 0, days * DAY, 4, vec3());
    expect(q.x).toBeCloseTo(start.x + vel.x * days * DAY, -3);
  });

  it('curves the dust tail back along the orbit, in the orbital plane, anti-sunward of the head', () => {
    const c = comet('halley');
    const jd = jdOf('1986-03-08T00:00:00Z');
    const curves = dustTail(c.row, c.orbit, jd, display);
    expect(curves).toHaveLength(DUST_BETAS.length);
    const p = vec3();
    const v = vec3();
    c.orbit.stateAt(jd, p, v);
    const away = antiSunward(p, vec3());
    const w = c.orbit.W;
    const travel = v3cross(vec3(), w, away);
    const maxLen = dustTailLength(c.row, v3len(p) / AU, display);
    let lagHigh = 0;
    curves.forEach((curve, j) => {
      const end = 3 * (curve.count - 1);
      const tip = vec3(curve.pos[end], curve.pos[end + 1], curve.pos[end + 2]);
      const len = v3len(tip);
      expect(len, `beta ${DUST_BETAS[j]}`).toBeGreaterThan(0);
      expect(len).toBeLessThan(2.5 * maxLen);
      // Syndynes lie in the orbital plane.
      expect(Math.abs(v3dot(tip, w)) / len).toBeLessThan(1e-6);
      // Every tip trails the comet in its motion (the oldest grains were released before the Sun's
      // direction swung round, so only the younger half is tested for lying anti-sunward).
      expect(v3dot(tip, travel)).toBeLessThan(0);
      const m = 3 * Math.floor(curve.count / 2);
      const mid = vec3(curve.pos[m], curve.pos[m + 1], curve.pos[m + 2]);
      expect(v3dot(mid, away), `beta ${DUST_BETAS[j]}`).toBeGreaterThan(0);
      expect(v3dot(mid, travel), `beta ${DUST_BETAS[j]}`).toBeLessThan(0);
      // The curve leaves the nucleus along the Sun-comet line (within a few degrees after the first step).
      const first = vec3(curve.pos[3], curve.pos[4], curve.pos[5]);
      expect(v3dot(first, away) / v3len(first)).toBeGreaterThan(0.9);
      expect(curve.lum[curve.count - 1]).toBe(0);
      for (let k = 0; k < curve.count; k++) expect(curve.sigma[k]).toBeGreaterThan(0);
      if (j === curves.length - 1) lagHigh = Math.atan2(-v3dot(tip, travel), v3dot(tip, away));
    });
    // Even the lightest grains trail the ion tail by a clear angle: the two tails separate.
    expect((lagHigh * 180) / Math.PI).toBeGreaterThan(5);
    // Heavy grains (small beta) lag more than light ones.
    const lagOf = (j: number) => {
      const curve = curves[j];
      const end = 3 * (curve.count - 1);
      const tip = vec3(curve.pos[end], curve.pos[end + 1], curve.pos[end + 2]);
      return Math.atan2(-v3dot(tip, travel), v3dot(tip, away));
    };
    expect(lagOf(0)).toBeGreaterThan(lagOf(curves.length - 1));
    // Brightness is finite, non-negative and brightest near the head.
    const all = curves.flatMap((cv) => [...cv.lum]);
    expect(all.every((x) => Number.isFinite(x) && x >= 0)).toBe(true);
    expect(Math.max(...all)).toBeGreaterThan(0);
    // No dust tail when the comet is dormant.
    const dormant = dustTail(c.row, c.orbit, jdOf('2005-01-01T00:00:00Z'), display);
    expect(Math.max(...dormant.flatMap((cv) => [...cv.lum]))).toBe(0);
  });
});

describe('comet nucleus, facts, search and bookmarks', () => {
  it('builds a closed, outward-facing nucleus mesh inside the unit sphere', () => {
    const ico = icosphere(2);
    expect(ico.pos.length / 3).toBe(162);
    expect(ico.index.length / 3).toBe(320);
    for (const r of rows) {
      const mesh = buildNucleus(r.shape, hashString(r.id), 3);
      let rMax = 0;
      let outward = 0;
      const n = mesh.pos.length / 3;
      expect(n).toBe(642);
      for (let i = 0; i < n; i++) {
        const [x, y, z] = [mesh.pos[3 * i], mesh.pos[3 * i + 1], mesh.pos[3 * i + 2]];
        const l = Math.hypot(x, y, z);
        rMax = Math.max(rMax, l);
        expect(l).toBeGreaterThan(0.05);
        if (x * mesh.normal[3 * i] + y * mesh.normal[3 * i + 1] + z * mesh.normal[3 * i + 2] > 0) outward++;
      }
      expect(rMax).toBeCloseTo(1, 5); // the body radius is the largest extent
      expect(outward / n, r.id).toBeGreaterThan(0.93);
    }
    // Halley is elongated about 2:1; the two builds of one comet are identical (deterministic).
    const h = buildNucleus(row('halley').shape, hashString('halley'), 3);
    let yMax = 0;
    for (let i = 0; i < h.pos.length; i += 3) yMax = Math.max(yMax, Math.abs(h.pos[i + 1]));
    expect(yMax).toBeLessThan(0.7);
    expect([...buildNucleus(row('halley').shape, hashString('halley'), 3).pos]).toEqual([...h.pos]);
  });

  it('writes an info card with live facts for every comet', () => {
    const jd = jdOf('1986-03-08T00:00:00Z');
    const deps = {
      jd,
      display,
      fromSun: (id: string, t: number, out: Vec3d) => comet(id).orbit.stateAt(t, out),
      fromEarth: (id: string, t: number, out: Vec3d) => {
        comet(id).orbit.stateAt(t, out);
        out.x += 0.9 * AU;
        return out;
      },
    };
    for (const c of comets) {
      const card = infoCard(c.row, c.orbit, deps);
      expect(card.title).toBe(c.row.name);
      expect(card.simulated).toBe(true);
      expect(card.facts.length).toBeGreaterThan(8);
      for (const f of card.facts)
        expect(typeof f.value === 'string' || Number.isFinite(f.value), `${c.row.id} ${f.label}`).toBe(true);
      // Estimates and model values are always flagged.
      for (const f of card.facts.filter((x) => /estimate|model|Nucleus size/.test(x.label)))
        expect(f.approximate, f.label).toBe(true);
    }
    const facts = cometFacts(row('halley'), comet('halley').orbit, deps);
    const get = (label: string) => facts.find((f) => f.label.startsWith(label))!;
    expect(get('Last perihelion').value).toBe('1986-02-09');
    expect(get('Last perihelion').approximate).toBe(false);
    expect(String(get('Next perihelion').value)).toMatch(/^206[12]-/);
    expect(get('Next perihelion').approximate).toBe(true);
    expect(Number(get('Perihelion distance').value)).toBeCloseTo(0.5871, 3);
    expect(Number(get('Distance from the Sun').value)).toBeCloseTo(0.79, 1);
    expect(String(get('Orbital period').value)).toMatch(/^76\.\d* yr$/);
    expect(Number(get('Magnitude from Earth').value)).toBeLessThan(5);
    // Far from the element epoch the live distances are flagged approximate.
    const later = cometFacts(row('halley'), comet('halley').orbit, {
      ...deps,
      jd: jdOf('2026-01-01T00:00:00Z'),
    });
    expect(later.find((f) => f.label === 'Distance from the Sun')!.approximate).toBe(true);
    expect(later.find((f) => f.label.startsWith('Magnitude'))!.value).toMatch(/inactive/);
    // A long-period comet has one perihelion to report.
    const hb = cometFacts(row('hale-bopp'), comet('hale-bopp').orbit, deps);
    expect(hb.find((f) => f.label === 'Next perihelion')!.value).toBe('1997-04-01');
    expect(hb.find((f) => f.label === 'Last perihelion')).toBeUndefined();
    expect(perihelia(comet('encke').orbit, comet('encke').orbit.tp + 1).last).toBe(comet('encke').orbit.tp);
  });

  it('indexes names, designations and aliases for search', () => {
    const entries = searchEntries(rows);
    expect(entries).toHaveLength(rows.length);
    const find = (text: string) =>
      entries.find((e) => [e.name, ...(e.aliases ?? [])].some((a) => a.toLowerCase() === text.toLowerCase()));
    expect(find("Halley's Comet")!.id).toBe('halley');
    expect(find('Halley')!.id).toBe('halley');
    expect(find('1P')!.id).toBe('halley');
    expect(find('1P/Halley')!.id).toBe('halley');
    expect(find('Hale-Bopp')!.id).toBe('hale-bopp');
    expect(find('C/1995 O1')!.id).toBe('hale-bopp');
    expect(find('Great Comet of 1997')!.id).toBe('hale-bopp');
    expect(find('NEOWISE')!.id).toBe('neowise');
    expect(find('67P')!.id).toBe('67p');
    expect(find('12P')!.id).toBe('pons-brooks');
    for (const e of entries) {
      expect(e.kind).toBe('comet');
      expect(e.target).toBe(e.id);
      expect(e.subtitle).toMatch(/comet/i);
    }
  });

  it('builds bookmarks that look at the tails with the Sun out of frame', () => {
    const earthToComet = (id: string, jd: number) => {
      const p = comet(id).orbit.stateAt(jd, vec3());
      return vec3(p.x - 0.4 * AU, p.y + 0.9 * AU, p.z + 0.2 * AU);
    };
    const bms = buildBookmarks(comets, earthToComet);
    expect(bms.map((b) => b.id).sort()).toEqual(
      [HALE_BOPP_BOOKMARK, HALLEY_BOOKMARK, HALLEY_NUCLEUS_BOOKMARK, NEOWISE_BOOKMARK].sort(),
    );
    for (const b of bms) {
      expect(b.lookTarget!.length).toBeGreaterThan(60);
      expect(typeof b.ev).toBe('number');
      expect(typeof b.jd).toBe('number');
      expect(b.quat).toBeDefined();
      expect(Math.hypot(b.quat!.x, b.quat!.y, b.quat!.z, b.quat!.w)).toBeCloseTo(1, 9);
    }
    for (const id of [HALLEY_BOOKMARK, HALE_BOPP_BOOKMARK]) {
      const b = bms.find((x) => x.id === id)!;
      const c = comet(b.frame);
      expect(c).toBeDefined();
      // Camera forward (-Z rotated by the bookmark quaternion).
      const { x, y, z, w } = b.quat!;
      const fwd = vec3(-2 * (x * z + w * y), -2 * (y * z - w * x), -(1 - 2 * (x * x + y * y)));
      const sun = c.orbit.stateAt(b.jd as number, vec3());
      const toSun = v3normalize(vec3(), vec3(-sun.x - b.pos.x, -sun.y - b.pos.y, -sun.z - b.pos.z));
      const toHead = v3normalize(vec3(), vec3(-b.pos.x, -b.pos.y, -b.pos.z));
      // The Sun is far outside the 50 degree frame; the head is inside it.
      expect((Math.acos(v3dot(fwd, toSun)) * 180) / Math.PI).toBeGreaterThan(60);
      expect((Math.acos(v3dot(fwd, toHead)) * 180) / Math.PI).toBeLessThan(25);
      expect(v3len(b.pos) / AU).toBeGreaterThan(0.1);
    }
    const nuc = bms.find((b) => b.id === HALLEY_NUCLEUS_BOOKMARK)!;
    expect(v3len(nuc.pos)).toBeCloseTo(4.5 * comet('halley').body.radius, 0);
    const sky = bms.find((b) => b.id === NEOWISE_BOOKMARK)!;
    expect(sky.frame).toBe('earth');
    expect(v3len(sky.pos)).toBeCloseTo(6e7, -2);
  });

  it('registers bodies of kind comet that the camera can anchor to', () => {
    for (const c of comets) {
      expect(c.body.kind).toBe('comet');
      expect(c.body.frame).toBe(c.row.id);
      expect(c.body.influenceRadius).toBeGreaterThan(1000 * c.body.radius);
      expect(c.body.radius).toBe(c.row.physical.radiusKm * 1e3);
      expect(c.center === 'sun' || c.center === 'ssb').toBe(true);
    }
    expect(comet('mcnaught').center).toBe('ssb');
    expect(comet('halley').center).toBe('sun');
    // positionAt is a pure function of the date.
    const o = comet('halley').orbit;
    const a = o.positionAt(2446500.25, vec3());
    o.positionAt(2440000, vec3());
    expect(o.positionAt(2446500.25, vec3())).toEqual(a);
  });
});
