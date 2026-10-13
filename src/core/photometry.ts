/**
 * One photometric chain (DESIGN 3.2 Photometry): magnitude → illuminance, distance modulus,
 * B-V → Teff (Ballesteros 2012), Teff → linear sRGB (Planck × CIE 1931 2°), planet point flux.
 * Units: lux (lm/m²) for illuminance, cd/m² for luminance, metres, radians, kelvin.
 */
import { AU, PC, R_SUN } from './units';

/** Illuminance of a magnitude-0 source in V, lux (E = 2.54e-6 lx · 10^(-0.4 m)). */
export const LUX_MAG0 = 2.54e-6;
/** Absolute visual magnitude of the Sun (Willmer 2018). */
export const SUN_ABS_MAG_V = 4.83;
/** Effective temperature of the Sun (IAU 2015 B3 nominal), K. */
export const SUN_TEFF = 5772;

export const illuminanceFromMag = (m: number): number => LUX_MAG0 * 10 ** (-0.4 * m);
export const magFromIlluminance = (e: number): number => -2.5 * Math.log10(e / LUX_MAG0);
/** Distance modulus μ = 5·log10(d / 10 pc), d in metres. */
export const distanceModulus = (d: number): number => 5 * Math.log10(d / (10 * PC));
/** Apparent magnitude m = M + 5·log10(d / 10 pc). */
export const apparentMag = (absMag: number, d: number): number => absMag + distanceModulus(d);
export const absoluteMag = (appMag: number, d: number): number => appMag - distanceModulus(d);

/** Solar illuminance at distance r (m) from the Sun, lux (falls off as 1/r²). */
export const solarIlluminance = (r: number): number => illuminanceFromMag(apparentMag(SUN_ABS_MAG_V, r));
/** Solar illuminance at 1 AU, lux (≈ 1.26e5). */
export const SOLAR_ILLUMINANCE_1AU = solarIlluminance(AU);
/** Mean luminance of the solar disk, cd/m² (E / Ω; ≈ 1.9e9, centre-limb average). */
export const SUN_DISK_LUMINANCE = SOLAR_ILLUMINANCE_1AU / (Math.PI * (R_SUN / AU) ** 2);

/** Lambert sphere phase integral normalised to 1 at α = 0. */
export const lambertPhase = (alpha: number): number =>
  (Math.sin(alpha) + (Math.PI - alpha) * Math.cos(alpha)) / Math.PI;

export interface PlanetPointInput {
  /** Distance body–Sun, m. */
  rSun: number;
  /** Distance body–observer, m. */
  distance: number;
  /** Body radius, m. */
  radius: number;
  /** Geometric albedo. */
  albedo: number;
  /** Sun–body–observer angle, radians. */
  phaseAngle: number;
}

/**
 * Illuminance at the observer from a body drawn as a point, lux:
 * flux = E_sun(r) · albedo · πR² · LambertPhase(α) / (π·Δ²). Works from any viewpoint.
 */
export function planetPointIlluminance(p: PlanetPointInput): number {
  return (
    (solarIlluminance(p.rSun) * p.albedo * Math.PI * p.radius ** 2 * lambertPhase(p.phaseAngle)) /
    (Math.PI * p.distance ** 2)
  );
}

/** B-V colour index → effective temperature, K (Ballesteros 2012, EPL 97, 34008). */
export function bvToTeff(bv: number): number {
  return 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
}

/** Rec. 709 / sRGB luminance of linear RGB. */
export const luminance = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// ---------------------------------------------------------------------------------------
// Blackbody colour
// ---------------------------------------------------------------------------------------

