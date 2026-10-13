import { describe, expect, it } from 'vitest';
import {
  EPOCH_JD,
  KIND,
  generateBelts,
  mainBeltDensity,
  planetMeanLongitude,
  populationCounts,
  positionAt,
  rebase,
  solveKepler4,
  wrapPi,
} from '../../../src/modules/smallbodies/public';
import { solveKepler } from '../../../src/modules/solar-system/public';

const DEG = Math.PI / 180;

describe('smallbodies Kepler solver (Mikkola + 4 Newton)', () => {
  it('converges to 1e-9 for e up to 0.97 over the whole M range', () => {
    let worst = 0;
    for (let ie = 0; ie <= 97; ie++) {
      const e = ie / 100;
      for (let j = 0; j <= 4000; j++) {
        const M = -Math.PI + (2 * Math.PI * j) / 4000;
        const E = solveKepler4(M, e);
        worst = Math.max(worst, Math.abs(wrapPi(E - e * Math.sin(E) - M)));
      }
    }
    expect(worst).toBeLessThan(1e-9);
  });

  it('agrees with the solar-system float64 solver and wraps any M', () => {
    for (const [M, e] of [
      [0.3, 0.2],
      [-2.9, 0.9],
      [17.5, 0.5],
      [1e-6, 0.97],
    ]) {
      expect(Math.abs(wrapPi(solveKepler4(M, e) - solveKepler(wrapPi(M), e)))).toBeLessThan(1e-9);
    }
  });
});

describe('smallbodies populations', () => {
  const belts = generateBelts(150000, 1);

  it('is deterministic per seed and splits counts by population', () => {
    const again = generateBelts(2000, 1);
    const other = generateBelts(2000, 2);
    const first = generateBelts(2000, 1);
    expect(Array.from(again.el0.subarray(0, 64))).toEqual(Array.from(first.el0.subarray(0, 64)));
    expect(Array.from(other.el0.subarray(0, 64))).not.toEqual(Array.from(first.el0.subarray(0, 64)));
    const c = populationCounts(20000);
    expect(c.main + c.hilda + c.trojan + c.kuiper + c.plutino).toBe(20000);
    expect(c.main).toBeGreaterThan(c.kuiper);
  });

  it('carves a Kirkwood gap at 2.50 AU (density minimum vs 2.3 and 2.7 AU)', () => {
    const bin = (a0: number) => {
      let n = 0;
      for (let k = 0; k < belts.count; k++) {
        const a = belts.el0[4 * k];
        if (belts.kind[k] === KIND.main && a >= a0 - 0.01 && a < a0 + 0.01) n++;
      }
      return n;
    };
    const gap = bin(2.5);
    expect(gap).toBeLessThan(0.15 * bin(2.3));
    expect(gap).toBeLessThan(0.15 * bin(2.7));
    for (const g of [2.825, 2.958, 3.279])
      expect(mainBeltDensity(g)).toBeLessThan(0.5 * mainBeltDensity(2.65));
  });

  it('keeps Trojans near L4/L5 and Hildas/plutinos in resonance after decades', () => {
    const jd = EPOCH_JD + 26 * 365.25;
    const lJ = planetMeanLongitude('jupiter', jd);
    let l4 = 0;
    let l5 = 0;
    let n = 0;
    for (let k = 0; k < belts.count && n < 3000; k++) {
      if (belts.kind[k] !== KIND.trojan) continue;
      const [x, y] = positionAt(belts, k, jd);
      const d = wrapPi(Math.atan2(y, x) - lJ) / DEG;
      if (Math.abs(d - 60) < 45) l4++;
      else if (Math.abs(d + 60) < 45) l5++;
      n++;
    }
    expect(l4 + l5).toBeGreaterThan(0.95 * n);
    expect(l4).toBeGreaterThan(l5);
    // Hildas: n exactly 3/2 of Jupiter's, so the resonant angle never drifts.
    for (let k = 0; k < belts.count; k++) {
      if (belts.kind[k] === KIND.hilda) {
        expect(belts.n[k] / ((3034.74612775 / 36525) * DEG)).toBeCloseTo(1.5, 9);
        break;
      }
    }
    const kuiper = Array.from(belts.kind).filter((x) => x === KIND.kuiper || x === KIND.plutino).length;
    expect(kuiper).toBeGreaterThan(0.15 * belts.count);
  });

  it('float32 GPU propagation after a rebase matches the float64 twin (time warp)', () => {
    const b = generateBelts(500, 3);
    const jd0 = EPOCH_JD + 9500.25;
    rebase(b, jd0);
    const f = Math.fround;
    for (const dt of [0, 37.5, 199]) {
      for (let k = 0; k < b.count; k += 7) {
        if (b.lib[2 * k] > 0) continue;
        const M = f(f(b.el1[4 * k + 1]) + f(f(b.el1[4 * k + 2]) * f(dt)));
        const ref = positionAt(b, k, jd0 + dt);
        // Rebuild the position with the float32 mean anomaly through the float64 path.
        const save = b.m0[k];
        b.m0[k] = M - b.n[k] * (jd0 + dt - EPOCH_JD);
        const got = positionAt(b, k, jd0 + dt);
        b.m0[k] = save;
        const err = Math.hypot(got[0] - ref[0], got[1] - ref[1], got[2] - ref[2]);
        expect(err).toBeLessThan(2e-5); // AU (< 3,000 km)
      }
    }
  });
});
