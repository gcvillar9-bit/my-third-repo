/**
 * Deep-space probes, to scale. Shared body axes: +z is the dish boresight (turned to Earth by the
 * attitude model), the bus sits behind the dish at -z, +x is the roll reference.
 */
import { add, along, assemble, basis, mat, MeshBuilder, scale, sub, type CraftModel, type V3 } from './kit';

const WHITE = mat(0xe6e6e2, 0.15);
const DISH_BACK = mat(0xd8d8d2, 0.1);
const BLACK = mat(0x26262a, 0.45);
const DARK = mat(0x3c3d42, 0.3);
const METAL = mat(0x9a9ca1, 0.5);
const GOLD = mat(0xd9a441, 0.75);
const GOLD_DARK = mat(0xa87a2c, 0.7);
const RTG = mat(0x4a4b50, 0.25);

/** A finned RTG cylinder from p0 to p1. */
function rtg(b: MeshBuilder, p0: V3, p1: V3, r: number, fins: number): void {
  b.cyl(p0, p1, r, r, 8, RTG);
  const d = sub(p1, p0);
  const [u, v] = basis(d);
  const mid = add(p0, scale(d, 0.5));
  for (let k = 0; k < fins; k++) {
    const a = (Math.PI * k) / fins;
    const f = add(scale(u, Math.cos(a)), scale(v, Math.sin(a)));
    b.panel(mid, scale(d, 0.45), scale(f, r * 1.9), RTG);
  }
}

/** Dish with a feed on a tripod: vertex at z = z0, rim at z0 + depth. */
function antenna(b: MeshBuilder, z0: number, radius: number, depth: number, feedZ: number): void {
  b.dish([0, 0, z0], [0, 0, 1], radius, depth, 20, 4, WHITE, DISH_BACK);
  for (let k = 0; k < 3; k++) {
    const a = (2 * Math.PI * k) / 3 + 0.5;
    const r = radius * 0.8;
    b.strut([r * Math.cos(a), r * Math.sin(a), z0 + depth * 0.64], [0, 0, feedZ], 0.02, METAL, 3);
  }
  b.cyl([0, 0, feedZ - 0.12], [0, 0, feedZ + 0.1], radius * 0.13, radius * 0.1, 10, WHITE);
}

/** Voyager 1 and 2: 3.66 m dish, ten-sided bus, RTG boom, science boom, 13 m magnetometer boom. */
export function buildVoyager(): CraftModel {
  const b = new MeshBuilder();
  antenna(b, -0.1, 1.83, 0.45, 1.25);
  // Ten-sided bus (1.78 m across, 0.47 m high) around the propellant tank, in black blankets.
  b.cyl([0, 0, -0.95], [0, 0, -0.48], 0.89, 0.89, 10, BLACK, { smooth: false });
  b.cyl([0, 0, -0.48], [0, 0, -0.1], 0.55, 0.7, 10, DARK);
  b.ball([0, 0, -0.72], 0.36, 5, 8, METAL);
  // The Golden Record on one bay of the bus.
  b.cyl([0.88, 0, -0.72], [0.93, 0, -0.72], 0.15, 0.15, 12, GOLD, { cap1: GOLD });
  // Science boom (+y) with the scan platform and its cameras.
  const sci: V3 = [0, 2.9, -0.95];
  b.lattice([0, 0.8, -0.7], sci, 0.12, 4, 0.015, METAL);
  b.box(sci, [0.28, 0.25, 0.3], DARK);
  b.cyl(along(sci, [1, 0, 0], 0.28), along(sci, [1, 0, 0], 0.95), 0.13, 0.15, 8, WHITE);
  b.cyl(along(sci, [1, 0.5, 0.6], 0.3), along(sci, [1, 0.5, 0.6], 0.7), 0.09, 0.1, 8, BLACK);
  b.box([0, 1.7, -0.6], [0.12, 0.2, 0.18], GOLD_DARK);
  // RTG boom (-y, drooping): three generators in a row.
  const r0: V3 = [0, -0.8, -0.75];
  const rdir: V3 = [0.1, -0.86, -0.5];
  b.lattice(r0, along(r0, rdir, 1.6), 0.1, 3, 0.015, METAL);
  for (let k = 0; k < 3; k++)
    rtg(b, along(r0, rdir, 1.65 + 0.58 * k), along(r0, rdir, 2.17 + 0.58 * k), 0.2, 3);
  // Magnetometer boom: 13 m of open lattice with two sensors.
  const m0: V3 = [-0.5, -0.5, -0.9];
  const mdir: V3 = [-0.62, -0.5, -0.6];
  const m1 = along(m0, mdir, 13);
  b.lattice(m0, m1, 0.11, 16, 0.012, METAL);
  b.box(along(m0, mdir, 7), [0.09, 0.09, 0.09], GOLD_DARK);
  b.box(m1, [0.09, 0.09, 0.09], GOLD_DARK);
  // Two 10 m whip antennas (planetary radio astronomy and plasma waves) in a V.
  b.strut([0.3, 0.3, -0.95], along([0.3, 0.3, -0.95], [0.85, 0.2, -0.5], 10), 0.012, METAL, 3);
  b.strut([0.3, 0.3, -0.95], along([0.3, 0.3, -0.95], [-0.2, 0.85, -0.5], 10), 0.012, METAL, 3);
  // Thruster struts under the bus.
  for (let k = 0; k < 4; k++) {
    const a = (Math.PI * k) / 2 + 0.6;
    b.strut(
      [0.6 * Math.cos(a), 0.6 * Math.sin(a), -0.95],
      [0.9 * Math.cos(a), 0.9 * Math.sin(a), -1.4],
      0.02,
      METAL,
      3,
    );
  }
  return assemble([{ name: 'voyager', mesh: b.build(), pivot: [0, 0, 0] }]);
}

