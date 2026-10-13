/**
 * Black-hole catalogue (public/data/blackholes/blackholes.json): rows → derived constants, frames
 * and bodies. Every hole frame uses world (ICRF) axes whatever its parent, so disk normals, S-star
 * orbits and bookmarks are all written in one basis.
 */
import type { Body, FrameDef, FrameTree, Quatd, Vec3d } from '../../core/contracts';
import { MW_FRAME, ROOT_FRAME, SSB_FRAME } from '../../core/contracts';
import { qconj, quat, v3cross, v3normalize, vec3 } from '../../core/math64';
import { AU, C, GM_SUN, PC, R_SUN } from '../../core/units';
import { B_CRIT } from './geodesic';
import { skyBasis, type SStarRow } from './sstars';

export interface DiskRow {
  mode: 'thin' | 'none';
  tMaxK?: number;
  lum?: number;
  rOut?: number;
  riafTK?: number;
  riafLum?: number;
  incDeg?: number;
  paDeg?: number;
  /** Outer radius (r_s) of the large-scale disk mesh (X-ray binaries). */
  meshOutRs?: number;
  meshLum?: number;
}

export interface CompanionRow {
  id: string;
  name: string;
  massMsun: number;
  radiusRsun: number;
  teffK: number;
  periodDays: number;
  /** Superior conjunction of the companion (it is behind the hole), JD. */
  t0Jd: number;
  source: string;
}

export interface HoleRow {
  id: string;
  name: string;
  aliases?: string[];
  massMsun: number;
  distancePc: number;
  raDeg: number;
  decDeg: number;
  atMwOrigin?: boolean;
  disk: DiskRow;
  companion?: CompanionRow;
  description: string;
  source: string;
}

export interface Catalogue {
  version: number;
  holes: HoleRow[];
  sstars: SStarRow[];
}

export interface Hole {
  row: HoleRow;
  id: string;
  frame: string;
  /** Schwarzschild radius, m. */
  rs: number;
  gm: number;
  /** Distance from the Sun, m. */
  distance: number;
  /** Unit direction Sun → hole, world axes. */
  skyDir: Vec3d;
  diskMode: 'thin' | 'none';
  disk: Required<Pick<DiskRow, 'tMaxK' | 'lum' | 'rOut' | 'riafTK' | 'riafLum'>> & DiskRow;
  /** Disk axis (rotation sense) and in-plane basis, world axes. */
  diskNormal: Vec3d;
  diskA: Vec3d;
  diskB: Vec3d;
}

const D2R = Math.PI / 180;

export const schwarzschildRadius = (massMsun: number): number => (2 * GM_SUN * massMsun) / (C * C);
export const holeFrameId = (id: string): string => `bh:${id}`;

/**
 * Disk axis from sky angles: inclination i between the axis and the direction to the observer
 * (i > 90° = clockwise on the sky) and position angle of the projected axis, east of north.
 */
export function diskAxis(raDeg: number, decDeg: number, incDeg: number, paDeg: number): Vec3d {
  const b = skyBasis(raDeg, decDeg);
  const ci = Math.cos(incDeg * D2R);
  const si = Math.sin(incDeg * D2R);
  const cp = Math.cos(paDeg * D2R);
  const sp = Math.sin(paDeg * D2R);
  return v3normalize(
    vec3(),
    vec3(
      -ci * b.los.x + si * (cp * b.n.x + sp * b.e.x),
      -ci * b.los.y + si * (cp * b.n.y + sp * b.e.y),
      -ci * b.los.z + si * (cp * b.n.z + sp * b.e.z),
    ),
  );
}

export function buildHole(row: HoleRow): Hole {
  const rs = schwarzschildRadius(row.massMsun);
  const sky = skyBasis(row.raDeg, row.decDeg);
  const n = diskAxis(row.raDeg, row.decDeg, row.disk.incDeg ?? 60, row.disk.paDeg ?? 0);
  const ref = Math.abs(n.z) < 0.9 ? vec3(0, 0, 1) : vec3(1, 0, 0);
  const a = v3normalize(vec3(), v3cross(vec3(), ref, n));
  const b = v3cross(vec3(), n, a);
  return {
    row,
    id: row.id,
    frame: holeFrameId(row.id),
    rs,
    gm: GM_SUN * row.massMsun,
    distance: row.distancePc * PC,
    skyDir: sky.los,
    diskMode: row.disk.mode,
    disk: {
      tMaxK: 7000,
      lum: 1000,
      rOut: 14,
      riafTK: 3000,
      riafLum: 0.05,
      ...row.disk,
    },
    diskNormal: n,
    diskA: a,
    diskB: b,
  };
}

