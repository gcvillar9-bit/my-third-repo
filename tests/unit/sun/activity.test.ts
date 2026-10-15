import { describe, expect, it } from 'vitest';
import { parseInstant } from '../../../src/core/time';
import {
  MAX_FILAMENTS,
  MAX_REGIONS,
  MAX_SPOTS,
  SunActivity,
  activeGroups,
  filamentAngle,
  filamentPoints,
  filaments,
  flareAt,
  groupAxes,
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
      expect(p.height * 696).toBeLessThanOrEqual(121);
    }
  });

  it('groups are bipolar: a compact leading spot, a fragmented following cluster, pores', () => {
    const groups = activeGroups(jd('2024-10-10T12:00:00Z'));
    const big = groups.filter((g) => g.size > 0.4 && g.strength > 0.5);
    expect(big.length).toBeGreaterThan(0);
    for (const g of big) {
      const [lead, ...rest] = g.spots;
      expect(lead.penumbra).toBe(true);
      for (const s of rest) expect(s.umbraM).toBeLessThan(lead.umbraM);
      // Along the Joy-tilted axis: the leading spot ahead of the centre, most others behind it.
      const { axis } = groupAxes(g);
      const along = (d: number[]) => d.reduce((a, v, k) => a + (v - g.centre[k]) * axis[k], 0);
      expect(along(lead.dir)).toBeGreaterThan(0);
      expect(rest.filter((s) => along(s.dir) < 0).length).toBeGreaterThanOrEqual(2);
    }
    const all = groups.flatMap((g) => g.spots);
    expect(all.some((s) => !s.penumbra)).toBe(true); // decayed / small spots are pores
    for (const s of all) {
      expect(s.seed).toBeGreaterThanOrEqual(0);
      expect(s.seed).toBeLessThan(128);
      expect(s.penumbra).toBe(s.umbraM > 1.6e6);
    }
  });

  it('packs the visible hemisphere first when the spots outnumber the uniform slots', () => {
    const t = jd('2024-10-10T12:00:00Z');
    const groups = activeGroups(t);
    expect(groups.reduce((n, g) => n + g.spots.length, 0)).toBeGreaterThan(MAX_SPOTS); // crowded
    for (const v of [
      [3, 0, 0],
      [-3, 0, 0],
      [0, 2, 1],
    ] as [number, number, number][]) {
      const a = new SunActivity();
      a.update(t, v);
      expect(a.spotCount).toBeLessThanOrEqual(MAX_SPOTS);
      expect(a.regionCount).toBeLessThanOrEqual(MAX_REGIONS);
      const d = Math.hypot(...v);
      const visible = groups.filter((g) => g.centre.reduce((s, c, k) => s + c * v[k], 0) / d > 1 / d - 0.15);
      // Every visible group whose spots fit is packed (regions carry the group centres).
      const packed = new Set<string>();
      for (let i = 0; i < a.regionCount; i++)
        packed.add([0, 1, 2].map((k) => a.regions[i * 4 + k].toFixed(4)).join());
      const missing = visible.filter(
        (g) => !packed.has(g.centre.map((c) => Math.fround(c).toFixed(4)).join()),
      );
      expect(missing.length).toBeLessThanOrEqual(1);
      // w = +/-(seed + umbra radius): integer seed < 128, radius < 0.02 R; negative for pores.
      for (let i = 0; i < a.spotCount; i++) {
        const w = Math.abs(a.spots[i * 4 + 3]);
        expect(Math.floor(w)).toBeLessThan(128);
        expect(w - Math.floor(w)).toBeGreaterThan(0);
        expect(w - Math.floor(w)).toBeLessThan(0.02);
      }
    }
  });

  it('filaments are the quiescent prominences seen on the disk', () => {
    const t = jd('2024-10-19T12:00:00Z');
    const pr = prominences(t, activeGroups(t));
    const fl = filaments(pr);
    expect(fl.length).toBeGreaterThanOrEqual(8);
    expect(fl.length).toBeLessThanOrEqual(MAX_FILAMENTS);
    for (const f of fl) {
      expect(f.halfLength * 696).toBeGreaterThanOrEqual(20);
      expect(f.halfLength).toBeLessThanOrEqual(0.45);
      expect(Math.abs(filamentAngle(f.seed))).toBeLessThanOrEqual(0.7);
      const pts = filamentPoints(f, 5);
      expect(pts[2][0]).toBeCloseTo(f.dir[0], 6);
      const end = Math.acos(pts[0].reduce((a, v, k) => a + v * f.dir[k], 0));
      expect(end).toBeCloseTo(Math.atan(0.9 * f.halfLength), 6);
    }
    const a = new SunActivity();
    a.update(t);
    expect(a.filCount).toBe(fl.length);
    for (let i = 0; i < a.filCount; i++) {
      const w = a.fil[i * 4 + 3];
      expect(Math.floor(w)).toBe(fl[i].seed);
      expect(w - Math.floor(w)).toBeCloseTo(fl[i].halfLength, 4);
    }
  });
});
