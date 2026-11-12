import { describe, expect, it } from 'vitest';
import type { LabelItem, ViewState } from '../../../src/core/contracts';
import { qrotate, v3len, vec3 } from '../../../src/core/math64';
import { parseInstant } from '../../../src/core/time';
import { AU } from '../../../src/core/units';
import {
  CLOUD_BOOKMARK_ID,
  CLOUD_EV,
  INSIDE_BOOKMARK_ID,
  SPIRAL_BOOKMARK_ID,
  buildCloudBookmarks,
} from '../../../src/modules/oort/cloud/bookmarks';
import { REBASE_KYR } from '../../../src/modules/oort/cloud/cloud';
import { contrastBoost, insideDim, pointLux, spacingFraction } from '../../../src/modules/oort/cloud/display';
import { buildDensity, densityAt, meanSpacingAu, regionAt } from '../../../src/modules/oort/cloud/density';
import {
  CLOUD_INFO_ID,
  cloudInfoCard,
  cloudSearchEntry,
  formatLightTime,
  sunMagnitudeAt,
} from '../../../src/modules/oort/cloud/facts';
import {
  AGE_YR,
  DAYS_PER_KYR,
  EPOCH_JD,
  NU2_PER_YR2,
  TRUE_LAW,
  createCloud,
  generateCloud,
  generateMore,
  lawSample,
  lawValue,
  orbitNormalAt,
  positionAt,
  rebase,
  tideRatePerYr,
  weightAt,
  type Cloud,
} from '../../../src/modules/oort/cloud/generate';
import vertGlsl from '../../../src/modules/oort/cloud/glsl/cloud.vert.glsl?raw';
import { KEPLER_ITERATIONS, solveKepler, wrapPi } from '../../../src/modules/oort/cloud/kepler';
import { createRegionLabels } from '../../../src/modules/oort/cloud/labels';
import model from '../../../src/modules/oort/cloud/model.json';
import { GALACTIC_POLE_ECL, type OortShared } from '../../../src/modules/oort/shared';

type V3 = [number, number, number];
const G: V3 = [GALACTIC_POLE_ECL.x, GALACTIC_POLE_ECL.y, GALACTIC_POLE_ECL.z];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const f = Math.fround;

const cloud = generateCloud(60_000, 1);
const A = (c: Cloud, k: number) => c.el0[4 * k];

