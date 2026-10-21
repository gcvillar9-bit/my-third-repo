/**
 * Procedural low-poly buildings by architectural style (cities module data, life module rendering).
 * Model space as in mesh.ts (metres, +x is the facade, +y up, origin on the ground at the centre).
 * Static (sway weight 0). Sizes are typical, not surveyed.
 */
import { MeshBuilder, PART, hash01, mixRgb, rgb, type Joint, type V3 } from './mesh';

const still: Joint = { part: PART.plant, pivot: [0, 0, 0] };

export type BuildingKind =
  | 'mudHouse'
  | 'mudHouse2'
  | 'ziggurat'
  | 'pyramid'
  | 'pylonTemple'
  | 'brickHouse'
  | 'courtyardHouse'
  | 'pagoda'
  | 'palaceHall'
  | 'stoneHouse'
  | 'insula'
  | 'temple'
  | 'timberHouse'
  | 'stoneHouseMed'
  | 'cathedral'
  | 'keep'
  | 'flatHouse'
  | 'mosque'
  | 'shikhara'
  | 'woodHouse'
  | 'castleTiers'
  | 'stiltHouse'
  | 'prang'
  | 'hut'
  | 'stepPyramid'
  | 'andeanHouse'
  | 'roundHut'
  | 'mudMosque'
  | 'colonialHouse'
  | 'baroqueChurch'
  | 'terrace'
  | 'factory'
  | 'apartment'
  | 'tower'
  | 'suburbanHouse'
  | 'wall';

export interface BuildingModel {
  /** Footprint half-sizes (x along the facade normal, z along the facade), m. */
  half: [number, number];
  height: number;
  /** Landmarks are placed at the centre, one each. */
  landmark?: boolean;
  build(m: MeshBuilder, seed: number): void;
}

/** An axis-aligned box from (x0, y0, z0) to (x1, y1, z1) with one colour per face group. */
function box(m: MeshBuilder, a: V3, b: V3, wall: V3, top: V3 = wall, bottom = false) {
  const [x0, y0, z0] = a;
  const [x1, y1, z1] = b;
  const p = (x: number, y: number, z: number): V3 => [x, y, z];
  // sides (counter-clockwise seen from outside)
  m.quad(p(x1, y0, z0), p(x1, y1, z0), p(x1, y1, z1), p(x1, y0, z1), wall, still);
  m.quad(p(x0, y0, z1), p(x0, y1, z1), p(x0, y1, z0), p(x0, y0, z0), mixRgb(wall, [0, 0, 0], 0.08), still);
  m.quad(p(x0, y0, z0), p(x0, y1, z0), p(x1, y1, z0), p(x1, y0, z0), mixRgb(wall, [0, 0, 0], 0.04), still);
  m.quad(p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1), p(x0, y0, z1), mixRgb(wall, [0, 0, 0], 0.04), still);
  m.quad(p(x0, y1, z0), p(x0, y1, z1), p(x1, y1, z1), p(x1, y1, z0), top, still);
  if (bottom) m.quad(p(x0, y0, z0), p(x1, y0, z0), p(x1, y0, z1), p(x0, y0, z1), wall, still);
}

/** A centred box of half sizes hx, hz from y0 to y1. */
function cbox(
  m: MeshBuilder,
  hx: number,
  hz: number,
  y0: number,
  y1: number,
  wall: V3,
  top: V3 = wall,
  cx = 0,
  cz = 0,
) {
  box(m, [cx - hx, y0, cz - hz], [cx + hx, y1, cz + hz], wall, top);
}

/** A gable roof over a box of half sizes hx, hz at height y, ridge along z, overhang o. */
function gable(
  m: MeshBuilder,
  hx: number,
  hz: number,
  y: number,
  rise: number,
  col: V3,
  o = 0.4,
  cx = 0,
  cz = 0,
) {
  const x0 = cx - hx - o;
  const x1 = cx + hx + o;
  const z0 = cz - hz - o;
  const z1 = cz + hz + o;
  const r: V3 = [cx, y + rise, z0];
  const r1: V3 = [cx, y + rise, z1];
  m.quad([x1, y, z0], r, r1, [x1, y, z1], col, still);
  m.quad([x0, y, z1], r1, r, [x0, y, z0], mixRgb(col, [0, 0, 0], 0.12), still);
  // gable ends
  const wallEnd = mixRgb(col, [0.6, 0.55, 0.5], 0.5);
  m.triangle([x0 + o, y, z0 + o], [cx, y + rise, z0 + o], [x1 - o, y, z0 + o], wallEnd, still);
  m.triangle([x1 - o, y, z1 - o], [cx, y + rise, z1 - o], [x0 + o, y, z1 - o], wallEnd, still);
}

