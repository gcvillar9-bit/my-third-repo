/**
 * Procedural crater field with a cumulative size-frequency distribution N(>D) = C * D^-2
 * (D in metres, N per square metre), evaluated in float64 on the body sphere.
 *
 * Octave k covers diameters [Dhi/2, Dhi] with Dhi = dMax * 2^-k. Its craters are points of a 3D
 * jittered grid of cell size S = 2.5 Dhi: each cell holds `n = 0.75 C (Dhi/2)^-2 S^2` points on average
 * (floor plus a Bernoulli remainder), uniform in the cell, kept only within S/2 of the sphere. That
 * gives exactly n / S^2 craters per unit area, independent of orientation, and any crater influencing
 * a point (ejecta reach 1.25 D <= S/2) lies in one of its 8 nearest cells. Diameters inside an octave
 * follow the truncated power law, so the whole field has slope -2 at every scale.
 *
 * Profile (r = distance / (D/2)): parabolic bowl below a raised rim, flat floor and central peak for
 * D above the simple-to-complex transition Dt, ejecta blanket h_rim * r^-3 fading out by r = 2.5.
 * Fresh depth/diameter 0.2 (simple), continuing as 0.2 Dt (D/Dt)^0.3 for complex craters; rim height
 * 0.04 D (simple), 0.04 Dt (D/Dt)^0.4 (complex) (Pike 1977, scaled). Each crater gets a degradation
 * factor; `relaxD` makes craters larger than it shallower (viscous relaxation on icy bodies).
 */
import { band, hash3, rehash, smoothstep, unit } from './noise';

export interface CraterParams {
  seed: number;
  /** C in N(>D) = C D^-2 (D in m, per m^2). */
  density: number;
  /** Largest diameter (m). */
  dMax: number;
  /** Smallest diameter (m). */
  dMin: number;
  /** Simple-to-complex transition diameter (m): 15 km * g_moon / g. */
  transitionD: number;
  /** Degradation: depth factor = 1 - degrade * u^2 for a uniform u (0 = all fresh). */
  degrade: number;
  /** Diameter above which craters relax (icy bodies); 0 = none. */
  relaxD?: number;
  /** 'caldera': flat floor, steep walls, no rim or ejecta (Io paterae). */
  kind?: 'impact' | 'caldera';
  /** Caldera depth (m) when kind is 'caldera'. */
  calderaDepth?: number;
}

export interface Crater {
  x: number;
  y: number;
  z: number;
  D: number;
  /** Depth/rim factor in (0, 1]. */
  f: number;
}

const MAX_PER_CELL = 6;
/** Ejecta reach in crater radii. */
export const EJECTA_R = 2.5;

/** Number of octaves between dMax and dMin. */
export const octaveCount = (p: CraterParams): number =>
  Math.max(0, Math.ceil(Math.log2(p.dMax / Math.max(p.dMin, 1e-3))));

/** Mean points per cell (independent of the octave): 0.75 C (Dhi/2)^-2 (2.5 Dhi)^2. */
export const pointsPerCell = (p: CraterParams): number => 0.75 * p.density * 4 * 6.25;

/**
 * Calls `fn` for every crater of octave `k` stored in cell (ix, iy, iz). `radius` is the sphere radius
 * (craters are projected onto it).
 */
export function cellCraters(
  p: CraterParams,
  radius: number,
  k: number,
  ix: number,
  iy: number,
  iz: number,
  fn: (c: Crater) => void,
): void {
  const dHi = p.dMax * 2 ** -k;
  const dLo = dHi / 2;
  const S = 2.5 * dHi;
  const mean = Math.min(MAX_PER_CELL, pointsPerCell(p));
  let h = hash3(ix, iy, iz, (p.seed + Math.imul(k + 1, 0x632be5ab)) | 0);
  const base = Math.floor(mean);
  const n = base + (unit(h) < mean - base ? 1 : 0);
  const a = dLo ** -2;
  const b = dHi ** -2;
  for (let i = 0; i < n; i++) {
    h = rehash(h);
    const px = (ix + unit(h)) * S;
    h = rehash(h);
    const py = (iy + unit(h)) * S;
    h = rehash(h);
    const pz = (iz + unit(h)) * S;
    h = rehash(h);
    const uD = unit(h);
    h = rehash(h);
    const uF = unit(h);
    const r = Math.hypot(px, py, pz);
    if (Math.abs(r - radius) >= S / 2 || r === 0) continue;
    const D = (a - uD * (a - b)) ** -0.5;
    if (D < p.dMin) continue;
    const s = radius / r;
    fn({ x: px * s, y: py * s, z: pz * s, D, f: 1 - p.degrade * uF * uF });
  }
}

