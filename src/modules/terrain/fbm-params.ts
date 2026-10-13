/**
 * Parameters of the default 'fbm-craters-lite' height source (kept outside height/ so the main
 * bundle can build specs without pulling the height module itself).
 */
export interface FbmCratersParams {
  /** Equatorial radius, m. */
  radius: number;
  /** Largest fBm wavelength λ0, m. */
  lambda0: number;
  /** Amplitude of the λ0 octave, m. */
  amplitude: number;
  /** Hurst exponent (amplitude ∝ λ^H). */
  hurst: number;
  /** Crater layers (0 disables craters). */
  craterLayers: number;
  /** Fraction of shell cells holding a crater. */
  craterDensity: number;
  seed: number;
}

export const LACUNARITY = 2;
export const CRATER_RATIO = 1 / 2.8;
/** Smallest wavelength ever synthesised, m. */
export const LAMBDA_MIN = 0.04;

export function defaultParams(radius: number, craters: boolean, seed: number): FbmCratersParams {
  const lambda0 = Math.min(radius / 2, 4e5);
  return {
    radius,
    lambda0,
    amplitude: 0.0035 * lambda0,
    hurst: 0.9,
    craterLayers: craters ? 9 : 0,
    craterDensity: 0.9,
    seed: seed >>> 0,
  };
}

/** Vertex spacing at `level` (same formula as cube.ts cellSize). */
export function cellAt(radius: number, level: number): number {
  return ((Math.PI / 2) * radius) / (32 * 2 ** level);
}

/** Band weight of a feature of wavelength λ on a grid of spacing `cell`: 0 below 2 cells, 1 above 4. */
export function band(lambda: number, cell: number): number {
  const x = lambda / cell;
  return x <= 2 ? 0 : x >= 4 ? 1 : (x - 2) / 2;
}

export function craterDepth(D: number): number {
  return Math.min(0.2 * D, 1000 * (D / 15000) ** 0.3);
}

/** Analytic bound on |height| (heights are clamped to it). */
export function maxAbsHeight(p: FbmCratersParams): number {
  let fbm = 0;
  for (let l = p.lambda0, a = p.amplitude; l >= LAMBDA_MIN; l /= LACUNARITY, a *= LACUNARITY ** -p.hurst)
    fbm += a;
  let cr = 0;
  let S = p.lambda0 / 2;
  for (let k = 0; k < p.craterLayers; k++, S *= CRATER_RATIO) {
    const D = 0.35 * S;
    cr += 1.3 * craterDepth(D);
  }
  return fbm + cr;
}
