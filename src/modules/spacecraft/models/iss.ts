/**
 * International Space Station, assembly complete, to scale (109 m truss, 73 m across the arrays).
 *
 * Body axes (the station's own, held by the local-vertical attitude): +x the flight direction,
 * +y starboard, +z the nadir. The pressurised modules run along x under the truss, which runs
 * along y. Two parts: the hull, and the outboard truss with the eight solar array wings, which
 * turns about the truss axis to follow the Sun (the alpha joints; the beta gimbals are not modelled).
 */
import { assemble, mat, MeshBuilder, tint, type CraftModel, type Material, type V3 } from './kit';

const WHITE = mat(0xe4e4e0, 0.2);
const WHITE_WARM = mat(0xd9d5c8, 0.2);
const RUSSIAN = mat(0xc9c2ad, 0.25);
const TRUSS = mat(0x8b8d92, 0.35);
const TRUSS_DARK = mat(0x5c5e63, 0.3);
const RADIATOR = mat(0xf0f0f0, 0.1);
const CELL = mat(0x1a2440, 0.6);
const CELL_BACK = mat(0xb5803a, 0.3);
const GOLD = mat(0xd9a441, 0.7);
const BLACK = mat(0x1c1c20, 0.3);

/** Truss axis in body axes: above (zenith of) the laboratory. */
export const TRUSS_X = 6;
export const TRUSS_Z = -4.6;
/** Centres of the four array stations along the truss (inner and outer, port and starboard), m. */
const ARRAY_Y = [33.5, 48.8];

/** A module: a round cylinder with slightly darker end cones. */
function module(b: MeshBuilder, p0: V3, p1: V3, r: number, m: Material, sides = 12): void {
  b.cyl(p0, p1, r, r, sides, m, { cap0: tint(m, 0.8), cap1: tint(m, 0.8) });
}

function buildHull(): MeshBuilder {
  const b = new MeshBuilder();
  // --- US segment along the flight direction ---
  b.cyl([17.5, 0, 0], [19.6, 0, 0], 1.2, 0.8, 10, TRUSS_DARK); // PMA-2 and docking adapter
  module(b, [10.3, 0, 0], [17.5, 0, 0], 2.2, WHITE); // Harmony
  module(b, [1.8, 0, 0], [10.3, 0, 0], 2.15, WHITE_WARM); // Destiny
  module(b, [-3.7, 0, 0], [1.8, 0, 0], 2.3, WHITE); // Unity
  b.cyl([-5.7, 0, 0], [-3.7, 0, 0], 0.9, 1.2, 10, TRUSS_DARK); // PMA-1
  // --- Russian segment ---
  module(b, [-18.3, 0, 0], [-5.7, 0, 0], 2.05, RUSSIAN); // Zarya
  b.cyl([-21.5, 0, 0], [-18.3, 0, 0], 1.1, 1.4, 10, RUSSIAN); // Zvezda transfer compartment
  module(b, [-31.4, 0, 0], [-21.5, 0, 0], 2.05, RUSSIAN); // Zvezda
  b.cyl([-38.6, 0, 0], [-31.4, 0, 0], 1.1, 1.1, 10, tint(RUSSIAN, 0.7)); // Progress at the aft port
  for (const s of [1, -1]) {
    // Zvezda and Progress arrays.
    b.panel([-27, s * 9.2, 0], [1.6, 0, 0], [0, 6.8, 0], CELL, CELL_BACK);
    b.panel([-35.5, s * 3.6, 0], [0.7, 0, 0], [0, 2.3, 0], CELL, CELL_BACK);
  }
  module(b, [-8, 0, 2.0], [-8, 0, 8.0], 1.2, RUSSIAN, 10); // Rassvet (nadir)
  b.cyl([-8, 0, 8.0], [-8, 0, 14.5], 1.1, 1.1, 8, tint(RUSSIAN, 0.7)); // Soyuz
  module(b, [-20, 0, -1.2], [-20, 0, -5.2], 1.3, RUSSIAN, 10); // Poisk (zenith)
  module(b, [-20, 0, 1.2], [-20, 0, 13.5], 2.05, RUSSIAN); // Nauka (nadir)
  b.ball([-20, 0, 15.2], 1.7, 6, 10, RUSSIAN); // Prichal
  b.panel([-20, 0, 8], [0, 7.5, 0], [0, 0, 1.4], CELL, CELL_BACK); // Nauka arrays
  // --- Side modules ---
  module(b, [13.9, 2.2, 0], [13.9, 9.1, 0], 2.2, WHITE); // Columbus (starboard)
  module(b, [13.9, -2.2, 0], [13.9, -13.4, 0], 2.2, WHITE_WARM); // Kibo (port)
  module(b, [13.9, -6.2, -2.2], [13.9, -6.2, -6.4], 2.2, WHITE, 10); // Kibo logistics module (zenith)
  b.box([13.9, -16.6, 0.2], [2.5, 3.0, 1.9], TRUSS); // Kibo exposed facility
  b.box([15.6, -16.6, -1.2], [0.9, 2.2, 0.6], GOLD);
  b.cyl([-0.9, 2.3, 0], [-0.9, 5.3, 0], 2.0, 2.0, 10, WHITE); // Quest airlock
  b.cyl([-0.9, 5.3, 0], [-0.9, 7.8, 0], 1.0, 1.0, 8, WHITE_WARM);
  // High-pressure gas tanks around the crew lock.
  for (const a of [0.9, 2.4, 3.9, 5.4])
    b.ball([-0.9 + 1.5 * Math.cos(a), 5.6, 1.5 * Math.sin(a)], 0.5, 4, 6, WHITE);
  module(b, [-0.9, -2.3, 0], [-0.9, -9.0, 0], 2.2, WHITE); // Tranquility (port)
  b.cyl([-0.9, -6.4, 2.2], [-0.9, -6.4, 3.7], 1.5, 0.9, 7, TRUSS_DARK, { smooth: false, cap1: BLACK }); // Cupola
  module(b, [1.3, -5.6, 0], [7.9, -5.6, 0], 2.25, WHITE_WARM); // Leonardo
  b.cyl([-3.1, -5.6, 0], [-7.1, -5.6, 0], 1.6, 1.6, 10, WHITE); // BEAM
  // --- Truss: Z1 above Unity, then S0, S1 and P1 with the main radiators ---
  b.box([-0.9, 0, -3.6], [1.6, 1.6, 1.3], TRUSS_DARK);
  b.box([TRUSS_X, 0, -2.6], [1.2, 1.2, 0.5], TRUSS_DARK);
  for (let k = -6; k < 6; k++) {
    // Twelve 4 m bays so that the lattice reads as alternating facets.
    b.box([TRUSS_X, 4 * k + 2, TRUSS_Z], [1.9, 1.95, 1.7], k % 2 ? TRUSS : TRUSS_DARK);
  }
  for (const s of [1, -1]) {
    for (const y of [9.6, 13.6, 17.6]) {
      // Each radiator: eight white panels folding out aft of the truss.
      for (let k = 0; k < 8; k++) {
        b.panel(
          [TRUSS_X - 3.3 - 2.85 * k, s * y, TRUSS_Z + (k % 2 ? 0.12 : -0.12)],
          [1.38, 0, 0],
          [0, 1.65, 0],
          tint(RADIATOR, k % 2 ? 1 : 0.9),
        );
      }
    }
    // Stowage platforms and the mobile transporter.
    b.box([TRUSS_X + 2.6, s * 21, TRUSS_Z + 1.0], [1.2, 1.8, 0.7], tint(GOLD, 0.8));
    b.box([TRUSS_X - 2.4, s * 5.5, TRUSS_Z - 2.2], [0.9, 1.5, 0.5], WHITE);
  }
  // Canadarm2: two 7 m booms from the mobile base.
  const base: V3 = [TRUSS_X + 2.2, -2, TRUSS_Z];
  const elbow: V3 = [TRUSS_X + 8.5, -3.5, TRUSS_Z - 3.5];
  b.cyl(base, elbow, 0.18, 0.18, 6, WHITE);
  b.cyl(elbow, [TRUSS_X + 12.5, 1.5, TRUSS_Z + 1.5], 0.18, 0.18, 6, WHITE);
  return b;
}

