/**
 * Comet activity, photometry and tail geometry (three-free, float64; CPU twin of what the shaders draw).
 *
 * - Brightness: m = H + 5 log10(delta) + K log10(r), faded to nothing between 3.5 and 5 AU. The coma's
 *   luminous intensity I (cd) follows from it, so the unresolved point, the resolved coma and the tails
 *   share one number.
 * - Coma: a steady outflow (density ~ 1/rho^2) seen through; its column is 1/b at impact parameter b.
 * - Ion tail: a straight ray along the Sun-comet line.
 * - Dust tail: syndynes. A grain of radiation-pressure ratio beta released at rest from the nucleus feels
 *   solar gravity reduced to (1 - beta); grains of one beta released over the past weeks trace a curve
 *   that leaves the nucleus anti-sunward and bends back along the orbit. Several betas make the fan.
 */
import type { Vec3d } from '../../core/contracts';
import { v3len, v3set, vec3 } from '../../core/math64';
import { LUX_MAG0 } from '../../core/photometry';
import { AU, DAY, GM_SUN } from '../../core/units';
import type { CometDisplay, CometRow } from './data';
import type { CometOrbit } from './orbit';

export const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Activity switch: 1 inside the inner fade distance, 0 beyond the outer one. */
export function activityFade(rAU: number, display: CometDisplay): number {
  return 1 - smoothstep(display.activityFadeAU[0], display.activityFadeAU[1], rAU);
}

/** Total visual magnitude seen from `deltaAU` (Infinity when the comet is inactive). */
export function apparentMagnitude(
  row: CometRow,
  rAU: number,
  deltaAU: number,
  display: CometDisplay,
): number {
  const fade = activityFade(rAU, display);
  if (fade <= 0) return Infinity;
  const { H, K } = row.photometry;
  return H + 5 * Math.log10(deltaAU) + K * Math.log10(rAU) - 2.5 * Math.log10(fade);
}

/** Luminous intensity of the coma, cd: the illuminance it gives at distance d is I / d^2. */
export function comaIntensity(row: CometRow, rAU: number, display: CometDisplay): number {
  const fade = activityFade(rAU, display);
  if (fade <= 0) return 0;
  const { H, K } = row.photometry;
  return LUX_MAG0 * 10 ** (-0.4 * (H + K * Math.log10(rAU))) * AU * AU * fade;
}

/** Visual coma radius, m: larger for intrinsically brighter comets, compressed near the Sun. */
export function comaRadius(row: CometRow, rAU: number, display: CometDisplay): number {
  const r = Math.min(3, Math.max(0.15, rAU));
  const size = display.comaRadiusKm * 1e3 * r ** 0.8 * 10 ** (-0.08 * (row.photometry.H - 5));
  return Math.min(8e8, Math.max(2.5e7, size));
}

/**
 * Reference surface brightness of the tails, cd/m^2: the coma's light spread over a disk of its 1 AU
 * radius. (Using the actual coma radius, which shrinks near the Sun, would overstate the tails of
 * sun-skirting comets by orders of magnitude.)
 */
export function tailReferenceLuminance(row: CometRow, rAU: number, display: CometDisplay): number {
  const rc = comaRadius(row, 1, display);
  return comaIntensity(row, rAU, display) / (Math.PI * rc * rc);
}

/** Size factor of a comet's tails from its absolute magnitude (1 at H = 5). */
const tailSize = (row: CometRow): number => 10 ** (-0.06 * (row.photometry.H - 5));

/** Ion-tail length, m: grows towards the Sun, zero when inactive, capped at 1.2 AU. */
export function ionTailLength(row: CometRow, rAU: number, display: CometDisplay): number {
  const fade = activityFade(rAU, display);
  if (fade <= 0 || row.look.ion <= 0) return 0;
  const len = (0.35 * AU * tailSize(row) * (row.look.ionLength ?? 1)) / Math.max(rAU, 0.05);
  return Math.min(1.2 * AU, len) * fade;
}

