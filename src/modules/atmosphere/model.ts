/**
 * TypeScript twin of the GPU atmosphere (three-free): media, transmittance integral, the LUT
 * parameterisations of Hillaire 2020, CPU transmittance / multiple-scattering LUTs and a sky
 * raymarch. glsl/common.glsl mirrors these functions one to one (same names, km units, radiance
 * per unit solar illuminance).
 */
import type { AtmosphereParams, RGB } from './params';

export const TRANSMITTANCE_SIZE: [number, number] = [256, 64];
export const MULTISCATTER_SIZE = 32;
export const SKYVIEW_SIZE: [number, number] = [192, 108];
export const AP_SLICES = 32;
export const AP_SIZE = 32;
/** Steps of the transmittance integral (LUT and twin). */
export const TRANSMITTANCE_STEPS = 40;
export const MS_DIRS_SQRT = 8;
export const MS_STEPS = 20;

const PI = Math.PI;
type V3 = [number, number, number];

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

export interface Medium {
  rayS: RGB;
  mieS: RGB;
  ext: RGB;
}

/** Medium at altitude h (km) above the bottom radius (clamped at 0). */
export function medium(p: AtmosphereParams, hKm: number): Medium {
  const h = Math.max(hKm, 0);
  const dr = Math.exp(-h / p.rayleighScaleKm);
  const dm = Math.exp(-h / p.mieScaleKm);
  const da = Math.max(0, 1 - Math.abs(h - p.absorptionCenterKm) / p.absorptionHalfWidthKm);
  const rayS: RGB = [0, 0, 0];
  const mieS: RGB = [0, 0, 0];
  const ext: RGB = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    rayS[c] = p.rayleighScattering[c] * dr;
    mieS[c] = p.mieScattering[c] * dm;
    ext[c] = rayS[c] + p.mieExtinction[c] * dm + p.absorptionExtinction[c] * da;
  }
  return { rayS, mieS, ext };
}

/** Distances (near, far) along a unit ray to a sphere at the origin, or null if missed. */
export function raySphere(ro: V3, rd: V3, R: number): [number, number] | null {
  const b = dot(ro, rd);
  const c = dot(ro, ro) - R * R;
  const disc = b * b - c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  return [-b - s, -b + s];
}

/** Distance to the top boundary from radius r along zenith cosine mu (camera inside). */
export function distanceToTop(p: AtmosphereParams, r: number, mu: number): number {
  const disc = r * r * (mu * mu - 1) + p.topKm * p.topKm;
  return Math.max(0, -r * mu + Math.sqrt(Math.max(disc, 0)));
}

/** Optical depth from radius r (km) along zenith cosine mu to the top boundary (midpoint rule). */
export function opticalDepth(p: AtmosphereParams, r: number, mu: number, steps = TRANSMITTANCE_STEPS): RGB {
  const tMax = distanceToTop(p, r, mu);
  const dt = tMax / steps;
  const od: RGB = [0, 0, 0];
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) * dt;
    const ri = Math.sqrt(r * r + t * t + 2 * r * mu * t);
    const m = medium(p, ri - p.bottomKm);
    for (let c = 0; c < 3; c++) od[c] += m.ext[c] * dt;
  }
  return od;
}

export function transmittance(p: AtmosphereParams, r: number, mu: number, steps = TRANSMITTANCE_STEPS): RGB {
  const od = opticalDepth(p, r, mu, steps);
  return [Math.exp(-od[0]), Math.exp(-od[1]), Math.exp(-od[2])];
}

// ---- LUT parameterisations (Bruneton 2017 / Hillaire 2020) ----

/** (r, mu) -> transmittance LUT uv; mu below the horizon clamps to the horizon. */
export function transmittanceUv(p: AtmosphereParams, r: number, mu: number): [number, number] {
  const B = p.bottomKm;
  const H = Math.sqrt(p.topKm * p.topKm - B * B);
  const rho = Math.sqrt(Math.max(0, r * r - B * B));
  const d = distanceToTop(p, r, mu);
  const dMin = p.topKm - r;
  const dMax = rho + H;
  return [clamp((d - dMin) / Math.max(dMax - dMin, 1e-9), 0, 1), clamp(rho / H, 0, 1)];
}

