/**
 * Deterministic (seeded) statistical model of the Oort Cloud, three-free and float64 (model.json):
 * - semi-major axis from the flat 'samplingSlopes' power law, each point weighted by true / sampling law;
 * - eccentricity: a continuous blend from detached (perihelion 38-90 AU) inside to thermal f(e) = 2e outside
 *   (weights smooth in ln a), so perihelia stay beyond qMin;
 * - orientation: a disc near the ecliptic inside, isotropic outside (smooth in ln a);
 * - the orbit-averaged vertical Galactic tide precesses every orbit about the north Galactic pole at a rate
 *   that grows steeply with a, which twists the inner cloud into a spiral (Nesvorny et al. 2025). The rate
 *   uses the typical eccentricity at a (not the orbit's own) with a log-normal scatter, so the twist is a
 *   smooth function of a and the spiral stays coherent.
 * Elements are heliocentric, ecliptic J2000. Times on the GPU are in kyr since a float64 base epoch.
 */
import { GM_SUN, JULIAN_YEAR, PC } from '../../../core/units';
import { GALACTIC_POLE_ECL, smoothstep } from '../shared';
import { solveKepler, wrapPi } from './kepler';
import model from './model.json';

const TWO_PI = 2 * Math.PI;
const DEG = Math.PI / 180;
/** Days per kyr: GPU time unit. */
export const DAYS_PER_KYR = 365_250;
/** Epoch of the stored float64 masters (J2000). */
export const EPOCH_JD: number = model.epochJd;
/** Age of the cloud: the tide has acted for this long before J2000, yr. */
export const AGE_YR: number = model.ageYr;
/** Floats per point on the GPU: aEl0 (4), aQuat (4), aEl1 (2). */
export const GPU_FLOATS_PER_POINT = 10;

/** nu^2 = 4 pi G rho0 of the local Galactic disc, yr^-2 (about 5.65e-15). */
export const NU2_PER_YR2 = ((4 * Math.PI * GM_SUN * model.tide.rho0MsunPerPc3) / PC ** 3) * JULIAN_YEAR ** 2;

const G_POLE = GALACTIC_POLE_ECL;

/** Mean motion for a in AU, rad/yr. */
export const meanMotionPerYr = (aAu: number): number => TWO_PI / aAu ** 1.5;

/**
 * Orbit-averaged node precession about the north Galactic pole from the vertical tide, rad/yr
 * (Heisler & Tremaine 1986), times `scale` (the scatter), capped at half the mean motion.
 */
export function tideRatePerYr(aAu: number, e: number, cosIG: number, scale = 1): number {
  const n = meanMotionPerYr(aAu);
  const r = -(NU2_PER_YR2 / (2 * n)) * cosIG * ((1 + 1.5 * e * e) / Math.sqrt(1 - e * e)) * scale;
  return Math.max(-0.5 * n, Math.min(0.5 * n, r));
}

/** A continuous piecewise power law x^slope over the breaks, normalised to 1 at x = norm. */
export interface PowerLaw {
  breaks: readonly number[];
  slopes: readonly number[];
  /** Value at the start of each segment. */
  coef: number[];
  /** Integral over each segment. */
  seg: number[];
  total: number;
}

export function powerLaw(breaks: readonly number[], slopes: readonly number[], norm: number): PowerLaw {
  const coef: number[] = [1];
  for (let j = 1; j < slopes.length; j++)
    coef.push(coef[j - 1] * (breaks[j] / breaks[j - 1]) ** slopes[j - 1]);
  const law: PowerLaw = { breaks, slopes, coef, seg: [], total: 0 };
  const scale = 1 / lawValue(law, norm);
  for (let j = 0; j < slopes.length; j++) {
    coef[j] *= scale;
    const b0 = breaks[j];
    const s1 = slopes[j] + 1;
    const r = breaks[j + 1] / b0;
    law.seg.push(coef[j] * b0 * (Math.abs(s1) < 1e-12 ? Math.log(r) : (r ** s1 - 1) / s1));
  }
  law.total = law.seg.reduce((x, y) => x + y, 0);
  return law;
}