describe('oort cloud generation', () => {
  it('is deterministic for a seed, and any prefix is the same whatever the count or batching', () => {
    const a = generateCloud(3000, 7);
    const b = generateCloud(3000, 7);
    expect(Array.from(a.el0)).toEqual(Array.from(b.el0));
    expect(Array.from(a.quat)).toEqual(Array.from(b.quat));
    expect(Array.from(a.el1)).toEqual(Array.from(b.el1));
    expect(Array.from(generateCloud(3000, 8).el0)).not.toEqual(Array.from(a.el0));
    const c = createCloud(5000, 7);
    while (c.generated < c.count) generateMore(c, 777);
    expect(Array.from(c.el0.subarray(0, 3000 * 4))).toEqual(Array.from(a.el0));
    expect(Array.from(c.qJ.subarray(0, 3000 * 4))).toEqual(Array.from(a.qJ));
  });

  it('weights are true / sampling law, normalised at 2,000 AU', () => {
    expect(NU2_PER_YR2).toBeCloseTo(5.65e-15, 16);
    expect(weightAt(250)).toBeCloseTo(0.125, 6);
    expect(weightAt(2000)).toBeCloseTo(1, 9);
    expect(weightAt(50_000)).toBeCloseTo(0.2, 6);
    expect(weightAt(100_000)).toBeCloseTo(0.0707, 4);
    let wMax = 0;
    for (let k = 0; k < cloud.count; k++) wMax = Math.max(wMax, cloud.el1[2 * k + 1]);
    expect(wMax).toBeLessThanOrEqual(1 + 1e-6);
    // Inverse CDF lands inside the breaks.
    expect(lawSample(TRUE_LAW, 0)).toBeCloseTo(250, 6);
    expect(lawSample(TRUE_LAW, 0.999999)).toBeLessThanOrEqual(100_000);
  });

  it('keeps every perihelion at or beyond qMin and every orbit bound', () => {
    let qMin = Infinity;
    let eMax = 0;
    for (let k = 0; k < cloud.count; k++) {
      const a = A(cloud, k);
      const e = cloud.el0[4 * k + 1];
      qMin = Math.min(qMin, a * (1 - e));
      eMax = Math.max(eMax, e);
      expect(a).toBeGreaterThanOrEqual(250 * (1 - 1e-6));
      expect(a).toBeLessThanOrEqual(100_000 * (1 + 1e-6));
    }
    expect(qMin).toBeGreaterThan(model.perihelion.qMinAu * (1 - 1e-3));
    expect(eMax).toBeLessThan(1);
    expect(eMax).toBeGreaterThan(0.999);
  });

  it('weighted counts follow the true law: about five times more comets inside 20,000 AU than outside', () => {
    let inner = 0;
    let outer = 0;
    for (let k = 0; k < cloud.count; k++) {
      const a = A(cloud, k);
      const w = cloud.el1[2 * k + 1];
      if (a >= 2000 && a < 20_000) inner += w;
      else if (a >= 20_000) outer += w;
    }
    // Analytic ratio of the true law (dN/da ~ a^-1.5 to 50,000 AU, a^-3.5 beyond): 4.58.
    const integ = (a0: number, a1: number) => {
      let s = 0;
      const n = 4000;
      for (let i = 0; i < n; i++) {
        const x0 = a0 * (a1 / a0) ** (i / n);
        const x1 = a0 * (a1 / a0) ** ((i + 1) / n);
        s += lawValue(TRUE_LAW, Math.sqrt(x0 * x1)) * (x1 - x0);
      }
      return s;
    };
    const expected = integ(2000, 20_000) / integ(20_000, 100_000);
    expect(expected).toBeGreaterThan(4.3);
    expect(expected).toBeLessThan(5);
    expect(Math.abs(inner / outer / expected - 1)).toBeLessThan(0.06);
  });

  it('the inner disc stays near the ecliptic, the 3,000 AU orbits are twisted about the Galactic pole', () => {
    const meanNormal = (a0: number, a1: number) => {
      const m: V3 = [0, 0, 0];
      const n: V3 = [0, 0, 0];
      let twist = 0;
      let cnt = 0;
      for (let k = 0; k < cloud.count; k++) {
        const a = A(cloud, k);
        if (a < a0 || a > a1) continue;
        orbitNormalAt(cloud, k, n);
        for (let i = 0; i < 3; i++) m[i] += n[i];
        twist += (cloud.rate[k] * AGE_YR) / 1000;
        cnt++;
      }
      const l = Math.hypot(...m);
      return { m: m.map((x) => x / l) as V3, twist: twist / cnt };
    };
    const inner = meanNormal(600, 1200);
    expect(Math.acos(inner.m[2]) / (Math.PI / 180)).toBeLessThan(15);
    // Sanity value: a = 1000 AU, q = 60 AU gives about 0.2 rad over 4.5 Gyr; 3000 AU about 2 rad.
    expect(tideRatePerYr(1000, 0.94, 0.497) * AGE_YR).toBeCloseTo(-0.217, 2);
    expect(tideRatePerYr(3000, 0.98, 0.497) * AGE_YR).toBeCloseTo(-2.03, 1);
    const mid = meanNormal(2500, 3500);
    // Signed angle about the pole from the ecliptic pole's projection to the mean normal's projection.
    const proj = (v: V3): V3 => {
      const d = dot(v, G);
      return [v[0] - d * G[0], v[1] - d * G[1], v[2] - d * G[2]];
    };
    const u = proj([0, 0, 1]);
    const v = proj(mid.m);
    const angle = Math.atan2(dot(G, cross(u, v)), dot(u, v));
    expect(mid.twist).toBeLessThan(-1.5); // prograde orbits precess backwards about the pole
    expect(angle).toBeLessThan(-1);
    expect(Math.abs(wrapPi(angle - mid.twist))).toBeLessThan(0.6);
  });

  it('the outer cloud is isotropic', () => {
    let sum = 0;
    let cnt = 0;
    const n: V3 = [0, 0, 0];
    for (let k = 0; k < cloud.count; k++) {
      if (A(cloud, k) < 30_000) continue;
      orbitNormalAt(cloud, k, n);
      sum += Math.abs(n[2]);
      cnt++;
    }
    expect(cnt).toBeGreaterThan(5000);
    expect(Math.abs(sum / cnt - 0.5)).toBeLessThan(0.02);
  });
});