/** Influence radius of a hole frame, m. */
export function influenceRadius(h: Hole): number {
  if (h.row.atMwOrigin) return 3e4 * AU;
  return Math.max(1e5 * h.rs, 20 * AU);
}

/**
 * Frame of a hole. Sgr A* sits at the `mw` origin; Milky Way holes hang under `mw` and M87*
 * under `universe` (the `ssb` influence sphere is under 1 pc), placed along their sky direction
 * from the Sun. Axes are world axes via orientationAt = conj(orientation(parent)).
 */
export function holeFrame(h: Hole, frames: FrameTree, jd: number): FrameDef {
  const parent = h.row.atMwOrigin ? MW_FRAME : h.distance > 1e5 * PC ? ROOT_FRAME : MW_FRAME;
  const pos = vec3();
  if (!h.row.atMwOrigin) {
    const local = vec3(h.skyDir.x * h.distance, h.skyDir.y * h.distance, h.skyDir.z * h.distance);
    frames.convertPoint(SSB_FRAME, local, parent, jd, pos);
  }
  const q: Quatd = qconj(quat(), frames.orientation(parent, jd, quat()));
  return {
    id: h.frame,
    parent,
    influenceRadius: influenceRadius(h),
    positionAt: (_jd, out) => {
      out.x = pos.x;
      out.y = pos.y;
      out.z = pos.z;
      return out;
    },
    orientationAt: (_jd, out) => {
      out.x = q.x;
      out.y = q.y;
      out.z = q.z;
      out.w = q.w;
      return out;
    },
  };
}

export function holeBody(h: Hole): Body {
  return {
    id: h.id,
    name: h.row.name,
    kind: 'blackhole',
    frame: h.frame,
    radius: h.rs,
    gm: h.gm,
    influenceRadius: influenceRadius(h),
    labelPriority: h.row.atMwOrigin ? 90 : 60,
  };
}

/** Separation of a circular binary (m) from total mass and period. */
export const binarySeparation = (massMsun: number, periodS: number): number =>
  Math.cbrt((GM_SUN * massMsun * periodS * periodS) / (4 * Math.PI * Math.PI));

export interface CompanionOrbit {
  row: CompanionRow;
  /** BH–companion separation, m. */
  a: number;
  radius: number;
  /** Orbital basis: u1 points away from the observer (superior conjunction), u2 = n × u1. */
  u1: Vec3d;
  u2: Vec3d;
  n: Vec3d;
  periodS: number;
}

export function companionOrbit(h: Hole): CompanionOrbit | null {
  const c = h.row.companion;
  if (!c) return null;
  const n = h.diskNormal;
  const los = h.skyDir;
  const d = los.x * n.x + los.y * n.y + los.z * n.z;
  const u1 = v3normalize(vec3(), vec3(los.x - d * n.x, los.y - d * n.y, los.z - d * n.z));
  const u2 = v3cross(vec3(), n, u1);
  const periodS = c.periodDays * 86400;
  return {
    row: c,
    a: binarySeparation(h.row.massMsun + c.massMsun, periodS),
    radius: c.radiusRsun * R_SUN,
    u1,
    u2,
    n,
    periodS,
  };
}

/** Companion orbital phase (rad, 0 at superior conjunction) at jd. */
export const companionPhase = (o: CompanionOrbit, jd: number): number =>
  (2 * Math.PI * ((jd - o.row.t0Jd) * 86400)) / o.periodS;

/** Companion position relative to the hole, world axes, m. */
export function companionPosition(o: CompanionOrbit, jd: number, out: Vec3d): Vec3d {
  const p = companionPhase(o, jd);
  const c = Math.cos(p) * o.a;
  const s = Math.sin(p) * o.a;
  out.x = c * o.u1.x + s * o.u2.x;
  out.y = c * o.u1.y + s * o.u2.y;
  out.z = c * o.u1.z + s * o.u2.z;
  return out;
}

/** Shadow angular diameter seen from the Sun, rad (2 b_c r_s / d). */
export const shadowDiameterFromEarth = (h: Hole): number => (2 * B_CRIT * h.rs) / h.distance;