export function lawValue(law: PowerLaw, x: number): number {
  const { breaks, slopes, coef } = law;
  let j = 0;
  while (j < slopes.length - 1 && x > breaks[j + 1]) j++;
  return coef[j] * (x / breaks[j]) ** slopes[j];
}

/** Inverse CDF: u in [0, 1) -> x. */
export function lawSample(law: PowerLaw, u: number): number {
  let x = u * law.total;
  let j = 0;
  while (j < law.seg.length - 1 && x > law.seg[j]) x -= law.seg[j++];
  const b0 = law.breaks[j];
  const s1 = law.slopes[j] + 1;
  const c = law.coef[j] * b0;
  const t = Math.abs(s1) < 1e-12 ? Math.exp(x / c) : (1 + (x * s1) / c) ** (1 / s1);
  return Math.min(law.breaks[j + 1], b0 * t);
}

const SA = model.semiMajorAxis;
/** dN/da of the model (true) and of the drawn points (sampling), both 1 at a = 2000 AU. */
export const TRUE_LAW = powerLaw(SA.breaksAu, SA.slopes, 2000);
export const SAMPLING_LAW = powerLaw(SA.breaksAu, SA.samplingSlopes, 2000);
export const A_MIN_AU = SA.breaksAu[0];
export const A_MAX_AU = SA.breaksAu[SA.breaksAu.length - 1];

/** Brightness / count weight of a point drawn at a (true / sampling law, <= 1). */
export const weightAt = (aAu: number): number => lawValue(TRUE_LAW, aAu) / lawValue(SAMPLING_LAW, aAu);

const P = model.perihelion;
const O = model.orientation;
const T = model.tide;
/** Midpoint of the detached perihelion range, AU. */
const Q_MID_AU = 0.5 * (P.qMinAu + P.qDetachedMaxAu);

/** Typical eccentricity at a (detached perihelion qMid inside, the thermal mean outside): sets the tide rate. */
export const typicalEccentricity = (aAu: number): number => {
  const t = thermalFraction(aAu);
  return (1 - t) * (1 - Q_MID_AU / aAu) + t * T.meanEccentricity;
};
const lnSmooth = (from: number, to: number, a: number) =>
  smoothstep(Math.log(from), Math.log(to), Math.log(a));
/** Weight of the thermal (rather than detached) eccentricity at a. */
export const thermalFraction = (aAu: number): number => lnSmooth(P.thermalFromAu, P.thermalToAu, aAu);
/** Probability of an isotropic (rather than disc) orientation at a. */
export const isotropicFraction = (aAu: number): number => lnSmooth(O.isotropicFromAu, O.isotropicToAu, aAu);

/** Seeded PRNG (mulberry32, as in smallbodies). */
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

export interface Cloud {
  /** Final number of points (capacity). */
  readonly count: number;
  /** Points generated so far (generation is time-sliced); the GPU draws [0, generated). */
  generated: number;
  /** Epoch of the GPU mean anomalies and quaternions, JD (rebase moves it). */
  baseJd: number;
  /** GPU: a [AU], e, M at baseJd [rad], n [rad/kyr]. */
  readonly el0: Float32Array;
  /** GPU: perifocal -> ecliptic rotation at baseJd, tide included (x, y, z, w). */
  readonly quat: Float32Array;
  /** GPU: tide rate about the Galactic pole [rad/kyr], weight (true / sampling law). */
  readonly el1: Float32Array;
  /** Float64 masters: M at J2000 [rad], n [rad/kyr], tide rate [rad/kyr]. */
  readonly m0: Float64Array;
  readonly n: Float64Array;
  readonly rate: Float64Array;
  /** Orientation at J2000 (the twist over the age of the cloud included), x y z w. */
  readonly qJ: Float32Array;
  /** Generator state (draws exactly 10 numbers per point, so any prefix is the same for any count). */
  readonly rnd: () => number;
}

