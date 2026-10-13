/**
 * Deterministic (seeded) orbital elements of the belts, three-free. Elements are heliocentric,
 * ecliptic J2000, at epoch `epochJd` (J2000). Populations:
 * - main belt: a in 2.1-3.3 AU from a smooth bump times Gaussian notches at the Kirkwood gaps
 *   (3:1, 5:2, 7:3, 2:1), so the gaps live in the a-distribution as in reality;
 * - Hildas: n = 3/2 n_Jupiter exactly, resonant angle 3 lambda_J - 2 lambda - varpi near 0, which
 *   draws the Hilda triangle in Jupiter's rotating frame;
 * - Trojans: n = n_Jupiter, lambda = lambda_J +-60 deg plus a libration term (L4 more populous);
 * - Kuiper belt: classical 42-48 AU (cold and hot), plutinos at n = 2/3 n_Neptune with the
 *   resonant angle 3 lambda - 2 lambda_N - varpi near 180 deg.
 */
import data from './populations.json';
import { solveKepler4, wrapPi } from './kepler4';

export const KIND = { main: 0, hilda: 1, trojan: 2, kuiper: 3, plutino: 4 } as const;
export type PopulationName = keyof typeof KIND;
const DEG = Math.PI / 180;
const TWO_PI = 2 * Math.PI;
export const EPOCH_JD: number = data.epochJd;
const K = data.gaussK; // rad/day for a in AU

export interface BeltElements {
  count: number;
  /** Epoch of el1 mean anomalies and lib phases on the GPU (rebase moves it). */
  baseJd: number;
  /** a [AU], e, i [rad], node [rad] per point. */
  el0: Float32Array;
  /** arg. of perihelion [rad], M at baseJd [rad], n [rad/day], H [mag] per point. */
  el1: Float32Array;
  /** Libration amplitude [rad] (Trojans only, else 0) and phase at baseJd [rad]. */
  lib: Float32Array;
  /** Float64 masters at EPOCH_JD: mean anomaly, mean motion, libration phase. */
  m0: Float64Array;
  n: Float64Array;
  libPhase0: Float64Array;
  kind: Uint8Array;
  /** Trojan libration frequency, rad/day. */
  libFreq: number;
}

/** Seeded PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mean motion of Jupiter or Neptune (Standish mean elements), rad/day. */
export const planetMeanMotion = (p: 'jupiter' | 'neptune'): number => (data.planets[p].rate / 36525) * DEG;

/** Mean longitude (ecliptic J2000) of Jupiter or Neptune at `jd`, rad. */
export function planetMeanLongitude(p: 'jupiter' | 'neptune', jd: number): number {
  return wrapPi(data.planets[p].L0 * DEG + planetMeanMotion(p) * (jd - EPOCH_JD));
}

/** Main-belt relative density in a (AU): smooth bump times flat-bottomed (super-Gaussian) Kirkwood notches (max 1). */
export function mainBeltDensity(a: number): number {
  const m = data.main;
  if (a <= m.aMin || a >= m.aMax) return 0;
  let d = Math.sin((Math.PI * (a - m.aMin)) / (m.aMax - m.aMin)) ** 0.6;
  for (const g of m.gaps) d *= 1 - g.depth * Math.exp(-(((a - g.a) / g.width) ** 4));
  return d;
}

/** Number of points per population for a total count (fractions from populations.json). */
export function populationCounts(total: number): Record<PopulationName, number> {
  const f = data.fractions;
  const out = {} as Record<PopulationName, number>;
  let used = 0;
  for (const name of ['hilda', 'trojan', 'kuiper', 'plutino'] as const) {
    out[name] = Math.round(total * f[name]);
    used += out[name];
  }
  out.main = total - used;
  return out;
}

const aFromN = (n: number): number => (K / n) ** (2 / 3);