/** Length at which dust syndynes are cut, m. */
export function dustTailLength(row: CometRow, rAU: number, display: CometDisplay): number {
  const fade = activityFade(rAU, display);
  if (fade <= 0 || row.look.dust <= 0) return 0;
  return Math.min(1.2 * AU, (0.25 * AU * tailSize(row)) / Math.max(rAU, 0.05)) * fade;
}

/** Unit vector from the Sun through the comet (the ion-tail axis). */
export function antiSunward(sunToComet: Vec3d, out: Vec3d): Vec3d {
  const l = v3len(sunToComet) || 1;
  return v3set(out, sunToComet.x / l, sunToComet.y / l, sunToComet.z / l);
}

/** A tail centreline sampled from the nucleus outwards (positions relative to the nucleus, m). */
export interface TailCurve {
  count: number;
  /** xyz per point, ICRF axes, m from the nucleus. */
  pos: Float64Array;
  /** Gaussian cross-section sigma per point, m. */
  sigma: Float64Array;
  /** Peak surface brightness of the ribbon drawn along the curve, cd/m^2. */
  lum: Float64Array;
  /** Face-on surface brightness of the sheet spanned between neighbouring curves (dust fan), cd/m^2. */
  fan: Float64Array;
}

export function createCurve(count: number): TailCurve {
  return {
    count,
    pos: new Float64Array(3 * count),
    sigma: new Float64Array(count),
    lum: new Float64Array(count),
    fan: new Float64Array(count),
  };
}

export const ION_POINTS = 24;

/**
 * Ion tail: straight along the Sun-comet line, narrow, brightness falling gently from the coma level and
 * tapering to zero at the tip. `sunToComet` in m.
 */
export function ionTail(row: CometRow, sunToComet: Vec3d, display: CometDisplay, out?: TailCurve): TailCurve {
  const c = out ?? createCurve(ION_POINTS);
  const n = c.count;
  const rAU = v3len(sunToComet) / AU;
  const len = ionTailLength(row, rAU, display);
  const dir = antiSunward(sunToComet, vec3());
  const rc = comaRadius(row, rAU, display);
  const root = display.tailGain * row.look.ion * tailReferenceLuminance(row, rAU, display);
  for (let k = 0; k < n; k++) {
    const u = k / (n - 1);
    const s = len * u * u; // denser near the head
    c.pos[3 * k] = dir.x * s;
    c.pos[3 * k + 1] = dir.y * s;
    c.pos[3 * k + 2] = dir.z * s;
    c.sigma[k] = 0.22 * rc + 0.026 * s;
    // u^2 = s / len: the brightness tapers along the whole length and reaches zero at the tip.
    c.lum[k] = len > 0 ? root * (1 + s / rc) ** -(display.tailFalloff + 0.15) * (1 - u * u) ** 1.5 : 0;
  }
  return c;
}

/** Radiation-pressure ratios of the syndynes and their share of the dust light (sums to 1). */
export const DUST_BETAS: readonly number[] = [0.03, 0.07, 0.15, 0.3, 0.55, 0.9, 1.4];
export const DUST_WEIGHTS: readonly number[] = [0.05, 0.09, 0.15, 0.21, 0.22, 0.17, 0.11];
export const DUST_POINTS = 26;
/** Oldest grains drawn, days. */
export const DUST_MAX_AGE_DAYS = 45;

const acc = vec3();
function accel(mu: number, x: number, y: number, z: number, sun: Vec3d): Vec3d {
  const dx = x - sun.x;
  const dy = y - sun.y;
  const dz = z - sun.z;
  const r2 = dx * dx + dy * dy + dz * dz;
  const k = -mu / (r2 * Math.sqrt(r2));
  return v3set(acc, k * dx, k * dy, k * dz);
}

/**
 * Integrates a grain from (p, v) for `dt` seconds in `steps` RK4 steps under gravity `mu` (may be zero or
 * negative: beta >= 1) towards `sun`. Writes the final position into p.
 */