/** CIE 1931 2° colour-matching functions x̄, ȳ, z̄ at 10 nm from 380 to 780 nm (CIE 015:2004). */
export const CIE_START_NM = 380;
export const CIE_STEP_NM = 10;
// prettier-ignore
export const CIE_1931_2DEG: readonly (readonly [number, number, number])[] = [
  [0.001368, 0.000039, 0.00645], [0.004243, 0.00012, 0.02005], [0.01431, 0.000396, 0.06785],
  [0.04351, 0.00121, 0.2074], [0.13438, 0.004, 0.6456], [0.2839, 0.0116, 1.3856],
  [0.34828, 0.023, 1.74706], [0.3362, 0.038, 1.77211], [0.2908, 0.06, 1.6692],
  [0.19536, 0.09098, 1.28764], [0.09564, 0.13902, 0.81295], [0.03201, 0.20802, 0.46518],
  [0.0049, 0.323, 0.272], [0.0093, 0.503, 0.1582], [0.06327, 0.71, 0.07825],
  [0.1655, 0.862, 0.04216], [0.2904, 0.954, 0.0203], [0.43345, 0.99495, 0.00875],
  [0.5945, 0.995, 0.0039], [0.7621, 0.952, 0.0021], [0.9163, 0.87, 0.00165],
  [1.0263, 0.757, 0.0011], [1.0622, 0.631, 0.0008], [1.0026, 0.503, 0.00034],
  [0.85445, 0.381, 0.00019], [0.6424, 0.265, 0.00005], [0.4479, 0.175, 0.00002],
  [0.2835, 0.107, 0], [0.1649, 0.061, 0], [0.0874, 0.032, 0],
  [0.04677, 0.017, 0], [0.0227, 0.00821, 0], [0.011359, 0.004102, 0],
  [0.00579, 0.002091, 0], [0.002899, 0.001047, 0], [0.00144, 0.00052, 0],
  [0.00069, 0.000249, 0], [0.000332, 0.00012, 0], [0.000166, 0.00006, 0],
  [0.000083, 0.00003, 0], [0.000042, 0.000015, 0],
];

/** Second radiation constant hc/k, m·K. */
const C2 = 1.438776877e-2;

/** CIE XYZ of a blackbody (relative units; only the chromaticity matters). */
export function blackbodyXYZ(teff: number): [number, number, number] {
  let X = 0;
  let Y = 0;
  let Z = 0;
  for (let i = 0; i < CIE_1931_2DEG.length; i++) {
    const lam = (CIE_START_NM + i * CIE_STEP_NM) * 1e-9;
    const b = 1 / (lam ** 5 * Math.expm1(C2 / (lam * teff)));
    const [x, y, z] = CIE_1931_2DEG[i];
    X += b * x;
    Y += b * y;
    Z += b * z;
  }
  return [X, Y, Z];
}

/**
 * Linear sRGB (D65 white, no chromatic adaptation) of a blackbody, normalised to luminance 1.
 * Out-of-gamut negatives are clipped and the result renormalised.
 */
export function blackbodyRgb(teff: number): [number, number, number] {
  const [X, Y, Z] = blackbodyXYZ(teff);
  const x = X / Y;
  const z = Z / Y;
  let r = Math.max(0, 3.2404542 * x - 1.5371385 - 0.4985314 * z);
  let g = Math.max(0, -0.969266 * x + 1.8760108 + 0.041556 * z);
  let b = Math.max(0, 0.0556434 * x - 0.2040259 + 1.0572252 * z);
  const l = luminance(r, g, b) || 1;
  r /= l;
  g /= l;
  b /= l;
  return [r, g, b];
}

/** Blackbody LUT layout (shared with chunks/blackbody.glsl): log-spaced Teff. */
export const BLACKBODY_LUT_SIZE = 256;
export const BLACKBODY_T_MIN = 1000;
export const BLACKBODY_T_MAX = 40000;

/** LUT coordinate u ∈ [0, 1] of a temperature (log spacing). */
export const blackbodyLutU = (teff: number): number =>
  Math.min(1, Math.max(0, Math.log(teff / BLACKBODY_T_MIN) / Math.log(BLACKBODY_T_MAX / BLACKBODY_T_MIN)));

/** Builds the LUT: `size` RGB triples (Y = 1) for log-spaced Teff in [T_MIN, T_MAX]. */
export function buildBlackbodyLut(size = BLACKBODY_LUT_SIZE): Float32Array {
  const out = new Float32Array(size * 3);
  for (let i = 0; i < size; i++) {
    const t = BLACKBODY_T_MIN * (BLACKBODY_T_MAX / BLACKBODY_T_MIN) ** (i / (size - 1));
    out.set(blackbodyRgb(t), i * 3);
  }
  return out;
}

/** Linear-RGB colour of sunlight (Y = 1), for SurfaceInput.sunIlluminance = E · SUN_RGB. */
export const SUN_RGB: readonly [number, number, number] = blackbodyRgb(SUN_TEFF);
