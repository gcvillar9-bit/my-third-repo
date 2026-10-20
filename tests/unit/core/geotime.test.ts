import { describe, expect, it } from 'vitest';
import {
  ERA_PRESETS,
  JD_PRESENT_BP,
  PHASE_PERIOD_DAYS,
  formatAge,
  geologicPlace,
  jdFromYearsBP,
  parseUserInstant,
  yearsBeforePresent,
} from '../../../src/core/geotime';
import geotime from '../../../src/core/geotime.json';
import { jdToIso, parseInstant, utcToTt } from '../../../src/core/time';
import { JD_J2000 } from '../../../src/core/units';

const NOW = utcToTt(Date.UTC(2026, 5, 15, 14, 30) / 86400000 + 2440587.5);
const frac = (x: number) => x - Math.floor(x);

describe('geologic time', () => {
  it('has a source on every unit and ascending bases per rank', () => {
    for (const u of geotime.units) expect(u.source, u.name).toMatch(/ICS/);
    for (const rank of ['epoch', 'period', 'era', 'eon']) {
      const bases = geotime.units.filter((u) => u.rank === rank).map((u) => u.baseMa);
      expect(bases, rank).toEqual([...bases].sort((a, b) => a - b));
    }
  });

  it('names the unit at an age, boundary ages belonging to the older unit', () => {
    expect(geologicPlace(0)!.label).toBe('Holocene');
    expect(geologicPlace(21e3)!.label).toBe('Pleistocene');
    expect(geologicPlace(66e6)!.label).toBe('Late Cretaceous');
    expect(geologicPlace(65.9e6)!.label).toBe('Paleocene');
    expect(geologicPlace(150e6)!.label).toBe('Late Jurassic');
    expect(geologicPlace(255e6)!.label).toBe('Permian');
    expect(geologicPlace(300e6)!.label).toBe('Carboniferous');
    expect(geologicPlace(530e6)!.label).toBe('Cambrian');
    expect(geologicPlace(600e6)!.label).toBe('Ediacaran');
    expect(geologicPlace(600e6)!.approximate).toBe(true);
    expect(geologicPlace(1.1e9)!.label).toBe('Stenian');
    expect(geologicPlace(-10)).toBeNull();
    expect(formatAge(21e3)).toBe('21.0 ka');
    expect(formatAge(66e6)).toBe('66.0 Ma');
    expect(formatAge(1e9)).toBe('1.00 Ga');
  });

  it('converts years before 1950 straight to TT', () => {
    expect(JD_PRESENT_BP).toBe(JD_J2000 - 50 * 365.25);
    expect(yearsBeforePresent(jdFromYearsBP(66e6))).toBeCloseTo(66e6, 3);
  });
});

describe('parseUserInstant', () => {
  it('reads deep-time ages, keeping the time of day and season of the view', () => {
    for (const text of ['66 Ma', '66Ma', '66 mya', '66 Myr ago', '66 million years ago', '66,000 ka']) {
      const jd = parseUserInstant(text, NOW) as number;
      expect(typeof jd, text).toBe('number');
      const bp = yearsBeforePresent(jd);
      expect(bp, text).toBeGreaterThanOrEqual(66e6);
      expect(bp, text).toBeLessThan(66e6 + 4);
      // Whole 4-year steps from now: same time of day (to float64 resolution at 66 Ma).
      expect(Math.abs(frac(jd) - frac(NOW)), text).toBeLessThan(1e-5);
      expect(
        Math.abs(((((NOW - jd) % PHASE_PERIOD_DAYS) + PHASE_PERIOD_DAYS) % PHASE_PERIOD_DAYS) - 0),
      ).toBeLessThan(1e-4);
    }
    expect(yearsBeforePresent(parseUserInstant('21 ka', NOW) as number)).toBeCloseTo(21e3, -1);
    expect(yearsBeforePresent(parseUserInstant('1.2 Ga', NOW) as number)).toBeCloseTo(1.2e9, -2);
  });

  it('reads historical years at the current month, day and time', () => {
    const at = (text: string, iso: string) =>
      expect(
        Math.abs(Date.parse(jdToIso(parseUserInstant(text, NOW) as number)!) - Date.parse(iso)),
        text,
      ).toBeLessThan(1000);
    at('1066', '1066-06-15T14:30:00Z');
    at('AD 1066', '1066-06-15T14:30:00Z');
    at('1066 CE', '1066-06-15T14:30:00Z');
    at('500 BC', '-000499-06-15T14:30:00Z');
    at('-2999', '-002999-06-15T14:30:00Z');
    at('26 years ago', '2000-06-15T14:30:00Z');
  });

  it('keeps JDs, ISO dates and now, and rejects nonsense', () => {
    expect(parseUserInstant('now', NOW)).toBe('now');
    expect(parseUserInstant('JD 2451545', NOW)).toBe(2451545);
    expect(parseUserInstant('2451545', NOW)).toBe(2451545);
    expect(parseUserInstant('-24104454455.5', NOW)).toBe(-24104454455.5);
    expect(parseUserInstant('2026-01-01', NOW)).toBe(parseInstant('2026-01-01'));
    expect(parseUserInstant('dinosaurs', NOW)).toBeNull();
    expect(parseUserInstant('', NOW)).toBeNull();
  });

  it('offers presets it can parse', () => {
    for (const p of ERA_PRESETS) expect(parseUserInstant(p.value, NOW), p.value).not.toBeNull();
  });

  it('round-trips deep-past share links (negative JDs)', () => {
    const jd = jdFromYearsBP(250e6);
    expect(parseInstant(String(jd))).toBe(jd);
  });
});
