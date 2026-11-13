/** Pure geometry helpers of the atlas (no three.js): model frame conversion and arm curves. */
import { SUN_MODEL, WORLD_TO_MODEL } from '../model';

const DEG = Math.PI / 180;

/** Model kpc (origin Sgr A*) -> pc from the Sun in ICRS axes. WORLD_TO_MODEL is orthonormal. */
export function modelToIcrsPc(x: number, y: number, z: number): [number, number, number] {
  const dx = (x - SUN_MODEL.x) * 1000;
  const dy = (y - SUN_MODEL.y) * 1000;
  const dz = (z - SUN_MODEL.z) * 1000;
  const m = WORLD_TO_MODEL;
  return [
    m[0] * dx + m[3] * dy + m[6] * dz,
    m[1] * dx + m[4] * dy + m[7] * dz,
    m[2] * dx + m[5] * dy + m[8] * dz,
  ];
}

/** Points of a log-spiral arm (Reid et al. 2019 eq. 1) between two azimuths (degrees), model kpc, z = 0. */
export function spiralPoints(
  shape: { betaKinkDeg: number; rKinkKpc: number; psiLtDeg: number; psiGtDeg: number },
  beta0: number,
  beta1: number,
  stepDeg = 2,
): [number, number][] {
  const out: [number, number][] = [];
  const n = Math.max(1, Math.ceil(Math.abs(beta1 - beta0) / stepDeg));
  for (let i = 0; i <= n; i++) {
    const beta = beta0 + ((beta1 - beta0) * i) / n;
    const psi = beta < shape.betaKinkDeg ? shape.psiLtDeg : shape.psiGtDeg;
    const R = shape.rKinkKpc * Math.exp(-(beta - shape.betaKinkDeg) * DEG * Math.tan(psi * DEG));
    // beta = 0 towards the Sun (model -x), increasing with Galactic rotation (towards +y).
    out.push([-R * Math.cos(beta * DEG), R * Math.sin(beta * DEG)]);
  }
  return out;
}
