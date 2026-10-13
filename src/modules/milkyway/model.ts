/**
 * GalaxyModel, TypeScript twin (P4-A). Parameters come from milkyway-model.json; the GLSL twin
 * (armfield.glsl + galaxy.glsl, driven by `modelGlslDefines`) evaluates the same formulas on the GPU.
 *
 * Model frame (kpc): origin Sgr A*, z = normal of the physical mid-plane, x from the Sun's projection
 * towards the centre, y towards l = 90 deg. It is the `mw` frame (IAU galactic axes) tilted by
 * asin(z0 / R0) so the Sun sits z0 = 20.8 pc above the plane (docs/modules/engine.md).
 */
import type { Vec3d } from '../../core/contracts';
import { ICRS_TO_GALACTIC, SSB_IN_MW } from '../../core/frames';
import { blackbodyRgb } from '../../core/photometry';
import { KPC, PC } from '../../core/units';
import raw from './milkyway-model.json';

export type ModelJson = typeof raw;
export type ArmRow = (typeof raw.arms)[number];
export const MODEL: ModelJson = raw;

const DEG = Math.PI / 180;
const TWO_PI = 2 * Math.PI;

/** Row-major 3x3 products and helpers. */
const mul3 = (a: readonly number[], b: readonly number[]): number[] => {
  const o: number[] = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) o.push(a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]);
  return o;
};
const norm = (v: number[]): number[] => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: number[], b: number[]): number[] => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** mw (galactic) axes → model axes, row-major (p_model = M · p_mw). */
export const MW_TO_MODEL: readonly number[] = (() => {
  const r0 = Math.hypot(SSB_IN_MW.x, SSB_IN_MW.y, SSB_IN_MW.z);
  const s = [SSB_IN_MW.x / r0, SSB_IN_MW.y / r0, SSB_IN_MW.z / r0]; // centre → Sun
  const n0 = [0, 0, 1];
  const ym = norm(cross(s, n0));
  const k = n0[0] * s[0] + n0[1] * s[1] + n0[2] * s[2];
  const n1 = norm([n0[0] - k * s[0], n0[1] - k * s[1], n0[2] - k * s[2]]);
  const th = Math.asin((MODEL.sun.z0 * KPC) / r0);
  const zm = [0, 1, 2].map((i) => Math.cos(th) * n1[i] + Math.sin(th) * s[i]);
  const xm = cross(ym, zm);
  return [...xm, ...ym, ...zm];
})();

/** World (ICRS) axes → model axes, row-major. */
export const WORLD_TO_MODEL: readonly number[] = mul3(MW_TO_MODEL, ICRS_TO_GALACTIC);

/** Applies a row-major 3x3 matrix. */
export function apply3(m: readonly number[], v: Vec3d, out: Vec3d): Vec3d {
  const { x, y, z } = v;
  out.x = m[0] * x + m[1] * y + m[2] * z;
  out.y = m[3] * x + m[4] * y + m[5] * z;
  out.z = m[6] * x + m[7] * y + m[8] * z;
  return out;
}

/** Unit vector for galactic (l, b) in degrees, IAU galactic axes. */
export const galacticDir = (lDeg: number, bDeg: number): Vec3d => ({
  x: Math.cos(bDeg * DEG) * Math.cos(lDeg * DEG),
  y: Math.cos(bDeg * DEG) * Math.sin(lDeg * DEG),
  z: Math.sin(bDeg * DEG),
});

/** The Sun in model coordinates, kpc. */
export const SUN_MODEL: Readonly<Vec3d> = apply3(
  MW_TO_MODEL,
  { x: SSB_IN_MW.x / KPC, y: SSB_IN_MW.y / KPC, z: SSB_IN_MW.z / KPC },
  { x: 0, y: 0, z: 0 },
);

/** Galactocentric arm azimuth beta (rad): 0 towards the Sun, increasing with Galactic rotation. */
export const armAzimuth = (x: number, y: number): number => Math.atan2(y, -x);

// ---------------------------------------------------------------------------------------
// Precomputed constants (shared with the GLSL defines)
// ---------------------------------------------------------------------------------------

export interface ArmConst {
  bk: number;
  lnRk: number;
  tLt: number;
  tGt: number;
  wk: number;
  rk: number;
  bMin: number;
  bMax: number;
  young: number;
  old: number;
  dust: number;
}