/** Allocates an empty cloud of `count` points (nothing generated yet). */
export function createCloud(count: number, seed = 1, baseJd = EPOCH_JD): Cloud {
  return {
    count,
    generated: 0,
    baseJd,
    el0: new Float32Array(count * 4),
    quat: new Float32Array(count * 4),
    el1: new Float32Array(count * 2),
    m0: new Float64Array(count),
    n: new Float64Array(count),
    rate: new Float64Array(count),
    qJ: new Float32Array(count * 4),
    rnd: mulberry32(seed * 104_729 + 7),
  };
}

/** Writes the GPU mean anomaly and quaternion of point k at the cloud's base epoch. */
function writeBase(c: Cloud, k: number, tKyr: number): void {
  c.el0[4 * k + 2] = wrapPi(c.m0[k] + c.n[k] * tKyr);
  const h = 0.5 * wrapPi(c.rate[k] * tKyr);
  const s = Math.sin(h);
  const gx = G_POLE.x * s;
  const gy = G_POLE.y * s;
  const gz = G_POLE.z * s;
  const gw = Math.cos(h);
  const i = 4 * k;
  const qx = c.qJ[i];
  const qy = c.qJ[i + 1];
  const qz = c.qJ[i + 2];
  const qw = c.qJ[i + 3];
  // (g) ⊗ (q): the tidal rotation applied after the J2000 orientation.
  c.quat[i] = gw * qx + gx * qw + gy * qz - gz * qy;
  c.quat[i + 1] = gw * qy - gx * qz + gy * qw + gz * qx;
  c.quat[i + 2] = gw * qz + gx * qy - gy * qx + gz * qw;
  c.quat[i + 3] = gw * qw - gx * qx - gy * qy - gz * qz;
}

/** Generates points [c.generated, min(count, c.generated + max)); returns how many were added. */
export function generateMore(c: Cloud, max: number): number {
  const { rnd } = c;
  const from = c.generated;
  const to = Math.min(c.count, from + max);
  const qMin = P.qMinAu;
  const qSpan = P.qDetachedMaxAu - P.qMinAu;
  const sigma = O.diskInclinationSigmaDeg * DEG;
  const tBase = (c.baseJd - EPOCH_JD) / DAYS_PER_KYR;
  for (let k = from; k < to; k++) {
    const a = lawSample(SAMPLING_LAW, rnd());
    const w = weightAt(a);
    const th = thermalFraction(a);
    const eDet = 1 - (qMin + rnd() * qSpan) / a;
    const eTh = (1 - qMin / a) * Math.sqrt(rnd());
    const e = (1 - th) * eDet + th * eTh;
    const iso = rnd() < isotropicFraction(a);
    const ui = rnd();
    const inc = iso
      ? Math.acos(1 - 2 * ui)
      : Math.min(Math.PI, sigma * Math.sqrt(-2 * Math.log(1 - ui * 0.999999)));
    const node = rnd() * TWO_PI;
    const argp = rnd() * TWO_PI;
    const M0 = wrapPi(rnd() * TWO_PI);
    // Box-Muller normal deviate for the scatter of the tide rate.
    const gauss = Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(TWO_PI * rnd());
    // Perifocal -> ecliptic: Rz(node) Rx(inc) Rz(argp).
    const si = Math.sin(0.5 * inc);
    const ci = Math.cos(0.5 * inc);
    const dm = 0.5 * (node - argp);
    const sm = 0.5 * (node + argp);
    const qx = si * Math.cos(dm);
    const qy = si * Math.sin(dm);
    const qz = ci * Math.sin(sm);
    const qw = ci * Math.cos(sm);
    // Orbit normal W and its cosine to the Galactic pole.
    const sI = Math.sin(inc);
    const cosIG = G_POLE.x * Math.sin(node) * sI - G_POLE.y * Math.cos(node) * sI + G_POLE.z * Math.cos(inc);
    // The rate from the typical eccentricity at a (e and i_G oscillate together under the tide), with scatter.
    const rateYr = tideRatePerYr(a, typicalEccentricity(a), cosIG, Math.exp(T.rateScatter * gauss));
    // Twist accumulated over the age of the cloud up to J2000.
    const h = 0.5 * wrapPi(rateYr * AGE_YR);
    const s = Math.sin(h);
    const gx = G_POLE.x * s;
    const gy = G_POLE.y * s;
    const gz = G_POLE.z * s;
    const gw = Math.cos(h);
    const i4 = 4 * k;
    c.qJ[i4] = gw * qx + gx * qw + gy * qz - gz * qy;
    c.qJ[i4 + 1] = gw * qy - gx * qz + gy * qw + gz * qx;
    c.qJ[i4 + 2] = gw * qz + gx * qy - gy * qx + gz * qw;
    c.qJ[i4 + 3] = gw * qw - gx * qx - gy * qy - gz * qz;
    c.m0[k] = M0;
    c.n[k] = meanMotionPerYr(a) * 1000;
    c.rate[k] = rateYr * 1000;
    c.el0[i4] = a;
    c.el0[i4 + 1] = e;
    c.el0[i4 + 3] = c.n[k];
    c.el1[2 * k] = c.rate[k];
    c.el1[2 * k + 1] = w;
    writeBase(c, k, tBase);
  }
  c.generated = to;
  return to - from;
}