export function integrateGrain(p: Vec3d, v: Vec3d, mu: number, dt: number, steps: number, sun: Vec3d): void {
  const h = dt / steps;
  let { x, y, z } = p;
  let vx = v.x;
  let vy = v.y;
  let vz = v.z;
  for (let s = 0; s < steps; s++) {
    const a1 = accel(mu, x, y, z, sun);
    const [k1x, k1y, k1z] = [a1.x, a1.y, a1.z];
    const a2 = accel(mu, x + 0.5 * h * vx, y + 0.5 * h * vy, z + 0.5 * h * vz, sun);
    const [k2x, k2y, k2z] = [a2.x, a2.y, a2.z];
    const a3 = accel(
      mu,
      x + 0.5 * h * vx + 0.25 * h * h * k1x,
      y + 0.5 * h * vy + 0.25 * h * h * k1y,
      z + 0.5 * h * vz + 0.25 * h * h * k1z,
      sun,
    );
    const [k3x, k3y, k3z] = [a3.x, a3.y, a3.z];
    const a4 = accel(
      mu,
      x + h * vx + 0.5 * h * h * k2x,
      y + h * vy + 0.5 * h * h * k2y,
      z + h * vz + 0.5 * h * h * k2z,
      sun,
    );
    // Classical RK4 written for x'' = a(x).
    x += h * vx + ((h * h) / 6) * (k1x + k2x + k3x);
    y += h * vy + ((h * h) / 6) * (k1y + k2y + k3y);
    z += h * vz + ((h * h) / 6) * (k1z + k2z + k3z);
    vx += (h / 6) * (k1x + 2 * k2x + 2 * k3x + a4.x);
    vy += (h / 6) * (k1y + 2 * k2y + 2 * k3y + a4.y);
    vz += (h / 6) * (k1z + 2 * k2z + 2 * k3z + a4.z);
  }
  v3set(p, x, y, z);
}