/** Outboard truss and the eight wings, in a frame centred on the truss axis; cells face -z at rest. */
function buildArrays(): MeshBuilder {
  const b = new MeshBuilder();
  for (const s of [1, -1]) {
    // Outboard truss beyond the rotary joint.
    for (let k = 0; k < 7; k++) b.box([0, s * (26 + 4 * k), 0], [1.5, 1.95, 1.5], k % 2 ? TRUSS : TRUSS_DARK);
    b.cyl([0, s * 23.2, 0], [0, s * 24.2, 0], 2.3, 2.3, 12, TRUSS_DARK);
    for (const y of ARRAY_Y) {
      for (const dir of [1, -1]) {
        // One wing: a mast with two blankets, 34 m long and 11.6 m wide in all.
        b.strut([dir * 1.5, s * y, 0], [dir * 36.5, s * y, 0], 0.12, TRUSS, 4);
        for (const side of [1, -1]) {
          for (let k = 0; k < 8; k++) {
            const x = dir * (2.6 + 4.24 * (k + 0.5));
            b.panel(
              [x, s * y + side * 3.1, 0],
              [2.07, 0, 0],
              [0, -2.3, 0],
              tint(CELL, (k + (side > 0 ? 1 : 0)) % 2 ? 1 : 1.3),
              CELL_BACK,
            );
          }
        }
      }
      // Photovoltaic radiator at each array station.
      b.panel([-7.5, s * y, 1.2], [5.5, 0, 0], [0, 0, 1.6], RADIATOR);
    }
  }
  return b;
}

export function buildIss(): CraftModel {
  return assemble([
    { name: 'hull', mesh: buildHull().build(), pivot: [0, 0, 0] },
    { name: 'arrays', mesh: buildArrays().build(), pivot: [TRUSS_X, 0, TRUSS_Z], track: 'sun-y' },
  ]);
}
