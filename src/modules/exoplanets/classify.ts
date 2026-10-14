/**
 * Pure exoplanet physics and classification (unit-tested). Classes drive the illustrative tint only;
 * the rendered planets are "artist's impressions".
 */
import { R_SUN } from '../../core/units';

export const R_EARTH = 6.371e6;
export const BOND_ALBEDO = 0.3;

export type PlanetClass = 'lava' | 'rocky' | 'ocean' | 'ice' | 'sub-neptune' | 'gas-giant' | 'hot-jupiter';

export interface ClassStyle {
  label: string;
  /** Linear RGB albedo for the lit surface. */
  albedo: [number, number, number];
  /** Latitude banding strength (giants). */
  bands: number;
  /** Self-emission in cd/m² (lava worlds, hot Jupiters' night side glow), approximate. */
  glow: [number, number, number];
  /** Marker / UI colour (display sRGB hex). */
  css: string;
}

export const CLASS_STYLE: Record<PlanetClass, ClassStyle> = {
  lava: {
    label: 'Lava world',
    albedo: [0.1, 0.075, 0.06],
    bands: 0,
    glow: [0.6, 0.12, 0.02],
    css: '#ff7a3c',
  },
  rocky: { label: 'Rocky planet', albedo: [0.32, 0.26, 0.21], bands: 0, glow: [0, 0, 0], css: '#c8a27a' },
  ocean: { label: 'Ocean world', albedo: [0.1, 0.2, 0.36], bands: 0, glow: [0, 0, 0], css: '#4f8fe0' },
  ice: { label: 'Ice world', albedo: [0.72, 0.78, 0.84], bands: 0, glow: [0, 0, 0], css: '#cfe6ff' },
  'sub-neptune': {
    label: 'Sub-Neptune',
    albedo: [0.42, 0.6, 0.74],
    bands: 0.35,
    glow: [0, 0, 0],
    css: '#7cc4e8',
  },
  'gas-giant': { label: 'Gas giant', albedo: [0.62, 0.52, 0.38], bands: 1, glow: [0, 0, 0], css: '#e0c08a' },
  'hot-jupiter': {
    label: 'Hot Jupiter',
    albedo: [0.22, 0.16, 0.13],
    bands: 0.8,
    glow: [0.25, 0.06, 0.01],
    css: '#ff9a5a',
  },
};

/** Radius (R_earth) from mass (M_earth), Chen & Kipping 2017 (Forecaster mean relation). */
export function radiusFromMass(mEarth: number): number {
  if (mEarth < 2.04) return 1.008 * mEarth ** 0.279;
  if (mEarth < 132) return 0.808 * mEarth ** 0.589;
  return Math.min(22, 17.74 * mEarth ** -0.044);
}

/** Equilibrium temperature (K) for full redistribution and Bond albedo 0.3. */
export const equilibriumTemp = (teff: number, rStarRsun: number, aAU: number): number =>
  teff * Math.sqrt((rStarRsun * R_SUN) / (2 * aAU * 1.495978707e11)) * (1 - BOND_ALBEDO) ** 0.25;

/** Class by radius (R_earth) and equilibrium temperature (K). */
export function classify(rEarth: number, teq: number): PlanetClass {
  if (rEarth >= 6) return teq >= 1000 ? 'hot-jupiter' : 'gas-giant';
  if (rEarth >= 1.75) return 'sub-neptune';
  if (teq >= 1000) return 'lava';
  if (teq < 180) return 'ice';
  if (teq <= 330) return 'ocean';
  return 'rocky';
}

/** Semi-major axis (AU) from period (days) and total mass (M_sun), Kepler III. */
export const aFromPeriod = (periodDays: number, mStar: number): number =>
  Math.cbrt(mStar * (periodDays / 365.25) ** 2);

/** Period (days) from a (AU) and mass (M_sun). */
export const periodFromA = (aAU: number, mStar: number): number => 365.25 * Math.sqrt(aAU ** 3 / mStar);

/**
 * Conservative habitable zone (AU): runaway greenhouse (inner) to maximum greenhouse (outer),
 * Kopparapu et al. 2013, ApJ 765, 131 (erratum ApJ 770, 82). Teff is clamped to the fit range 2600-7200 K.
 */
export function habitableZone(lumLsun: number, teff: number): [number, number] {
  const t = Math.max(2600, Math.min(7200, teff)) - 5780;
  const seff = (s0: number, a: number, b: number, c: number, d: number) =>
    s0 + a * t + b * t * t + c * t ** 3 + d * t ** 4;
  const inner = seff(1.0385, 1.2456e-4, 1.4612e-8, -7.6345e-12, -1.7511e-15);
  const outer = seff(0.3507, 5.9578e-5, 1.6707e-9, -3.0058e-12, -5.1925e-16);
  return [Math.sqrt(lumLsun / inner), Math.sqrt(lumLsun / outer)];
}

/** Rough V-band bolometric correction for cool hosts (approximate; 0 above 5000 K). */
export const bolometricCorrectionV = (teff: number): number =>
  teff >= 5000 ? 0 : -3 * ((5000 - teff) / 2500) ** 1.6;
