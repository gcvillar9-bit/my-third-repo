import { describe, expect, it } from 'vitest';
import { JD_LIMIT, SimClockImpl, astroTimeFromTt, jdToIso, ttToUtc, utcToTt } from '../../../src/core/time';
import { JD_J2000 } from '../../../src/core/units';

const MA = (ma: number) => JD_J2000 - ma * 1e6 * 365.25;

describe('deep-time clock safety', () => {
  // astronomy-engine's AstroTime.FromTerrestrialTime never returns for these instants (verified
  // against astronomy-engine 2.1.19): a day near 3743 BCE inside the ephemeris window, and 365 Ma.
  const HANGING_IN_LIBRARY = [354393.00114547904, -133313798455];

  it('solves TT → UT without hanging where the library loops forever', () => {
    for (const jd of HANGING_IN_LIBRARY) {
      const ut = ttToUtc(jd);
      expect(Number.isFinite(ut)).toBe(true);
      expect(astroTimeFromTt(jd - JD_J2000).tt + JD_J2000).toBeCloseTo(jd, 4);
    }
    // Historical instants still round-trip to well under a millisecond.
    expect(utcToTt(ttToUtc(354393.00114547904))).toBeCloseTo(354393.00114547904, 8);
  });

  it('returns null dates beyond the JS Date range without converting', () => {
    const c = new SimClockImpl({ jd: JD_J2000 });
    for (const jd of [MA(46.9), MA(66), MA(185), MA(365), JD_J2000 - JD_LIMIT, JD_J2000 + JD_LIMIT]) {
      expect(c.toDate(jd)).toBeNull();
      expect(jdToIso(jd)).toBeNull();
    }
    // 100 ka is still a valid (expanded-year) Date.
    expect(c.toDate(JD_J2000 - 1e5 * 365.25)).not.toBeNull();
  });

  it('keeps the clock moving at real-time rates in deep time', () => {
    // At 66 Ma one float64 step of JD is ~0.33 s, bigger than a 1/60 s frame.
    const c = new SimClockImpl({ jd: MA(66), rate: 1 });
    const start = c.jd;
    for (let i = 0; i < 600; i++) c.tick(1 / 60);
    expect((c.jd - start) * 86400).toBeCloseTo(10, 0);
    // At 540 Ma (2.6 s steps) 60x still advances a minute per second.
    c.setTime(MA(540));
    c.setRate(60);
    const s540 = c.jd;
    for (let i = 0; i < 600; i++) c.tick(1 / 60);
    expect(Math.abs((c.jd - s540) * 86400 - 600)).toBeLessThan(3);
  });

  it('drops the rounding carry on setTime', () => {
    const c = new SimClockImpl({ jd: MA(66), rate: 1 });
    c.tick(1 / 60);
    c.setTime(JD_J2000);
    c.setRate(86400);
    c.tick(1);
    expect(c.jd).toBe(JD_J2000 + 1);
  });
});
