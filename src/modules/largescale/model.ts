/**
 * largescale model (pure TS, no three.js): the hand-entered structures (structures.json) placed in the
 * `universe` frame (supergalactic axes, origin Milky Way centre, Mpc), a toy peculiar-velocity field
 * (softened point-mass pulls of the Great Attractor, Shapley and Virgo), deterministic streamlines
 * through it, and the stylised Laniakea outline (a lumpy ellipsoid). Everything here is approximate.
 */
import type { QualityPreset, Vec3d } from '../../core/contracts';
import { GALACTIC_TO_SUPERGALACTIC, SSB_IN_MW } from '../../core/frames';
import { v3cross, v3dot, v3len, v3normalize, vec3 } from '../../core/math64';
import { MPC } from '../../core/units';
import { NAMED_GALAXIES } from '../galaxies/public';
import structuresJson from './structures.json';

export interface StructureRow {
  id: string;
  name: string;
  l?: number;
  b?: number;
  distMpc?: number;
  czKms?: number;
  z?: number;
  massMsun?: number;
  ref?: string;
  speedKms?: number;
  speedErrKms?: number;
  diameterMpc?: number;
  diameterMly?: number;
  galaxies?: number;
  centreFractionOfGA?: number;
  semiAxesMpc?: [number, number, number];
  source: string;
  approximate: boolean;
}

export const STRUCTURES: readonly StructureRow[] = (
  structuresJson as unknown as { structures: StructureRow[] }
).structures;
export function row(id: string): StructureRow {
  const r = STRUCTURES.find((s) => s.id === id);
  if (!r) throw new Error(`largescale: unknown structure ${id}`);
  return r;
}

const DEG = Math.PI / 180;

/** Galactic (l, b in degrees, distance from the Sun in Mpc) → universe frame, Mpc (as tools/build-galaxies.mjs). */
export function galacticToUniverse(lDeg: number, bDeg: number, dMpc: number, out: Vec3d = vec3()): Vec3d {
  const l = lDeg * DEG;
  const b = bDeg * DEG;
  const gx = Math.cos(b) * Math.cos(l) * dMpc + SSB_IN_MW.x / MPC;
  const gy = Math.cos(b) * Math.sin(l) * dMpc + SSB_IN_MW.y / MPC;
  const gz = Math.sin(b) * dMpc + SSB_IN_MW.z / MPC;
  const m = GALACTIC_TO_SUPERGALACTIC;
  out.x = m[0] * gx + m[1] * gy + m[2] * gz;
  out.y = m[3] * gx + m[4] * gy + m[5] * gz;
  out.z = m[6] * gx + m[7] * gy + m[8] * gz;
  return out;
}

/** Inverse direction: a universe-frame vector → galactic (l, b) in degrees (direction only). */
export function universeToGalacticLB(v: Vec3d): { l: number; b: number } {
  const m = GALACTIC_TO_SUPERGALACTIC;
  const gx = m[0] * v.x + m[3] * v.y + m[6] * v.z;
  const gy = m[1] * v.x + m[4] * v.y + m[7] * v.z;
  const gz = m[2] * v.x + m[5] * v.y + m[8] * v.z;
  const l = Math.atan2(gy, gx) / DEG;
  return { l: (l + 360) % 360, b: Math.atan2(gz, Math.hypot(gx, gy)) / DEG };
}

/** Universe-frame position (Mpc) of a structure row; Virgo reuses the galaxies module's M87. */
export function structurePos(id: string): Vec3d {
  const r = row(id);
  if (r.ref?.startsWith('galaxies:')) {
    const g = NAMED_GALAXIES.find((x) => x.id === r.ref!.slice(9));
    if (g) return vec3(g.pos[0], g.pos[1], g.pos[2]);
  }
  if (r.l === undefined || r.b === undefined || r.distMpc === undefined)
    throw new Error(`largescale: ${id} has no position`);
  return galacticToUniverse(r.l, r.b, r.distMpc);
}

export const GA_POS: Readonly<Vec3d> = structurePos('great-attractor');
export const NORMA_POS: Readonly<Vec3d> = structurePos('norma');
export const SHAPLEY_POS: Readonly<Vec3d> = structurePos('shapley');
export const VIRGO_POS: Readonly<Vec3d> = structurePos('virgo');

