/** Gas-giant parameters (giants.json), flow-cycle timing and Great Red Spot detection (CPU, testable). */
import data from './giants.json';

export interface GrsSpec {
  latDeg: number;
  searchHalfWidthDeg: number;
  semiMajorKm: number;
  semiMinorKm: number;
  periodDays: number;
}

export interface GiantSpec {
  id: string;
  minnaertK: number;
  turbulence: number;
  /** [planetocentric latitude deg, speed m/s, half-width deg]. */
  jets: [number, number, number][];
  grs?: GrsSpec;
  approximate?: boolean;
  source: string;
}

export const GIANTS: readonly GiantSpec[] = (data as unknown as { bodies: GiantSpec[] }).bodies;
export const FLOW_CYCLE_S: number = (data as { flowCycleSeconds: number }).flowCycleSeconds;
export const MAX_JETS = 8;
const J2000 = 2451545;

/** Zonal wind (m/s) at planetocentric latitude `latRad` (CPU twin of giantJets). */
export function jetSpeed(spec: GiantSpec, latRad: number): number {
  let u = 0;
  for (const [lat, speed, w] of spec.jets) {
    const x = (latRad - (lat * Math.PI) / 180) / ((w * Math.PI) / 180);
    u += speed * Math.exp(-x * x);
  }
  return u;
}

export interface FlowState {
  /** Elapsed seconds of phases A and B (each in [0, cycle)). */
  tA: number;
  tB: number;
  /** Crossfade weight of phase B; zero whenever B wraps, one whenever A wraps. */
  wB: number;
  /** Flow amplitude: fades to 0 when one frame advances more than a tenth of the cycle. */
  amp: number;
}

/** Flow-cycle phases for TT `jd` (float64), given the sim seconds advanced since the last frame. */
export function flowState(jd: number, stepSeconds: number, cycle = FLOW_CYCLE_S): FlowState {
  const t = (jd - J2000) * 86400;
  const p = t / cycle - Math.floor(t / cycle);
  const pB = (p + 0.5) % 1;
  const wA = 1 - Math.abs(2 * p - 1);
  const x = Math.min(1, Math.max(0, (Math.abs(stepSeconds) - cycle / 100) / (cycle / 10 - cycle / 100)));
  return { tA: p * cycle, tB: pB * cycle, wB: 1 - wA, amp: 1 - x * x * (3 - 2 * x) };
}

/**
 * Finds the Great Red Spot in an equirectangular RGBA image (row 0 = north): the reddest smoothed
 * spot within `halfWidthDeg` of `latDeg`. Returns texture u (0..1, east-positive like
 * SurfaceInput.uv) and latitude in degrees, or null without a clear red maximum.
 */
export function findRedSpot(
  px: ArrayLike<number>,
  w: number,
  h: number,
  latDeg: number,
  halfWidthDeg: number,
): { u: number; latDeg: number } | null {
  const rowOf = (lat: number) => Math.round(((90 - lat) / 180) * h - 0.5);
  const y0 = Math.max(1, rowOf(latDeg + halfWidthDeg));
  const y1 = Math.min(h - 2, rowOf(latDeg - halfWidthDeg));
  const red = (x: number, y: number) => {
    const i = 4 * (y * w + (((x % w) + w) % w));
    return px[i] - 0.5 * (px[i + 1] + px[i + 2]);
  };
  const scores: number[] = [];
  let best = -Infinity;
  let bx = 0;
  let by = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -2; dx <= 2; dx++) s += red(x + dx, y + dy);
      s /= 15;
      scores.push(s);
      if (s > best) [best, bx, by] = [s, x, y];
    }
  }
  if (!scores.length) return null;
  scores.sort((a, b) => a - b);
  const median = scores[scores.length >> 1];
  if (best - median < 12) return null;
  return { u: (bx + 0.5) / w, latDeg: 90 - ((by + 0.5) / h) * 180 };
}