/** Height (m) of one crater at normalised distance r = dist / (D/2). */
export function craterProfile(p: CraterParams, D: number, f: number, r: number): number {
  if (r >= EJECTA_R) return 0;
  if (p.kind === 'caldera') {
    const depth = (p.calderaDepth ?? 1000) * f;
    return -depth * (1 - smoothstep(0.85, 1.05, r));
  }
  const Dt = p.transitionD;
  const complex = D > Dt;
  let depth = complex ? 0.2 * Dt * (D / Dt) ** 0.3 : 0.2 * D;
  let rim = complex ? 0.04 * Dt * (D / Dt) ** 0.4 : 0.04 * D;
  let relax = 1;
  if (p.relaxD && D > p.relaxD) relax = p.relaxD / D;
  depth *= f * relax;
  rim *= f * relax;
  if (r >= 1) {
    const t = smoothstep(1.4, EJECTA_R, r);
    return rim * r ** -3 * (1 - t);
  }
  const c = smoothstep(Dt, 2 * Dt, D); // complex weight: flat floor + central peak
  const floorR = 0.45 * c;
  const t = r <= floorR ? 0 : (r - floorR) / (1 - floorR);
  const bowl = rim - (depth + rim) * (1 - t * t);
  const peak = c * 0.45 * depth * Math.exp(-((r / 0.16) ** 2));
  return bowl + peak;
}

/** Largest |height| a single crater can produce (rim or depth), m. */
export function craterBound(p: CraterParams): number {
  if (p.kind === 'caldera') return p.calderaDepth ?? 1000;
  const D = p.dMax;
  const Dt = p.transitionD;
  const depth = D > Dt ? 0.2 * Dt * (D / Dt) ** 0.3 : 0.2 * D;
  const rim = D > Dt ? 0.04 * Dt * (D / Dt) ** 0.4 : 0.04 * D;
  return depth + rim;
}

/**
 * Sum of crater heights at body-fixed point (x, y, z) on the sphere of `radius` (m), band-limited
 * for vertex spacing `cell`: a crater fades in between 2 and 4 cells of diameter.
 */
export function craterHeight(
  p: CraterParams,
  radius: number,
  x: number,
  y: number,
  z: number,
  cell: number,
): number {
  let sum = 0;
  const K = octaveCount(p);
  for (let k = 0; k < K; k++) {
    const dHi = p.dMax * 2 ** -k;
    if (dHi < 2 * cell) break;
    const S = 2.5 * dHi;
    const bx = Math.floor(x / S - 0.5);
    const by = Math.floor(y / S - 0.5);
    const bz = Math.floor(z / S - 0.5);
    for (let c = 0; c < 8; c++) {
      cellCraters(p, radius, k, bx + (c & 1), by + ((c >> 1) & 1), bz + (c >> 2), (cr) => {
        const d = Math.hypot(x - cr.x, y - cr.y, z - cr.z);
        const r = d / (cr.D / 2);
        if (r >= EJECTA_R) return;
        const w = band(cr.D, cell);
        if (w > 0) sum += w * craterProfile(p, cr.D, cr.f, r);
      });
    }
  }
  return sum;
}

/** Every crater with centre within `capRadius` (m, chord) of the surface point (x, y, z) (tests). */
export function cratersNear(
  p: CraterParams,
  radius: number,
  x: number,
  y: number,
  z: number,
  capRadius: number,
  dMin: number,
): Crater[] {
  const out: Crater[] = [];
  const K = octaveCount(p);
  const c = [x, y, z];
  const len = Math.hypot(x, y, z);
  for (let k = 0; k < K; k++) {
    const dHi = p.dMax * 2 ** -k;
    if (dHi < dMin) break;
    const S = 2.5 * dHi;
    // The cap is nearly flat: along axis i it spans capRadius * sqrt(1 - n_i^2) plus the sagitta.
    const ext = c.map(
      (v) => S + capRadius * Math.sqrt(Math.max(0, 1 - (v / len) ** 2)) + capRadius ** 2 / radius,
    );
    const lo = c.map((v, i) => Math.floor((v - ext[i]) / S));
    const hi = c.map((v, i) => Math.floor((v + ext[i]) / S));
    for (let ix = lo[0]; ix <= hi[0]; ix++)
      for (let iy = lo[1]; iy <= hi[1]; iy++)
        for (let iz = lo[2]; iz <= hi[2]; iz++)
          cellCraters(p, radius, k, ix, iy, iz, (c) => {
            if (Math.hypot(c.x - x, c.y - y, c.z - z) < capRadius) out.push(c);
          });
  }
  return out;
}