// ---------------------------------------------------------------------------------------
// Toy velocity field (linear theory: peculiar velocity ∝ gravitational pull)
// ---------------------------------------------------------------------------------------

export interface Attractor {
  id: string;
  pos: Readonly<Vec3d>;
  /** Relative mass weight. */
  weight: number;
  /** Plummer softening, Mpc. */
  soft: number;
}

/**
 * Relative weights chosen (not fitted) so that the Great Attractor dominates inside Laniakea, Shapley
 * takes over ~50 Mpc beyond it, and the Milky Way's model flow lands within ~25° of the observed
 * Local Group–CMB direction (Virgo supplies roughly a third of the pull at the Milky Way).
 */
export const ATTRACTORS: readonly Attractor[] = [
  { id: 'great-attractor', pos: GA_POS, weight: 1, soft: 20 },
  { id: 'shapley', pos: SHAPLEY_POS, weight: 3, soft: 25 },
  { id: 'virgo', pos: VIRGO_POS, weight: 0.03, soft: 5 },
];

/** Model velocity at (x, y, z) Mpc, in model units (multiply by KMS_PER_UNIT for km/s). */
export function velocity(x: number, y: number, z: number, out: Vec3d): Vec3d {
  let vx = 0;
  let vy = 0;
  let vz = 0;
  for (const a of ATTRACTORS) {
    const dx = a.pos.x - x;
    const dy = a.pos.y - y;
    const dz = a.pos.z - z;
    const r2 = dx * dx + dy * dy + dz * dz + a.soft * a.soft;
    const f = a.weight / (r2 * Math.sqrt(r2));
    vx += f * dx;
    vy += f * dy;
    vz += f * dz;
  }
  out.x = vx;
  out.y = vy;
  out.z = vz;
  return out;
}

/** Model flow at the Milky Way (universe origin). */
export const MW_FLOW: Readonly<Vec3d> = velocity(0, 0, 0, vec3());
/** Calibration: the model speed at the Milky Way is set to the Local Group's 627 km/s (CMB frame). */
export const KMS_PER_UNIT = (row('lg-motion').speedKms ?? 627) / v3len(MW_FLOW);

/** Streamline step and stopping radius around the Great Attractor, Mpc. */
export const STEP_MPC = 2;
export const STOP_MPC = 3;
export const SEED_STEPS = 32;
export const PATH_STEPS = 64;

const tv = vec3();
/**
 * Traces a streamline from `start` (RK2 midpoint, unit direction, STEP_MPC steps) and writes up to
 * `maxSteps + 1` vertices into `pos` at vertex offset `at` plus speeds (km/s) into `speed`.
 * Stops within STOP_MPC of the Great Attractor. Returns the vertex count.
 */
export function traceStreamline(
  start: Vec3d,
  maxSteps: number,
  pos: Float32Array | Float64Array,
  speed: Float32Array | Float64Array,
  at = 0,
): number {
  let x = start.x;
  let y = start.y;
  let z = start.z;
  let n = 0;
  for (let i = 0; i <= maxSteps; i++) {
    const v1 = velocity(x, y, z, tv);
    const s1 = v3len(v1);
    const k = (at + n) * 3;
    pos[k] = x;
    pos[k + 1] = y;
    pos[k + 2] = z;
    speed[at + n] = s1 * KMS_PER_UNIT;
    n++;
    if (i === maxSteps || s1 < 1e-12) break;
    if (Math.hypot(x - GA_POS.x, y - GA_POS.y, z - GA_POS.z) < STOP_MPC) break;
    const h = (0.5 * STEP_MPC) / s1;
    const v2 = velocity(x + v1.x * h, y + v1.y * h, z + v1.z * h, tv);
    const s2 = v3len(v2);
    if (s2 < 1e-12) break;
    x += (v2.x / s2) * STEP_MPC;
    y += (v2.y / s2) * STEP_MPC;
    z += (v2.z / s2) * STEP_MPC;
  }
  return n;
}

