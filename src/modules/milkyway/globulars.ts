/**
 * Globular clusters (P4-A): Celestia globulars.dsc (Baumgardt et al. 2023) as King (1962)
 * point clouds. Each cluster becomes N points drawn from King's 3D density; together they carry
 * the cluster's integrated V magnitude, so distant clusters are faint fuzzy dots and the cloud
 * resolves when you fly in. Background layer, RTE positions in pc relative to the ssb (ICRS axes).
 */
import {
  AdditiveBlending,
  BufferGeometry,
  Float32BufferAttribute,
  Points,
  ShaderMaterial,
  Vector3,
  type IUniform,
} from 'three';
import {
  SSB_FRAME,
  type Bookmark,
  type InfoCard,
  type InfoProvider,
  type Quatd,
  type QualityPreset,
  type Renderable,
  type SearchEntry,
  type SearchProvider,
  type Vec3d,
} from '../../core/contracts';
import { qlookRotation, quat, vec3 } from '../../core/math64';
import { blackbodyRgb, LUX_MAG0 } from '../../core/photometry';
import { PC } from '../../core/units';
import { createRteUniforms, RTE_GLSL, setRteCamera } from '../../render/chunks';
import shader from './globulars.glsl?raw';

/** [name, aliases, raDeg, decDeg, distPc, rcPc, rtPc, absMagV] */
export type GlobularRow = [string, string[], number, number, number, number, number, number];
export interface GlobularFile {
  source: string;
  columns: string[];
  rows: GlobularRow[];
}

export const POINTS_PER_CLUSTER: Record<QualityPreset, number> = {
  potato: 48,
  low: 64,
  medium: 128,
  high: 256,
  ultra: 384,
};
/** Integrated-light colour of an old metal-poor population (~5200 K), approximate. */
export const GLOBULAR_TEFF = 5200;

/** ICRS unit vector from RA/Dec in degrees. */
export const icrsDir = (raDeg: number, decDeg: number): Vec3d => {
  const a = (raDeg * Math.PI) / 180;
  const d = (decDeg * Math.PI) / 180;
  return vec3(Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d));
};

/** King (1962) space density (arbitrary units) at radius r for core rc and tidal radius rt. */
export function kingDensity(r: number, rc: number, rt: number): number {
  if (r >= rt) return 0;
  const z = Math.sqrt((1 + (r / rc) ** 2) / (1 + (rt / rc) ** 2));
  return (Math.acos(z) / z - Math.sqrt(1 - z * z)) / (z * z);
}

/** Deterministic PRNG (mulberry32). */
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

const TABLE = 96;
/** Draws `n` 3D radii (same unit as rc, rt) from the King profile by inverse CDF of 4πr²ρ. */
export function sampleKingRadii(n: number, rc: number, rt: number, rand: () => number): Float64Array {
  const rMin = Math.min(rc * 0.01, rt * 1e-3);
  const r = new Float64Array(TABLE);
  const cdf = new Float64Array(TABLE);
  for (let i = 0; i < TABLE; i++) r[i] = rMin * (rt / rMin) ** (i / (TABLE - 1));
  for (let i = 1; i < TABLE; i++) {
    const rm = 0.5 * (r[i] + r[i - 1]);
    cdf[i] = cdf[i - 1] + 4 * Math.PI * rm * rm * kingDensity(rm, rc, rt) * (r[i] - r[i - 1]);
  }
  const total = cdf[TABLE - 1] || 1;
  const out = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const u = rand() * total;
    let i = 1;
    while (i < TABLE - 1 && cdf[i] < u) i++;
    const f = (u - cdf[i - 1]) / Math.max(cdf[i] - cdf[i - 1], 1e-300);
    out[k] = r[i - 1] + (r[i] - r[i - 1]) * Math.min(1, Math.max(0, f));
  }
  return out;
}

/** Cluster centre, pc from the ssb in ICRS axes. */
export const clusterCentrePc = (row: GlobularRow): Vec3d => {
  const d = icrsDir(row[2], row[3]);
  return vec3(d.x * row[4], d.y * row[4], d.z * row[4]);
};

/** Builds positions (pc, ICRS, relative to the ssb) and per-point absolute magnitudes. */
export function buildGlobularPoints(rows: readonly GlobularRow[], perCluster: number, seed = 1) {
  const n = rows.length * perCluster;
  const pos = new Float32Array(n * 3);
  const mag = new Float32Array(n);
  const rand = mulberry32(seed);
  let k = 0;
  for (const row of rows) {
    const c = clusterCentrePc(row);
    const rc = Math.max(row[5], 1e-3);
    const rt = Math.max(row[6], rc * 1.5);
    const radii = sampleKingRadii(perCluster, rc, rt, rand);
    const mPoint = row[7] + 2.5 * Math.log10(perCluster);
    for (let i = 0; i < perCluster; i++, k++) {
      const u = 2 * rand() - 1;
      const phi = 2 * Math.PI * rand();
      const s = Math.sqrt(1 - u * u);
      pos[3 * k] = c.x + radii[i] * s * Math.cos(phi);
      pos[3 * k + 1] = c.y + radii[i] * s * Math.sin(phi);
      pos[3 * k + 2] = c.z + radii[i] * u;
      mag[k] = mPoint;
    }
  }
  return { pos, mag, count: n };
}

