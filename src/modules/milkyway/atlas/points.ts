/**
 * Atlas star points: one additive Points draw in the background layer for every atlas object
 * that emits visible light. Real stars (open-cluster members from Gaia, Cepheids) keep their
 * measured sky position and brightness; satellite galaxies and the populations of the Galactic
 * centre are clouds of simulated points that carry the measured total light and size.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  Matrix3,
  Points,
  ShaderMaterial,
  Vector3,
  type IUniform,
} from 'three';
import {
  SSB_FRAME,
  type QualityPreset,
  type Quatd,
  type Renderable,
  type Vec3d,
} from '../../../core/contracts';
import { quat, vec3 } from '../../../core/math64';
import { blackbodyRgb, bvToTeff, LUX_MAG0, SUN_ABS_MAG_V } from '../../../core/photometry';
import { PC } from '../../../core/units';
import { createRteUniforms, RTE_GLSL, setRteCamera } from '../../../render/chunks';
import { cameraModel } from '../galaxy';
import type { AtlasState } from '../guides';
import { MODEL, SUN_MODEL, WORLD_TO_MODEL } from '../model';
import type { Atlas } from './catalog';
import shader from './points.glsl?raw';

/** Largest number of member stars drawn per open cluster (the file holds up to 82, brightest first). */
export const STARS_PER_CLUSTER: Record<QualityPreset, number> = {
  potato: 12,
  low: 24,
  medium: 48,
  high: 82,
  ultra: 82,
};
/** Multiplier on the number of simulated points of a population. */
export const POPULATION_SCALE: Record<QualityPreset, number> = {
  potato: 0.25,
  low: 0.5,
  medium: 1,
  high: 1,
  ultra: 1.5,
};

export const CLUSTER_STARS_MAGIC = 0x5343574d;

export interface ClusterStars {
  count: number;
  cluster: Uint16Array;
  dx: Int16Array;
  dy: Int16Array;
  g: Uint8Array;
  c: Uint8Array;
}

/** Decodes cluster-stars.bin (MWCS v1, see tools/milkyway/layers/open-clusters.mjs). */
export function decodeClusterStars(buf: ArrayBuffer): ClusterStars {
  const head = new Uint32Array(buf, 0, 4);
  if (head[0] !== CLUSTER_STARS_MAGIC || head[1] !== 1) throw new Error('cluster-stars.bin: bad header');
  const n = head[2];
  if (buf.byteLength !== 16 + 8 * n) throw new Error('cluster-stars.bin: bad length');
  return {
    count: n,
    cluster: new Uint16Array(buf, 16, n),
    dx: new Int16Array(buf, 16 + 2 * n, n),
    dy: new Int16Array(buf, 16 + 4 * n, n),
    g: new Uint8Array(buf, 16 + 6 * n, n),
    c: new Uint8Array(buf, 16 + 7 * n, n),
  };
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
const gauss = (rand: () => number): number =>
  Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand());

/** Unit vectors towards east, north and away from the Sun at a heliocentric ICRS position. */
export function skyBasis(x: number, y: number, z: number): { e: Vec3d; n: Vec3d; los: Vec3d } {
  const d = Math.hypot(x, y, z) || 1;
  const los = vec3(x / d, y / d, z / d);
  const rxy = Math.hypot(los.x, los.y);
  const e = rxy > 1e-9 ? vec3(-los.y / rxy, los.x / rxy, 0) : vec3(1, 0, 0);
  const n = vec3(los.y * e.z - los.z * e.y, los.z * e.x - los.x * e.z, los.x * e.y - los.y * e.x);
  return { e, n, los };
}

export class PointBuilder {
  pos: number[] = [];
  mag: number[] = [];
  col: number[] = [];
  blob: number[] = [];
  ext: number[] = [];
  get count(): number {
    return this.mag.length;
  }
  add(x: number, y: number, z: number, absMag: number, rgb: readonly number[], blobPc = 0, ext = 0): void {
    this.pos.push(x, y, z);
    this.mag.push(absMag);
    const m = Math.max(rgb[0], rgb[1], rgb[2], 1e-6);
    // Colours are stored with luminance 1 in 8 bits after scaling into range: `scale` restores it.
    this.col.push(rgb[0] / m, rgb[1] / m, rgb[2] / m);
    this.mag[this.mag.length - 1] -= 2.5 * Math.log10(m);
    this.blob.push(blobPc);
    this.ext.push(ext);
  }
}

const TEFF_STEPS = 64;
const teffRgb: [number, number, number][] = [];
/** Luminance-1 colour of a Gaia BP-RP colour (via an approximate B-V = 0.75 (BP-RP), Teff from B-V). */
function bpRpRgb(code: number): [number, number, number] {
  if (!teffRgb.length)
    for (let i = 0; i < TEFF_STEPS; i++) teffRgb.push(blackbodyRgb(2500 + (i / (TEFF_STEPS - 1)) * 27500));
  const bpRp = code === 255 ? 0.85 : -0.6 + code * 0.02;
  const teff = Math.min(30000, Math.max(2500, bvToTeff(0.75 * bpRp)));
  return teffRgb[Math.round(((teff - 2500) / 27500) * (TEFF_STEPS - 1))];
}