/** Inverse of transmittanceUv: uv -> (r, mu). */
export function transmittanceParams(p: AtmosphereParams, u: number, v: number): [number, number] {
  const B = p.bottomKm;
  const H = Math.sqrt(p.topKm * p.topKm - B * B);
  const rho = H * v;
  const r = Math.sqrt(rho * rho + B * B);
  const dMin = p.topKm - r;
  const dMax = rho + H;
  const d = dMin + u * (dMax - dMin);
  const mu = d === 0 ? 1 : (H * H - rho * rho - d * d) / (2 * r * d);
  return [r, clamp(mu, -1, 1)];
}

/** Unit [0,1] <-> texel-centre range of an N-texel axis (edges land on texel centres). */
export const toSubUv = (u: number, n: number): number => 0.5 / n + u * ((n - 1) / n);
export const fromSubUv = (s: number, n: number): number => (s - 0.5 / n) * (n / (n - 1));

/** Multi-scattering LUT uv for (r, muS). */
export function multiScatterUv(p: AtmosphereParams, r: number, muS: number): [number, number] {
  const u = clamp(muS * 0.5 + 0.5, 0, 1);
  const v = clamp((r - p.bottomKm) / (p.topKm - p.bottomKm), 0, 1);
  return [toSubUv(u, MULTISCATTER_SIZE), toSubUv(v, MULTISCATTER_SIZE)];
}

/** Horizon geometry for a viewer at radius r and height h = r - bottom (h passed to avoid cancellation). */
function horizon(p: AtmosphereParams, r: number, h: number): { beta: number; zha: number } {
  const vH = Math.sqrt(Math.max(h * (2 * p.bottomKm + h), 0));
  const beta = Math.acos(clamp(vH / r, -1, 1));
  return { beta, zha: PI - beta };
}

/** Sky-view LUT uv -> (view zenith cosine, light-view azimuth cosine). */
export function skyViewParams(p: AtmosphereParams, r: number, h: number, su: number, sv: number): [number, number] {
  const u = fromSubUv(su, SKYVIEW_SIZE[0]);
  const v = fromSubUv(sv, SKYVIEW_SIZE[1]);
  const { beta, zha } = horizon(p, r, h);
  let vzc: number;
  if (v < 0.5) {
    const c = 1 - (1 - 2 * v) * (1 - 2 * v);
    vzc = Math.cos(zha * c);
  } else {
    const c = (2 * v - 1) * (2 * v - 1);
    vzc = Math.cos(zha + beta * c);
  }
  const lvc = -(u * u * 2 - 1);
  return [vzc, lvc];
}

/** (view zenith cosine, light-view azimuth cosine) -> sky-view LUT uv. */
export function skyViewUv(
  p: AtmosphereParams,
  r: number,
  h: number,
  intersectGround: boolean,
  vzc: number,
  lvc: number,
): [number, number] {
  const { beta, zha } = horizon(p, r, h);
  const ang = Math.acos(clamp(vzc, -1, 1));
  let v: number;
  if (!intersectGround) {
    const c = clamp(ang / zha, 0, 1);
    v = (1 - Math.sqrt(1 - c)) * 0.5;
  } else {
    const c = clamp((ang - zha) / Math.max(beta, 1e-6), 0, 1);
    v = Math.sqrt(c) * 0.5 + 0.5;
  }
  const u = Math.sqrt(clamp(-lvc * 0.5 + 0.5, 0, 1));
  return [toSubUv(u, SKYVIEW_SIZE[0]), toSubUv(v, SKYVIEW_SIZE[1])];
}

/** Depth (km) of aerial-perspective slice coordinate s (0..32, quadratic). */
export const apSliceDepth = (p: AtmosphereParams, s: number): number => p.apMaxKm * (s / AP_SLICES) ** 2;
/** Continuous slice coordinate of a depth (inverse of apSliceDepth). */
export const apDepthSlice = (p: AtmosphereParams, t: number): number => Math.sqrt(t / p.apMaxKm) * AP_SLICES;

// ---- CPU LUTs (bilinear, clamp-to-edge, texel centres at (i + 0.5) / n like the GPU) ----

export class Lut2D {
  readonly data: Float32Array;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.data = new Float32Array(w * h * 3);
  }
  set(i: number, j: number, v: RGB): void {
    const k = 3 * (j * this.w + i);
    this.data[k] = v[0];
    this.data[k + 1] = v[1];
    this.data[k + 2] = v[2];
  }
  sample(u: number, v: number): RGB {
    const x = clamp(u * this.w - 0.5, 0, this.w - 1);
    const y = clamp(v * this.h - 0.5, 0, this.h - 1);
    const i0 = Math.floor(x);
    const j0 = Math.floor(y);
    const i1 = Math.min(i0 + 1, this.w - 1);
    const j1 = Math.min(j0 + 1, this.h - 1);
    const fx = x - i0;
    const fy = y - j0;
    const out: RGB = [0, 0, 0];
    const d = this.data;
    for (let c = 0; c < 3; c++) {
      const a = d[3 * (j0 * this.w + i0) + c] * (1 - fx) + d[3 * (j0 * this.w + i1) + c] * fx;
      const b = d[3 * (j1 * this.w + i0) + c] * (1 - fx) + d[3 * (j1 * this.w + i1) + c] * fx;
      out[c] = a * (1 - fy) + b * fy;
    }
    return out;
  }
}

