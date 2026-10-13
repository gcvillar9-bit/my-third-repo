/**
 * Physical units and constants (SI, float64). Values follow IAU 2012/2015 resolutions and
 * CODATA 2018 where applicable.
 */

/** Speed of light, m/s (exact). */
export const C = 299_792_458;
/** Astronomical unit, m (IAU 2012, exact). */
export const AU = 149_597_870_700;
/** Light year, m (Julian year × c). */
export const LY = 9_460_730_472_580_800;
/** Parsec, m (IAU 2015: 648000/π AU). */
export const PC = (648_000 / Math.PI) * AU;
export const KPC = 1e3 * PC;
export const MPC = 1e6 * PC;
export const KM = 1e3;

/** Seconds per day / Julian year. */
export const DAY = 86_400;
export const JULIAN_YEAR = 365.25 * DAY;
/** JD of J2000.0 (2000-01-01T12:00:00 TT). */
export const JD_J2000 = 2_451_545.0;
/** JD of the Unix epoch (1970-01-01T00:00:00 UTC). */
export const JD_UNIX_EPOCH = 2_440_587.5;

/** Newtonian constant of gravitation, m³ kg⁻¹ s⁻². */
export const G = 6.6743e-11;
/** Nominal solar radius (IAU 2015 B3), m. */
export const R_SUN = 6.957e8;
/** Nominal solar GM (IAU 2015 B3), m³/s². */
export const GM_SUN = 1.3271244e20;

/** Distance of the Sun from Sgr A*, m (GRAVITY 2019: 8.178 kpc). */
export const R0_GALACTIC = 8.178 * KPC;
/** Height of the Sun above the Galactic mid-plane, m (Bennett & Bovy 2019: 20.8 pc). */
export const Z0_GALACTIC = 20.8 * PC;

/** HUD speed text: m/s, km/s, then multiples of c, then ly/s, then Mpc/s (DESIGN 3.2). */
export function formatSpeed(v: number): string {
  const a = Math.abs(v);
  if (a >= MPC) return `${fmt(a / MPC)} Mpc/s`;
  if (a >= LY) return `${fmt(a / LY)} ly/s`;
  if (a >= 0.1 * C) return `${fmt(a / C)} c`;
  if (a >= 1e3) return `${fmt(a / 1e3)} km/s`;
  return `${fmt(a)} m/s`;
}

/** Distance text: m, km, AU, ly, kpc, Mpc. */
export function formatDistance(d: number): string {
  const a = Math.abs(d);
  if (a >= MPC) return `${fmt(a / MPC)} Mpc`;
  if (a >= KPC) return `${fmt(a / KPC)} kpc`;
  if (a >= 0.1 * LY) return `${fmt(a / LY)} ly`;
  if (a >= 0.01 * AU) return `${fmt(a / AU)} AU`;
  if (a >= 1e3) return `${fmt(a / 1e3)} km`;
  return `${fmt(a)} m`;
}

function fmt(x: number): string {
  if (x >= 1e6) return x.toExponential(2);
  if (x >= 100) return x.toFixed(0);
  if (x >= 10) return x.toFixed(1);
  return x.toFixed(2);
}
