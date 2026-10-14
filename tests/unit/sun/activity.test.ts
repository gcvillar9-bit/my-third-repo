import { describe, expect, it } from 'vitest';
import { parseInstant } from '../../../src/core/time';
import {
  MAX_SPOTS,
  SunActivity,
  activeGroups,
  flareAt,
  prominences,
  rotationPeriodDays,
  sunspotNumber,
} from '../../../src/modules/sun/activity';

const DEG = Math.PI / 180;
const jd = (iso: string) => parseInstant(iso)!;

/** Mean number of live groups sampled every 5 days over `days` from `iso`. */
function meanGroups(iso: string, days = 120): number {
  let n = 0;
  let k = 0;
  for (let t = 0; t < days; t += 5, k++) n += activeGroups(jd(iso) + t).length;
  return n / k;
}

/** Mean |latitude| of groups born in [from, from + days). */
function meanBirthLat(from: string, days: number): number {
  const seen = new Map<number, number>();
  for (let t = 0; t < days; t += 3)
    for (const g of activeGroups(jd(from) + t)) seen.set(g.id, Math.abs(g.latDeg));
  const lats = [...seen.values()];
  expect(lats.length).toBeGreaterThan(5);
  return lats.reduce((a, b) => a + b, 0) / lats.length;
}

describe('sun activity (simulated)', () => {
  it('sunspot number follows the cycle: ~160 in late 2024, low at the minima', () => {
    expect(sunspotNumber(jd('2024-10-15T00:00:00Z'))).toBeGreaterThan(140);
    expect(sunspotNumber(jd('2024-10-15T00:00:00Z'))).toBeLessThan(175);
    expect(sunspotNumber(jd('2019-12-15T00:00:00Z'))).toBeLessThan(25);
    expect(sunspotNumber(jd('2030-12-01T00:00:00Z'))).toBeLessThan(25);
    expect(sunspotNumber(jd('1950-01-01T00:00:00Z'))).toBeGreaterThanOrEqual(0);
  });

  it('more spot groups near maximum than at minimum', () => {
    const max = meanGroups('2024-09-01T00:00:00Z');
    expect(max).toBeGreaterThan(10);
    expect(max).toBeGreaterThan(4 * meanGroups('2019-11-01T00:00:00Z'));
    expect(max).toBeGreaterThan(4 * meanGroups('2030-10-01T00:00:00Z'));
  });

  it('butterfly: emergence latitudes high early in the cycle, low late, never beyond 40 deg', () => {
    const early = meanBirthLat('2021-01-01T00:00:00Z', 360);
    const late = meanBirthLat('2028-06-01T00:00:00Z', 360);
    expect(early).toBeGreaterThan(late + 6);
    expect(early).toBeGreaterThan(16);
    expect(late).toBeLessThan(14);
    for (let t = 0; t < 4000; t += 7)
      for (const g of activeGroups(jd('2019-01-01T00:00:00Z') + t))
        expect(Math.abs(g.latDeg)).toBeLessThanOrEqual(40);
  });

  it('differential rotation: ~25 d at the equator, ~33-36 d at 75 deg', () => {
    expect(rotationPeriodDays(0)).toBeGreaterThan(24.5);
    expect(rotationPeriodDays(0)).toBeLessThan(25.5);
    expect(rotationPeriodDays(75 * DEG)).toBeGreaterThan(33);
    expect(rotationPeriodDays(75 * DEG)).toBeLessThan(36);
  });

  it('is deterministic in sim time and fits the uniform budget', () => {
    const t = jd('2024-10-10T06:00:00Z');
    expect(activeGroups(t)).toEqual(activeGroups(t));
    const a = new SunActivity();
    const b = new SunActivity();
    a.update(t);
    b.update(t + 3);
    b.update(t);
    expect([...a.spots]).toEqual([...b.spots]);
    expect([...a.prom]).toEqual([...b.prom]);
    expect(a.spotCount).toBeGreaterThan(10);
    expect(a.spotCount).toBeLessThanOrEqual(MAX_SPOTS);
    expect(a.spots.every(Number.isFinite)).toBe(true);
  });

  it('groups decay over days to weeks, umbrae and lengths are in range', () => {
    const groups = activeGroups(jd('2024-10-10T00:00:00Z'));
    for (const g of groups) {
      expect(g.lifeDays).toBeGreaterThanOrEqual(3);
      expect(g.lifeDays).toBeLessThanOrEqual(40);
      expect(g.lengthM).toBeGreaterThanOrEqual(50e6);
      expect(g.lengthM).toBeLessThanOrEqual(200e6);
      expect(g.spots[0].umbraM).toBeLessThanOrEqual(12.5e6);
    }
    // A group seen now is gone (or decayed) a life later.
    const g = groups[0];
    expect(activeGroups(g.birthJd + g.lifeDays + 0.01).some((h) => h.id === g.id)).toBe(false);
  });

  it('flares are short-lived and occasional; prominences have 10-100 Mm heights', () => {
    let on = 0;
    const t0 = jd('2024-10-01T00:00:00Z');
    for (let h = 0; h < 24 * 20; h++) if (flareAt(12345, 0.8, t0 + h / 24) > 0) on++;
    expect(on).toBeGreaterThan(5);
    expect(on).toBeLessThan(24 * 20 * 0.6);
    const pr = prominences(t0, activeGroups(t0));
    expect(pr.length).toBeGreaterThanOrEqual(6);
    for (const p of pr.filter((q) => q.type === 0)) {
      expect(p.height * 696).toBeGreaterThanOrEqual(9.9);
      expect(p.height * 696).toBeLessThanOrEqual(101);
    }
  });
});
