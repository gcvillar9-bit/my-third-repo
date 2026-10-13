import { describe, expect, it } from 'vitest';
import {
  B_CRIT,
  PHOTON_SPHERE,
  deflectionExact,
  deflectionLut,
  deflectionSeries,
  impactFromAngle,
  rayWithImpact,
  rk4Step,
  shadowAngle,
  traceRay,
  type V3,
} from '../../../src/modules/blackholes/geodesic';
import { LENSING_PRESETS, stepFactor } from '../../../src/modules/blackholes/lensing';

const angle = (a: V3, b: V3) =>
  Math.acos(Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / Math.hypot(...a) / Math.hypot(...b)));

describe('Schwarzschild null geodesics (r_s = 1)', () => {
  it('has the photon sphere at 1.5 r_s: a tangential photon there stays on its circle', () => {
    expect(PHOTON_SPHERE).toBe(1.5);
    // Circular orbit: x'' = -1.5 h² x / r⁵ balances v²/r exactly when r = 1.5.
    const s = new Float64Array([1.5, 0, 0, 0, 1, 0]);
    const h2 = 1.5 * 1.5;
    let rMin = 1.5;
    let rMax = 1.5;
    for (let i = 0; i < 2000; i++) {
      rk4Step(s, h2, 0.005);
      const r = Math.hypot(s[0], s[1], s[2]);
      rMin = Math.min(rMin, r);
      rMax = Math.max(rMax, r);
    }
    // 2000 × 0.005 = 10 r_s of path, more than one full orbit (2π·1.5 ≈ 9.4).
    expect(rMax - rMin).toBeLessThan(1e-4);
    // Just outside it escapes, just inside it falls in.
    expect(traceRay([1.52, 0, 0], [0, 1, 0], { stepFactor: 0.005 }).fate).toBe('escape');
    expect(traceRay([1.48, 0, 0], [0, 1, 0], { stepFactor: 0.005 }).fate).toBe('capture');
  });

  it('separates escape from capture at the critical impact parameter b_c = 3√3/2 ≈ 2.598', () => {
    expect(B_CRIT).toBeCloseTo(2.598, 3);
    for (const r0 of [1000, 30]) {
      const above = rayWithImpact(B_CRIT * 1.002, r0);
      const below = rayWithImpact(B_CRIT * 0.998, r0);
      expect(traceRay(above.pos, above.dir, { stepFactor: 0.004, maxSteps: 200000 }).fate).toBe('escape');
      expect(traceRay(below.pos, below.dir, { stepFactor: 0.004, maxSteps: 200000 }).fate).toBe('capture');
    }
    // Synge: the shadow seen from far away subtends b_c / r.
    expect(shadowAngle(1e6) * 1e6).toBeCloseTo(B_CRIT, 4);
    expect(impactFromAngle(30, shadowAngle(30))).toBeCloseTo(B_CRIT, 9);
    expect(shadowAngle(1.5)).toBeCloseTo(Math.PI / 2, 9);
  });

  it('reproduces the weak-field deflection 2 r_s / b within 1% at b = 1000 r_s', () => {
    const b = 1000;
    const { pos, dir } = rayWithImpact(b, 1e6);
    const res = traceRay(pos, dir, { stepFactor: 0.01, rEscape: 1e6, maxSteps: 100000 });
    expect(res.fate).toBe('escape');
    const alpha = angle(dir, res.dir);
    expect(Math.abs(alpha / (2 / b) - 1)).toBeLessThan(0.01);
    // The quadrature (LUT source) agrees with the series and with the integrator in the strong field.
    expect(deflectionExact(1000) / deflectionSeries(1000)).toBeCloseTo(1, 4);
    const r10 = rayWithImpact(10, 1e5);
    const t10 = traceRay(r10.pos, r10.dir, { stepFactor: 0.002, rEscape: 1e5, maxSteps: 400000 });
    expect(angle(r10.dir, t10.dir) / deflectionExact(10)).toBeCloseTo(1, 2);
    const lut = deflectionLut(16, 2.6, 1e4);
    expect(lut[15]).toBeCloseTo(1, 3);
    expect(lut[0]).toBeGreaterThan(lut[1]);
  });

  it('classifies the shadow edge within 5% using the shader step budgets', () => {
    for (const preset of ['potato', 'medium', 'ultra'] as const) {
      const steps = LENSING_PRESETS[preset].steps;
      const k = stepFactor(steps);
      for (const r0 of [26, 40]) {
        const opts = { stepFactor: k, maxSteps: steps, rEscape: 1.02 * r0 };
        const out = rayWithImpact(B_CRIT * 1.05, r0);
        const inn = rayWithImpact(B_CRIT * 0.95, r0);
        const fo = traceRay(out.pos, out.dir, opts);
        expect(fo.fate === 'escape' || (fo.fate === 'unfinished' && fo.rMin > 1)).toBe(true);
        expect(traceRay(inn.pos, inn.dir, opts).fate).toBe('capture');
      }
    }
  });
});
