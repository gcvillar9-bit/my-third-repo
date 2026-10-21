/**
 * Procedural low-poly plants by era (model space as in mesh.ts; sway weight in aBend.w grows with
 * height). Heights are typical adult heights in metres; instances are scaled 0.6-1.3.
 */
import { MeshBuilder, PART, hash01, mixRgb, rgb, type Joint, type V3 } from './mesh';

const plant: Joint = { part: PART.plant, pivot: [0, 0, 0] };

export type PlantKind =
  | 'moss'
  | 'cooksonia'
  | 'lycopsid'
  | 'calamites'
  | 'treeFern'
  | 'fern'
  | 'seedFern'
  | 'conifer'
  | 'araucaria'
  | 'cycad'
  | 'ginkgo'
  | 'broadleaf'
  | 'palm'
  | 'shrub'
  | 'grass'
  | 'cactus'
  | 'birch'
  | 'deadShrub';

export interface PlantModel {
  height: number;
  /** Sway amplitude at the top, m. */
  sway: number;
  build(m: MeshBuilder, seed: number): void;
}

const bark = rgb(0x5a4632);
const darkBark = rgb(0x3e3024);

function trunk(m: MeshBuilder, h: number, r0: number, r1: number, col = bark, lean = 0, segs = 3) {
  const rings = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    rings.push({
      p: [lean * h * t * t, h * t, 0] as V3,
      w: r0 + (r1 - r0) * t,
      h: r0 + (r1 - r0) * t,
      top: col,
      bend: t * t,
    });
  }
  m.loft(rings, 5, plant, { capStart: false });
}

/** A drooping frond (fern, cycad, palm leaf) from `base` in direction `az` (radians), length `len`. */
function frond(
  m: MeshBuilder,
  base: V3,
  az: number,
  len: number,
  rise: number,
  width: number,
  col: V3,
  bendBase: number,
) {
  const n = 4;
  const ca = Math.cos(az);
  const sa = Math.sin(az);
  const pts: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const d = len * t;
    const y = base[1] + rise * len * t - 0.9 * len * t * t * (1 - rise * 0.5);
    pts.push([base[0] + ca * d, y, base[2] + sa * d]);
  }
  // Leaflets: a strip of width `width` across the rachis.
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const w0 = width * Math.sin(Math.PI * (i / n) + 0.3);
    const w1 = width * Math.sin(Math.PI * ((i + 1) / n) + 0.3);
    const px = -sa;
    const pz = ca;
    const bw0 = bendBase + (1 - bendBase) * (i / n);
    const bw1 = bendBase + (1 - bendBase) * ((i + 1) / n);
    const c = mixRgb(col, [col[0] * 0.8, col[1] * 0.85, col[2] * 0.8], i / n);
    m.quad(
      [a[0] + px * w0, a[1], a[2] + pz * w0],
      [b[0] + px * w1, b[1], b[2] + pz * w1],
      [b[0] - px * w1, b[1], b[2] - pz * w1],
      [a[0] - px * w0, a[1], a[2] - pz * w0],
      c,
      plant,
      bw0,
      bw1,
      bw1,
      bw0,
    );
    m.quad(
      [a[0] - px * w0, a[1], a[2] - pz * w0],
      [b[0] - px * w1, b[1], b[2] - pz * w1],
      [b[0] + px * w1, b[1], b[2] + pz * w1],
      [a[0] + px * w0, a[1], a[2] + pz * w0],
      c,
      plant,
      bw0,
      bw1,
      bw1,
      bw0,
    );
  }
}

function crownOfFronds(
  m: MeshBuilder,
  top: V3,
  count: number,
  len: number,
  rise: number,
  width: number,
  col: V3,
  seed: number,
) {
  for (let i = 0; i < count; i++) {
    const az = (2 * Math.PI * (i + 0.37 * hash01(seed, i))) / count;
    frond(m, top, az, len * (0.85 + 0.3 * hash01(seed, i, 2)), rise, width, col, 0.7);
  }
}

const g = (hex: number) => rgb(hex);

