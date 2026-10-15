/**
 * The Orion Nebula as a 2.5D "blister" volume (TS twin of model.glsl + march.glsl; docs/modules/nebulae.md).
 *
 * Local frame `nebula:m42` (pc): origin θ¹ Ori C at D = 400 pc, x east, y north, z away from Earth
 * (right-handed: east × north = line of sight). A column is an Earth ray (ξ, η) = (x, y) / (D + z): every
 * column carries the observed (photo) radiance S_k of three components (Hα+[NII], [OIII]+Hβ, scattered light) and
 * a dust optical depth. Along the column the emission is spread over thin layers whose profiles integrate to 1,
 * so the view from Earth equals the photo whatever the depth model does:
 * - sheet: the ionization front, a concave bowl 0.2 pc behind θ¹ Ori C rising towards Earth outwards, with
 *   the Orion Bar escarpment 0.23 pc SE; ~0.1 pc thick near the core, ~1 pc outwards; z displacement and
 *   thickness noise from the maps;
 * - M43: a 0.6 pc ball around NU Ori;
 * - veil: an absorber ~2 pc in front (dust lanes from the map plus a smooth A_V); the emission behind it is
 *   de-reddened by the same τ, so the product seen from Earth is the photo;
 * - OMC-1: an opaque slab just behind the emission.
 * Layer integrals use the profile CDF over each ray segment (P(u_b) - P(u_a)) / (u_b - u_a), which is exact for
 * any step size along an Earth ray (column integrals are conserved).
 */
import type { Vec3d } from '../../core/contracts';
import orion from './orion.json';

export const D_PC = orion.distance.pc;
const DEG = Math.PI / 180;
const G = orion.geometry;

/** Shipped build products (public/data/nebulae/orion-meta.json, written by tools/build-nebulae.mjs). */
export interface NebulaMeta {
  version: number;
  center: { raDeg: number; decDeg: number };
  field: { halfWidthDeg: number; xiMax: number; pixels: number; mapPixels: number; pxArcsec: number };
  emission: { file: string; encodeExp: number; lRef: number; components: string[] };
  maps: { file: string; tauMax: number };
  core: { file: string; xiMax: number; pixels: number; ratioLog2Span: number } | null;
  calibration: {
    /** Inverse stretch of the photo: 'asinh' (L = a·sinh(p·v)) or 'power' (L = a·Y^p). */
    transfer: string;
    stretch: number;
    /** Brightness rise of the rebuilt clipped core over its edge. */
    domePeak: number;
    totalV: number;
    coreMuV: number;
    m43V: number;
    totalApertureArcmin: number;
    m43ApertureArcmin: number;
    coreRadiusArcmin: number;
  };
}
export const META_PATH = 'data/nebulae/orion-meta.json';

export const CENTER = orion.center;

/** Gnomonic projection about θ¹ Ori C: [ξ east, η north] (tangent-plane, radians at the centre). */
export function gnomonic(raDeg: number, decDeg: number): [number, number] {
  const a = raDeg * DEG;
  const d = decDeg * DEG;
  const a0 = CENTER.raDeg * DEG;
  const d0 = CENTER.decDeg * DEG;
  const cosc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(a - a0);
  return [
    (Math.cos(d) * Math.sin(a - a0)) / cosc,
    (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(a - a0)) / cosc,
  ];
}

/** Sky-plane position (pc, in the z = 0 plane through θ¹ Ori C) of a catalogue direction. */
export function skyPc(raDeg: number, decDeg: number): { x: number; y: number } {
  const [xi, eta] = gnomonic(raDeg, decDeg);
  return { x: xi * D_PC, y: eta * D_PC };
}

/** Local position (pc) of a point at `distPc` from the Sun along (ra, dec). */
export function localPc(raDeg: number, decDeg: number, distPc: number, out: Vec3d): Vec3d {
  const [xi, eta] = gnomonic(raDeg, decDeg);
  const n = Math.hypot(xi, eta, 1);
  out.x = (xi / n) * distPc;
  out.y = (eta / n) * distPc;
  out.z = distPc / n - D_PC;
  return out;
}