/** Generates the whole cloud at once (tests, density sample). */
export function generateCloud(count: number, seed = 1, baseJd = EPOCH_JD): Cloud {
  const c = createCloud(count, seed, baseJd);
  generateMore(c, count);
  return c;
}

/**
 * Moves the GPU epoch to `jd` (float64): recomputes the mean anomalies and the twisted quaternions of
 * every generated point, keeping the float32 phases of the shader small. A tight loop, no allocation.
 */
export function rebase(c: Cloud, jd: number): void {
  const t = (jd - EPOCH_JD) / DAYS_PER_KYR;
  for (let k = 0; k < c.generated; k++) writeBase(c, k, t);
  c.baseJd = jd;
}

/** Unit orbit normal of point k at J2000, ecliptic axes (from its orientation quaternion). */
export function orbitNormalAt(c: Cloud, k: number, out: [number, number, number]): [number, number, number] {
  const i = 4 * k;
  const x = c.qJ[i];
  const y = c.qJ[i + 1];
  const z = c.qJ[i + 2];
  const w = c.qJ[i + 3];
  // Third column of the rotation matrix: R * (0, 0, 1).
  out[0] = 2 * (x * z + w * y);
  out[1] = 2 * (y * z - w * x);
  out[2] = 1 - 2 * (x * x + y * y);
  return out;
}

/**
 * Heliocentric ecliptic J2000 position (AU) of point k at `jd`: the float64 twin of the vertex shader
 * (Kepler, perifocal -> ecliptic by the J2000 quaternion, then the tidal twist since J2000 about the pole).
 */
export function positionAt(c: Cloud, k: number, jd: number, out: [number, number, number]): typeof out {
  const t = (jd - EPOCH_JD) / DAYS_PER_KYR;
  const a = c.el0[4 * k];
  const e = c.el0[4 * k + 1];
  const E = solveKepler(c.m0[k] + c.n[k] * t, e);
  const px = a * (Math.cos(E) - e);
  const py = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const i = 4 * k;
  const qx = c.qJ[i];
  const qy = c.qJ[i + 1];
  const qz = c.qJ[i + 2];
  const qw = c.qJ[i + 3];
  // v = q (px, py, 0) q*
  const tx = 2 * (-qz * py);
  const ty = 2 * (qz * px);
  const tz = 2 * (qx * py - qy * px);
  const vx = px + qw * tx + (qy * tz - qz * ty);
  const vy = py + qw * ty + (qz * tx - qx * tz);
  const vz = qw * tz + (qx * ty - qy * tx);
  // Rodrigues about the Galactic pole by rate * t.
  const ang = c.rate[k] * t;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const g = G_POLE;
  const gv = g.x * vx + g.y * vy + g.z * vz;
  out[0] = vx * ca + (g.y * vz - g.z * vy) * sa + g.x * gv * (1 - ca);
  out[1] = vy * ca + (g.z * vx - g.x * vz) * sa + g.y * gv * (1 - ca);
  out[2] = vz * ca + (g.x * vy - g.y * vx) * sa + g.z * gv * (1 - ca);
  return out;
}
