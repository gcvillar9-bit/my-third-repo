/**
 * Accretion-disk physics twins (units r_s = 1, c = 1, so M = 1/2). GLSL twins live in
 * glsl/disk.glsl; keep both in sync.
 *
 * - Novikov-Thorne / Page-Thorne flux for a = 0 (Page & Thorne 1974), written in r_g = M units
 *   (x = r/M): F ∝ J(x) / (x^{5/2} (x - 3)), J = 2(√x - √6) - √3 ln[(√x - √3)(√6 + √3) / ((√x + √3)(√6 - √3))].
 *   F = 0 at r_isco = 3 r_s and F → 2/x³ (Newtonian) far out. T ∝ F^{1/4}.
 * - g = ν_obs/ν_emit = 1 / (u^t (1 - Ω λ)) for a Keplerian emitter (u^t = 1/sqrt(1 - 1.5/r),
 *   Ω = sqrt(1/(2 r³))) and a photon with angular momentum λ = L_z/E about the disk axis;
 *   split into gravitational sqrt(1 - 1/r) and Doppler parts so each can be switched off.
 */
import { R_ISCO } from './geodesic';

const SQ3 = Math.sqrt(3);
const SQ6 = Math.sqrt(6);

/** Page-Thorne flux (arbitrary units) at radius r (r_s units); 0 inside r_isco. */
export function ntFlux(r: number): number {
  const x = 2 * r; // r in units of M
  if (x <= 6) return 0;
  const y = Math.sqrt(x);
  const j = 2 * (y - SQ6) - SQ3 * Math.log(((y - SQ3) * (SQ6 + SQ3)) / ((y + SQ3) * (SQ6 - SQ3)));
  return j / (x ** 2.5 * (x - 3));
}

/** Radius of the flux maximum (r_s): about 4.9 r_s for a = 0. */
export const NT_PEAK_R = (() => {
  let best = R_ISCO;
  let fBest = 0;
  for (let r = R_ISCO; r < 20; r += 0.001) {
    const f = ntFlux(r);
    if (f > fBest) {
      fBest = f;
      best = r;
    }
  }
  return best;
})();
export const NT_PEAK_FLUX = ntFlux(NT_PEAK_R);

/** Disk temperature at r (r_s) for a peak temperature tMax, K. */
export const ntTemperature = (r: number, tMax: number): number =>
  tMax * Math.max(ntFlux(r) / NT_PEAK_FLUX, 0) ** 0.25;

/** Keplerian angular velocity in units of c / r_s. */
export const keplerOmega = (r: number): number => Math.sqrt(1 / (2 * r * r * r));

export interface GFactorOptions {
  /** Doppler (and beaming) on. Default true. */
  doppler?: boolean;
  /** Gravitational redshift on. Default true. */
  gravity?: boolean;
  /** Static observer radius (r_s) for the observer's blueshift; default infinity. */
  rObs?: number;
}

/**
 * Redshift factor g = ν_obs / ν_emit for a Keplerian emitter at r (r_s ≥ 1.5) and a photon with
 * angular momentum per unit energy `lambda` (r_s; positive when co-rotating with the disk).
 */
export function gFactor(r: number, lambda: number, opts: GFactorOptions = {}): number {
  const full = Math.sqrt(1 - 1.5 / r) / (1 - keplerOmega(r) * lambda);
  const grav = Math.sqrt(1 - 1 / r);
  const obs = opts.rObs && Number.isFinite(opts.rObs) ? 1 / Math.sqrt(1 - 1 / opts.rObs) : 1;
  const dop = full / grav;
  return ((opts.gravity ?? true) ? grav * obs : 1) * ((opts.doppler ?? true) ? dop : 1);
}

/** Observed bolometric intensity relative to emitted (I_obs = g⁴ I_emit). */
export const beamedIntensity = (g: number): number => g ** 4;