/** Real member stars of the open clusters. Depth inside the cluster is simulated. */
export function addClusterStars(
  b: PointBuilder,
  atlas: Atlas,
  stars: ClusterStars,
  perCluster: number,
): void {
  const layer = atlas.layers.get('open-clusters');
  if (!layer) return;
  const { rows } = layer.file;
  const { col } = layer;
  const rand = mulberry32(7);
  let run = -1;
  let inRun = 0;
  let basis = skyBasis(1, 0, 0);
  let cx = 0;
  let cy = 0;
  let cz = 0;
  let scale = 0;
  let depth = 0;
  let dm = 0;
  for (let i = 0; i < stars.count; i++) {
    const ci = stars.cluster[i];
    if (ci !== run) {
      run = ci;
      inRun = 0;
      const row = rows[ci];
      if (!row) continue;
      cx = row[col.x] as number;
      cy = row[col.y] as number;
      cz = row[col.z] as number;
      basis = skyBasis(cx, cy, cz);
      scale = ((row[col.rMem] as number) || 0) / 32767;
      // Depth spread: the half-member radius (1D sigma of a Gaussian with that median radius).
      depth = ((row[col.r] as number) || 1) / 1.1774;
      dm = 5 * Math.log10(Math.hypot(cx, cy, cz) / 10);
    }
    if (inRun++ >= perCluster) continue;
    const ex = stars.dx[i] * scale;
    const ny = stars.dy[i] * scale;
    const dz = gauss(rand) * depth;
    b.add(
      cx + ex * basis.e.x + ny * basis.n.x + dz * basis.los.x,
      cy + ex * basis.e.y + ny * basis.n.y + dz * basis.los.y,
      cz + ex * basis.e.z + ny * basis.n.z + dz * basis.los.z,
      stars.g[i] * 0.08 - dm, // observed brightness from the Sun, so its extinction is included
      bpRpRgb(stars.c[i]),
    );
  }
}

/** Colour temperature of a classical Cepheid (F-G supergiant), approximate. */
export const CEPHEID_TEFF = 5800;

export function addCepheids(b: PointBuilder, atlas: Atlas): void {
  const rgb = blackbodyRgb(CEPHEID_TEFF);
  for (const o of atlas.ofClass('cepheids')) {
    const m = atlas.value(o, 'absMag');
    if (m !== null) b.add(o.x, o.y, o.z, m, rgb, 0, 1);
  }
}

export interface Population {
  x: number;
  y: number;
  z: number;
  /** Half-light radius, pc. */
  rHalf: number;
  /** Total absolute V magnitude. */
  absMag: number;
  /** 1 - b/a on the sky (0 = round). */
  ellipticity: number;
  /** Position angle of the major axis, degrees east of north. */
  paDeg: number;
  teff: number;
  points: number;
  ext: number;
}

/**
 * A Plummer sphere of `points` equal clumps of light, flattened on the sky by the measured
 * ellipticity along the measured position angle. The positions are simulated.
 */
export function addPopulation(b: PointBuilder, p: Population, seed: number): void {
  const rand = mulberry32(seed);
  const { e, n, los } = skyBasis(p.x, p.y, p.z);
  const pa = (p.paDeg * Math.PI) / 180;
  // Major axis (east of north) and minor axis on the sky.
  const ma = vec3(
    Math.sin(pa) * e.x + Math.cos(pa) * n.x,
    Math.sin(pa) * e.y + Math.cos(pa) * n.y,
    Math.sin(pa) * e.z + Math.cos(pa) * n.z,
  );
  const mi = vec3(
    Math.cos(pa) * e.x - Math.sin(pa) * n.x,
    Math.cos(pa) * e.y - Math.sin(pa) * n.y,
    Math.cos(pa) * e.z - Math.sin(pa) * n.z,
  );
  const q = 1 - Math.min(0.9, Math.max(0, p.ellipticity));
  // Projected half-light radius of a Plummer sphere equals its scale radius a.
  const a = p.rHalf / Math.sqrt(q);
  const rgb = blackbodyRgb(p.teff);
  const mPoint = p.absMag + 2.5 * Math.log10(p.points);
  const blob = (0.9 * p.rHalf) / Math.cbrt(p.points);
  for (let i = 0; i < p.points; i++) {
    const r = Math.min(a / Math.sqrt(Math.max(rand(), 1e-6) ** (-2 / 3) - 1), 8 * a);
    const u = 2 * rand() - 1;
    const phi = 2 * Math.PI * rand();
    const s = Math.sqrt(1 - u * u);
    const pa1 = r * s * Math.cos(phi);
    const pb = r * s * Math.sin(phi) * q;
    const pc = r * u;
    b.add(
      p.x + pa1 * ma.x + pb * mi.x + pc * los.x,
      p.y + pa1 * ma.y + pb * mi.y + pc * los.y,
      p.z + pa1 * ma.z + pb * mi.z + pc * los.z,
      mPoint,
      rgb,
      blob,
      p.ext,
    );
  }
}