const nu = orion.stars.find((s) => s.id === 'nu-ori')!;
const barNormalPa = (G.bar.paDeg + 90) * DEG;

/** Model constants (pc unless noted). */
export const MODEL = {
  z0: G.bowl.z0Pc,
  bowlDepth: G.bowl.depthPc,
  bowlScale: G.bowl.scalePc,
  /** Unit normal of the Orion Bar towards SE, (east, north). */
  barNormal: [Math.sin(barNormalPa), Math.cos(barNormalPa)] as const,
  barDistance: G.bar.distancePc,
  barRise: G.bar.risePc,
  barWidth: G.bar.widthPc,
  /** Half-length of the escarpment along the Bar. */
  barLength: 1.2,
  thicknessCore: G.sheet.thicknessCorePc,
  thicknessOuter: G.sheet.thicknessOuterPc,
  thicknessRadius: G.sheet.outerRadiusPc,
  displacement: G.sheet.displacement,
  thicknessNoise: G.sheet.thicknessNoise,
  m43: skyPc(nu.raDeg, nu.decDeg),
  m43Radius: G.m43.radiusPc,
  veilZ: G.veil.zPc,
  veilHalf: G.veil.halfThicknessPc,
  /** Smooth veil optical depth τ_V = A_V / 1.0857 inside baseRadius. */
  veilBaseTau: G.veil.baseAv / 1.0857,
  veilBaseRadius: G.veil.baseRadiusPc,
  tauMax: G.veil.maxTau,
  /** Minimum gap between an absorber and the emission it sits in front of / behind. */
  layerGap: 0.3,
  omcGap: G.omc.gapPc,
  omcHalf: G.omc.halfThicknessPc,
  omcTau: G.omc.tau,
  omcInner: G.omc.innerRadiusPc,
  omcOuter: G.omc.outerRadiusPc,
  /** A_λ / A_V of the three components. */
  ext: [G.extinctionRatios.halpha, G.extinctionRatios.oiii, G.extinctionRatios.scattered] as const,
  /** Field edge: emission and dust fade to 0 between EDGE·ξmax and ξmax. */
  edge: 0.9,
} as const;

export const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Smooth ionization-front depth (pc, + away from Earth) under sky-plane position (X, Y) pc. */
export function bowlZ(X: number, Y: number): number {
  const m = MODEL;
  const r2 = X * X + Y * Y;
  let z = m.z0 - m.bowlDepth * (1 - Math.exp(-r2 / (2 * m.bowlScale * m.bowlScale)));
  // Orion Bar: beyond the ridge (SE) the front stands closer to us, an escarpment seen edge-on from Earth.
  const across = X * m.barNormal[0] + Y * m.barNormal[1] - m.barDistance;
  const along = -X * m.barNormal[1] + Y * m.barNormal[0];
  z -=
    m.barRise *
    smoothstep(-m.barWidth, m.barWidth, across) *
    (1 - smoothstep(m.barLength * 0.5, m.barLength, Math.abs(along)));
  return z;
}

/** Full emitting-layer thickness (pc) at sky radius rho; `noise` ∈ [-1, 1]. */
export function thickness(rho: number, noise: number): number {
  const m = MODEL;
  return (
    (m.thicknessCore + (m.thicknessOuter - m.thicknessCore) * smoothstep(0, m.thicknessRadius, rho)) *
    (1 + m.thicknessNoise * noise)
  );
}

/** Per-column map values: τ_V of the dust lanes (0..tauMax), z displacement and thickness noise (-1..1). */
export interface ColumnMaps {
  tau: number;
  disp: number;
  thick: number;
}

/** Layer stack of one column (all z in pc, half-thicknesses in pc). */
export interface ColumnLayers {
  sheetZ: number;
  sheetHw: number;
  /** Share of the column's emission in the M43 ball (the sheet gets 1 - w43). */
  w43: number;
  m43Z: number;
  m43Hw: number;
  veilZ: number;
  veilHw: number;
  veilTau: number;
  omcZ: number;
  omcHw: number;
  omcTau: number;
}