export function buildTransmittanceLut(p: AtmosphereParams, size = TRANSMITTANCE_SIZE): Lut2D {
  const lut = new Lut2D(size[0], size[1]);
  for (let j = 0; j < size[1]; j++) {
    for (let i = 0; i < size[0]; i++) {
      const [r, mu] = transmittanceParams(p, (i + 0.5) / size[0], (j + 0.5) / size[1]);
      lut.set(i, j, transmittance(p, r, mu));
    }
  }
  return lut;
}

/** Smooth planet shadow: 1 when the Sun is above the geometric horizon at radius r. */
export function planetShadow(p: AtmosphereParams, r: number, muS: number): number {
  const muH = -Math.sqrt(Math.max(0, 1 - (p.bottomKm * p.bottomKm) / (r * r)));
  const x = clamp((muS - muH + 0.004) / 0.008, 0, 1);
  return x * x * (3 - 2 * x);
}

export interface Luts {
  trans: Lut2D;
  ms: Lut2D | null;
}

/** Sun transmittance at (r, muS) from the LUT, times the planet shadow. */
export function sunTransmittance(p: AtmosphereParams, luts: Luts, r: number, muS: number): RGB {
  const [u, v] = transmittanceUv(p, r, muS);
  const t = luts.trans.sample(u, v);
  const s = planetShadow(p, r, muS);
  return [t[0] * s, t[1] * s, t[2] * s];
}

export function phaseRayleigh(c: number): number {
  return (3 / (16 * PI)) * (1 + c * c);
}

export function phaseCornetteShanks(c: number, g: number): number {
  const g2 = g * g;
  const k = ((3 / (8 * PI)) * (1 - g2)) / (2 + g2);
  return (k * (1 + c * c)) / Math.max(1 + g2 - 2 * g * c, 1e-6) ** 1.5;
}

export interface MarchResult {
  L: RGB;
  T: RGB;
  fms: RGB;
}

/**
 * Integrates single scattering (+ multiple scattering from the MS LUT) along [ta, tb] of a ray,
 * with a quadratic step distribution dense at ta (or at tb when denseAtB). Radiance is per unit
 * solar illuminance. `iso` uses the isotropic phase (multi-scattering LUT pass).
 */
export function march(
  p: AtmosphereParams,
  luts: Luts,
  ro: V3,
  rd: V3,
  sun: V3,
  ta: number,
  tb: number,
  n: number,
  denseAtB: boolean,
  iso: boolean,
  acc: MarchResult = { L: [0, 0, 0], T: [1, 1, 1], fms: [0, 0, 0] },
): MarchResult {
  const cosT = dot(rd, sun);
  const phR = iso ? 1 / (4 * PI) : phaseRayleigh(cosT);
  const phM = iso
    ? [1 / (4 * PI), 1 / (4 * PI), 1 / (4 * PI)]
    : p.mieG.map((g) => phaseCornetteShanks(cosT, g));
  for (let i = 0; i < n; i++) {
    let u0 = i / n;
    let u1 = (i + 1) / n;
    if (denseAtB) {
      u0 = 1 - (1 - u0) * (1 - u0);
      u1 = 1 - (1 - u1) * (1 - u1);
    } else {
      u0 *= u0;
      u1 *= u1;
    }
    const t0 = ta + (tb - ta) * u0;
    const t1 = ta + (tb - ta) * u1;
    const dt = t1 - t0;
    const t = 0.5 * (t0 + t1);
    const P: V3 = [ro[0] + rd[0] * t, ro[1] + rd[1] * t, ro[2] + rd[2] * t];
    const r = len(P);
    const muS = dot(P, sun) / r;
    const m = medium(p, r - p.bottomKm);
    const ts = sunTransmittance(p, luts, r, muS);
    const ms = luts.ms ? luts.ms.sample(...multiScatterUv(p, r, muS)) : [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      const sS = m.rayS[c] + m.mieS[c];
      const S = ts[c] * (m.rayS[c] * phR + m.mieS[c] * phM[c]) + ms[c] * sS;
      const st = Math.exp(-m.ext[c] * dt);
      const k = m.ext[c] > 1e-9 ? (1 - st) / m.ext[c] : dt;
      acc.L[c] += acc.T[c] * S * k;
      acc.fms[c] += acc.T[c] * sS * k;
      acc.T[c] *= st;
    }
  }
  return acc;
}