/** A hip roof (pyramid-like) over half sizes hx, hz. */
function hip(
  m: MeshBuilder,
  hx: number,
  hz: number,
  y: number,
  rise: number,
  col: V3,
  o = 0.5,
  cx = 0,
  cz = 0,
  ridge = 0.4,
) {
  const a: V3 = [cx - hx - o, y, cz - hz - o];
  const b: V3 = [cx + hx + o, y, cz - hz - o];
  const c: V3 = [cx + hx + o, y, cz + hz + o];
  const d: V3 = [cx - hx - o, y, cz + hz + o];
  const rz = hz * ridge;
  const t0: V3 = [cx, y + rise, cz - rz];
  const t1: V3 = [cx, y + rise, cz + rz];
  m.quad(b, t0, t1, c, col, still);
  m.quad(d, t1, t0, a, mixRgb(col, [0, 0, 0], 0.12), still);
  m.triangle(a, t0, b, mixRgb(col, [0, 0, 0], 0.06), still);
  m.triangle(c, t1, d, mixRgb(col, [0, 0, 0], 0.06), still);
}

/** Dark openings on the +x facade: a door and windows in rows. */
function facade(
  m: MeshBuilder,
  hx: number,
  hz: number,
  floors: number,
  floorH: number,
  col: V3,
  door = true,
  y0 = 0,
) {
  const x = hx + 0.02;
  const n = Math.max(1, Math.floor((2 * hz) / 3));
  for (let f = 0; f < floors; f++) {
    for (let i = 0; i < n; i++) {
      const z = -hz + ((i + 0.5) * 2 * hz) / n;
      const y = y0 + f * floorH + floorH * 0.35;
      if (door && f === 0 && i === Math.floor(n / 2)) {
        m.quad(
          [x, y0, z - 0.6],
          [x, y0 + 2.1, z - 0.6],
          [x, y0 + 2.1, z + 0.6],
          [x, y0, z + 0.6],
          col,
          still,
        );
        continue;
      }
      m.quad(
        [x, y, z - 0.45],
        [x, y + floorH * 0.4, z - 0.45],
        [x, y + floorH * 0.4, z + 0.45],
        [x, y, z + 0.45],
        col,
        still,
      );
    }
  }
}

function cylinder(
  m: MeshBuilder,
  r: number,
  y0: number,
  y1: number,
  col: V3,
  sides = 8,
  cx = 0,
  cz = 0,
  r1 = r,
) {
  m.loft(
    [
      { p: [cx, y0, cz], w: r, h: r, top: col },
      { p: [cx, y1, cz], w: r1, h: r1, top: col },
    ],
    sides,
    still,
  );
}

/** A dome: the upper half of a blob. */
function dome(m: MeshBuilder, r: number, y: number, col: V3, cx = 0, cz = 0) {
  const rings = [];
  for (let i = 0; i <= 4; i++) {
    const a = (i / 4) * (Math.PI / 2);
    rings.push({
      p: [cx, y + Math.sin(a) * r, cz] as V3,
      w: Math.cos(a) * r + 1e-3,
      h: Math.cos(a) * r + 1e-3,
      top: col,
    });
  }
  m.loft(rings, 10, still, { capStart: false });
}

const C = {
  mud: rgb(0xb89a72),
  mudLight: rgb(0xd2bc96),
  whitewash: rgb(0xe6dfcf),
  brick: rgb(0xa0583a),
  darkBrick: rgb(0x7a4630),
  stone: rgb(0xc9c0ad),
  greyStone: rgb(0x9a968c),
  marble: rgb(0xe8e4da),
  terracotta: rgb(0xa8523a),
  slate: rgb(0x55585e),
  thatch: rgb(0x9a8450),
  darkWood: rgb(0x5a3e2a),
  greyTile: rgb(0x5e6266),
  plaster: rgb(0xe8e0cc),
  timber: rgb(0x4a3424),
  concrete: rgb(0xa8a8a2),
  glass: rgb(0x46607a),
  opening: rgb(0x1e1a16),
  gold: rgb(0xc8a040),
  green: rgb(0x4a7a5a),
  red: rgb(0x9a3a2a),
};

