/**
 * Surface brightness helpers (a shim until core/photometry has them; docs/requests/nebulae.md):
 * μ [mag/arcsec²] ↔ L [cd/m²], with the V = 0 illuminance LUX_MAG0.
 */
import { LUX_MAG0 } from '../../core/photometry';

const ARCSEC = Math.PI / 180 / 3600;

/** Luminance (cd/m²) of a V surface brightness (mag/arcsec²). */
export const luminanceFromMu = (mu: number): number => (LUX_MAG0 * 10 ** (-0.4 * mu)) / (ARCSEC * ARCSEC);
/** V surface brightness (mag/arcsec²) of a luminance (cd/m²). */
export const muFromLuminance = (l: number): number => -2.5 * Math.log10((l * ARCSEC * ARCSEC) / LUX_MAG0);
