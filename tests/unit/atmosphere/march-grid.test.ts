import { describe, expect, it } from 'vitest';
import {
  gridDistance,
  march,
  marchGrid,
  raySphere,
  stepGrid,
  transmittance,
  transmittanceParams,
  type Lut2D,
  type Luts,
} from '../../../src/modules/atmosphere/model';
import { ATMOSPHERE_ROWS, paramsFromRow } from '../../../src/modules/atmosphere/params';

/**
 * Planet stripe fix: the outside-view march uses a fixed step grid from the segment's dense end with
 * a fractional step at the thin end, instead of a whole step count that followed the path length
 * (dithered per pixel). The integral must be continuous across the disc, and no dearer than before.
 */
const earth = paramsFromRow(
  ATMOSPHERE_ROWS.find((r) => r.id === 'earth')!,
  6378137,
);
// Single scattering with the exact transmittance integral: no LUT texels, so any jump is the march's.
const luts: Luts = {
  trans: {
    sample: (u: number, v: number) => transmittance(earth, ...transmittanceParams(earth, u, v)),
  } as unknown as Lut2D,
  ms: null,
};
const SHELL = earth.topKm - earth.bottomKm;
const CAP = 40; // medium's march steps
type V3 = [number, number, number];

// Rays from 3 Earth radii across the disc (centre to 90% of its radius), Sun 40 deg off the view axis.
const D = 3 * earth.bottomKm;
const ro: V3 = [0, 0, D];
const sun: V3 = [Math.sin(0.7), 0, Math.cos(0.7)];

function sweep(n: number) {
  const amax = 0.9 * Math.asin(earth.bottomKm / D);
  const grid: number[] = [];
  const whole: number[] = [];
  let stepsGrid = 0;
  let stepsWhole = 0;
  for (let i = 0; i <= n; i++) {
    const a = (amax * i) / n;
    const rd: V3 = [Math.sin(a), 0, -Math.cos(a)];
    const tStart = raySphere(ro, rd, earth.topKm)![0];
    const tEnd = raySphere(ro, rd, earth.bottomKm)![0];
    const path = tEnd - tStart;
    grid.push(marchGrid(earth, luts, ro, rd, sun, tEnd, path, -1, CAP).L[1]);
    stepsGrid += stepGrid(path, SHELL, CAP).n;
    // The former scheme without its dither: the step count follows the path in whole steps.
    const k = Math.min(CAP, Math.max(8, Math.floor(path / (SHELL / 8))));
    whole.push(march(earth, luts, ro, rd, sun, tStart, tEnd, k, true, false).L[1]);
    stepsWhole += k;
  }
  return { grid, whole, stepsGrid, stepsWhole };
}

/** Largest |second difference| relative to the value: a jump keeps it as sampling gets finer. */
function roughness(v: number[]): number {
  let worst = 0;
  for (let i = 1; i < v.length - 1; i++)
    worst = Math.max(worst, Math.abs(v[i + 1] - 2 * v[i] + v[i - 1]) / v[i]);
  return worst;
}

const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;

describe('outside-view march grid', () => {
  it("takes 8 steps through Earth's vertical column, the first 2 km, and stretches past the cap", () => {
    const g = stepGrid(SHELL, SHELL, CAP);
    expect(g.n).toBe(8);
    expect(gridDistance(g, 1)).toBeCloseTo(2, 6);
    expect(gridDistance(g, g.xMax)).toBeCloseTo(SHELL, 6);
    const long = stepGrid(5000, SHELL, 20);
    expect(long.n).toBe(20);
    expect(gridDistance(long, long.xMax)).toBeCloseTo(5000, 6);
    // Continuous at the cap: the path that exactly fills 20 steps needs no stretch.
    const s20 = (20 * (0.5 + 1.5 * 20) * SHELL) / 100;
    expect(stepGrid(s20, SHELL, 20).xMax).toBeCloseTo(20, 9);
    expect(stepGrid(s20 * 1.001, SHELL, 20).unitKm).toBeCloseTo(1.001, 9);
  });

  it('is continuous across the disc where whole step counts jumped, with no more steps', () => {
    const a = sweep(400);
    const b = sweep(800);
    // Whole-count steps jump: the largest second difference stays as the sampling doubles.
    expect(roughness(b.whole)).toBeGreaterThan(0.8 * roughness(a.whole));
    // The grid is continuous: it halves (kinks of the medium profile only) and is far below.
    expect(roughness(b.grid)).toBeLessThan(0.6 * roughness(a.grid));
    expect(roughness(a.grid)).toBeLessThan(0.2 * roughness(a.whole));
    expect(a.stepsGrid).toBeLessThanOrEqual(a.stepsWhole);
    // Same radiance as the former quadrature (within 1% on average).
    expect(Math.abs(mean(a.grid) / mean(a.whole) - 1)).toBeLessThan(0.01);
  });

  it('marches a limb ray as two capped halves around the closest approach', () => {
    const s = (earth.bottomKm + 5) / D;
    const rd: V3 = [s, 0, -Math.sqrt(1 - s * s)];
    const [t0, t1] = raySphere(ro, rd, earth.topKm)!;
    const tc = -(ro[0] * rd[0] + ro[1] * rd[1] + ro[2] * rd[2]);
    expect(stepGrid(tc - t0, SHELL, CAP / 2).n).toBe(CAP / 2);
    const acc = marchGrid(earth, luts, ro, rd, sun, tc, tc - t0, -1, CAP / 2);
    marchGrid(earth, luts, ro, rd, sun, tc, t1 - tc, 1, CAP / 2, acc);
    const ref = march(earth, luts, ro, rd, sun, t0, tc, 200, true, false);
    march(earth, luts, ro, rd, sun, tc, t1, 200, false, false, ref);
    expect(Math.abs(acc.L[1] / ref.L[1] - 1)).toBeLessThan(0.03);
    expect(Math.abs(acc.T[1] / ref.T[1] - 1)).toBeLessThan(0.03);
  });
});
