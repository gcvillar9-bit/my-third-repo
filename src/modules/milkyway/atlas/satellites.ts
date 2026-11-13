/**
 * The galaxies module's catalogue (Celestia) already holds some satellites of the Milky Way as
 * generic impostors. The atlas draws every satellite as a resolved star cloud, so those rows are
 * hidden there (galaxies/public `hideGalaxies`). A catalogue row matches a satellite when it lies
 * within MATCH_DEG of it on the sky and their distances from the Sun agree within a factor of 2.
 */
import { GALACTIC_TO_SUPERGALACTIC, ICRS_TO_GALACTIC, SSB_IN_MW } from '../../../core/frames';
import { PC } from '../../../core/units';

export const MATCH_DEG = 2;
const MPC = 1e6 * PC;

const mul = (m: readonly number[], x: number, y: number, z: number): [number, number, number] => [
  m[0] * x + m[1] * y + m[2] * z,
  m[3] * x + m[4] * y + m[5] * z,
  m[6] * x + m[7] * y + m[8] * z,
];

/** Sun-centred ICRS parsecs -> `universe` frame (supergalactic axes, origin Sgr A*), Mpc. */
export function icrsPcToUniverseMpc(x: number, y: number, z: number): [number, number, number] {
  const g = mul(ICRS_TO_GALACTIC, x * PC, y * PC, z * PC);
  const u = mul(GALACTIC_TO_SUPERGALACTIC, g[0] + SSB_IN_MW.x, g[1] + SSB_IN_MW.y, g[2] + SSB_IN_MW.z);
  return [u[0] / MPC, u[1] / MPC, u[2] / MPC];
}

/**
 * Predicate for `hideGalaxies`: true for a `universe`-frame position (Mpc) that matches one of
 * the given satellite positions (Sun-centred ICRS parsecs).
 */
export function satelliteMatcher(
  satellites: readonly { x: number; y: number; z: number }[],
): (x: number, y: number, z: number) => boolean {
  const sun = icrsPcToUniverseMpc(0, 0, 0);
  const list = satellites.map((s) => {
    const u = icrsPcToUniverseMpc(s.x, s.y, s.z);
    const h = [u[0] - sun[0], u[1] - sun[1], u[2] - sun[2]];
    const d = Math.hypot(h[0], h[1], h[2]);
    return { d, ux: h[0] / d, uy: h[1] / d, uz: h[2] / d };
  });
  const cosMax = Math.cos((MATCH_DEG * Math.PI) / 180);
  return (x, y, z) => {
    const hx = x - sun[0];
    const hy = y - sun[1];
    const hz = z - sun[2];
    const d = Math.hypot(hx, hy, hz);
    if (!(d > 0) || d > 1) return false; // nothing beyond 1 Mpc is a Milky Way satellite
    for (const s of list) {
      if (d < 0.5 * s.d || d > 2 * s.d) continue;
      if ((hx * s.ux + hy * s.uy + hz * s.uz) / d >= cosMax) return true;
    }
    return false;
  };
}
