/**
 * Display law of the cloud points (three-free; the vertex shader mirrors pointLux). Every factor here is a
 * visibility choice, not physics: the real cloud is far too faint to see.
 * - E = E0 · w · (count factor) · brightness · inside(d_sun) · contrast(a) · (D0 / max(d, k·s))², capped:
 *   1/d² keeps a haze's surface brightness independent of the viewing distance; bounding d below by k mean
 *   spacings s stops the few nearest points outshining the haze they belong to;
 * - contrast(a) = (a / fromAu)^exponent beyond fromAu flattens the true r^-2.5 fall of the column density;
 * - inside(d_sun) dims the cloud while the camera is inside its dense part, where a haze would turn the
 *   whole sky grey.
 */
import { smoothstep } from '../shared';
import model from './model.json';

const D = model.display;

/** Artificial brightening of the outer cloud: (a / fromAu)^exponent beyond fromAu. */
export const contrastBoost = (aAu: number): number =>
  Math.max(1, aAu / D.contrast.fromAu) ** D.contrast.exponent;

/** Artificial dimming while the camera is inside the dense cloud (min at fromAu, 1 beyond toAu). */
export function insideDim(sunDistAu: number): number {
  const { fromAu, toAu, min } = D.insideDim;
  const t = smoothstep(Math.log(fromAu), Math.log(toAu), Math.log(Math.max(sunDistAu, 1)));
  return min + (1 - min) * t;
}

/** Mean spacing between drawn points as a fraction of a, for `count` points. */
export const spacingFraction = (count: number): number =>
  D.spacingFraction * Math.cbrt(D.referenceCount / count);

/**
 * Illuminance of one point at the camera, lux (CPU twin of the vertex shader). `scale` holds everything that
 * does not depend on the point: E0 · referenceCount / count · brightness · insideDim.
 */
export function pointLux(scale: number, weight: number, aAu: number, distAu: number, count: number): number {
  const d = Math.max(distAu, D.nearSpacings * spacingFraction(count) * aAu);
  const q = D.referenceDistanceAu / d;
  return Math.min(scale * weight * contrastBoost(aAu) * q * q, D.capLux);
}