/** Colour temperature of an old metal-poor dwarf galaxy (integrated light), approximate. */
export const SATELLITE_TEFF = 5000;
/** Satellites drawn by the galaxies module as 3D portraits (never drawn here). */
export const SATELLITES_ELSEWHERE = new Set(['mw:satellites:lmc', 'mw:satellites:smc']);

/** Number of simulated points of a population with V luminosity L (solar units). */
export const populationPoints = (lumSun: number, scale: number): number =>
  Math.round(Math.min(1500, Math.max(24, 30 * (lumSun / 1e3) ** 0.4)) * scale);

/** Satellite dwarf galaxies of the atlas as populations. Rows without size or brightness are skipped. */
export function satellitePopulations(atlas: Atlas, scale: number): Population[] {
  const out: Population[] = [];
  for (const o of atlas.ofClass('satellites')) {
    if (SATELLITES_ELSEWHERE.has(o.id)) continue;
    const absMag = atlas.value(o, 'absMag');
    if (absMag === null || !(o.r > 0)) continue;
    const lum = 10 ** (-0.4 * (absMag - SUN_ABS_MAG_V));
    out.push({
      x: o.x,
      y: o.y,
      z: o.z,
      rHalf: o.r,
      absMag,
      ellipticity: atlas.value(o, 'ellipticity') ?? 0,
      paDeg: atlas.value(o, 'posAngle') ?? 0,
      teff: SATELLITE_TEFF,
      points: populationPoints(lum, scale),
      ext: 0,
    });
  }
  return out;
}

export interface PointLayer extends Renderable {
  count: number;
}

export function createStarPoints(b: PointBuilder, state: AtlasState): PointLayer {
  const n = b.count;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(b.pos), 3));
  geometry.setAttribute('absMag', new Float32BufferAttribute(new Float32Array(b.mag), 1));
  const col = new Uint8Array(n * 3);
  for (let i = 0; i < n * 3; i++) col[i] = Math.round(b.col[i] * 255);
  geometry.setAttribute('color', new BufferAttribute(col, 3, true));
  geometry.setAttribute('blob', new Float32BufferAttribute(new Float32Array(b.blob), 1));
  geometry.setAttribute('ext', new BufferAttribute(new Uint8Array(b.ext), 1, false));
  const rte = createRteUniforms();
  const uniforms: Record<string, IUniform> = {
    ...rte,
    uScale: { value: 0 },
    uPixelAngle: { value: 1e-3 },
    uGain: { value: 1 },
    uCamModel: { value: new Vector3() },
    uSunModel: { value: new Vector3(SUN_MODEL.x, SUN_MODEL.y, SUN_MODEL.z) },
    // three.js Matrix3.set takes row-major arguments, like WORLD_TO_MODEL.
    uWorldToModel: {
      value: new Matrix3().set(
        ...(WORLD_TO_MODEL as [number, number, number, number, number, number, number, number, number]),
      ),
    },
  };
  const d = MODEL.dust;
  const defines =
    `#define MW_R0 ${MODEL.sun.R0.toFixed(4)}\n#define MW_DUST_K0 ${d.kappaV0.toFixed(4)}\n` +
    `#define MW_DUST_HR ${d.hR.toFixed(4)}\n#define MW_DUST_HZ ${d.hz.toFixed(4)}\n` +
    `#define MW_REDDEN vec3(${d.reddening.map((v) => v.toFixed(4)).join(', ')})\n`;
  // cosmos:no-depth (background layer: atlas stars are drawn as directions at infinity)
  const material = new ShaderMaterial({
    vertexShader: `#define COSMOS_VERTEX\n${defines}${RTE_GLSL}\n${shader}`,
    fragmentShader: shader,
    uniforms,
    blending: AdditiveBlending,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = -7.5;
  const cam = vec3();
  const camPc = vec3();
  const camModel = vec3();
  const zero = vec3();
  const q: Quatd = quat();
  const bytes = n * (12 + 4 + 3 + 4 + 1);
  return {
    id: 'milkyway.atlas.stars',
    layer: 'background',
    object: points,
    count: n,
    update(view) {
      points.visible = state.light;
      if (!state.light) return;
      const t = view.toCamera(SSB_FRAME, zero, cam);
      camPc.x = -t.x / PC;
      camPc.y = -t.y / PC;
      camPc.z = -t.z / PC;
      setRteCamera(rte, camPc);
      view.frameQuat(SSB_FRAME, q);
      points.quaternion.set(q.x, q.y, q.z, q.w);
      cameraModel(view, camModel);
      (uniforms.uCamModel.value as Vector3).set(camModel.x, camModel.y, camModel.z);
      uniforms.uPixelAngle.value = view.pixelAngle;
      uniforms.uScale.value = (LUX_MAG0 * view.exposure) / (view.pixelAngle * view.pixelAngle);
    },
    memoryBytes: () => bytes,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