/** The vertex shader's keplerE in float32 arithmetic (GPU sin/cos approximated by rounded float64). */
function keplerF32(M: number, e: number): number {
  const den = f(f(4 * e) + 0.5);
  const alpha = f(f(1 - e) / den);
  const beta = f(f(0.5 * M) / den);
  const sgn = beta >= 0 ? 1 : -1;
  const root = f(Math.sqrt(f(f(beta * beta) + f(f(alpha * alpha) * alpha))));
  const z = f(sgn * f(Math.pow(f(Math.abs(beta) + root), f(1 / 3))));
  let s = f(z - f(alpha / z));
  const s5 = f(f(f(f(f(0.078 * s) * s) * s) * s) * s);
  s = f(s - f(s5 / f(1 + e)));
  let E = f(M + f(e * f(f(3 * s) - f(f(f(4 * s) * s) * s))));
  for (let k = 0; k < KEPLER_ITERATIONS; k++) {
    const num = f(f(E - f(e * f(Math.sin(E)))) - M);
    E = f(E - f(num / f(1 - f(e * f(Math.cos(E))))));
  }
  return E;
}

describe('oort Kepler solver', () => {
  it('the shader runs the same number of Newton steps as the CPU twin', () => {
    expect(vertGlsl).toContain(`const int KEPLER_ITERATIONS = ${KEPLER_ITERATIONS};`);
  });

  it('float64: residual below 1e-12 rad up to e = 0.9997', () => {
    let worst = 0;
    for (const e of [0, 0.3, 0.7, 0.9, 0.97, 0.99, 0.999, 0.9997]) {
      for (let j = 0; j <= 4000; j++) {
        const M = -Math.PI + (2 * Math.PI * j) / 4000;
        const E = solveKepler(M, e);
        worst = Math.max(worst, Math.abs(wrapPi(E - e * Math.sin(E) - M)));
      }
    }
    expect(worst).toBeLessThan(1e-12);
  });

  it('float32: never NaN, position error below 1e-5 of a up to e = 0.9997', () => {
    let worst = 0;
    for (const e64 of [0, 0.3, 0.7, 0.9, 0.97, 0.99, 0.995, 0.999, 0.9995, 0.9997]) {
      const e = f(e64);
      for (let j = 0; j < 20_000; j++) {
        const M = f(-Math.PI + (2 * Math.PI * j) / 20_000);
        const E32 = keplerF32(M, e);
        expect(Number.isFinite(E32)).toBe(true);
        const E = solveKepler(M, e);
        const b = Math.sqrt(1 - e * e);
        const dx = f(Math.cos(E32)) - e - (Math.cos(E) - e);
        const dy = b * (f(Math.sin(E32)) - Math.sin(E));
        worst = Math.max(worst, Math.hypot(dx, dy));
      }
    }
    expect(worst).toBeLessThan(1e-5);
  });

  it('float32 mean anomaly stays within 1e-3 rad of float64 up to the rebase threshold', () => {
    const n = ((2 * Math.PI) / 250 ** 1.5) * 1000; // fastest orbit, rad/kyr
    let worst = 0;
    for (let j = 0; j <= 2000; j++) {
      const M0 = wrapPi(j * 2.39996);
      const dt = (REBASE_KYR * j) / 2000;
      const m32 = f(f(f(M0) + f(f(n) * f(dt))) + f(Math.PI));
      const wrapped = f(f(m32 - f(f(2 * Math.PI) * Math.floor(f(m32 / f(2 * Math.PI))))) - f(Math.PI));
      worst = Math.max(worst, Math.abs(wrapPi(wrapped - (M0 + n * dt))));
    }
    expect(worst).toBeLessThan(1e-3);
  });
});