/** End point of a streamline from `start` after `steps` steps (tests, info). */
export function streamlineEnd(start: Vec3d, steps: number): Vec3d {
  const pos = new Float64Array((steps + 1) * 3);
  const sp = new Float64Array(steps + 1);
  const n = traceStreamline(start, steps, pos, sp);
  return vec3(pos[(n - 1) * 3], pos[(n - 1) * 3 + 1], pos[(n - 1) * 3 + 2]);
}

// ---------------------------------------------------------------------------------------
// Laniakea outline: a deterministic lumpy ellipsoid
// ---------------------------------------------------------------------------------------

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lan = row('laniakea');
const semi = lan.semiAxesMpc ?? [85, 78, 55];
const e1 = v3normalize(vec3(), GA_POS);
const e3 = v3normalize(vec3(), vec3(-e1.z * e1.x, -e1.z * e1.y, 1 - e1.z * e1.z));
const e2 = v3cross(vec3(), e3, e1);
const cf = lan.centreFractionOfGA ?? 0.5;

/** Shell basis: e1 toward the Great Attractor, e3 toward supergalactic north, e2 = e3 × e1. */
export const LANIAKEA = {
  centre: vec3(GA_POS.x * cf, GA_POS.y * cf, GA_POS.z * cf) as Readonly<Vec3d>,
  axes: [e1, e2, e3] as readonly Readonly<Vec3d>[],
  semi: semi as readonly number[],
};

/** Six seeded plane waves give the lumps (amplitude ±~15%). */
const LUMPS = (() => {
  const r = mulberry32(2014);
  return Array.from({ length: 6 }, () => {
    const d = v3normalize(vec3(), vec3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1));
    return { d, f: 1.5 + 3 * r(), p: 2 * Math.PI * r(), a: 0.035 + 0.035 * r() };
  });
})();

/** Radial factor of the outline along unit direction u (ellipsoid-normalised coordinates). */
export function lumpFactor(ux: number, uy: number, uz: number): number {
  let f = 1;
  for (const w of LUMPS) f += w.a * Math.sin(w.f * (w.d.x * ux + w.d.y * uy + w.d.z * uz) + w.p);
  return Math.max(0.75, f);
}

/** Ellipsoid-normalised coordinates (p in Mpc, universe) → out. */
function toLocal(p: Vec3d, out: Vec3d): Vec3d {
  const c = LANIAKEA.centre;
  const d = vec3(p.x - c.x, p.y - c.y, p.z - c.z);
  out.x = v3dot(d, e1) / semi[0];
  out.y = v3dot(d, e2) / semi[1];
  out.z = v3dot(d, e3) / semi[2];
  return out;
}

export function insideLaniakea(p: Vec3d): boolean {
  const q = toLocal(p, vec3());
  const r = v3len(q);
  return r < 1e-9 || r < lumpFactor(q.x / r, q.y / r, q.z / r);
}

function fromLocal(lx: number, ly: number, lz: number, out: Vec3d): Vec3d {
  const c = LANIAKEA.centre;
  const a = lx * semi[0];
  const b = ly * semi[1];
  const d = lz * semi[2];
  out.x = c.x + e1.x * a + e2.x * b + e3.x * d;
  out.y = c.y + e1.y * a + e2.y * b + e3.y * d;
  out.z = c.z + e1.z * a + e2.z * b + e3.z * d;
  return out;
}

/** Point on the outline at local unit direction scaled by `s` (s = 1: on the surface), Mpc. */
export function shellPoint(ux: number, uy: number, uz: number, s: number, out: Vec3d = vec3()): Vec3d {
  const f = lumpFactor(ux, uy, uz) * s;
  return fromLocal(ux * f, uy * f, uz * f, out);
}

