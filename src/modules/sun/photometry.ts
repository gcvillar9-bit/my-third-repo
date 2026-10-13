/**
 * Three-free photometry of the photosphere and corona (CPU twins of the shaders, used by tests):
 * Neckel (2005) limb darkening, mean disk luminance versus Teff, the Baumbach corona, and the
 * granulation field statistics.
 */
import { SUN_DISK_LUMINANCE, SUN_TEFF, blackbodyXYZ } from '../../core/photometry';
import data from './sun-data.json';

export const LIMB_WAVELENGTHS_UM: readonly [number, number, number] = data.limbDarkening.wavelengthsUm as [
  number,
  number,
  number,
];

/** Limb-darkening coefficients A_0..A_5 at `lambdaUm` (I(mu)/I(1) = sum A_k mu^k, sum A_k = 1). */
export function limbCoefficients(lambdaUm: number): number[] {
  return data.limbDarkening.rows.map((r) => r.c + r.l1 / lambdaUm + r.l5 / lambdaUm ** 5);
}

/** I(mu)/I(1) at `lambdaUm`. */
export function limbProfile(mu: number, lambdaUm: number): number {
  const a = limbCoefficients(lambdaUm);
  let s = 0;
  for (let k = 5; k >= 0; k--) s = s * mu + a[k];
  return Math.max(0, s);
}

/** Disk-averaged I/I(1) = 2 * integral of P(mu) mu dmu = 2 sum A_k / (k + 2). */
export function limbDiskMean(lambdaUm: number): number {
  return 2 * limbCoefficients(lambdaUm).reduce((s, a, k) => s + a / (k + 2), 0);
}

const SUN_Y = blackbodyXYZ(SUN_TEFF)[1];

/** Mean disk luminance (cd/m2) of a blackbody photosphere at `teff`, scaled from the Sun's. */
export function diskLuminance(teff: number): number {
  return (SUN_DISK_LUMINANCE * blackbodyXYZ(teff)[1]) / SUN_Y;
}

/** Baumbach corona brightness relative to the mean disk brightness at `r` solar radii (r >= 1). */
export function coronaBrightness(r: number): number {
  const c = data.corona;
  return c.scale * c.terms.reduce((s, t) => s + t.a * r ** -t.p, 0);
}

export const CORONA_SHELL_RADII: number = data.corona.shellRadii;
export const GRANULE_M: number = data.granulation.granuleKm * 1e3;
export const SUPERGRANULE_M: number = data.granulation.supergranuleKm * 1e3;
export const GRANULE_CONTRAST: number = data.granulation.contrast;
export const NETWORK_CONTRAST: number = data.granulation.networkContrast;

// --- Granulation twin (mirrors photosphere.glsl in float64) ----------------------------------

const fract = (x: number): number => x - Math.floor(x);
type V3 = [number, number, number];

function hash3(px: number, py: number, pz: number): V3 {
  let x = fract(px * 0.1031);
  let y = fract(py * 0.103);
  let z = fract(pz * 0.0973);
  const d = x * (y + 33.33) + y * (x + 33.33) + z * (z + 33.33);
  x += d;
  y += d;
  z += d;
  return [fract((x + y) * z), fract((x + x) * y), fract((y + x) * x)];
}

/** (F1, F2) of the animated Worley field at p (cell units), time t in seconds. */
export function worley(p: V3, t: number, cyclesMin: number, cyclesSpan: number): [number, number] {
  const c = p.map(Math.floor) as V3;
  const f = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
  let d1 = 9;
  let d2 = 9;
  const ph = [0, 0.33, 0.67];
  for (let z = -1; z <= 1; z++)
    for (let y = -1; y <= 1; y++)
      for (let x = -1; x <= 1; x++) {
        const o = [x, y, z];
        const h = hash3(c[0] + x, c[1] + y, c[2] + z);
        const cyc = Math.floor(
          cyclesMin + cyclesSpan * hash3(c[0] + x + 17, c[1] + y + 17, c[2] + z + 17)[0],
        );
        let d = 0;
        for (let k = 0; k < 3; k++) {
          const jit = 0.5 + 0.38 * Math.sin(2 * Math.PI * ((cyc * t) / 86400 + h[k] + ph[k]));
          const r = o[k] + jit - f[k];
          d += r * r;
        }
        if (d < d1) {
          d2 = d1;
          d1 = d;
        } else if (d < d2) d2 = d;
      }
  return [Math.sqrt(d1), Math.sqrt(d2)];
}

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Raw granulation brightness (shader `starGranuleRaw`). */
export const granuleRaw = ([f1, f2]: [number, number]): number =>
  smoothstep(0, 0.3, f2 - f1) * (1 - 0.45 * f1);

/** Supergranular network indicator (shader `net`). */
export const networkRaw = ([f1, f2]: [number, number]): number => 1 - smoothstep(0, 0.12, f2 - f1);

/** Constants baked into photosphere.glsl (keep in sync; a unit test checks them). */
export const GRAN_MEAN = 0.4362;
export const GRAN_STD = 0.3272;
export const NET_MEAN = 0.1997;
