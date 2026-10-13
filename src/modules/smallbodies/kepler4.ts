/**
 * Kepler's equation as the vertex shader solves it (CPU twin of glsl/kepler.glsl): Mikkola's
 * (1987) cubic starter followed by exactly 4 Newton iterations. Residual < 1e-9 rad in float64 for
 * e <= 0.97 over the whole M range (unit-tested); float32 on the GPU limits it to ~1e-7.
 */
const TWO_PI = 2 * Math.PI;

/** Wraps an angle to [-pi, pi). */
export function wrapPi(x: number): number {
  return x - TWO_PI * Math.floor((x + Math.PI) / TWO_PI);
}

/** Mikkola's starter for E given M in [-pi, pi). */
export function keplerStart(M: number, e: number): number {
  const den = 4 * e + 0.5;
  const alpha = (1 - e) / den;
  const beta = (0.5 * M) / den;
  const sgn = beta >= 0 ? 1 : -1;
  const z = sgn * Math.cbrt(Math.abs(beta) + Math.sqrt(beta * beta + alpha * alpha * alpha));
  let s = z - alpha / z;
  s -= (0.078 * s ** 5) / (1 + e);
  return M + e * (3 * s - 4 * s * s * s);
}

/** Eccentric anomaly for mean anomaly M (any range) and eccentricity e < 1. */
export function solveKepler4(M: number, e: number): number {
  const m = wrapPi(M);
  let E = keplerStart(m, e);
  for (let k = 0; k < 4; k++) E -= (E - e * Math.sin(E) - m) / (1 - e * Math.cos(E));
  return E;
}