/** The vertex shader's propagation in float64 from the GPU arrays (aEl0, aQuat, aEl1, uDt). */
function gpuPositionAt(c: Cloud, k: number, jd: number): V3 {
  const dt = (jd - c.baseJd) / DAYS_PER_KYR;
  const [a, e, mBase, n] = c.el0.subarray(4 * k, 4 * k + 4);
  const E = solveKepler(mBase + n * dt, e);
  const p = vec3(a * (Math.cos(E) - e), a * Math.sqrt(1 - e * e) * Math.sin(E), 0);
  const [x, y, z, w] = c.quat.subarray(4 * k, 4 * k + 4);
  const v = qrotate(vec3(), { x, y, z, w }, p);
  const ang = c.el1[2 * k] * dt;
  const vv: V3 = [v.x, v.y, v.z];
  const gv = dot(G, vv);
  const gx = cross(G, vv);
  return [0, 1, 2].map(
    (i) => vv[i] * Math.cos(ang) + gx[i] * Math.sin(ang) + G[i] * gv * (1 - Math.cos(ang)),
  ) as V3;
}

describe('oort rebase', () => {
  it('rebase leaves positionAt unchanged and the GPU arrays follow it', () => {
    const c = generateCloud(400, 3, parseInstant('2026-01-01T00:00:00Z')!);
    const jd = EPOCH_JD + 3.7e6 * DAYS_PER_KYR; // 3.7 Myr after J2000
    const before = Array.from({ length: c.count }, (_, k) => positionAt(c, k, jd, [0, 0, 0]));
    rebase(c, jd);
    expect(c.baseJd).toBe(jd);
    for (let k = 0; k < c.count; k++) {
      const p = positionAt(c, k, jd, [0, 0, 0]);
      expect(p).toEqual(before[k]);
      const a = A(c, k);
      // At the epoch: only float32 storage of M and the quaternion.
      const g0 = gpuPositionAt(c, k, jd);
      expect(Math.hypot(g0[0] - p[0], g0[1] - p[1], g0[2] - p[2]) / a).toBeLessThan(1e-5);
      // Half a rebase interval later: float32 n and rate over 500 kyr.
      const jd2 = jd + 0.5 * REBASE_KYR * DAYS_PER_KYR;
      const q = positionAt(c, k, jd2, [0, 0, 0]);
      const g1 = gpuPositionAt(c, k, jd2);
      expect(Math.hypot(g1[0] - q[0], g1[1] - q[1], g1[2] - q[2]) / a).toBeLessThan(2e-4);
    }
  });
});

