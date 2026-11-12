/**
 * Radial number density of real comets (larger than 1 km) in the model, three-free: a weighted histogram
 * in ln r of a generated sample (each point's distance from the Sun at J2000), normalised so the points
 * with a > population.outerFromAu add up to population.outerCount (Boe et al. 2019).
 */
import { EPOCH_JD, generateCloud, positionAt } from './generate';
import model from './model.json';

/** Bins span ln r over [R_MIN_AU, R_MAX_AU]. */
export const R_MIN_AU = 20;
export const R_MAX_AU = 400_000;
const BINS = 44;
const LN_MIN = Math.log(R_MIN_AU);
const DLN = (Math.log(R_MAX_AU) - LN_MIN) / BINS;

export interface DensityProfile {
  /** Comets larger than 1 km per cubic AU at the bin centres. */
  readonly n: Float64Array;
  /** Real comets one sample point of weight 1 stands for. */
  readonly cometsPerWeight: number;
  /** Comets larger than 1 km in the whole model (all semi-major axes). */
  readonly totalComets: number;
}

/** Builds the profile from `sampleCount` points of the seeded model (about 30 ms for 40,000). */
export function buildDensity(sampleCount = 40_000, seed = 1): DensityProfile {
  const c = generateCloud(sampleCount, seed);
  const hist = new Float64Array(BINS);
  const p: [number, number, number] = [0, 0, 0];
  let outerW = 0;
  let totalW = 0;
  for (let k = 0; k < c.count; k++) {
    const w = c.el1[2 * k + 1];
    totalW += w;
    if (c.el0[4 * k] > model.population.outerFromAu) outerW += w;
    positionAt(c, k, EPOCH_JD, p);
    // Cloud-in-cell in ln r: split the weight between the two nearest bin centres.
    const x = (Math.log(Math.hypot(p[0], p[1], p[2])) - LN_MIN) / DLN - 0.5;
    const i = Math.floor(x);
    const f = x - i;
    if (i >= 0 && i < BINS) hist[i] += w * (1 - f);
    if (i + 1 >= 0 && i + 1 < BINS) hist[i + 1] += w * f;
  }
  const cometsPerWeight = model.population.outerCount / outerW;
  const n = new Float64Array(BINS);
  for (let i = 0; i < BINS; i++) {
    const r0 = Math.exp(LN_MIN + i * DLN);
    const r1 = Math.exp(LN_MIN + (i + 1) * DLN);
    n[i] = (hist[i] * cometsPerWeight) / ((4 / 3) * Math.PI * (r1 ** 3 - r0 ** 3));
  }
  return { n, cometsPerWeight, totalComets: totalW * cometsPerWeight };
}

/** Comets larger than 1 km per cubic AU at `rAu` from the Sun (log-log interpolation; 0 outside). */
export function densityAt(p: DensityProfile, rAu: number): number {
  if (!(rAu >= R_MIN_AU && rAu <= R_MAX_AU)) return 0;
  const x = Math.min(BINS - 1, Math.max(0, (Math.log(rAu) - LN_MIN) / DLN - 0.5));
  const i = Math.min(BINS - 2, Math.floor(x));
  const f = x - i;
  const a = p.n[i];
  const b = p.n[i + 1];
  if (!(a > 0) || !(b > 0)) return (1 - f) * a + f * b;
  return Math.exp((1 - f) * Math.log(a) + f * Math.log(b));
}

/** Mean distance between neighbouring comets, n^(-1/3), AU (Infinity where the model has none). */
export function meanSpacingAu(p: DensityProfile, rAu: number): number {
  const n = densityAt(p, rAu);
  return n > 0 ? n ** (-1 / 3) : Infinity;
}

/** Inside this distance the camera is among the planets and the Kuiper belt, not in the cloud, AU. */
export const HELIOSPHERE_AU = 120;

/** The model region at a distance from the Sun (by the regions' semi-major-axis limits). */
export function regionAt(rAu: number): { id: string; name: string } {
  if (rAu < HELIOSPHERE_AU) return { id: 'planetary', name: 'Planetary region (inside the heliosphere)' };
  for (const r of model.regions) if (rAu < r.aMaxAu) return { id: r.id, name: r.name };
  return { id: 'beyond', name: 'Beyond the Oort Cloud' };
}
