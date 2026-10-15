/**
 * Photosphere SurfaceShading factory (the Sun at priority 10, and starSurface() for P4 close-ups).
 * Uniform values are physical: uStarI0 is the disk-centre radiance per channel such that the
 * disk-averaged luminance equals diskLuminance(teff).
 */
import { Vector3 } from 'three';
import type { SurfaceShading, ViewState } from '../../core/contracts';
import { SUN_TEFF, blackbodyRgb } from '../../core/photometry';
import { DAY, JD_J2000 } from '../../core/units';
import photosphereGlsl from './glsl/photosphere.glsl?raw';
import {
  GRANULE_CONTRAST,
  GRANULE_M,
  LIMB_WAVELENGTHS_UM,
  NETWORK_CONTRAST,
  SUPERGRANULE_M,
  diskLuminance,
  limbCoefficients,
  limbDiskMean,
} from './photometry';

const R_SUN = 6.957e8;

export interface StarSurfaceOptions {
  /** Body id the shading applies to (default 'sun'). */
  bodyId?: string;
  /** Registry priority (default 10). */
  priority?: number;
  /** Granule size override, m (default: solar 1,000 km scaled by Teff and R^2, i.e. by T/g at solar mass). */
  granuleM?: number;
  /** rms granulation contrast (default 0.14). */
  contrast?: number;
}

/** Granule size for a star of `teff` and `radius` (pressure scale height ~ T/g, solar mass assumed). */
export function granuleSize(teff: number, radius: number): number {
  const g = GRANULE_M * (teff / SUN_TEFF) * (radius / R_SUN) ** 2;
  return Math.min(Math.max(g, 1e5), radius / 20);
}

/** Sim time in seconds wrapped to one day (the granulation animation is periodic over a day). */
export const starTime = (jd: number): number => {
  const s = ((jd - JD_J2000) * DAY) % DAY;
  return s < 0 ? s + DAY : s;
};

/** Photosphere shading for a star of `teff` (K) and `radius` (m). */
export function starSurface(teff: number, radius: number, opts: StarSurfaceOptions = {}): SurfaceShading {
  const L = diskLuminance(teff);
  const rgb = blackbodyRgb(teff);
  const coeffs = LIMB_WAVELENGTHS_UM.map(limbCoefficients);
  const i0 = new Vector3(...LIMB_WAVELENGTHS_UM.map((lam, c) => (L * rgb[c]) / limbDiskMean(lam)));
  const limbA = [0, 1, 2, 3, 4, 5].map((k) => new Vector3(coeffs[0][k], coeffs[1][k], coeffs[2][k]));
  const gran = opts.granuleM ?? granuleSize(teff, radius);
  const superM = Math.min(gran * (SUPERGRANULE_M / GRANULE_M), radius / 3);
  const uniforms = {
    uStarI0: { value: i0 },
    uLimbA: { value: limbA },
    uGranCells: { value: radius / gran },
    uSuperCells: { value: radius / superM },
    uGranSizeM: { value: gran },
    uGranContrast: { value: opts.contrast ?? GRANULE_CONTRAST },
    uNetContrast: { value: NETWORK_CONTRAST },
    uStarTime: { value: 0 },
  };
  return {
    bodyId: opts.bodyId ?? 'sun',
    priority: opts.priority ?? 10,
    glsl: photosphereGlsl,
    uniforms,
    update(view: ViewState) {
      uniforms.uStarTime.value = starTime(view.jd);
    },
  };
}
