/**
 * Atmosphere parameter sets (three-free). planets.json keeps SI units with `source` fields;
 * the GPU and the TypeScript twin work in kilometres (coefficients per km).
 */
import planets from './planets.json';

export type RGB = [number, number, number];

export interface AtmosphereRowJson {
  id: string;
  thicknessM: number;
  rayleigh: { scattering: number[]; scaleHeightM: number; source: string };
  mie: { scattering: number[]; extinction: number[]; scaleHeightM: number; g: number[]; source: string };
  absorption: { extinction: number[]; centerM: number; halfWidthM: number; source: string };
  groundAlbedo: number[];
  apMaxM: number;
  sunTransmittanceInPost: boolean;
  approximate: boolean;
  source: string;
}

export interface AtmosphereParams {
  id: string;
  /** Planet (bottom) radius, km. */
  bottomKm: number;
  /** Top-of-atmosphere radius, km. */
  topKm: number;
  rayleighScattering: RGB;
  rayleighScaleKm: number;
  mieScattering: RGB;
  mieExtinction: RGB;
  mieScaleKm: number;
  /** Mie asymmetry per channel (Cornette-Shanks phase). */
  mieG: RGB;
  absorptionExtinction: RGB;
  absorptionCenterKm: number;
  absorptionHalfWidthKm: number;
  groundAlbedo: RGB;
  /** Aerial-perspective atlas range, km (32 quadratic slices). */
  apMaxKm: number;
  /** The composite multiplies surface pixels by the Sun transmittance (shadings that do not apply it). */
  sunTransmittanceInPost: boolean;
  approximate: boolean;
}

export const ATMOSPHERE_ROWS: readonly AtmosphereRowJson[] = (planets as { bodies: AtmosphereRowJson[] })
  .bodies;

const rgb = (a: number[], s = 1): RGB => [a[0] * s, a[1] * s, a[2] * s];

/** Converts a JSON row (SI) into GPU/twin units (km, 1/km) for a body of equatorial radius `radiusM`. */
export function paramsFromRow(row: AtmosphereRowJson, radiusM: number): AtmosphereParams {
  const bottomKm = radiusM / 1000;
  return {
    id: row.id,
    bottomKm,
    topKm: bottomKm + row.thicknessM / 1000,
    rayleighScattering: rgb(row.rayleigh.scattering, 1000),
    rayleighScaleKm: row.rayleigh.scaleHeightM / 1000,
    mieScattering: rgb(row.mie.scattering, 1000),
    mieExtinction: rgb(row.mie.extinction, 1000),
    mieScaleKm: row.mie.scaleHeightM / 1000,
    mieG: rgb(row.mie.g),
    absorptionExtinction: rgb(row.absorption.extinction, 1000),
    absorptionCenterKm: row.absorption.centerM / 1000,
    absorptionHalfWidthKm: Math.max(row.absorption.halfWidthM / 1000, 1e-3),
    groundAlbedo: rgb(row.groundAlbedo),
    apMaxKm: row.apMaxM / 1000,
    sunTransmittanceInPost: row.sunTransmittanceInPost,
    approximate: row.approximate,
  };
}

/** Keys that change the static LUTs (transmittance, multiple scattering). */
const PHYSICS_KEYS: (keyof AtmosphereParams)[] = [
  'bottomKm',
  'topKm',
  'rayleighScattering',
  'rayleighScaleKm',
  'mieScattering',
  'mieExtinction',
  'mieScaleKm',
  'mieG',
  'absorptionExtinction',
  'absorptionCenterKm',
  'absorptionHalfWidthKm',
  'groundAlbedo',
];

/** Stable hash of the physical parameters (ignores ids, flags, sources and notes). */
export function physicsHash(p: AtmosphereParams): string {
  return PHYSICS_KEYS.map((k) => {
    const v = p[k];
    return Array.isArray(v) ? v.map((x) => x.toPrecision(9)).join(',') : (v as number).toPrecision(9);
  }).join('|');
}