/** Hillaire's Psi_ms at (r, muS): 64 directions, isotropic phase, ground albedo bounce, 1/(1 - f_ms). */
export function multiScatterAt(p: AtmosphereParams, trans: Lut2D, r: number, muS: number): RGB {
  const ro: V3 = [0, 0, r];
  const sun: V3 = [0, Math.sqrt(Math.max(0, 1 - muS * muS)), muS];
  const luts: Luts = { trans, ms: null };
  const L2: RGB = [0, 0, 0];
  const f: RGB = [0, 0, 0];
  const n = MS_DIRS_SQRT * MS_DIRS_SQRT;
  for (let a = 0; a < MS_DIRS_SQRT; a++) {
    for (let b = 0; b < MS_DIRS_SQRT; b++) {
      const theta = (2 * PI * (a + 0.5)) / MS_DIRS_SQRT;
      const phi = Math.acos(1 - (2 * (b + 0.5)) / MS_DIRS_SQRT);
      const rd: V3 = [Math.cos(theta) * Math.sin(phi), Math.sin(theta) * Math.sin(phi), Math.cos(phi)];
      const ground = raySphere(ro, rd, p.bottomKm);
      const hitsGround = ground !== null && ground[0] > 0;
      const tMax = hitsGround ? ground![0] : raySphere(ro, rd, p.topKm)![1];
      const res = march(p, luts, ro, rd, sun, 0, tMax, MS_STEPS, false, true);
      if (hitsGround) {
        const G: V3 = [rd[0] * tMax, rd[1] * tMax, rd[2] * tMax + r];
        const gl = len(G);
        const mu0 = dot(G, sun) / gl;
        const ts = sunTransmittance(p, luts, gl, mu0);
        for (let c = 0; c < 3; c++)
          res.L[c] += (res.T[c] * ts[c] * Math.max(mu0, 0) * p.groundAlbedo[c]) / PI;
      }
      for (let c = 0; c < 3; c++) {
        L2[c] += res.L[c] / n;
        f[c] += res.fms[c] / n;
      }
    }
  }
  return [L2[0] / (1 - f[0]), L2[1] / (1 - f[1]), L2[2] / (1 - f[2])];
}

export function buildMultiScatterLut(p: AtmosphereParams, trans: Lut2D, n = MULTISCATTER_SIZE): Lut2D {
  const lut = new Lut2D(n, n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const muS = fromSubUv((i + 0.5) / n, n) * 2 - 1;
      const r = Math.max(p.bottomKm + 1e-4, p.bottomKm + fromSubUv((j + 0.5) / n, n) * (p.topKm - p.bottomKm));
      lut.set(i, j, multiScatterAt(p, trans, r, clamp(muS, -1, 1)));
    }
  }
  return lut;
}

/**
 * Sky radiance per unit solar illuminance seen from height hKm, view direction given by its
 * elevation and azimuth relative to the Sun, Sun at elevation sunElDeg (CPU twin of the sky-view LUT).
 */
export function skyRadiance(
  p: AtmosphereParams,
  luts: Luts,
  hKm: number,
  viewElDeg: number,
  viewAzDeg: number,
  sunElDeg: number,
  steps = 64,
): RGB {
  const d = PI / 180;
  const r = p.bottomKm + hKm;
  const ro: V3 = [0, 0, r];
  const sun: V3 = [Math.cos(sunElDeg * d), 0, Math.sin(sunElDeg * d)];
  const el = viewElDeg * d;
  const az = viewAzDeg * d;
  const rd: V3 = [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];
  const ground = raySphere(ro, rd, p.bottomKm);
  const tMax = ground && ground[0] > 0 ? ground[0] : raySphere(ro, rd, p.topKm)![1];
  return march(p, luts, ro, rd, sun, 0, tMax, steps, false, false).L;
}

/** Builds both static LUTs on the CPU (tests, reference). */
export function buildCpuLuts(p: AtmosphereParams, msSize = MULTISCATTER_SIZE): Luts {
  const trans = buildTransmittanceLut(p);
  return { trans, ms: buildMultiScatterLut(p, trans, msSize) };
}