export interface GlobularLayer extends Renderable {
  visible: boolean;
}

export function createGlobulars(rows: readonly GlobularRow[], perCluster: number): GlobularLayer {
  const { pos, mag } = buildGlobularPoints(rows, perCluster);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geometry.setAttribute('absMag', new Float32BufferAttribute(mag, 1));
  const rte = createRteUniforms();
  const c = blackbodyRgb(GLOBULAR_TEFF);
  const uniforms: Record<string, IUniform> = {
    ...rte,
    uScale: { value: 0 },
    uColor: { value: new Vector3(c[0], c[1], c[2]) },
  };
  // cosmos:no-depth (background layer: cluster stars are drawn as directions at infinity)
  const material = new ShaderMaterial({
    vertexShader: `#define COSMOS_VERTEX\n${RTE_GLSL}\n${shader}`,
    fragmentShader: shader,
    uniforms,
    blending: AdditiveBlending,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = -8;
  const cam = vec3();
  const camPc = vec3();
  const zero = vec3();
  const q: Quatd = quat();
  const self: GlobularLayer = {
    id: 'milkyway.globulars',
    layer: 'background',
    object: points,
    visible: true,
    update(view) {
      points.visible = self.visible;
      if (!self.visible) return;
      const t = view.toCamera(SSB_FRAME, zero, cam); // camera → ssb, world axes, m
      camPc.x = -t.x / PC;
      camPc.y = -t.y / PC;
      camPc.z = -t.z / PC;
      setRteCamera(rte, camPc);
      view.frameQuat(SSB_FRAME, q);
      points.quaternion.set(q.x, q.y, q.z, q.w);
      // E (lux) → pre-exposed luminance if the whole flux lands in one pixel.
      uniforms.uScale.value = (LUX_MAG0 * view.exposure) / (view.pixelAngle * view.pixelAngle);
    },
    memoryBytes: () => pos.byteLength + mag.byteLength,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
  return self;
}

/** Search entries: fly to 6 tidal radii from the cluster, on the Sun side, looking at it. */
export function globularBookmark(row: GlobularRow): Bookmark {
  const c = clusterCentrePc(row);
  const d = Math.hypot(c.x, c.y, c.z);
  const back = Math.max(d - 6 * row[6], 0.5 * d);
  const dir = vec3(c.x / d, c.y / d, c.z / d);
  return {
    id: `gc:${row[0]}`,
    title: row[0],
    frame: SSB_FRAME,
    pos: vec3(dir.x * back * PC, dir.y * back * PC, dir.z * back * PC),
    quat: qlookRotation(quat(), dir, vec3(0, 0, 1)),
    fovY: (40 * Math.PI) / 180,
    lookTarget: `Globular cluster ${row[0]} at the centre as a dense ball of point stars.`,
  };
}

export function createGlobularSearch(rows: readonly GlobularRow[]): SearchProvider {
  const entries: SearchEntry[] = rows.map((row) => ({
    id: `gc:${row[0]}`,
    name: row[0],
    aliases: row[1],
    subtitle: 'Globular cluster',
    kind: 'cluster',
    target: globularBookmark(row),
  }));
  return { id: 'milkyway.globulars', entries: () => entries };
}

export function createGlobularInfo(rows: readonly GlobularRow[]): InfoProvider {
  const byId = new Map(rows.map((r) => [`gc:${r[0]}`, r]));
  const src = 'Baumgardt et al. 2023 via CelestiaContent globulars.dsc';
  return {
    id: 'milkyway.globulars',
    info(id): InfoCard | null {
      const r = byId.get(id);
      if (!r) return null;
      return {
        title: r[0],
        subtitle: 'Globular cluster',
        facts: [
          { label: 'Distance', value: Number((r[4] / 1000).toFixed(2)), unit: 'kpc', source: src },
          { label: 'Absolute magnitude (V)', value: r[7], source: src },
          { label: 'Core radius', value: Number(r[5].toFixed(2)), unit: 'pc', source: src },
          { label: 'Tidal radius', value: Number(r[6].toFixed(1)), unit: 'pc', source: src },
          { label: 'King concentration', value: Number(Math.log10(r[6] / r[5]).toFixed(2)), source: src },
        ],
        description: r[1].length ? `Also known as ${r[1].join(', ')}.` : undefined,
        simulated: true,
        credit: 'Point cloud drawn from a King (1962) profile; individual stars are procedural.',
      };
    },
  };
}