/** UV-sphere mesh of the outline: positions (Mpc, universe frame) and triangle indices. */
export function shellMesh(nLat: number, nLon: number): { pos: Float32Array; index: Uint16Array } {
  const pos = new Float32Array((nLat + 1) * (nLon + 1) * 3);
  const p = vec3();
  let k = 0;
  for (let i = 0; i <= nLat; i++) {
    const th = (Math.PI * i) / nLat;
    for (let j = 0; j <= nLon; j++) {
      const ph = (2 * Math.PI * j) / nLon;
      shellPoint(Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th), 1, p);
      pos[k++] = p.x;
      pos[k++] = p.y;
      pos[k++] = p.z;
    }
  }
  const index = new Uint16Array(nLat * nLon * 6);
  k = 0;
  for (let i = 0; i < nLat; i++)
    for (let j = 0; j < nLon; j++) {
      const a = i * (nLon + 1) + j;
      const b = a + nLon + 1;
      index.set([a, b, a + 1, a + 1, b, b + 1], k);
      k += 6;
    }
  return { pos, index };
}

/** Deterministic seeds uniform inside the outline (rejection sampling), Mpc. */
export function seedPoints(n: number, seed = 1): Vec3d[] {
  const r = mulberry32(seed);
  const out: Vec3d[] = [];
  while (out.length < n) {
    const x = r() * 2 - 1;
    const y = r() * 2 - 1;
    const z = r() * 2 - 1;
    const l = Math.hypot(x, y, z);
    if (l > 1 || l < 1e-6) continue;
    if (l >= 0.97 * lumpFactor(x / l, y / l, z / l)) continue;
    out.push(fromLocal(x, y, z, vec3()));
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// Flow-line geometry
// ---------------------------------------------------------------------------------------

export const FLOW_LINES: Record<QualityPreset, number> = {
  potato: 600,
  low: 800,
  medium: 1000,
  high: 1200,
  ultra: 1500,
};

export interface FlowGeometry {
  /** Vertex positions, Mpc, universe frame. */
  pos: Float32Array;
  /** Per vertex: arc length + random phase (Mpc), speed colour 0..1, weight 0..1, highlight 0/1. */
  flow: Float32Array;
  /** Line-segment index pairs. */
  index: Uint32Array;
  lines: number;
  vertices: number;
  /** Vertex range [start, count] of 'Our path' (the streamline from the Milky Way). */
  path: [number, number];
}

/** Speed (km/s) → colour coordinate 0..1 (0.5 = the Local Group's 627 km/s, log scale). */
export const speedColour = (kms: number): number =>
  Math.min(1, Math.max(0, 0.5 + 0.35 * Math.log2(Math.max(kms, 1) / 627)));

/** Streamlines from `lines` seeds inside Laniakea plus 'Our path' from the Milky Way. */
export function generateFlows(lines: number, seed = 1): FlowGeometry {
  const seeds = seedPoints(lines, seed);
  const rnd = mulberry32(seed + 77);
  const maxV = lines * (SEED_STEPS + 1) + PATH_STEPS + 1;
  const pos = new Float32Array(maxV * 3);
  const speed = new Float32Array(maxV);
  const flow = new Float32Array(maxV * 4);
  const index = new Uint32Array((maxV - 1) * 2);
  let v = 0;
  let s = 0;
  let path: [number, number] = [0, 0];
  const emit = (start: Vec3d, steps: number, hi: number) => {
    const n = traceStreamline(start, steps, pos, speed, v);
    const phase = rnd() * 12;
    for (let i = 0; i < n; i++) {
      const k = (v + i) * 4;
      flow[k] = phase + i * STEP_MPC;
      flow[k + 1] = speedColour(speed[v + i]);
      flow[k + 2] = Math.min(1, i / 3) * Math.min(1, 0.35 + (n - 1 - i) / 3);
      flow[k + 3] = hi;
      if (i > 0) {
        index[s++] = v + i - 1;
        index[s++] = v + i;
      }
    }
    v += n;
    return n;
  };
  for (const p of seeds) emit(p, SEED_STEPS, 0);
  const start = v;
  path = [start, emit(vec3(), PATH_STEPS, 1)];
  // 'Our path' starts at the Milky Way at full weight.
  for (let i = 0; i < Math.min(3, path[1]); i++) flow[(start + i) * 4 + 2] = 1;
  return {
    pos: pos.slice(0, v * 3),
    flow: flow.slice(0, v * 4),
    index: index.slice(0, s),
    lines: lines + 1,
    vertices: v,
    path,
  };
}
