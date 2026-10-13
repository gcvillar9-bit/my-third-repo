import { describe, expect, it } from 'vitest';
import { jdToIso, parseInstant } from '../../../src/core/time';
import {
  LUXOR,
  diskVisibleFraction,
  ellipsoidPoint,
  localSolarEclipse,
  nextLunarEclipse,
  nextSolarEclipse,
  skyFactor,
} from '../../../src/modules/eclipses/public';

const jd = (iso: string) => parseInstant(iso)!;
const minutesBetween = (a: number, b: number) => Math.abs(a - b) * 1440;

describe('eclipse finder', () => {
  it('2024-04-08: greatest eclipse near 25.3N 104.1W at about 18:17 UTC', () => {
    const e = nextSolarEclipse(jd('2024-03-01T00:00:00Z'));
    expect(e.kind).toBe('total');
    expect(e.latDeg!).toBeCloseTo(25.3, 0);
    expect(Math.abs(e.lonDeg! - -104.1)).toBeLessThan(0.6);
    expect(jdToIso(e.peakJd)!.slice(0, 10)).toBe('2024-04-08');
    expect(minutesBetween(e.peakJd, jd('2024-04-08T18:17:00Z'))).toBeLessThan(3);
  });

  it('2027-08-02: total near Luxor, greatest eclipse close to the city', () => {
    const local = localSolarEclipse(jd('2027-07-01T00:00:00Z'), LUXOR.latDeg, LUXOR.lonDeg, LUXOR.heightM);
    expect(local.kind).toBe('total');
    expect(jdToIso(local.peakJd)!.slice(0, 10)).toBe('2027-08-02');
    expect(local.sunAltitudeDeg).toBeGreaterThan(70);
    expect((local.totalEndJd! - local.totalBeginJd!) * 1440).toBeGreaterThan(5.5); // ~6 min totality
    const g = nextSolarEclipse(jd('2027-07-01T00:00:00Z'));
    expect(g.kind).toBe('total');
    expect(Math.abs(g.latDeg! - LUXOR.latDeg)).toBeLessThan(1.5);
    expect(Math.abs(g.lonDeg! - LUXOR.lonDeg)).toBeLessThan(1.5);
    expect(minutesBetween(g.peakJd, local.peakJd)).toBeLessThan(5);
  });

  it('finds the total lunar eclipse of 2025-09-07', () => {
    const e = nextLunarEclipse(jd('2025-08-15T00:00:00Z'));
    expect(e.kind).toBe('total');
    expect(jdToIso(e.peakJd)!.slice(0, 10)).toBe('2025-09-07');
    expect(e.totalMin).toBeGreaterThan(70);
  });
});

describe('eclipse sky', () => {
  it('visible disk fraction: none, annular, partial, total', () => {
    const rs = 4.65e-3;
    expect(diskVisibleFraction(rs, 0.9 * rs, 10 * rs)).toBe(1);
    expect(diskVisibleFraction(rs, 1.05 * rs, 0)).toBe(0);
    expect(diskVisibleFraction(rs, 0.9 * rs, 0)).toBeCloseTo(1 - 0.81, 10);
    const half = diskVisibleFraction(rs, rs, 0.8 * rs);
    expect(half).toBeGreaterThan(0.3);
    expect(half).toBeLessThan(0.7);
    expect(skyFactor(0)).toBeLessThan(1e-3);
    expect(skyFactor(1)).toBe(1);
  });

  it('ellipsoid point sits on the WGS84 surface at the eye height', () => {
    const a = 6378137;
    const f = 1 / 298.257223563;
    const p = ellipsoidPoint(LUXOR.latDeg, LUXOR.lonDeg, a, f, 0);
    const b = a * (1 - f);
    expect((p.x * p.x + p.y * p.y) / (a * a) + (p.z * p.z) / (b * b)).toBeCloseTo(1, 9);
    const q = ellipsoidPoint(LUXOR.latDeg, LUXOR.lonDeg, a, f, 1.7);
    expect(Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z)).toBeCloseTo(1.7, 6);
  });
});