export const emptyLayers = (): ColumnLayers => ({
  sheetZ: 0,
  sheetHw: 1,
  w43: 0,
  m43Z: 0,
  m43Hw: 1,
  veilZ: 0,
  veilHw: 1,
  veilTau: 0,
  omcZ: 0,
  omcHw: 1,
  omcTau: 0,
});

/** The layer stack under sky-plane position (X, Y) pc. */
export function columnLayers(X: number, Y: number, maps: ColumnMaps, out: ColumnLayers): ColumnLayers {
  const m = MODEL;
  const rho = Math.hypot(X, Y);
  const t = thickness(rho, maps.thick);
  out.sheetHw = 0.5 * t;
  out.sheetZ = bowlZ(X, Y) + m.displacement * t * maps.disp;
  const r43 = Math.hypot(X - m.m43.x, Y - m.m43.y);
  const R = m.m43Radius;
  out.w43 = 1 - smoothstep(0.7 * R, R, r43);
  out.m43Z = 0;
  out.m43Hw = Math.max(Math.sqrt(Math.max(R * R - r43 * r43, 0)), 0.05 * R);
  const front = Math.min(out.sheetZ - out.sheetHw, out.w43 > 0 ? -out.m43Hw : Infinity);
  const back = Math.max(out.sheetZ + out.sheetHw, out.w43 > 0 ? out.m43Hw : -Infinity);
  out.veilHw = m.veilHalf;
  out.veilZ = Math.min(m.veilZ, front - m.layerGap - m.veilHalf);
  out.veilTau = Math.min(
    maps.tau + m.veilBaseTau * (1 - smoothstep(0.5 * m.veilBaseRadius, 1.5 * m.veilBaseRadius, rho)),
    m.tauMax,
  );
  out.omcHw = m.omcHalf;
  out.omcZ = back + m.omcGap + m.omcHalf;
  out.omcTau = m.omcTau * (1 - smoothstep(m.omcInner, m.omcOuter, rho));
  return out;
}

/** Conservative z range of every layer (pc), for the bounding box. */
export function zRange(): [number, number] {
  const m = MODEL;
  const tMax = m.thicknessOuter * (1 + m.thicknessNoise);
  const bowlMin = m.z0 - m.bowlDepth - m.barRise;
  const sheetMin = bowlMin - m.displacement * tMax - 0.5 * tMax;
  const zMin = Math.min(m.veilZ, sheetMin - m.layerGap - m.veilHalf) - m.veilHalf;
  const sheetMax = m.z0 + m.displacement * tMax + 0.5 * tMax;
  const zMax = Math.max(sheetMax, m.m43Radius) + m.omcGap + 2 * m.omcHalf;
  return [zMin - 0.05, zMax + 0.05];
}

/** Profile CDF of every layer: u = (z - zc) / hw, P(-1) = 0, P(1) = 1 (cubic, pdf 3/4 (1 - u²)). */
export const profileCdf = (u: number): number => smoothstep(-1, 1, u);
export const profilePdf = (u: number): number => (Math.abs(u) < 1 ? 0.75 * (1 - u * u) : 0);

/**
 * Fraction of a layer's column crossed by a ray segment, with u linear along the segment from ua to ub and
 * `dtOverHw` = segment length / half-thickness. Exact for any step size when u varies linearly.
 */
export function segmentFraction(ua: number, ub: number, dtOverHw: number): number {
  const du = ub - ua;
  if (Math.abs(du) < 1e-4) return profilePdf(0.5 * (ua + ub)) * dtOverHw;
  return ((profileCdf(ub) - profileCdf(ua)) / du) * dtOverHw;
}

/** Position (0..1) inside a segment where the layer's centre u = 0 is crossed (clamped). */
export function segmentCentre(ua: number, ub: number): number {
  const du = ub - ua;
  if (Math.abs(du) < 1e-4) return 0.5;
  return Math.min(1, Math.max(0, -ua / du));
}

// ---------------------------------------------------------------------------------------------------------------
// Ray march (TS twin of march.glsl, used by the unit tests)
// ---------------------------------------------------------------------------------------------------------------