describe('oort density', () => {
  const density = buildDensity(40_000, 1);

  it('falls as r^-3.5 between 5,000 and 40,000 AU', () => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let r = 5000; r <= 40_000; r *= 1.25) {
      xs.push(Math.log(r));
      ys.push(Math.log(densityAt(density, r)));
    }
    const mx = xs.reduce((a, b) => a + b) / xs.length;
    const my = ys.reduce((a, b) => a + b) / ys.length;
    let sxy = 0;
    let sxx = 0;
    for (let i = 0; i < xs.length; i++) {
      sxy += (xs[i] - mx) * (ys[i] - my);
      sxx += (xs[i] - mx) ** 2;
    }
    expect(sxy / sxx).toBeGreaterThan(-3.8);
    expect(sxy / sxx).toBeLessThan(-3.2);
  });

  it('is normalised to the outer-cloud count, with tens of AU between comets in the outer cloud', () => {
    expect(density.totalComets).toBeGreaterThan(5 * model.population.outerCount);
    expect(density.totalComets).toBeLessThan(10 * model.population.outerCount);
    const s = meanSpacingAu(density, 30_000);
    expect(s).toBeGreaterThan(3);
    expect(s).toBeLessThan(100);
    expect(meanSpacingAu(density, 3000)).toBeLessThan(s);
    expect(meanSpacingAu(density, 1e6)).toBe(Infinity);
    expect(regionAt(50).id).toBe('planetary');
    expect(regionAt(1000).id).toBe('detached');
    expect(regionAt(5000).id).toBe('inner');
    expect(regionAt(30_000).id).toBe('outer');
    expect(regionAt(150_000).id).toBe('beyond');
  });

  it('info card: static facts with sources, live facts for the camera position', () => {
    const card = cloudInfoCard(30_000, density);
    expect(card.title).toBe('Oort Cloud');
    expect(card.simulated).toBe(true);
    const fact = (label: string) => card.facts.find((x) => x.label.startsWith(label))!;
    expect(String(fact('Extent').value)).toContain('1.6 light-years');
    expect(fact('Extent').approximate).toBe(true);
    expect(fact('Extent').source).toBeTruthy();
    expect(String(fact('Comets larger than 1 km (outer cloud)').value)).toBe('about 1.5 × 10¹²');
    expect(fact('Total mass').value).toBe('about 1.3');
    expect(fact('Total mass').source).toContain('Boe');
    expect(fact('Orbital period at 10,000 AU').value).toBe('1 million years');
    expect(String(fact('Predicted by').value)).toContain('Öpik');
    expect(String(fact('Predicted by').value)).toContain('Oort');
    expect(String(fact('Observed').value)).toContain('never');
    expect(fact('Your distance from the Sun').value).toBe('30,000 AU');
    expect(fact('Light travel time').value).toBe('173 days');
    expect(fact('The Sun from here').value).toBe('magnitude -4.4');
    expect(fact('Region here').value).toBe('Outer Oort Cloud');
    expect(fact('Mean spacing').approximate).toBe(true);
    expect(card.description).toContain('Nesvorný');
    expect(card.description).toContain('artificial');
    expect(sunMagnitudeAt(1)).toBeCloseTo(-26.74, 6);
    expect(formatLightTime(499)).toBe('8.3 min');
    expect(formatLightTime(2.7 * 365.25 * 86400)).toBe('2.7 years');
  });
});

describe('oort display law (artificial)', () => {
  const D = model.display;

  it('dims the cloud while the camera is inside its dense part', () => {
    expect(insideDim(500)).toBeCloseTo(D.insideDim.min, 9);
    expect(insideDim(2500)).toBeCloseTo(D.insideDim.min, 9);
    expect(insideDim(D.insideDim.toAu)).toBe(1);
    expect(insideDim(170_000)).toBe(1); // the whole-cloud view is not dimmed
    let prev = 0;
    for (let d = 1000; d < 200_000; d *= 1.2) {
      expect(insideDim(d)).toBeGreaterThanOrEqual(prev);
      prev = insideDim(d);
    }
    expect(insideDim(30_000)).toBeGreaterThan(0.5);
    expect(insideDim(30_000)).toBeLessThan(0.8);
  });

  it('boosts the outer cloud as (a / 2000)^k, leaving the inner cloud as it is', () => {
    expect(contrastBoost(500)).toBe(1);
    expect(contrastBoost(2000)).toBe(1);
    expect(contrastBoost(20_000)).toBeCloseTo(10 ** D.contrast.exponent, 9);
  });

  it('bounds the near field at a few mean spacings and falls as 1/d^2 beyond', () => {
    const n = 20_000;
    const a = 30_000;
    const bound = D.nearSpacings * spacingFraction(n) * a;
    expect(spacingFraction(D.referenceCount)).toBe(D.spacingFraction);
    expect(spacingFraction(n)).toBeCloseTo(D.spacingFraction * Math.cbrt(7.5), 9);
    const s = 1e-9; // keep below the safety cap
    expect(pointLux(s, 1, a, 0, n)).toBe(pointLux(s, 1, a, bound, n));
    expect(pointLux(s, 1, a, 2 * bound, n)).toBeCloseTo(pointLux(s, 1, a, bound, n) / 4, 20);
    expect(pointLux(1, 1, a, 0, n)).toBe(D.capLux);
  });

  it('the shader carries the same law', () => {
    expect(vertGlsl).toContain('max(dAU, uNearK * s)');
    expect(vertGlsl).toContain('pow(max(a / uContrast.x, 1.0), uContrast.y)');
  });
});

