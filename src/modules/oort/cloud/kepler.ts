/**
 * Kepler's equation as glsl/cloud.vert.glsl solves it (three-free CPU twin): Mikkola's (1987) cubic
 * starter followed by KEPLER_ITERATIONS Newton steps. Cloud orbits reach e = 0.9997, where the starter is
 * poorest near perihelion; the unit tests check the float32 emulation of this exact sequence.
 */
const TWO_PI = 2 * Math.PI;

/** Newton steps after the starter (the vertex shader's loop count). */
export const KEPLER_ITERATIONS = 5;

/** Wraps an angle to [-pi, pi). */
export function wrapPi(x: number): number {
  return x - TWO_PI * Math.floor((x + Math.PI) / TWO_PI);
}

/** Eccentric anomaly for mean anomaly M (any range) and 0 <= e < 1, float64. */
export function solveKepler(M: number, e: number): number {
  const m = wrapPi(M);
  const den = 4 * e + 0.5;
  const alpha = (1 - e) / den;
  const beta = (0.5 * m) / den;
  const sgn = beta >= 0 ? 1 : -1;
  const z = sgn * Math.cbrt(Math.abs(beta) + Math.sqrt(beta * beta + alpha * alpha * alpha));
  let s = z - alpha / z;
  s -= (0.078 * s ** 5) / (1 + e);
  let E = m + e * (3 * s - 4 * s * s * s);
  for (let k = 0; k < KEPLER_ITERATIONS; k++) E -= (E - e * Math.sin(E) - m) / (1 - e * Math.cos(E));
  return E;
}
