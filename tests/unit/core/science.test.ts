import { describe, expect, it } from 'vitest';
import {
  apparentMag,
  blackbodyRgb,
  BLACKBODY_LUT_SIZE,
  bvToTeff,
  buildBlackbodyLut,
  CIE_1931_2DEG,
  CIE_STEP_NM,
  illuminanceFromMag,
  lambertPhase,
  magFromIlluminance,
  planetPointIlluminance,
  SOLAR_ILLUMINANCE_1AU,
  solarIlluminance,
  SUN_ABS_MAG_V,
  SUN_DISK_LUMINANCE,
} from '../../../src/core/photometry';
import { deltaT, jdToIso, parseInstant, SimClockImpl, ttToUtc, utcToTt } from '../../../src/core/time';
import { AU, JD_J2000, KM, PC } from '../../../src/core/units';

describe('photometry', () => {
  it('gives the Sun m = -26.74 at 1 AU', () => {
    expect(apparentMag(SUN_ABS_MAG_V, AU)).toBeCloseTo(-26.74, 2);
    expect(magFromIlluminance(SOLAR_ILLUMINANCE_1AU)).toBeCloseTo(-26.74, 2);
    expect(SOLAR_ILLUMINANCE_1AU).toBeGreaterThan(1.2e5);
    expect(SOLAR_ILLUMINANCE_1AU).toBeLessThan(1.35e5);
    expect(SUN_DISK_LUMINANCE).toBeGreaterThan(1.5e9);
    expect(SUN_DISK_LUMINANCE).toBeLessThan(2.1e9);
    expect(solarIlluminance(2 * AU) * 4).toBeCloseTo(SOLAR_ILLUMINANCE_1AU, 6);
    expect(apparentMag(0, 10 * PC)).toBeCloseTo(0, 12);
    expect(illuminanceFromMag(0)).toBe(2.54e-6);
  });

  it('maps B-V 0.65 to about 5800 K (Ballesteros 2012)', () => {
    expect(Math.abs(bvToTeff(0.65) - 5800)).toBeLessThan(60);
    expect(bvToTeff(-0.03)).toBeGreaterThan(9000); // Vega-like
    expect(bvToTeff(1.85)).toBeLessThan(3700); // Betelgeuse-like
  });

  it('computes planet point flux (Jupiter at opposition is about -2.7)', () => {
    const e = planetPointIlluminance({
      rSun: 5.2 * AU,
      distance: 4.2 * AU,
      radius: 69911 * KM,
      albedo: 0.538,
      phaseAngle: 0,
    });
    expect(magFromIlluminance(e)).toBeGreaterThan(-3.0);
    expect(magFromIlluminance(e)).toBeLessThan(-2.4);
    expect(lambertPhase(0)).toBeCloseTo(1, 12);
    expect(lambertPhase(Math.PI)).toBeCloseTo(0, 12);
  });

  it('builds a Planck x CIE 1931 blackbody LUT with plausible colours', () => {
    const ySum = CIE_1931_2DEG.reduce((s, r) => s + r[1], 0) * CIE_STEP_NM;
    expect(ySum).toBeGreaterThan(105.5);
    expect(ySum).toBeLessThan(108);
    const lut = buildBlackbodyLut();
    expect(lut.length).toBe(BLACKBODY_LUT_SIZE * 3);
    for (let i = 0; i < lut.length; i += 3) {
      const y = 0.2126 * lut[i] + 0.7152 * lut[i + 1] + 0.0722 * lut[i + 2];
      expect(y).toBeCloseTo(1, 4);
      expect(Math.min(lut[i], lut[i + 1], lut[i + 2])).toBeGreaterThanOrEqual(0);
    }
    const [r3, g3, b3] = blackbodyRgb(3000);
    expect(r3 > g3 && g3 > b3).toBe(true);
    const [r6, g6, b6] = blackbodyRgb(6504);
    expect(Math.max(r6, g6, b6) / Math.min(r6, g6, b6)).toBeLessThan(1.12); // near D65 white
    const [r20, , b20] = blackbodyRgb(20000);
    expect(b20).toBeGreaterThan(r20);
  });
});

describe('time', () => {
  it('converts UTC and TT with a plausible Delta T', () => {
    const jdUtc = 2461041.5; // 2026-01-01T00:00:00Z
    const dt = deltaT(jdUtc);
    expect(dt).toBeGreaterThan(60);
    expect(dt).toBeLessThan(80);
    expect(ttToUtc(utcToTt(jdUtc))).toBeCloseTo(jdUtc, 9);
    expect(parseInstant('2026-01-01T00:00:00Z')).toBeCloseTo(utcToTt(jdUtc), 9);
    expect(parseInstant('2026-01-01T00:00:00')).toBeCloseTo(utcToTt(jdUtc), 9);
    expect(parseInstant('2451545')).toBe(2451545);
    expect(parseInstant('nonsense')).toBeNull();
    expect(jdToIso(utcToTt(jdUtc))).toBe('2026-01-01T00:00:00.000Z');
  });

  it('runs the clock, the warp ladder and validity badges', () => {
    const c = new SimClockImpl({ jd: JD_J2000, now: () => Date.UTC(2026, 0, 1) });
    let notified = 0;
    c.subscribe(() => notified++);
    c.setRate(86400);
    expect(c.tick(1)).toBe(86400);
    expect(c.jd).toBeCloseTo(JD_J2000 + 1, 9);
    c.setRate(1);
    c.warpStep(1);
    expect(c.rate).toBe(60);
    c.warpStep(1);
    expect(c.rate).toBe(3600);
    c.setRate(1);
    c.warpStep(-1);
    expect(c.paused).toBe(true);
    expect(c.rate).toBe(0);
    expect(c.tick(1)).toBe(0);
    c.warpStep(-1);
    expect(c.rate).toBe(-1);
    c.setRate(1e13);
    c.warpStep(1);
    expect(c.rate).toBe(1e13);
    c.setTime('2026-01-01T00:00:00Z');
    expect(c.toDate()!.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    c.setNow();
    expect(c.toDate()!.getTime()).toBe(Date.UTC(2026, 0, 1));
    expect(notified).toBeGreaterThan(5);
    const inside = c.validity(JD_J2000).find((s) => s.range.id === 'core.planets')!;
    expect(inside.inside).toBe(true);
    const outside = c.validity(JD_J2000 + 20_000 * 365.25).find((s) => s.range.id === 'core.planets')!;
    expect(outside.inside).toBe(false);
    expect(outside.range.beyond).toBe('frozen');
    expect(() => c.setTime('garbage')).toThrow();
  });
});