describe('oort bookmarks, search and labels', () => {
  const bookmarks = buildCloudBookmarks();
  const byId = (id: string) => bookmarks.find((b) => b.id === id)!;

  it('three views at their distances, each looking at the Sun', () => {
    const jd = parseInstant('2026-01-01T00:00:00Z')!;
    for (const [id, lo, hi] of [
      [CLOUD_BOOKMARK_ID, 165_000, 175_000],
      [SPIRAL_BOOKMARK_ID, 20_000, 25_000],
      [INSIDE_BOOKMARK_ID, 29_000, 31_000],
    ] as const) {
      const b = byId(id);
      expect(b.frame).toBe('sun');
      expect(b.jd).toBe(jd);
      expect(b.lookTarget!.length).toBeGreaterThan(40);
      const d = v3len(b.pos) / AU;
      expect(d).toBeGreaterThan(lo);
      expect(d).toBeLessThan(hi);
      const fwd = qrotate(vec3(), b.quat!, vec3(0, 0, -1));
      const cos = -(fwd.x * b.pos.x + fwd.y * b.pos.y + fwd.z * b.pos.z) / v3len(b.pos);
      expect(cos).toBeGreaterThan(0.9999);
    }
    expect(byId(CLOUD_BOOKMARK_ID).ev).toBe(CLOUD_EV);
    // The whole cloud starts fading at 200,000 AU: the overview stays inside the fade.
    expect(v3len(byId(CLOUD_BOOKMARK_ID).pos) / AU).toBeLessThan(200_000);
  });

  it('search entry flies to the overview and opens the card', () => {
    const e = cloudSearchEntry(byId(CLOUD_BOOKMARK_ID));
    expect(e.id).toBe(CLOUD_INFO_ID);
    expect(e.kind).toBe('other');
    expect(e.aliases).toEqual(expect.arrayContaining(['Hills cloud', 'Oort spiral', 'Öpik-Oort cloud']));
    expect(typeof e.target === 'object' && e.target.id).toBe(CLOUD_BOOKMARK_ID);
  });

  it('region labels show only while the cloud is visible and the region has a sensible size', () => {
    const shared = { sunDistAu: 170_000, cloudFade: 1, brightness: 1 } as unknown as OortShared;
    const src = createRegionLabels(shared);
    const ids = () => {
      const out: LabelItem[] = [];
      src.labels({} as ViewState, out);
      return out.map((l) => l.id).sort();
    };
    expect(ids()).toEqual(['oort-cloud.inner', 'oort-cloud.outer']);
    Object.assign(shared, { sunDistAu: 40_000 });
    expect(ids()).toEqual(['oort-cloud.inner', 'oort-cloud.outer', 'oort-cloud.spiral']);
    // Deep inside the outer cloud its label would sit anywhere: only the inner regions are named.
    Object.assign(shared, { sunDistAu: 22_000 });
    expect(ids()).toEqual(['oort-cloud.inner', 'oort-cloud.spiral']);
    Object.assign(shared, { sunDistAu: 1000 });
    expect(ids()).toEqual([]);
    Object.assign(shared, { sunDistAu: 30_000, cloudFade: 0 });
    expect(ids()).toEqual([]);
  });
});