export const ARMS: readonly ArmConst[] = MODEL.arms.map((a) => ({
  bk: a.betaKink * DEG,
  lnRk: Math.log(a.rKink),
  tLt: Math.tan(a.psiLt * DEG),
  tGt: Math.tan(a.psiGt * DEG),
  wk: a.width,
  rk: a.rKink,
  bMin: a.betaRender[0] * DEG,
  bMax: a.betaRender[1] * DEG,
  young: a.young,
  old: a.old,
  dust: a.dust,
}));

/** Arm centre-line radius (kpc) at azimuth beta (rad), Reid 2019 eq. 1 with a kink. */
export function armRadius(arm: ArmConst, beta: number): number {
  return Math.exp(arm.lnRk - (beta - arm.bk) * (beta < arm.bk ? arm.tLt : arm.tGt));
}

/** Linear-sRGB colour with luminance 1 for each emission component. */
export const COLORS = {
  thin: blackbodyRgb(MODEL.thinDisk.teff),
  thick: blackbodyRgb(MODEL.thickDisk.teff),
  bulge: blackbodyRgb(MODEL.bulge.teff),
  bar: blackbodyRgb(MODEL.bar.teff),
  young: blackbodyRgb(MODEL.armProfile.youngTeff),
  hii: ((c: number[]) => {
    const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    return [c[0] / l, c[1] / l, c[2] / l] as [number, number, number];
  })(MODEL.hii.rgb),
};

/** cd/m² per (Lsun pc^-3 · kpc) of emission integrated along a ray. */
export const LUMINANCE_PER_UNIT =
  ((MODEL.photometry.lsunLumens * 1e3) / (4 * Math.PI * PC * PC)) * MODEL.photometry.calibration;

// ---------------------------------------------------------------------------------------
// Planar arm field (baked to a texture by the GLSL twin)
// ---------------------------------------------------------------------------------------