export const PLANTS: Record<PlantKind, PlantModel> = {
  moss: {
    height: 0.15,
    sway: 0,
    build(m, seed) {
      for (let i = 0; i < 4; i++) {
        const a = 2 * Math.PI * hash01(seed, i);
        const r = 0.4 * hash01(seed, i, 1);
        m.blob([Math.cos(a) * r, 0.03, Math.sin(a) * r], [0.25, 0.08, 0.25], g(0x4a5a2a), plant, {
          lat: 2,
          lon: 5,
          seed: i,
        });
      }
    },
  },
  cooksonia: {
    height: 0.3,
    sway: 0.02,
    build(m, seed) {
      for (let i = 0; i < 9; i++) {
        const a = 2 * Math.PI * hash01(seed, i);
        const r = 0.35 * hash01(seed, i, 1);
        const h = 0.15 + 0.15 * hash01(seed, i, 2);
        const b: V3 = [Math.cos(a) * r, 0, Math.sin(a) * r];
        m.cone(b, [b[0] + 0.03, h, b[2]], 0.012, 3, g(0x5a7a32), plant, 0, 1);
        m.blob([b[0] + 0.03, h, b[2]], [0.02, 0.025, 0.02], g(0x8a7a3a), plant, { lat: 2, lon: 3, bend: 1 });
      }
    },
  },
  lycopsid: {
    height: 25,
    sway: 0.3,
    build(m, seed) {
      // Lepidodendron: a tall unbranched pole with a forked crown of grassy leaves.
      trunk(m, 20, 0.5, 0.35, g(0x5a5a3a), 0.02, 4);
      const top: V3 = [0.4, 20, 0];
      for (let i = 0; i < 4; i++) {
        const a = (2 * Math.PI * i) / 4 + hash01(seed, i);
        const tip: V3 = [top[0] + Math.cos(a) * 2.5, top[1] + 3, Math.sin(a) * 2.5];
        m.cone(top, tip, 0.2, 4, g(0x5a5a3a), plant, 1, 1);
        m.blob(tip, [1.8, 2.4, 1.8], g(0x3e5a28), plant, { lat: 3, lon: 5, bend: 1, rough: 0.2, seed: i });
      }
    },
  },
  calamites: {
    height: 8,
    sway: 0.25,
    build(m, seed) {
      // Giant horsetail: jointed stem with whorls of needle leaves.
      trunk(m, 8, 0.15, 0.08, g(0x6a7a3a), 0, 4);
      for (let k = 1; k < 7; k++) {
        const y = k * 1.1;
        for (let i = 0; i < 6; i++) {
          const a = (2 * Math.PI * (i + 0.5 * (k % 2))) / 6 + hash01(seed, k);
          m.cone(
            [0, y, 0],
            [Math.cos(a) * 0.8, y + 0.35, Math.sin(a) * 0.8],
            0.04,
            3,
            g(0x4e6a2a),
            plant,
            (y / 8) ** 2,
            (y / 8) ** 2,
          );
        }
      }
    },
  },
  treeFern: {
    height: 6,
    sway: 0.15,
    build(m, seed) {
      trunk(m, 5, 0.22, 0.18, darkBark, 0.05, 3);
      crownOfFronds(m, [0.25, 5, 0], 9, 2.4, 0.5, 0.35, g(0x3f6a2a), seed);
    },
  },
  fern: {
    height: 1,
    sway: 0.08,
    build(m, seed) {
      crownOfFronds(m, [0, 0.1, 0], 8, 1.0, 1.2, 0.18, g(0x4a7a30), seed);
    },
  },
  seedFern: {
    height: 4,
    sway: 0.12,
    build(m, seed) {
      // Glossopteris-like: a short tree with tongue-shaped leaf clusters.
      trunk(m, 3, 0.18, 0.1, bark, 0.05, 3);
      for (let i = 0; i < 4; i++) {
        const a = 2 * Math.PI * hash01(seed, i);
        m.blob(
          [Math.cos(a) * 0.8, 3 + 0.6 * hash01(seed, i, 1), Math.sin(a) * 0.8],
          [0.9, 0.6, 0.9],
          g(0x46622e),
          plant,
          { lat: 3, lon: 5, bend: 1, rough: 0.25, seed: i },
        );
      }
    },
  },
  conifer: {
    height: 18,
    sway: 0.25,
    build(m, seed) {
      trunk(m, 4, 0.35, 0.3, darkBark, 0, 2);
      const col = g(0x2e4a2a);
      for (let k = 0; k < 4; k++) {
        const y = 3 + k * 3.4;
        const r = 3.4 * (1 - k * 0.2);
        m.cone(
          [0, y, 0],
          [0.05 * hash01(seed, k), y + 5, 0],
          r,
          6,
          mixRgb(col, g(0x3e5e32), k / 4),
          plant,
          Math.min(1, (y / 18) ** 2),
          Math.min(1, ((y + 5) / 18) ** 2),
        );
      }
    },
  },
  araucaria: {
    height: 25,
    sway: 0.3,
    build(m, seed) {
      // Monkey-puzzle-like: tall bare trunk, flat crown of tufts (Mesozoic conifer forests).
      trunk(m, 18, 0.5, 0.3, darkBark, 0.01, 4);
      for (let i = 0; i < 7; i++) {
        const a = (2 * Math.PI * i) / 7 + hash01(seed, i);
        const r = 2.5 + 1.5 * hash01(seed, i, 1);
        const y = 17 + 4 * hash01(seed, i, 2);
        m.cone([0, y - 1, 0], [Math.cos(a) * r, y, Math.sin(a) * r], 0.12, 3, darkBark, plant, 1, 1);
        m.blob([Math.cos(a) * r, y + 0.3, Math.sin(a) * r], [2.4, 1.2, 2.4], g(0x2f4a28), plant, {
          lat: 2,
          lon: 6,
          bend: 1,
          rough: 0.2,
          seed: i,
        });
      }
      m.blob([0, 21, 0], [1.8, 1.4, 1.8], g(0x2f4a28), plant, {
        lat: 3,
        lon: 6,
        bend: 1,
        rough: 0.2,
        seed: 9,
      });
    },
  },
  cycad: {
    height: 2,
    sway: 0.06,
    build(m, seed) {
      m.loft(
        [
          { p: [0, 0, 0], w: 0.35, h: 0.35, top: g(0x6a5a3e) },
          { p: [0, 0.8, 0], w: 0.3, h: 0.3, top: g(0x5e5036) },
          { p: [0, 1.1, 0], w: 0.18, h: 0.18, top: g(0x5e5036) },
        ],
        6,
        plant,
        { capStart: false },
      );
      crownOfFronds(m, [0, 1.1, 0], 10, 1.4, 0.9, 0.16, g(0x3e6a2e), seed);
    },
  },
  ginkgo: {
    height: 14,
    sway: 0.2,
    build(m, seed) {
      trunk(m, 7, 0.35, 0.2, bark, 0.03, 3);
      for (let i = 0; i < 5; i++) {
        const a = 2 * Math.PI * hash01(seed, i);
        const r = 1.6 * hash01(seed, i, 1);
        m.blob(
          [Math.cos(a) * r, 7 + 5 * hash01(seed, i, 2), Math.sin(a) * r],
          [1.9, 2.2, 1.9],
          g(0x6a8a36),
          plant,
          { lat: 3, lon: 6, bend: 1, rough: 0.2, seed: i },
        );
      }
    },
  },
  broadleaf: {
    height: 16,
    sway: 0.2,
    build(m, seed) {
      trunk(m, 6, 0.4, 0.25, bark, 0.04, 3);
      for (let i = 0; i < 6; i++) {
        const a = 2 * Math.PI * hash01(seed, i);
        const r = 2.4 * hash01(seed, i, 1);
        const shade = 0.8 + 0.3 * hash01(seed, i, 3);
        const c = g(0x3a5e26).map((v) => v * shade) as V3;
        m.blob([Math.cos(a) * r, 7.5 + 6 * hash01(seed, i, 2), Math.sin(a) * r], [3.2, 2.6, 3.2], c, plant, {
          lat: 3,
          lon: 6,
          bend: 1,
          rough: 0.25,
          seed: i,
        });
      }
    },
  },
  birch: {
    height: 14,
    sway: 0.25,
    build(m, seed) {
      trunk(m, 8, 0.2, 0.12, g(0xd8d2c4), 0.02, 3);
      for (let i = 0; i < 4; i++) {
        const a = 2 * Math.PI * hash01(seed, i);
        m.blob(
          [Math.cos(a) * 1, 8 + 4 * hash01(seed, i, 2), Math.sin(a) * 1],
          [1.6, 2.4, 1.6],
          g(0x5a7a32),
          plant,
          { lat: 3, lon: 6, bend: 1, rough: 0.25, seed: i },
        );
      }
    },
  },
  palm: {
    height: 12,
    sway: 0.35,
    build(m, seed) {
      const lean = 0.08 + 0.1 * hash01(seed, 9);
      trunk(m, 11, 0.25, 0.18, g(0x7a6a4e), lean, 5);
      crownOfFronds(m, [lean * 11, 11, 0], 9, 3.6, 0.55, 0.45, g(0x4a7a2e), seed);
    },
  },
  shrub: {
    height: 1.5,
    sway: 0.05,
    build(m, seed) {
      for (let i = 0; i < 3; i++) {
        const a = 2 * Math.PI * hash01(seed, i);
        m.blob(
          [Math.cos(a) * 0.4, 0.6 + 0.3 * hash01(seed, i, 1), Math.sin(a) * 0.4],
          [0.75, 0.6, 0.75],
          g(0x4e6230),
          plant,
          { lat: 3, lon: 5, bend: 0.8, rough: 0.3, seed: i },
        );
      }
    },
  },
  grass: {
    height: 0.6,
    sway: 0.06,
    build(m, seed) {
      const col = g(0x8a8a46);
      for (let i = 0; i < 12; i++) {
        const a = 2 * Math.PI * hash01(seed, i);
        const r = 0.35 * Math.sqrt(hash01(seed, i, 1));
        const b: V3 = [Math.cos(a) * r, 0, Math.sin(a) * r];
        const h = 0.35 + 0.3 * hash01(seed, i, 2);
        const tip: V3 = [b[0] + 0.1 * Math.cos(a), h, b[2] + 0.1 * Math.sin(a)];
        const w = 0.025;
        const c = mixRgb(col, g(0x6a7a36), hash01(seed, i, 3));
        m.triangle(
          [b[0] - w * Math.sin(a), 0, b[2] + w * Math.cos(a)],
          tip,
          [b[0] + w * Math.sin(a), 0, b[2] - w * Math.cos(a)],
          c,
          plant,
          0,
          1,
          0,
        );
        m.triangle(
          [b[0] + w * Math.sin(a), 0, b[2] - w * Math.cos(a)],
          tip,
          [b[0] - w * Math.sin(a), 0, b[2] + w * Math.cos(a)],
          c,
          plant,
          0,
          1,
          0,
        );
      }
    },
  },
  cactus: {
    height: 4,
    sway: 0,
    build(m, seed) {
      const col = g(0x4a6a3a);
      m.loft(
        [
          { p: [0, 0, 0], w: 0.25, h: 0.25, top: col },
          { p: [0, 3.6, 0], w: 0.22, h: 0.22, top: col },
          { p: [0, 4, 0], w: 0.05, h: 0.05, top: col },
        ],
        7,
        plant,
        { capStart: false },
      );
      for (const z of [-1, 1]) {
        const y = 1.4 + hash01(seed, z + 2);
        m.loft(
          [
            { p: [0, y, 0], w: 0.15, h: 0.15, top: col },
            { p: [0, y, z * 0.8], w: 0.15, h: 0.15, top: col },
            { p: [0, y + 1.2, z * 0.85], w: 0.13, h: 0.13, top: col },
            { p: [0, y + 1.4, z * 0.85], w: 0.04, h: 0.04, top: col },
          ],
          6,
          plant,
        );
      }
    },
  },
  deadShrub: {
    height: 0.8,
    sway: 0.02,
    build(m, seed) {
      for (let i = 0; i < 6; i++) {
        const a = 2 * Math.PI * hash01(seed, i);
        m.cone(
          [0, 0, 0],
          [Math.cos(a) * 0.5, 0.5 + 0.3 * hash01(seed, i, 1), Math.sin(a) * 0.5],
          0.03,
          3,
          g(0x7a6a4e),
          plant,
          0,
          1,
        );
      }
      m.blob([0, 0.35, 0], [0.4, 0.3, 0.4], g(0x6e7046), plant, {
        lat: 2,
        lon: 5,
        bend: 0.5,
        rough: 0.4,
        seed,
      });
    },
  },
};

/** Builds plant `kind` (variant seed) into a new builder. */
export function buildPlant(kind: PlantKind, seed = 1): MeshBuilder {
  const m = new MeshBuilder();
  m.jitter = 0.1;
  PLANTS[kind].build(m, seed);
  return m;
}