/** Pioneer 10 and 11: 2.74 m dish, hexagonal bus, two RTG booms and a magnetometer boom 120° apart. */
export function buildPioneer(): CraftModel {
  const b = new MeshBuilder();
  antenna(b, 0, 1.37, 0.46, 1.2);
  // Medium-gain antenna on top of the feed.
  b.cyl([0, 0, 1.3], [0, 0, 1.5], 0.12, 0.2, 8, WHITE);
  // Hexagonal equipment compartment (0.36 m deep) in gold blankets, with the side bay for experiments.
  b.cyl([0, 0, -0.42], [0, 0, -0.06], 0.71, 0.71, 6, GOLD, { smooth: false });
  b.box([0.95, 0, -0.24], [0.3, 0.36, 0.17], GOLD_DARK);
  b.cyl([0, 0, -0.62], [0, 0, -0.42], 0.25, 0.35, 8, METAL);
  // RTG booms at ±120° from the magnetometer boom, two generators at the end of each.
  for (const s of [1, -1]) {
    const dir: V3 = [-0.5, s * 0.866, 0];
    const p0 = along([0, 0, -0.24], dir, 0.7);
    for (const off of [-0.07, 0.07]) {
      const side: V3 = [dir[1] * off, -dir[0] * off, 0];
      b.strut(
        [p0[0] + side[0], p0[1] + side[1], p0[2]],
        along([side[0], side[1], -0.24], dir, 2.9),
        0.012,
        METAL,
        3,
      );
    }
    rtg(b, along([0, 0, -0.24], dir, 2.9), along([0, 0, -0.24], dir, 3.25), 0.14, 3);
    rtg(b, along([0, 0, -0.24], dir, 3.28), along([0, 0, -0.24], dir, 3.63), 0.14, 3);
  }
  // Magnetometer boom, 6.6 m from the axis, sensor at the tip.
  b.lattice([0.7, 0, -0.24], [6.4, 0, -0.24], 0.07, 9, 0.01, METAL);
  b.box([6.5, 0, -0.24], [0.1, 0.07, 0.07], GOLD_DARK);
  // Thruster clusters on the dish rim.
  for (const s of [1, -1]) b.box([0, s * 1.4, 0.4], [0.07, 0.07, 0.1], METAL);
  return assemble([{ name: 'pioneer', mesh: b.build(), pivot: [0, 0, 0] }]);
}

/** New Horizons: 2.1 m dish on a gold-blanketed triangular body, RTG on the apex. */
export function buildNewHorizons(): CraftModel {
  const b = new MeshBuilder();
  // Body: a truncated triangle 0.7 m thick ("grand piano"), apex towards +x where the RTG mounts.
  const outline: [number, number][] = [
    [1.0, 0.35],
    [-0.75, 1.3],
    [-1.05, 1.0],
    [-1.05, -1.0],
    [-0.75, -1.3],
    [1.0, -0.35],
  ];
  const top = outline.map(([x, y]): V3 => [x, y, -0.1]);
  const bottom = outline.map(([x, y]): V3 => [x, y, -0.8]);
  b.polygon(top, GOLD, null);
  b.polygon([...bottom].reverse(), GOLD_DARK, null);
  for (let k = 0; k < outline.length; k++) {
    const n = (k + 1) % outline.length;
    b.quad(bottom[k], bottom[n], top[n], top[k], k % 2 ? GOLD : GOLD_DARK);
  }
  // High-gain dish with the medium-gain dish and feed above it.
  b.cyl([0, 0, -0.1], [0, 0, 0.02], 0.35, 0.45, 10, METAL);
  antenna(b, 0.02, 1.05, 0.3, 0.95);
  b.dish([0, 0, 1.05], [0, 0, 1], 0.15, 0.04, 10, 1, WHITE, DISH_BACK);
  // RTG on a conical adapter along +x.
  b.cyl([1.0, 0, -0.45], [1.3, 0, -0.45], 0.3, 0.2, 8, METAL);
  rtg(b, [1.3, 0, -0.45], [2.4, 0, -0.45], 0.21, 4);
  // Instruments: LORRI telescope, Ralph, Alice, PEPSSI, SWAP, star trackers.
  b.cyl([-0.3, -1.05, -0.45], [-0.3, -1.6, -0.45], 0.13, 0.13, 8, GOLD_DARK, { cap1: BLACK });
  b.box([-0.9, 0.5, -0.95], [0.2, 0.25, 0.15], WHITE);
  b.cyl([-0.9, 0.5, -1.1], [-0.9, 0.5, -1.35], 0.12, 0.16, 8, BLACK);
  b.box([-0.5, -0.6, -0.92], [0.25, 0.1, 0.12], METAL);
  b.cyl([-1.05, -0.6, -0.3], [-1.25, -0.6, -0.3], 0.1, 0.1, 8, WHITE);
  b.box([0.2, 0.75, -0.02], [0.09, 0.09, 0.08], METAL);
  // Launch adapter ring on the face opposite the RTG.
  b.cyl([-1.05, 0, -0.45], [-1.2, 0, -0.45], 0.42, 0.42, 12, METAL, { cap1: DARK });
  // Low-gain antenna mast under the body.
  b.strut([0.3, 0, -0.8], [0.3, 0, -1.25], 0.03, METAL);
  return assemble([{ name: 'newhorizons', mesh: b.build(), pivot: [0, 0, 0] }]);
}