/** 32-bit integer hash (identical to hashCell in armfield.glsl). */
export function hashCell(cx: number, cy: number): number {
  let h = (Math.imul(cx | 0, 0x8da6b343) ^ Math.imul(cy | 0, 0xd8163841)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
}

const smooth01 = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

export interface ArmField {
  /** Young-population arm proximity (sum of strength · Gaussian). */
  young: number;
  /** Old-disk arm contrast term. */
  old: number;
  /** Dust on the inner arm edges. */
  dust: number;
  /** HII clump amplitude (already multiplied by `young`). */
  hii: number;
}

/** Signed distance (kpc, > 0 outside the arm) to an arm's nearest in-range winding and its taper. */
export function armDistance(arm: ArmConst, R: number, beta: number): { d: number; taper: number } {
  const lnR = Math.log(Math.max(R, 0.05));
  let best = Infinity;
  let taper = 0;
  const tw = MODEL.armProfile.taperDeg * DEG;
  for (let k = -1; k <= 1; k++) {
    const b = beta + TWO_PI * k;
    if (b < arm.bMin || b > arm.bMax) continue;
    const lnRa = arm.lnRk - (b - arm.bk) * (b < arm.bk ? arm.tLt : arm.tGt);
    const d = R * (lnR - lnRa);
    if (Math.abs(d) < Math.abs(best)) {
      best = d;
      taper = smooth01((b - arm.bMin) / tw) * smooth01((arm.bMax - b) / tw);
    }
  }
  return { d: best, taper };
}

export function armField(x: number, y: number, out: ArmField): ArmField {
  const R = Math.max(Math.hypot(x, y), 0.05);
  const beta = armAzimuth(x, y);
  const ap = MODEL.armProfile;
  const dp = MODEL.dust;
  out.young = out.old = out.dust = out.hii = 0;
  for (const arm of ARMS) {
    const { d, taper } = armDistance(arm, R, beta);
    if (!Number.isFinite(d)) continue;
    const w = Math.max(0.1, (arm.wk + ap.widthGrowth * (R - arm.rk)) * ap.widthScale);
    const g = Math.exp(-0.5 * (d / w) ** 2) * taper;
    out.young += arm.young * g;
    out.old += arm.old * g;
    const e = (d + dp.edgeOffset * w) / (dp.edgeWidth * w);
    out.dust += arm.dust * Math.exp(-0.5 * e * e) * taper;
  }
  // HII clumps: one hashed clump per cell, modulated by arm proximity.
  const h = MODEL.hii;
  const cx = Math.floor(x / h.cell);
  const cy = Math.floor(y / h.cell);
  const h1 = hashCell(cx, cy);
  const h2 = hashCell(h1 | 0, 7);
  const occupied = (h2 & 0xffff) / 65535 < h.fraction;
  if (occupied) {
    const px = (cx + 0.2 + 0.6 * ((h1 & 0xffff) / 65535)) * h.cell;
    const py = (cy + 0.2 + 0.6 * ((h1 >>> 16) / 65535)) * h.cell;
    const amp = 0.4 + 0.6 * ((h2 >>> 16) / 65535);
    const r2 = (x - px) ** 2 + (y - py) ** 2;
    out.hii = amp * Math.exp((-0.5 * r2) / (h.sigma * h.sigma)) * out.young;
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// 3D emission and dust
// ---------------------------------------------------------------------------------------

export interface Components {
  thin: number;
  thick: number;
  bulge: number;
  bar: number;
  young: number;
  hii: number;
}

const BAR_C = Math.cos(MODEL.bar.angleDeg * DEG);
const BAR_S = Math.sin(MODEL.bar.angleDeg * DEG);

/** Bar-frame coordinates: xb along the major axis (near end at +xb, l > 0), yb across it. */
export const barFrame = (x: number, y: number): [number, number] => [
  -x * BAR_C + y * BAR_S,
  x * BAR_S + y * BAR_C,
];

/** Emission components (Lsun pc^-3) at a model point (kpc), given its arm field. */
export function components(x: number, y: number, z: number, f: ArmField, out: Components): Components {
  const R = Math.hypot(x, y);
  const az = Math.abs(z);
  const R0 = MODEL.sun.R0;
  const td = MODEL.thinDisk;
  const hole = 1 - td.holeDepth * Math.exp(-((R / td.holeR) ** 2));
  out.thin =
    td.j0 * Math.exp(-(R - R0) / td.hR - az / td.hz) * hole * (1 + MODEL.armProfile.oldContrast * f.old);
  const tk = MODEL.thickDisk;
  out.thick = td.j0 * tk.norm * Math.exp(-(R - R0) / tk.hR - az / tk.hz);
  const [xb, yb] = barFrame(x, y);
  const bu = MODEL.bulge;
  const q = (xb / bu.x0) ** 2 + (yb / bu.y0) ** 2;
  out.bulge = bu.j0 * Math.exp(-0.5 * Math.sqrt(q * q + (z / bu.z0) ** 4));
  const ba = MODEL.bar;
  out.bar =
    ba.j0 *
    Math.exp(
      -((Math.abs(xb) / ba.halfLength) ** ba.endSharpness) - Math.abs(yb) / ba.yScale - az / ba.zScale,
    );
  const ap = MODEL.armProfile;
  const radial = Math.exp(-(R - R0) / ap.youngHR);
  out.young = ap.youngJ0 * radial * Math.exp(-az / ap.youngHz) * f.young;
  out.hii = MODEL.hii.j0 * radial * Math.exp(-az / MODEL.hii.hz) * f.hii;
  return out;
}

/** Dust opacity kappa_V (1/kpc) at a model point. */
export function dustKappa(x: number, y: number, z: number, f: ArmField): number {
  const R = Math.hypot(x, y);
  const d = MODEL.dust;
  return d.kappaV0 * Math.exp(-(R - MODEL.sun.R0) / d.hR - Math.abs(z) / d.hz) * (1 + d.armKappa * f.dust);
}

/** Total emissivity (Lsun pc^-3, V-band-like luminance) at a model point. */
export function emissivity(x: number, y: number, z: number): number {
  const f = armField(x, y, { young: 0, old: 0, dust: 0, hii: 0 });
  const c = components(x, y, z, f, { thin: 0, thick: 0, bulge: 0, bar: 0, young: 0, hii: 0 });
  return c.thin + c.thick + c.bulge + c.bar + c.young + c.hii;
}

// ---------------------------------------------------------------------------------------
// Ray march (same scheme as galaxy.glsl)
// ---------------------------------------------------------------------------------------

/** Ray segment [t0, t1] (kpc) inside the bounding cylinder, or null. */
export function clipRay(ro: Vec3d, rd: Vec3d): [number, number] | null {
  const { rMax, zMax } = MODEL.bounds;
  let t0 = 0;
  let t1 = 1e9;
  // Slab |z| < zMax.
  if (Math.abs(rd.z) < 1e-9) {
    if (Math.abs(ro.z) > zMax) return null;
  } else {
    const a = (-zMax - ro.z) / rd.z;
    const b = (zMax - ro.z) / rd.z;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  // Cylinder x² + y² < rMax².
  const A = rd.x * rd.x + rd.y * rd.y;
  const B = ro.x * rd.x + ro.y * rd.y;
  const C = ro.x * ro.x + ro.y * ro.y - rMax * rMax;
  if (A < 1e-12) {
    if (C > 0) return null;
  } else {
    const disc = B * B - A * C;
    if (disc <= 0) return null;
    const s = Math.sqrt(disc);
    t0 = Math.max(t0, (-B - s) / A);
    t1 = Math.min(t1, (-B + s) / A);
  }
  return t1 > t0 ? [t0, t1] : null;
}

/** True when the point is inside the bounding cylinder (quadratic step spacing is used then). */
export const insideBounds = (p: Vec3d): boolean =>
  Math.abs(p.z) < MODEL.bounds.zMax && Math.hypot(p.x, p.y) < MODEL.bounds.rMax;

/**
 * Integrated linear-sRGB luminance (cd/m²) along a ray from `ro` (model kpc) in direction `rd`
 * (model axes, unit). Emission plus dust absorption, exact per homogeneous segment.
 */
export function skyLuminance(ro: Vec3d, rd: Vec3d, steps: number, jitter = 0.5): [number, number, number] {
  const seg = clipRay(ro, rd);
  if (!seg) return [0, 0, 0];
  const [t0, t1] = seg;
  const quad = insideBounds(ro);
  const red = MODEL.dust.reddening;
  const f: ArmField = { young: 0, old: 0, dust: 0, hii: 0 };
  const c: Components = { thin: 0, thick: 0, bulge: 0, bar: 0, young: 0, hii: 0 };
  const L = [0, 0, 0];
  const T = [1, 1, 1];
  for (let i = 0; i < steps; i++) {
    const u0 = i / steps;
    const u1 = (i + 1) / steps;
    const ta = t0 + (t1 - t0) * (quad ? u0 * u0 : u0);
    const tb = t0 + (t1 - t0) * (quad ? u1 * u1 : u1);
    const dt = tb - ta;
    const t = ta + dt * jitter;
    const x = ro.x + rd.x * t;
    const y = ro.y + rd.y * t;
    const z = ro.z + rd.z * t;
    armField(x, y, f);
    components(x, y, z, f, c);
    const k = dustKappa(x, y, z, f);
    const j = [0, 1, 2].map(
      (ch) =>
        c.thin * COLORS.thin[ch] +
        c.thick * COLORS.thick[ch] +
        c.bulge * COLORS.bulge[ch] +
        c.bar * COLORS.bar[ch] +
        c.young * COLORS.young[ch] +
        c.hii * COLORS.hii[ch],
    );
    for (let ch = 0; ch < 3; ch++) {
      const tau = k * red[ch] * dt;
      const att = Math.exp(-tau);
      L[ch] += T[ch] * j[ch] * dt * (tau > 1e-4 ? (1 - att) / tau : 1);
      T[ch] *= att;
    }
    if (T[0] < 1e-3 && T[1] < 1e-3 && T[2] < 1e-3) break;
  }
  return [L[0] * LUMINANCE_PER_UNIT, L[1] * LUMINANCE_PER_UNIT, L[2] * LUMINANCE_PER_UNIT];
}

/** Sky luminance (cd/m², Y) seen from the Sun towards galactic (l, b) in degrees. */
export function sunSkyLuminance(lDeg: number, bDeg: number, steps = 256): number {
  const d = apply3(MW_TO_MODEL, galacticDir(lDeg, bDeg), { x: 0, y: 0, z: 0 });
  const [r, g, b] = skyLuminance(SUN_MODEL, d, steps);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// ---------------------------------------------------------------------------------------
// GLSL twin parameters
// ---------------------------------------------------------------------------------------

const f = (v: number): string => {
  const s = Number.isInteger(v) ? v.toFixed(1) : String(v);
  return s.includes('e') ? v.toExponential(6) : s;
};
const v3 = (c: readonly number[]): string => `vec3(${f(c[0])}, ${f(c[1])}, ${f(c[2])})`;

/** `#define`s and constant arrays shared by armfield.glsl and galaxy.glsl. */
export function modelGlslDefines(): string {
  const m = MODEL;
  const arm = (fn: (a: ArmConst) => string) => ARMS.map(fn).join(', ');
  return [
    `#define MW_NARMS ${ARMS.length}`,
    `const vec4 MW_ARM_A[MW_NARMS] = vec4[MW_NARMS](${arm((a) => `vec4(${f(a.bk)}, ${f(a.lnRk)}, ${f(a.tLt)}, ${f(a.tGt)})`)});`,
    `const vec4 MW_ARM_B[MW_NARMS] = vec4[MW_NARMS](${arm((a) => `vec4(${f(a.wk)}, ${f(a.rk)}, ${f(a.bMin)}, ${f(a.bMax)})`)});`,
    `const vec3 MW_ARM_C[MW_NARMS] = vec3[MW_NARMS](${arm((a) => `vec3(${f(a.young)}, ${f(a.old)}, ${f(a.dust)})`)});`,
    `#define MW_R0 ${f(m.sun.R0)}`,
    `#define MW_WIDTH_GROWTH ${f(m.armProfile.widthGrowth)}`,
    `#define MW_WIDTH_SCALE ${f(m.armProfile.widthScale)}`,
    `#define MW_TAPER ${f(m.armProfile.taperDeg * DEG)}`,
    `#define MW_DUST_EDGE_OFFSET ${f(m.dust.edgeOffset)}`,
    `#define MW_DUST_EDGE_WIDTH ${f(m.dust.edgeWidth)}`,
    `#define MW_HII_CELL ${f(m.hii.cell)}`,
    `#define MW_HII_SIGMA ${f(m.hii.sigma)}`,
    `#define MW_HII_FRACTION ${f(m.hii.fraction)}`,
    `#define MW_THIN_J0 ${f(m.thinDisk.j0)}`,
    `#define MW_THIN_HR ${f(m.thinDisk.hR)}`,
    `#define MW_THIN_HZ ${f(m.thinDisk.hz)}`,
    `#define MW_HOLE_R ${f(m.thinDisk.holeR)}`,
    `#define MW_HOLE_DEPTH ${f(m.thinDisk.holeDepth)}`,
    `#define MW_OLD_CONTRAST ${f(m.armProfile.oldContrast)}`,
    `#define MW_THICK_NORM ${f(m.thickDisk.norm)}`,
    `#define MW_THICK_HR ${f(m.thickDisk.hR)}`,
    `#define MW_THICK_HZ ${f(m.thickDisk.hz)}`,
    `#define MW_BAR_C ${f(BAR_C)}`,
    `#define MW_BAR_S ${f(BAR_S)}`,
    `#define MW_BULGE_J0 ${f(m.bulge.j0)}`,
    `#define MW_BULGE_X0 ${f(m.bulge.x0)}`,
    `#define MW_BULGE_Y0 ${f(m.bulge.y0)}`,
    `#define MW_BULGE_Z0 ${f(m.bulge.z0)}`,
    `#define MW_BAR_J0 ${f(m.bar.j0)}`,
    `#define MW_BAR_L ${f(m.bar.halfLength)}`,
    `#define MW_BAR_N ${f(m.bar.endSharpness)}`,
    `#define MW_BAR_YS ${f(m.bar.yScale)}`,
    `#define MW_BAR_ZS ${f(m.bar.zScale)}`,
    `#define MW_YOUNG_J0 ${f(m.armProfile.youngJ0)}`,
    `#define MW_YOUNG_HR ${f(m.armProfile.youngHR)}`,
    `#define MW_YOUNG_HZ ${f(m.armProfile.youngHz)}`,
    `#define MW_HII_J0 ${f(m.hii.j0)}`,
    `#define MW_HII_HZ ${f(m.hii.hz)}`,
    `#define MW_DUST_K0 ${f(m.dust.kappaV0)}`,
    `#define MW_DUST_HR ${f(m.dust.hR)}`,
    `#define MW_DUST_HZ ${f(m.dust.hz)}`,
    `#define MW_DUST_ARM ${f(m.dust.armKappa)}`,
    `#define MW_REDDEN ${v3(m.dust.reddening)}`,
    `#define MW_RMAX ${f(m.bounds.rMax)}`,
    `#define MW_ZMAX ${f(m.bounds.zMax)}`,
    `#define MW_COL_THIN ${v3(COLORS.thin)}`,
    `#define MW_COL_THICK ${v3(COLORS.thick)}`,
    `#define MW_COL_BULGE ${v3(COLORS.bulge)}`,
    `#define MW_COL_BAR ${v3(COLORS.bar)}`,
    `#define MW_COL_YOUNG ${v3(COLORS.young)}`,
    `#define MW_COL_HII ${v3(COLORS.hii)}`,
    '',
  ].join('\n');
}