export function generateBelts(total: number, seed = 1): BeltElements {
  const rnd = mulberry32(seed * 7919 + 17);
  const rayleigh = (sigma: number, max: number) =>
    Math.min(max, sigma * Math.sqrt(-2 * Math.log(1 - rnd() * 0.999999)));
  const hMag = ([h0, h1]: number[]) => {
    const a = 10 ** (0.3 * h0);
    const b = 10 ** (0.3 * h1);
    return Math.log10(a + rnd() * (b - a)) / 0.3;
  };
  const b: BeltElements = {
    count: total,
    baseJd: EPOCH_JD,
    el0: new Float32Array(total * 4),
    el1: new Float32Array(total * 4),
    lib: new Float32Array(total * 2),
    m0: new Float64Array(total),
    n: new Float64Array(total),
    libPhase0: new Float64Array(total),
    kind: new Uint8Array(total),
    libFreq: TWO_PI / (data.trojan.libPeriodYr * 365.25),
  };
  const lJ = planetMeanLongitude('jupiter', EPOCH_JD);
  const lN = planetMeanLongitude('neptune', EPOCH_JD);
  const nJ = planetMeanMotion('jupiter');
  const nN = planetMeanMotion('neptune');
  let k = 0;
  const put = (
    kind: number,
    a: number,
    e: number,
    inc: number,
    node: number,
    varpi: number,
    lambda: number,
    n: number,
    H: number,
    libAmp = 0,
    libPhase = 0,
  ) => {
    b.el0.set([a, e, inc, wrapPi(node)], 4 * k);
    b.m0[k] = wrapPi(lambda - varpi);
    b.n[k] = n;
    b.libPhase0[k] = libPhase;
    b.el1.set([wrapPi(varpi - node), b.m0[k], n, H], 4 * k);
    b.lib.set([libAmp, libPhase], 2 * k);
    b.kind[k] = kind;
    k++;
  };
  const counts = populationCounts(total);
  const m = data.main;
  for (let i = 0; i < counts.main; i++) {
    let a = 0;
    do a = m.aMin + rnd() * (m.aMax - m.aMin);
    while (rnd() > mainBeltDensity(a));
    const node = rnd() * TWO_PI;
    put(
      KIND.main,
      a,
      rayleigh(m.eSigma, m.eMax),
      rayleigh(m.iSigmaDeg * DEG, 35 * DEG),
      node,
      rnd() * TWO_PI,
      rnd() * TWO_PI,
      K * a ** -1.5,
      hMag(m.H),
    );
  }
  const h = data.hilda;
  for (let i = 0; i < counts.hilda; i++) {
    const n = 1.5 * nJ;
    const varpi = rnd() * TWO_PI;
    const sigma = (2 * rnd() - 1) * h.sigmaAmpDeg * DEG;
    const lambda = (3 * lJ - varpi - sigma) / 2 + (rnd() < 0.5 ? 0 : Math.PI);
    put(
      KIND.hilda,
      aFromN(n) + (2 * rnd() - 1) * h.aSpread,
      h.eMin + rnd() * (h.eMax - h.eMin),
      rayleigh(h.iSigmaDeg * DEG, 30 * DEG),
      rnd() * TWO_PI,
      varpi,
      lambda,
      n,
      hMag(h.H),
    );
  }
  const t = data.trojan;
  for (let i = 0; i < counts.trojan; i++) {
    const lead = rnd() < t.l4Fraction ? 1 : -1; // L4 leads Jupiter by 60 deg
    const varpi = rnd() * TWO_PI;
    put(
      KIND.trojan,
      aFromN(nJ) + (2 * rnd() - 1) * t.aSpread,
      rnd() * t.eMax,
      rayleigh(t.iSigmaDeg * DEG, 40 * DEG),
      rnd() * TWO_PI,
      varpi,
      lJ + lead * 60 * DEG,
      nJ,
      hMag(t.H),
      Math.max(1e-4, t.libAmpMaxDeg * DEG * Math.sqrt(rnd())),
      rnd() * TWO_PI,
    );
  }
  const kb = data.kuiper;
  for (let i = 0; i < counts.kuiper; i++) {
    const cold = rnd() < kb.coldFraction;
    const a = kb.aMin + rnd() * (kb.aMax - kb.aMin);
    put(
      KIND.kuiper,
      a,
      rayleigh(cold ? kb.eSigmaCold : kb.eSigmaHot, cold ? 0.2 : 0.3),
      rayleigh((cold ? kb.iColdDeg : kb.iHotDeg) * DEG, 45 * DEG),
      rnd() * TWO_PI,
      rnd() * TWO_PI,
      rnd() * TWO_PI,
      K * a ** -1.5,
      hMag(kb.H),
    );
  }
  const p = data.plutino;
  for (let i = 0; i < counts.plutino; i++) {
    const n = (2 / 3) * nN;
    const varpi = rnd() * TWO_PI;
    const phi = Math.PI + (2 * rnd() - 1) * p.sigmaAmpDeg * DEG;
    const lambda = (phi + 2 * lN + varpi) / 3 + (TWO_PI / 3) * Math.floor(3 * rnd());
    put(
      KIND.plutino,
      aFromN(n) + (2 * rnd() - 1) * p.aSpread,
      p.eMin + rnd() * (p.eMax - p.eMin),
      rayleigh(p.iSigmaDeg * DEG, 40 * DEG),
      rnd() * TWO_PI,
      varpi,
      lambda,
      n,
      hMag(p.H),
    );
  }
  return b;
}

/** Moves the GPU epoch to `jd` (float64), keeping float32 phases small. */
export function rebase(b: BeltElements, jd: number): void {
  const dt = jd - EPOCH_JD;
  for (let k = 0; k < b.count; k++) {
    b.el1[4 * k + 1] = wrapPi(b.m0[k] + b.n[k] * dt);
    b.lib[2 * k + 1] = wrapPi(b.libPhase0[k] + b.libFreq * dt);
  }
  b.baseJd = jd;
}

/**
 * Heliocentric ecliptic position (AU) of point k at `jd` (float64 twin of the vertex shader).
 * `trojanShift` is the true-minus-mean longitude of Jupiter added to Trojans.
 */
export function positionAt(
  b: BeltElements,
  k: number,
  jd: number,
  trojanShift = 0,
): [number, number, number] {
  const dt = jd - EPOCH_JD;
  const [a, e, inc, node] = b.el0.subarray(4 * k, 4 * k + 4);
  const w = b.el1[4 * k];
  let M = b.m0[k] + b.n[k] * dt;
  const amp = b.lib[2 * k];
  if (amp > 0) M += amp * Math.sin(b.libPhase0[k] + b.libFreq * dt) + trojanShift;
  const E = solveKepler4(M, e);
  const px = a * (Math.cos(E) - e);
  const py = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const xw = px * Math.cos(w) - py * Math.sin(w);
  const yw = px * Math.sin(w) + py * Math.cos(w);
  const cO = Math.cos(node);
  const sO = Math.sin(node);
  const ci = Math.cos(inc);
  return [cO * xw - sO * ci * yw, sO * xw + cO * ci * yw, Math.sin(inc) * yw];
}