/** Squared distance from point (px, py, pz) to the polyline of curve c. */
function distToCurve(px: number, py: number, pz: number, c: TailCurve): number {
  let best = Infinity;
  const a = c.pos;
  for (let k = 0; k + 1 < c.count; k++) {
    const ax = a[3 * k];
    const ay = a[3 * k + 1];
    const az = a[3 * k + 2];
    const bx = a[3 * k + 3] - ax;
    const by = a[3 * k + 4] - ay;
    const bz = a[3 * k + 5] - az;
    const l2 = bx * bx + by * by + bz * bz;
    let t = l2 > 0 ? ((px - ax) * bx + (py - ay) * by + (pz - az) * bz) / l2 : 0;
    t = Math.min(1, Math.max(0, t));
    const dx = px - ax - t * bx;
    const dy = py - ay - t * by;
    const dz = pz - az - t * bz;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

const pe = vec3();
const ve = vec3();
const pn = vec3();
const ZERO: Readonly<Vec3d> = Object.freeze(vec3());

/**
 * Dust tail at `jd`: one curve per beta in DUST_BETAS. `sunOffset` is the Sun's position relative to the
 * orbit centre (zero for heliocentric elements; held fixed over the grains' flight for barycentric ones).
 */
export function dustTail(
  row: CometRow,
  orbit: CometOrbit,
  jd: number,
  display: CometDisplay,
  sunOffset: Vec3d = ZERO,
  out?: TailCurve[],
): TailCurve[] {
  const curves = out ?? DUST_BETAS.map(() => createCurve(DUST_POINTS));
  orbit.stateAt(jd, pn);
  const rNow = Math.hypot(pn.x - sunOffset.x, pn.y - sunOffset.y, pn.z - sunOffset.z);
  const rAU = rNow / AU;
  const maxLen = dustTailLength(row, rAU, display);
  const rc = comaRadius(row, rAU, display);
  const root = display.tailGain * row.look.dust * tailReferenceLuminance(row, rAU, display);
  const g = GM_SUN / (rNow * rNow);
  const tPeri = orbit.timeFromPerihelion(jd);
  const nExp = row.photometry.K / 2.5 - 2; // production ~ r^-nExp once illumination (r^-2) is taken out
  for (let j = 0; j < curves.length; j++) {
    const c = curves[j];
    const beta = DUST_BETAS[j];
    const n = c.count;
    // Age at which a grain of this beta has drifted maxLen (0.5 beta g t^2), capped.
    const ageMax = Math.min(DUST_MAX_AGE_DAYS * DAY, Math.sqrt((2 * Math.max(maxLen, 1)) / (beta * g)));
    const vEject = (300 * Math.sqrt(beta)) / Math.sqrt(Math.max(rAU, 0.05));
    for (let k = 0; k < n; k++) {
      const u = k / (n - 1);
      const age = ageMax * u ** 1.6;
      if (k === 0 || maxLen <= 0) {
        c.pos[3 * k] = c.pos[3 * k + 1] = c.pos[3 * k + 2] = 0;
        c.sigma[k] = 0.3 * rc;
        c.lum[k] = maxLen > 0 ? root * DUST_WEIGHTS[j] : 0;
        continue;
      }
      orbit.stateAt(jd - age / DAY, pe, ve);
      const rEmit = Math.hypot(pe.x - sunOffset.x, pe.y - sunOffset.y, pe.z - sunOffset.z);
      // Step by a fraction of the local dynamical time; perihelion in between sets the scale.
      const crossed = tPeri > 0 && tPeri - age < 0;
      const rMin = crossed ? orbit.q : Math.min(rNow, rEmit);
      const tDyn = Math.sqrt((rMin * rMin * rMin) / GM_SUN);
      const steps = Math.min(48, Math.max(2, Math.ceil(age / (0.12 * tDyn))));
      integrateGrain(pe, ve, GM_SUN * (1 - beta), age, steps, sunOffset);
      const x = pe.x - pn.x;
      const y = pe.y - pn.y;
      const z = pe.z - pn.z;
      c.pos[3 * k] = x;
      c.pos[3 * k + 1] = y;
      c.pos[3 * k + 2] = z;
      const s = Math.hypot(x, y, z);
      c.sigma[k] = Math.max(Math.hypot(0.3 * rc, vEject * age), 0.07 * s);
      const rGrain = Math.hypot(pe.x - sunOffset.x, pe.y - sunOffset.y, pe.z - sunOffset.z);
      // Dust made when the comet was more (or less) active, lit at the grain's present distance.
      const history = Math.min(4, Math.max(0.25, (rNow / rEmit) ** nExp * (rNow / rGrain) ** 2));
      c.lum[k] =
        root * DUST_WEIGHTS[j] * (1 + s / rc) ** -display.tailFalloff * history * (1 - smoothstep(0.7, 1, u));
    }
  }
  // Split each syndyne's light between a ribbon of its own width and the sheet between neighbouring
  // syndynes. With w the width a ribbon covers at its peak and d the gap to its neighbours, f = w / (w + d)
  // is the share of the neighbourhood the ribbon fills: close to the head the curves coincide and the
  // ribbons carry everything, further out the fan is a smooth sheet with faint striae along the syndynes.
  // Ribbon l f^2 over w plus sheet l f (1 + f) over d adds up to the same light per unit length, l w.
  for (let j = 0; j < curves.length; j++) {
    const c = curves[j];
    c.fan[0] = 0;
    for (let k = 1; k < c.count; k++) {
      const [x, y, z] = [c.pos[3 * k], c.pos[3 * k + 1], c.pos[3 * k + 2]];
      let gap = 0;
      let m = 0;
      if (j > 0) {
        gap += distToCurve(x, y, z, curves[j - 1]);
        m++;
      }
      if (j + 1 < curves.length) {
        gap += distToCurve(x, y, z, curves[j + 1]);
        m++;
      }
      const w = c.sigma[k] * Math.sqrt(2 * Math.PI);
      const f = w / (w + (m ? gap / m : 0));
      const l = c.lum[k];
      c.lum[k] = l * f * f;
      c.fan[k] = l * f * (1 + f);
    }
  }
  return curves;
}
