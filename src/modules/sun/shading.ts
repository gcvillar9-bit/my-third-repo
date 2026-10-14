/**
 * Photosphere SurfaceShading factory (the Sun at priority 10, and starSurface() for P4 close-ups).
 * Uniform values are physical: uStarI0 is the disk-centre radiance per channel such that the
 * disk-averaged luminance equals diskLuminance(teff).
 */
import { Vector2, Vector3 } from 'three';
import type { SurfaceShading, ViewState } from '../../core/contracts';
import { SUN_TEFF, blackbodyRgb } from '../../core/photometry';
import { DAY, JD_J2000 } from '../../core/units';
import { DRIFT_COEFFS, MAX_REGIONS, MAX_SPOTS, type SunActivity } from './activity';
import photosphereGlsl from './glsl/photosphere.glsl?raw';
import data from './sun-data.json';
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
  /** Simulated activity (the Sun only): spots, faculae, and the H-alpha view when `view.halpha`. */
  activity?: SunActivity;
  /** Live view switches read every frame. */
  view?: SunViewSwitches;
}

/** Shared per-frame switches of the Sun's look (the 'sun.filter' setting). */
export interface SunViewSwitches {
  halpha: boolean;
}

/** H-alpha disk-centre radiance per channel: the colour scaled so the disk-mean luminance is `L`. */
export function halphaI0(L: number): [number, number, number] {
  const [r, g, b] = data.halpha.colour;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const [a, k] = data.halpha.limb;
  const mean = a + (2 * k) / 3; // 2 * integral of (a + k mu) mu dmu
  return [r, g, b].map((c) => (L * c) / y / mean) as [number, number, number];
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
    uSpot: { value: opts.activity?.spots ?? new Float32Array(MAX_SPOTS * 4) },
    uSpotCount: { value: 0 },
    uRegion: { value: opts.activity?.regions ?? new Float32Array(MAX_REGIONS * 4) },
    uRegionB: { value: opts.activity?.regionsB ?? new Float32Array(MAX_REGIONS * 4) },
    uRegionCount: { value: 0 },
    uUmbra: { value: new Vector3(...data.spots.umbraIntensity) },
    uPenumbra: { value: data.spots.penumbraIntensity },
    uPenRatio: { value: data.spots.penumbraRatio },
    uFacular: { value: data.spots.facularContrast },
    uDrift: { value: new Vector3(...DRIFT_COEFFS) },
    uFilament: { value: [0, 0, 0, 0] },
    uHalpha: { value: 0 },
    uHaI0: { value: new Vector3(...halphaI0(L)) },
    uHaLimb: { value: new Vector2(...data.halpha.limb) },
  };
  const act = opts.activity;
  return {
    bodyId: opts.bodyId ?? 'sun',
    priority: opts.priority ?? 10,
    glsl: photosphereGlsl,
    uniforms,
    update(view: ViewState) {
      uniforms.uStarTime.value = starTime(view.jd);
      if (!act) return;
      act.update(view.jd);
      uniforms.uSpotCount.value = act.spotCount;
      uniforms.uRegionCount.value = act.regionCount;
      uniforms.uFilament.value = act.filament;
      uniforms.uHalpha.value = opts.view?.halpha ? 1 : 0;
    },
  };
}