export const BUILDINGS: Record<BuildingKind, BuildingModel> = {
  mudHouse: {
    half: [3, 2.5],
    height: 3.4,
    build(m) {
      cbox(m, 3, 2.5, 0, 3, C.mud, C.mudLight);
      cbox(m, 3.1, 2.6, 3, 3.4, C.mudLight); // parapet band
      facade(m, 3, 2.5, 1, 3, C.opening);
    },
  },
  mudHouse2: {
    half: [3.5, 3],
    height: 6.2,
    build(m) {
      cbox(m, 3.5, 3, 0, 3, C.mud, C.mudLight);
      cbox(m, 2.4, 2.2, 3, 5.8, C.mudLight);
      cbox(m, 2.5, 2.3, 5.8, 6.2, C.mud);
      facade(m, 3.5, 3, 1, 3, C.opening);
    },
  },
  ziggurat: {
    half: [32, 30],
    height: 32,
    landmark: true,
    build(m) {
      cbox(m, 32, 30, 0, 12, C.mud, C.mudLight);
      cbox(m, 22, 20, 12, 22, C.mudLight);
      cbox(m, 13, 11, 22, 28, C.mud);
      cbox(m, 6, 5, 28, 32, C.whitewash, C.red); // shrine
      // Central stair up the front.
      for (let i = 0; i < 6; i++)
        cbox(m, 4 + 2 * (5 - i), 3, 0, 2 * (i + 1), C.mudLight, C.mudLight, 32 + 2 * (5 - i) - 4, 0);
    },
  },
  pyramid: {
    half: [115, 115],
    height: 140,
    landmark: true,
    build(m) {
      const h = 140;
      const s = 115;
      const a: V3 = [-s, 0, -s];
      const b: V3 = [s, 0, -s];
      const c: V3 = [s, 0, s];
      const d: V3 = [-s, 0, s];
      const t: V3 = [0, h, 0];
      m.triangle(b, t, c, C.mudLight, still);
      m.triangle(d, t, a, mixRgb(C.mudLight, [0, 0, 0], 0.1), still);
      m.triangle(a, t, b, mixRgb(C.mudLight, [0, 0, 0], 0.05), still);
      m.triangle(c, t, d, mixRgb(C.mudLight, [0, 0, 0], 0.05), still);
      m.cone([0, h - 6, 0], t, 4.2, 4, C.gold, still); // capstone
    },
  },
  pylonTemple: {
    half: [40, 18],
    height: 22,
    landmark: true,
    build(m) {
      // Pylon gate (two tapered towers), a court of columns and a hall.
      for (const z of [-10, 10]) box(m, [30, 0, z - 8], [36, 22, z + 8], C.mudLight, C.stone);
      for (let i = 0; i < 5; i++) for (const z of [-8, 8]) cylinder(m, 1.2, 0, 12, C.stone, 6, 20 - i * 9, z);
      cbox(m, 12, 14, 0, 10, C.stone, C.mudLight, -30, 0);
      cbox(m, 34, 15, 12, 13, C.mudLight, C.mudLight, -2, 0);
    },
  },
  brickHouse: {
    half: [3.5, 3],
    height: 5,
    build(m) {
      cbox(m, 3.5, 3, 0, 4.6, C.brick, C.darkBrick);
      cbox(m, 3.6, 3.1, 4.6, 5, C.darkBrick);
      facade(m, 3.5, 3, 1, 4, C.opening);
    },
  },
  courtyardHouse: {
    half: [8, 8],
    height: 6,
    build(m) {
      // Four halls around a court, grey tiled hip roofs.
      for (const [cx, cz, hx, hz] of [
        [0, -6, 7, 2],
        [0, 6, 7, 2],
        [-6, 0, 2, 4],
        [6, 0, 2, 4],
      ]) {
        cbox(m, hx, hz, 0, 3.4, C.plaster, C.plaster, cx, cz);
        hip(m, hx, hz, 3.4, 2.4, C.greyTile, 0.6, cx, cz, 0.7);
      }
    },
  },
  pagoda: {
    half: [6, 6],
    height: 40,
    landmark: true,
    build(m) {
      for (let k = 0; k < 7; k++) {
        const s = 6 - k * 0.6;
        const y = k * 5.2;
        cbox(m, s * 0.7, s * 0.7, y, y + 3.6, C.red, C.red);
        hip(m, s * 0.7, s * 0.7, y + 3.6, 1.6, C.greyTile, 1.4, 0, 0, 0.05);
      }
      m.cone([0, 36.4, 0], [0, 40, 0], 0.5, 6, C.gold, still);
    },
  },
  palaceHall: {
    half: [30, 15],
    height: 28,
    landmark: true,
    build(m) {
      cbox(m, 32, 17, 0, 4, C.stone, C.stone);
      cbox(m, 26, 12, 4, 14, C.red, C.red);
      hip(m, 26, 12, 14, 6, C.gold, 3, 0, 0, 0.6);
      cbox(m, 20, 9, 18, 21, C.red, C.red);
      hip(m, 20, 9, 21, 7, C.gold, 2.5, 0, 0, 0.6);
    },
  },
  stoneHouse: {
    half: [4, 3.5],
    height: 6.5,
    build(m, seed) {
      const wall = hash01(seed, 1) < 0.5 ? C.plaster : rgb(0xd9b98a);
      cbox(m, 4, 3.5, 0, 4.2, wall);
      gable(m, 4, 3.5, 4.2, 1.8, C.terracotta, 0.4);
      facade(m, 4, 3.5, 1, 4, C.opening);
    },
  },
  insula: {
    half: [9, 7],
    height: 15,
    build(m) {
      cbox(m, 9, 7, 0, 13.5, rgb(0xc89a6a), rgb(0xb07a50));
      gable(m, 9, 7, 13.5, 1.6, C.terracotta, 0.3);
      facade(m, 9, 7, 4, 3.3, C.opening);
    },
  },
  temple: {
    half: [18, 10],
    height: 17,
    landmark: true,
    build(m) {
      cbox(m, 19, 11, 0, 2, C.marble, C.marble); // stylobate
      cbox(m, 12, 7, 2, 12, C.marble, C.marble, -2, 0); // cella
      for (let i = 0; i < 8; i++)
        for (const z of [-9.5, 9.5]) cylinder(m, 0.8, 2, 12, C.marble, 6, -16 + i * 4.6, z);
      for (const z of [-5, 0, 5]) cylinder(m, 0.8, 2, 12, C.marble, 6, 17, z);
      cbox(m, 18.5, 10.5, 12, 13.2, C.marble, C.marble);
      gable(m, 18.5, 10.5, 13.2, 3.6, rgb(0xd8cfbe), 0.3);
    },
  },
  timberHouse: {
    half: [4, 3.5],
    height: 10,
    build(m, seed) {
      cbox(m, 4, 3.5, 0, 3, C.greyStone);
      cbox(m, 4.3, 3.8, 3, 6.2, C.plaster, C.plaster);
      // timber frame
      for (const z of [-3.8, -1.3, 1.3, 3.8]) box(m, [4.31, 3, z - 0.15], [4.4, 6.2, z + 0.15], C.timber);
      box(m, [4.31, 4.5, -3.8], [4.4, 4.7, 3.8], C.timber);
      const roof = hash01(seed, 2) < 0.6 ? rgb(0x8a4a32) : C.slate;
      gable(m, 4.3, 3.8, 6.2, 4, roof, 0.5);
      facade(m, 4, 3.5, 1, 3, C.opening);
    },
  },
  stoneHouseMed: {
    half: [4.5, 4],
    height: 9,
    build(m) {
      cbox(m, 4.5, 4, 0, 6, C.greyStone);
      gable(m, 4.5, 4, 6, 3.2, C.slate, 0.4);
      facade(m, 4.5, 4, 2, 3, C.opening);
    },
  },
  cathedral: {
    half: [45, 18],
    height: 90,
    landmark: true,
    build(m) {
      cbox(m, 40, 9, 0, 28, C.stone); // nave
      gable(m, 40, 9, 28, 10, C.slate, 0.5);
      cbox(m, 8, 18, 0, 26, C.stone, C.stone, 10, 0); // transept
      gable(m, 8, 18, 26, 9, C.slate, 0.5, 10, 0);
      cbox(m, 7, 7, 0, 60, C.stone, C.stone, 42, 0); // west tower on the facade
      m.cone([42, 60, 0], [42, 90, 0], 6.5, 8, C.slate, still);
      cylinder(m, 9, 0, 22, C.stone, 10, -42, 0); // apse
      dome(m, 9, 22, C.slate, -42, 0);
    },
  },
  keep: {
    half: [12, 12],
    height: 30,
    landmark: true,
    build(m) {
      cbox(m, 12, 12, 0, 26, C.greyStone);
      for (let i = 0; i < 6; i++)
        for (const [x, z] of [
          [-12 + i * 4.8, -12],
          [-12 + i * 4.8, 12],
          [-12, -12 + i * 4.8],
          [12, -12 + i * 4.8],
        ])
          cbox(m, 1.1, 1.1, 26, 28.5, C.greyStone, C.greyStone, x, z);
      for (const [x, z] of [
        [-12, -12],
        [12, -12],
        [12, 12],
        [-12, 12],
      ])
        cylinder(m, 3.2, 0, 30, C.greyStone, 8, x, z);
    },
  },
  flatHouse: {
    half: [4, 4],
    height: 4.2,
    build(m, seed) {
      const wall = hash01(seed, 3) < 0.5 ? C.whitewash : rgb(0xd8c49c);
      cbox(m, 4, 4, 0, 3.6, wall);
      cbox(m, 4.1, 4.1, 3.6, 4.2, wall);
      facade(m, 4, 4, 1, 3.4, C.opening);
    },
  },
  mosque: {
    half: [25, 25],
    height: 55,
    landmark: true,
    build(m) {
      cbox(m, 22, 22, 0, 12, C.whitewash, C.whitewash);
      cylinder(m, 12, 12, 16, C.whitewash, 12);
      dome(m, 12, 16, rgb(0x3a7a8a));
      m.cone([0, 27.5, 0], [0, 31, 0], 0.4, 6, C.gold, still);
      for (const [x, z] of [
        [22, 22],
        [22, -22],
      ]) {
        cylinder(m, 2, 0, 45, C.whitewash, 8, x, z, 1.7);
        cbox(m, 2.6, 2.6, 38, 40, C.whitewash, C.whitewash, x, z);
        m.cone([x, 45, z], [x, 55, z], 1.8, 8, rgb(0x3a7a8a), still);
      }
    },
  },
  shikhara: {
    half: [14, 10],
    height: 36,
    landmark: true,
    build(m) {
      cbox(m, 14, 10, 0, 3, C.stone, C.stone);
      cbox(m, 6, 6, 3, 10, rgb(0xc8a070), rgb(0xc8a070), 6, 0); // hall
      hip(m, 6, 6, 10, 3, rgb(0xb88a5a), 0.5, 6, 0, 0.1);
      // Curved tower: stacked shrinking blocks.
      for (let k = 0; k < 8; k++) {
        const s = 6 * (1 - k * 0.1);
        cbox(m, s, s, 3 + k * 3.8, 3 + (k + 1) * 3.8, rgb(0xc8a070), rgb(0xb88a5a), -5, 0);
      }
      m.blob([-5, 34, 0], [2.4, 1.2, 2.4], rgb(0xb88a5a), still, { lat: 3, lon: 8 });
    },
  },
  woodHouse: {
    half: [5, 4],
    height: 6.5,
    build(m) {
      cbox(m, 5, 4, 0, 0.6, C.greyStone);
      cbox(m, 4.6, 3.6, 0.6, 3.6, C.darkWood, C.darkWood);
      hip(m, 4.6, 3.6, 3.6, 2.8, C.greyTile, 1.0, 0, 0, 0.5);
    },
  },
  castleTiers: {
    half: [25, 25],
    height: 50,
    landmark: true,
    build(m) {
      cbox(m, 25, 25, 0, 14, C.greyStone, C.greyStone); // stone base
      for (let k = 0; k < 5; k++) {
        const s = 14 - k * 2.4;
        const y = 14 + k * 6.4;
        cbox(m, s, s * 0.8, y, y + 4.6, C.whitewash, C.whitewash);
        hip(m, s, s * 0.8, y + 4.6, 1.8, C.greyTile, 1.5, 0, 0, 0.3);
      }
    },
  },
  stiltHouse: {
    half: [4, 3],
    height: 8,
    build(m) {
      for (const [x, z] of [
        [-3.5, -2.5],
        [3.5, -2.5],
        [3.5, 2.5],
        [-3.5, 2.5],
      ])
        cbox(m, 0.15, 0.15, 0, 2.2, C.darkWood, C.darkWood, x, z);
      cbox(m, 4, 3, 2.2, 4.6, C.darkWood, C.darkWood);
      gable(m, 4, 3, 4.6, 3.4, C.thatch, 0.8);
    },
  },
  prang: {
    half: [30, 30],
    height: 60,
    landmark: true,
    build(m) {
      cbox(m, 30, 30, 0, 6, C.greyStone, C.greyStone);
      cbox(m, 22, 22, 6, 14, C.greyStone, C.greyStone);
      for (const [x, z, h] of [
        [0, 0, 60],
        [16, 16, 38],
        [-16, 16, 38],
        [16, -16, 38],
        [-16, -16, 38],
      ]) {
        cbox(m, 5, 5, 14, 14 + (h - 14) * 0.4, C.greyStone, C.greyStone, x, z);
        m.loft(
          [
            { p: [x, 14 + (h - 14) * 0.4, z], w: 5, h: 5, top: C.greyStone },
            { p: [x, 14 + (h - 14) * 0.75, z], w: 3.6, h: 3.6, top: C.greyStone },
            { p: [x, h, z], w: 0.3, h: 0.3, top: C.greyStone },
          ],
          8,
          still,
        );
      }
    },
  },
  hut: {
    half: [3, 3],
    height: 4.5,
    build(m) {
      cbox(m, 3, 2.5, 0, 2.2, rgb(0xd8d0bc), rgb(0xd8d0bc));
      gable(m, 3, 2.5, 2.2, 2.4, C.thatch, 0.6);
    },
  },
  stepPyramid: {
    half: [30, 30],
    height: 45,
    landmark: true,
    build(m) {
      for (let k = 0; k < 6; k++) {
        const s = 30 - k * 4.6;
        cbox(m, s, s, k * 6, (k + 1) * 6, rgb(0xd8ccb0), rgb(0xc8bca0));
      }
      // Front stair and the temple on top.
      for (let i = 0; i < 6; i++)
        cbox(m, 2, 4, 0, (i + 1) * 6, rgb(0xb8ac90), rgb(0xb8ac90), 30 - i * 4.6 + 1, 0);
      cbox(m, 5, 5, 36, 42, C.red, C.red);
      gable(m, 5, 5, 42, 3, C.thatch, 0.6);
    },
  },
  andeanHouse: {
    half: [4, 3],
    height: 6,
    build(m) {
      cbox(m, 4, 3, 0, 3, C.greyStone);
      gable(m, 4, 3, 3, 3, C.thatch, 0.6);
      facade(m, 4, 3, 1, 3, C.opening);
    },
  },
  roundHut: {
    half: [3.2, 3.2],
    height: 5.5,
    build(m) {
      cylinder(m, 3, 0, 2.4, rgb(0xa88060), 10);
      m.cone([0, 2.2, 0], [0, 5.5, 0], 3.8, 10, C.thatch, still);
    },
  },
  mudMosque: {
    half: [28, 20],
    height: 22,
    landmark: true,
    build(m) {
      cbox(m, 28, 20, 0, 12, C.mud, C.mud);
      for (const z of [-14, 0, 14]) {
        cbox(m, 3.5, 3.5, 0, 20, C.mud, C.mud, 28, z);
        m.cone([28, 20, z], [28, 22.5, z], 2.4, 4, C.mud, still);
      }
      for (let i = 0; i < 9; i++)
        box(m, [28, 9, -19 + i * 4.75 - 0.15], [29.6, 9.3, -19 + i * 4.75 + 0.15], C.darkWood);
    },
  },
  colonialHouse: {
    half: [6, 5],
    height: 10,
    build(m, seed) {
      const wall = hash01(seed, 4) < 0.5 ? C.whitewash : rgb(0xe0c890);
      cbox(m, 6, 5, 0, 7.2, wall);
      hip(m, 6, 5, 7.2, 2.6, C.terracotta, 0.6, 0, 0, 0.5);
      facade(m, 6, 5, 2, 3.4, C.opening);
    },
  },
  baroqueChurch: {
    half: [30, 14],
    height: 45,
    landmark: true,
    build(m) {
      cbox(m, 28, 10, 0, 20, C.whitewash);
      gable(m, 28, 10, 20, 6, C.terracotta, 0.5);
      for (const z of [-8, 8]) {
        cbox(m, 4.5, 4.5, 0, 34, C.whitewash, C.whitewash, 26, z);
        dome(m, 3.5, 34, C.terracotta, 26, z);
        m.cone([26, 37, z], [26, 45, z], 0.4, 6, C.gold, still);
      }
      cylinder(m, 7, 20, 28, C.whitewash, 10, -10, 0);
      dome(m, 7, 28, C.terracotta, -10, 0);
    },
  },
  terrace: {
    half: [12, 5],
    height: 12,
    build(m) {
      cbox(m, 12, 5, 0, 10, C.brick, C.brick);
      gable(m, 12, 5, 10, 2.2, C.slate, 0.3);
      facade(m, 12, 5, 3, 3.1, C.opening);
      for (let i = 0; i < 4; i++) cbox(m, 0.5, 0.6, 11, 13.5, C.darkBrick, C.darkBrick, 0, -9 + i * 6); // chimneys
    },
  },
  factory: {
    half: [25, 15],
    height: 45,
    landmark: true,
    build(m) {
      cbox(m, 25, 15, 0, 10, C.darkBrick, C.slate);
      // Sawtooth roof: glazing facing -x, slopes facing +x, closed ends.
      for (let i = 0; i < 6; i++) {
        const x0 = -25 + i * (50 / 6);
        const x1 = x0 + 50 / 6;
        m.quad([x0, 10, 15], [x0, 15, 15], [x0, 15, -15], [x0, 10, -15], C.glass, still);
        m.quad([x0, 15, 15], [x1, 10, 15], [x1, 10, -15], [x0, 15, -15], C.slate, still);
        m.triangle([x0, 10, -15], [x0, 15, -15], [x1, 10, -15], C.darkBrick, still);
        m.triangle([x1, 10, 15], [x0, 15, 15], [x0, 10, 15], C.darkBrick, still);
      }
      cylinder(m, 2.2, 0, 45, C.darkBrick, 8, -20, 18, 1.5);
    },
  },
  apartment: {
    half: [16, 8],
    height: 36,
    build(m, seed) {
      const floors = 6 + Math.floor(hash01(seed, 5) * 6);
      const h = floors * 3;
      cbox(m, 16, 8, 0, h, C.concrete, rgb(0x707070));
      // Window bands on the long sides (z = +-8), facing out.
      for (let f = 0; f < floors; f++) {
        const y = f * 3 + 1;
        for (const s of [1, -1]) {
          const z = 8.03 * s;
          m.quad(
            [15 * s, y, z],
            [15 * s, y + 1.2, z],
            [-15 * s, y + 1.2, z],
            [-15 * s, y, z],
            C.glass,
            still,
          );
        }
      }
      void h;
    },
  },
  tower: {
    half: [18, 18],
    height: 220,
    landmark: true,
    build(m, seed) {
      const h = 120 + 140 * hash01(seed, 6);
      cbox(m, 18, 18, 0, h * 0.7, C.glass, C.concrete);
      cbox(m, 13, 13, h * 0.7, h * 0.92, C.glass, C.concrete);
      cbox(m, 7, 7, h * 0.92, h, C.concrete, C.concrete);
      // Floor bands every 12 m.
      for (let y = 6; y < h * 0.7; y += 12) cbox(m, 18.2, 18.2, y, y + 0.8, C.concrete);
    },
  },
  suburbanHouse: {
    half: [6, 5],
    height: 7,
    build(m, seed) {
      const wall = [C.whitewash, rgb(0xd8c8a8), rgb(0xb8c4cc), C.brick][Math.floor(hash01(seed, 7) * 4)];
      cbox(m, 6, 5, 0, 5, wall);
      gable(m, 6, 5, 5, 2.4, [C.slate, C.terracotta, C.greyTile][Math.floor(hash01(seed, 8) * 3)], 0.5);
      facade(m, 6, 5, 1, 4, C.opening);
    },
  },
  wall: {
    half: [3, 12],
    height: 14,
    build(m) {
      cbox(m, 3, 12, 0, 10, C.greyStone, C.greyStone);
      for (let i = 0; i < 5; i++) cbox(m, 3.1, 1.2, 10, 11.6, C.greyStone, C.greyStone, 0, -10 + i * 5);
      cbox(m, 4, 4, 0, 14, C.greyStone, C.greyStone, 0, 12); // tower at the end
    },
  },
};

/** Builds building `kind` (variant seed) into a new builder. */
export function buildBuilding(kind: BuildingKind, seed = 1): MeshBuilder {
  const m = new MeshBuilder();
  m.jitter = 0.04;
  BUILDINGS[kind].build(m, seed);
  return m;
}
