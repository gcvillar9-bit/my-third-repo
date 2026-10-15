/**
 * Display of the nebula's three components (TS twin of display.glsl). The march stores the radiance of
 * Hα+[NII], [OIII]+Hβ and scattered light, each in luminance units (cd/m²); the display turns them into colour:
 * - Realistic: the true colour of each emission (CIE 1931 colour of the lines in linear sRGB, brought into gamut
 *   by adding white, which keeps the luminance), so the luminance on screen is physical;
 * - Astrophoto: a display-only look like a processed astro image: magenta-red Hα, teal [OIII], an asinh stretch
 *   of the pre-exposed luminance and saturation ×1.6. No re-march is needed to switch.
 */
import { blackbodyRgb, CIE_1931_2DEG, CIE_START_NM, CIE_STEP_NM, luminance } from '../../core/photometry';

export type NebulaStyle = 'realistic' | 'astrophoto';
export const NEBULA_STYLES: readonly NebulaStyle[] = ['realistic', 'astrophoto'];
type Rgb = [number, number, number];

/** CIE 1931 2° XYZ of monochromatic light (linear interpolation of the 10 nm table). */
export function lineXYZ(nm: number): Rgb {
  const p = (nm - CIE_START_NM) / CIE_STEP_NM;
  const i = Math.max(0, Math.min(CIE_1931_2DEG.length - 2, Math.floor(p)));
  const t = Math.min(1, Math.max(0, p - i));
  const a = CIE_1931_2DEG[i];
  const b = CIE_1931_2DEG[i + 1];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * Linear sRGB of a mix of lines (weights in luminance), normalised to luminance 1 and brought into gamut by
 * adding white (which keeps the luminance and the hue).
 */
export function linesRgb(lines: readonly (readonly [number, number])[]): Rgb {
  let X = 0;
  let Y = 0;
  let Z = 0;
  for (const [nm, w] of lines) {
    const [x, y, z] = lineXYZ(nm);
    X += (w * x) / y;
    Y += w;
    Z += (w * z) / y;
  }
  const x = X / Y;
  const z = Z / Y;
  const rgb: Rgb = [
    3.2404542 * x - 1.5371385 - 0.4985314 * z,
    -0.969266 * x + 1.8760108 + 0.041556 * z,
    0.0556434 * x - 0.2040259 + 1.0572252 * z,
  ];
  const lo = Math.min(...rgb);
  if (lo < 0) for (let k = 0; k < 3; k++) rgb[k] = (rgb[k] - lo) / (1 - lo);
  const l = luminance(...rgb);
  return [rgb[0] / l, rgb[1] / l, rgb[2] / l];
}

const unitLum = (c: Rgb): Rgb => {
  const l = luminance(...c);
  return [c[0] / l, c[1] / l, c[2] / l];
};

/**
 * Realistic colours of the three components (unit luminance): Hα 656.3 nm with [NII] 658.4 nm (3:1 by luminance);
 * [OIII] 500.7 / 495.9 nm with Hβ 486.1 nm; scattered light of the Trapezium, ~11 000 K after reddening.
 */
export const REALISTIC_BASIS: readonly Rgb[] = [
  linesRgb([
    [656.3, 0.75],
    [658.4, 0.25],
  ]),
  linesRgb([
    [500.7, 0.6],
    [495.9, 0.2],
    [486.1, 0.2],
  ]),
  blackbodyRgb(11000),
];

/** Astrophoto palette (unit luminance): magenta-red Hα, teal [OIII], blue-white scattered light. */
export const ASTRO_BASIS: readonly Rgb[] = [
  unitLum([1, 0.12, 0.42]),
  unitLum([0.05, 0.75, 0.85]),
  unitLum([0.6, 0.75, 1.15]),
];

/** asinh softening (pre-exposed luminance) and gain of the Astrophoto stretch; Y = 1 maps to itself. */
export const ASTRO = { soft: 0.015, saturation: 1.6 } as const;

/** Colour of component radiances L (cd/m², per component) in a style, before exposure. */
export function styleRgb(style: NebulaStyle, L: Rgb): Rgb {
  const B = style === 'astrophoto' ? ASTRO_BASIS : REALISTIC_BASIS;
  return [0, 1, 2].map((c) => B[0][c] * L[0] + B[1][c] * L[1] + B[2][c] * L[2]) as Rgb;
}

/** The Astrophoto tone curve on pre-exposed linear RGB: asinh stretch of the luminance, then saturation. */
export function astrophotoTransform(rgb: Rgb): Rgb {
  const y = luminance(...rgb);
  if (y <= 0) return [0, 0, 0];
  const ys = Math.asinh(y / ASTRO.soft) / Math.asinh(1 / ASTRO.soft);
  const k = ys / y;
  const out = rgb.map((c) => c * k) as Rgb;
  return out.map((c) => Math.max(0, ys + ASTRO.saturation * (c - ys))) as Rgb;
}

/** Column-major mat3 elements (three.js Matrix3.set takes row-major) of a basis: columns are the components. */
export function basisRows(B: readonly Rgb[]): number[] {
  return [B[0][0], B[1][0], B[2][0], B[0][1], B[1][1], B[2][1], B[0][2], B[1][2], B[2][2]];
}