/** Fades emission and dust to 0 at the edge of the field (square, half-width xiMax). */
export const edgeFade = (xi: number, eta: number, xiMax: number): number =>
  1 - smoothstep(MODEL.edge, 1, Math.max(Math.abs(xi), Math.abs(eta)) / xiMax);

/** What a column holds: observed radiance per component (cd/m², core detail applied) and its maps. */
export interface ColumnSample extends ColumnMaps {
  S: [number, number, number];
}
export type FieldSampler = (xi: number, eta: number, out: ColumnSample) => ColumnSample;

export interface MarchResult {
  /** Radiance per component reaching the camera, cd/m². */
  L: [number, number, number];
  /** V-band transmittance of the background through the volume. */
  T: number;
  /** Column evaluations. */
  evals: number;
}

/** Bounding box of the volume (pc): |x|, |y| ≤ half, z ∈ [zMin, zMax]. */
export function volumeBox(xiMax: number): { half: number; zMin: number; zMax: number } {
  const [zMin, zMax] = zRange();
  return { half: xiMax * (D_PC + zMax), zMin, zMax };
}

/** Ray-box entry/exit distances or null. */
export function rayBox(
  o: Vec3d,
  d: Vec3d,
  half: number,
  zMin: number,
  zMax: number,
): [number, number] | null {
  let t0 = -Infinity;
  let t1 = Infinity;
  const lo = [-half, -half, zMin];
  const hi = [half, half, zMax];
  const oo = [o.x, o.y, o.z];
  const dd = [d.x, d.y, d.z];
  for (let k = 0; k < 3; k++) {
    if (Math.abs(dd[k]) < 1e-12) {
      if (oo[k] < lo[k] || oo[k] > hi[k]) return null;
      continue;
    }
    const a = (lo[k] - oo[k]) / dd[k];
    const b = (hi[k] - oo[k]) / dd[k];
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  t0 = Math.max(t0, 0);
  return t1 > t0 ? [t0, t1] : null;
}

interface Point {
  t: number;
  z: number;
  S: [number, number, number];
  L: ColumnLayers;
}

const MIN_STEP = 0.35;
/** Largest step count the shader loop allows (ultra uses 128). */
export const MAX_LOOP = 160;
const MAX_STEP = 3;
/** Early exit once the V transmittance falls below this. */
export const T_EXIT = 3e-3;

/**
 * Marches one ray (origin o, unit direction d, pc) through the volume with at most `steps` segments; `jitter`
 * ∈ [0, 1) shifts the first sample. Sheet tracing: steps shrink near the emitting layers and grow away from
 * them; the last segment always reaches the far side of the box.
 */
export function marchRay(
  o: Vec3d,
  d: Vec3d,
  steps: number,
  jitter: number,
  sampler: FieldSampler,
  xiMax: number,
): MarchResult {
  const box = volumeBox(xiMax);
  const res: MarchResult = { L: [0, 0, 0], T: 1, evals: 0 };
  const hit = rayBox(o, d, box.half, box.zMin, box.zMax);
  if (!hit) return res;
  const [tNear, tFar] = hit;
  const base = (tFar - tNear) / steps;
  const cs: ColumnSample = { S: [0, 0, 0], tau: 0, disp: 0, thick: 0 };
  const evalAt = (t: number): Point => {
    const x = o.x + d.x * t;
    const y = o.y + d.y * t;
    const z = o.z + d.z * t;
    const k = D_PC + z;
    sampler(x / k, y / k, cs);
    const e = edgeFade(x / k, y / k, xiMax);
    cs.S[0] *= e;
    cs.S[1] *= e;
    cs.S[2] *= e;
    cs.tau *= e;
    const L = columnLayers((x / k) * D_PC, (y / k) * D_PC, cs, emptyLayers());
    res.evals++;
    return { t, z, S: [cs.S[0], cs.S[1], cs.S[2]], L };
  };
  const T = [1, 1, 1, 1]; // per component, then V
  let a = evalAt(tNear);
  let t = tNear;
  for (let i = 0; i < steps && t < tFar && T[3] > T_EXIT; i++) {
    let dt = nextStep(a, base) * (i === 0 ? 0.25 + 0.75 * jitter : 1);
    if (i === steps - 1 || t + dt > tFar) dt = tFar - t;
    t += dt;
    const b = evalAt(t);
    integrateSegment(a, b, dt, T, res.L);
    a = b;
  }
  res.T = T[3];
  return res;
}

/** Sheet tracing: the vertical gap to the nearest emitting layer (or the ball) sets the next step. */
function nextStep(p: Point, base: number): number {
  const L = p.L;
  const gapSheet = Math.abs(p.z - L.sheetZ) - L.sheetHw;
  const gap43 = L.w43 > 0 ? Math.abs(p.z - L.m43Z) - L.m43Hw : Infinity;
  const gap = Math.min(gapSheet, gap43);
  return Math.min(MAX_STEP * base, Math.max(MIN_STEP * base, 0.8 * gap));
}

/** Integrates one segment a -> b into L (radiance) and T (per-component transmittance). */
function integrateSegment(a: Point, b: Point, dt: number, T: number[], L: number[]): void {
  const la = a.L;
  const lb = b.L;
  const ua = (z: number, zc: number, hw: number) => (z - zc) / hw;
  const mid = (x: number, y: number) => 0.5 * (x + y);
  // Layer fractions and where in the segment each layer's centre lies.
  const sUa = ua(a.z, la.sheetZ, la.sheetHw);
  const sUb = ua(b.z, lb.sheetZ, lb.sheetHw);
  const fSheet = segmentFraction(sUa, sUb, dt / mid(la.sheetHw, lb.sheetHw));
  const cSheet = segmentCentre(sUa, sUb);
  const mUa = ua(a.z, la.m43Z, la.m43Hw);
  const mUb = ua(b.z, lb.m43Z, lb.m43Hw);
  const f43 = segmentFraction(mUa, mUb, dt / mid(la.m43Hw, lb.m43Hw));
  const c43 = segmentCentre(mUa, mUb);
  const vUa = ua(a.z, la.veilZ, la.veilHw);
  const vUb = ua(b.z, lb.veilZ, lb.veilHw);
  const tauVeil = mid(la.veilTau, lb.veilTau) * segmentFraction(vUa, vUb, dt / mid(la.veilHw, lb.veilHw));
  const cVeil = segmentCentre(vUa, vUb);
  const oUa = ua(a.z, la.omcZ, la.omcHw);
  const oUb = ua(b.z, lb.omcZ, lb.omcHw);
  const tauOmc = mid(la.omcTau, lb.omcTau) * segmentFraction(oUa, oUb, dt / mid(la.omcHw, lb.omcHw));
  const cOmc = segmentCentre(oUa, oUb);
  const w43 = mid(la.w43, lb.w43);
  const veilCol = mid(la.veilTau, lb.veilTau);
  // Absorbers in front of an emitter inside the same segment dim it fully, behind it not at all.
  const before = (cE: number, cA: number) => smoothstep(-0.05, 0.05, cE - cA);
  for (let k = 0; k < 3; k++) {
    const ext = MODEL.ext[k];
    const s = mid(a.S[k], b.S[k]) * Math.exp(veilCol * ext); // de-reddened
    const eSheet =
      s *
      (1 - w43) *
      fSheet *
      Math.exp(-ext * (tauVeil * before(cSheet, cVeil) + tauOmc * before(cSheet, cOmc)));
    const e43 = s * w43 * f43 * Math.exp(-ext * (tauVeil * before(c43, cVeil) + tauOmc * before(c43, cOmc)));
    L[k] += T[k] * (eSheet + e43);
    T[k] *= Math.exp(-ext * (tauVeil + tauOmc));
  }
  T[3] *= Math.exp(-(tauVeil + tauOmc));
}

// ---------------------------------------------------------------------------------------------------------------
// GLSL twin
// ---------------------------------------------------------------------------------------------------------------

const f = (v: number): string => {
  const s = Number(v.toPrecision(9)).toString();
  return /[.e]/.test(s) ? s : `${s}.0`;
};

/** #defines shared with model.glsl / march.glsl (every NEB_ symbol comes from here). */
export function nebulaGlslDefines(meta: NebulaMeta): string {
  const m = MODEL;
  const [zMin, zMax] = zRange();
  const box = volumeBox(meta.field.xiMax);
  return [
    `#define NEB_D ${f(D_PC)}`,
    `#define NEB_XI_MAX ${f(meta.field.xiMax)}`,
    `#define NEB_HALF ${f(box.half)}`,
    `#define NEB_Z_MIN ${f(zMin)}`,
    `#define NEB_Z_MAX ${f(zMax)}`,
    `#define NEB_EDGE ${f(m.edge)}`,
    `#define NEB_ENC ${f(meta.emission.encodeExp)}`,
    `#define NEB_LREF ${f(meta.emission.lRef)}`,
    `#define NEB_TEXEL_PC ${f((2 * meta.field.xiMax * D_PC) / meta.field.pixels)}`,
    `#define NEB_CORE_XI ${f(meta.core ? meta.core.xiMax : 0)}`,
    `#define NEB_CORE_SPAN ${f(meta.core ? meta.core.ratioLog2Span : 0)}`,
    `#define NEB_CORE_TEXEL_PC ${f(meta.core ? (2 * meta.core.xiMax * D_PC) / meta.core.pixels : 1)}`,
    `#define NEB_MAX_LOOP ${MAX_LOOP}`,
    `#define NEB_Z0 ${f(m.z0)}`,
    `#define NEB_BOWL_DEPTH ${f(m.bowlDepth)}`,
    `#define NEB_BOWL_2S2 ${f(2 * m.bowlScale * m.bowlScale)}`,
    `#define NEB_BAR_N vec2(${f(m.barNormal[0])}, ${f(m.barNormal[1])})`,
    `#define NEB_BAR_D ${f(m.barDistance)}`,
    `#define NEB_BAR_RISE ${f(m.barRise)}`,
    `#define NEB_BAR_W ${f(m.barWidth)}`,
    `#define NEB_BAR_LEN ${f(m.barLength)}`,
    `#define NEB_T_CORE ${f(m.thicknessCore)}`,
    `#define NEB_T_OUTER ${f(m.thicknessOuter)}`,
    `#define NEB_T_R ${f(m.thicknessRadius)}`,
    `#define NEB_DISP ${f(m.displacement)}`,
    `#define NEB_T_NOISE ${f(m.thicknessNoise)}`,
    `#define NEB_M43 vec2(${f(m.m43.x)}, ${f(m.m43.y)})`,
    `#define NEB_M43_R ${f(m.m43Radius)}`,
    `#define NEB_VEIL_Z ${f(m.veilZ)}`,
    `#define NEB_VEIL_HW ${f(m.veilHalf)}`,
    `#define NEB_VEIL_BASE_TAU ${f(m.veilBaseTau)}`,
    `#define NEB_VEIL_BASE_R ${f(m.veilBaseRadius)}`,
    `#define NEB_TAU_MAX ${f(m.tauMax)}`,
    `#define NEB_GAP ${f(m.layerGap)}`,
    `#define NEB_OMC_GAP ${f(m.omcGap)}`,
    `#define NEB_OMC_HW ${f(m.omcHalf)}`,
    `#define NEB_OMC_TAU ${f(m.omcTau)}`,
    `#define NEB_OMC_R0 ${f(m.omcInner)}`,
    `#define NEB_OMC_R1 ${f(m.omcOuter)}`,
    `#define NEB_EXT vec3(${f(m.ext[0])}, ${f(m.ext[1])}, ${f(m.ext[2])})`,
    `#define NEB_MIN_STEP ${f(MIN_STEP)}`,
    `#define NEB_MAX_STEP ${f(MAX_STEP)}`,
    `#define NEB_T_EXIT ${f(T_EXIT)}`,
    '',
  ].join('\n');
}
