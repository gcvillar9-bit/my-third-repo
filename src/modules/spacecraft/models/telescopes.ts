/**
 * Hubble and Webb, to scale.
 *
 * Hubble body axes: +x along the telescope towards the aperture, +z the solar panels' sunny face
 * (the attitude model turns +z to the Sun), +y along the panel masts.
 * Webb body axes: +x the way the telescope looks (V1), +z from the sunshield up to the telescope
 * (V3, away from the Sun), +y across the shield (V2). Everything above the shield is flagged as
 * permanently shaded, because the shader does not cast shadows.
 */
import { assemble, mat, MeshBuilder, tint, type CraftModel, type Material, type V3 } from './kit';

const SILVER = mat(0xd4d6da, 0.8);
const SILVER_DARK = mat(0xa9acb2, 0.7);
const GOLD_FOIL = mat(0xd9a441, 0.75);
const METAL = mat(0x8e9096, 0.5);
const BLACK = mat(0x17181b, 0.3);
const CELL = mat(0x1b2a55, 0.6);
const CELL_BACK = mat(0xb08a4a, 0.3);
const WHITE = mat(0xe6e6e2, 0.15);

/** Hubble: 13.2 m long, 4.3 m aft shroud, 3.1 m forward shell, two 7.1 m × 2.6 m rigid arrays. */
export function buildHubble(): CraftModel {
  const b = new MeshBuilder();
  // Aft shroud and bulkhead.
  b.cyl([-6.6, 0, 0], [-2.7, 0, 0], 2.14, 2.14, 16, SILVER, { cap0: SILVER_DARK });
  b.cyl([-6.75, 0, 0], [-6.6, 0, 0], 1.2, 1.2, 12, METAL);
  // Equipment section ring, then the forward shell and light shield.
  b.cyl([-2.7, 0, 0], [-1.6, 0, 0], 2.14, 1.6, 16, SILVER_DARK);
  b.cyl([-1.6, 0, 0], [6.6, 0, 0], 1.53, 1.53, 16, SILVER, { cap1: false });
  for (const x of [-1.2, 1.4, 3.9]) b.cyl([x, 0, 0], [x + 0.18, 0, 0], 1.57, 1.57, 16, SILVER_DARK);
  b.cyl([6.4, 0, 0], [6.6, 0, 0], 1.6, 1.6, 16, SILVER_DARK, { cap1: false });
  // Looking down the tube: dark.
  b.cyl([6.3, 0, 0], [6.58, 0, 0], 1.5, 1.5, 16, BLACK, { cap0: false });
  // Aperture door, open, hinged on the -z side so that it shades the tube from the Sun's side.
  const hinge: V3 = [6.6, 0, -1.55];
  const doorDir: V3 = [0.97, 0, -0.25];
  const dc: V3 = [hinge[0] + doorDir[0] * 1.55, 0, hinge[2] + doorDir[2] * 1.55];
  const ring: V3[] = [];
  for (let k = 0; k < 14; k++) {
    const a = (2 * Math.PI * k) / 14;
    ring.push([
      dc[0] + doorDir[0] * 1.55 * Math.cos(a),
      1.55 * Math.sin(a),
      dc[2] + doorDir[2] * 1.55 * Math.cos(a),
    ]);
  }
  b.polygon(ring, SILVER, SILVER_DARK);
  // Solar arrays on masts along ±y, long side parallel to the tube, cells towards +z.
  for (const s of [1, -1]) {
    b.strut([0.6, s * 1.5, 0], [0.6, s * 2.5, 0], 0.07, METAL);
    for (let k = 0; k < 5; k++) {
      const x = 0.6 - 3.55 + 0.71 + 1.42 * k;
      b.panel([x, s * 3.8, 0], [0.69, 0, 0], [0, 1.3, 0], tint(CELL, k % 2 ? 1 : 1.25), CELL_BACK);
    }
    b.strut([-2.95, s * 3.8, 0], [4.15, s * 3.8, 0], 0.05, METAL);
  }
  // High-gain antennas on booms along ±z.
  for (const s of [1, -1]) {
    b.strut([1.5, 0, s * 1.5], [1.5, 0, s * 4.2], 0.04, METAL);
    b.dish([1.5, 0, s * 4.2], [0, 0, s], 0.65, 0.15, 12, 2, WHITE, METAL);
  }
  // Handrails and bay doors as a few bright panels on the aft shroud.
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI * k) / 3 + 0.3;
    const r = 2.16;
    b.panel(
      [-4.6, r * Math.cos(a), r * Math.sin(a)],
      [1.2, 0, 0],
      [0, -0.55 * Math.sin(a), 0.55 * Math.cos(a)],
      k % 2 ? GOLD_FOIL : WHITE,
    );
  }
  return assemble([{ name: 'hubble', mesh: b.build(), pivot: [0, 0, 0] }]);
}

/** Outline of the sunshield in the x-y plane (21.2 m × 14.2 m), counter-clockwise seen from +z. */
const KITE: [number, number][] = [
  [10.6, 0.7],
  [0.4, 7.08],
  [-1.0, 7.08],
  [-10.6, 0.7],
  [-10.6, -0.7],
  [-1.0, -7.08],
  [0.4, -7.08],
  [10.6, -0.7],
];

/** Flat-to-flat size of one primary mirror segment, m. */
export const SEGMENT = 1.32;

/** Centres (y, z offsets from the mirror centre) of the 18 segments: two hexagonal rings. */
export function segmentCentres(): [number, number][] {
  const R = SEGMENT / Math.sqrt(3);
  const out: [number, number][] = [];
  for (let q = -2; q <= 2; q++)
    for (let r = -2; r <= 2; r++) {
      if (Math.abs(q + r) > 2 || (q === 0 && r === 0)) continue;
      out.push([1.5 * R * q, SEGMENT * (r + q / 2)]);
    }
  return out;
}

/** Webb: five-layer kite sunshield, bus and solar panel below, 6.5 m segmented mirror above. */
export function buildJwst(): CraftModel {
  const b = new MeshBuilder();
  const shade = (m: Material): Material => ({ ...m, shaded: true });
  const HOT = mat(0xc9a3c4, 0.75); // the Sun-facing layer's silicon coating reads pink-violet
  const FILM = shade(mat(0xcfd1d6, 0.8));
  const GOLD = shade(mat(0xf2c14e, 1));
  const BACKPLANE = shade(mat(0x1d1d20, 0.2));
  // Sunshield: layer 0 faces the Sun, each next one is a little smaller so the stack shows at the rim.
  for (let k = 0; k < 5; k++) {
    const z = -1.15 + 0.27 * k;
    const s = 1 - 0.035 * k;
    const pts = KITE.map(([x, y]): V3 => [x * s, y * s, z]);
    // The membranes are stretched between the tips: facets from the centre, alternately tinted.
    const centre: V3 = [0, 0, z];
    pts.forEach((p, i) => {
      const q = pts[(i + 1) % pts.length];
      const shadeOf = (1 - 0.05 * (4 - k)) * (i % 2 ? 1 : 0.86);
      b.tri(centre, p, q, tint(FILM, shadeOf));
      b.tri(centre, q, p, tint(k === 0 ? HOT : FILM, i % 2 ? 1 : 0.9));
    });
  }
  // Spreader bars at the two tips and the mid-booms.
  for (const s of [1, -1]) {
    b.strut([s * 9.4, 0, -1.2], [s * 9.4, 0, 0], 0.06, shade(METAL));
    b.strut([-0.3, s * 6.4, -1.2], [-0.3, s * 6.4, 0], 0.06, shade(METAL));
  }
  // Spacecraft bus, solar panel, antenna and trim flap on the hot side.
  b.box([0, 0, -2.3], [1.6, 1.6, 1.05], GOLD_FOIL);
  b.panel([-4.4, 0, -3.1], [2.9, 0, -0.5], [0, -1.15, 0], CELL, CELL_BACK);
  b.strut([-1.6, 0, -2.9], [-2.0, 0, -2.95], 0.06, METAL);
  b.strut([1.0, 0.8, -3.35], [1.0, 0.8, -3.9], 0.05, METAL);
  b.dish([1.0, 0.8, -3.9], [0, 0, -1], 0.6, 0.12, 12, 2, WHITE, METAL);
  b.panel([-11.3, 0, -1.9], [0, 1.0, 0], [-0.55, 0, -0.85], SILVER);
  b.strut([-10.6, 0, -1.15], [-11.0, 0, -1.4], 0.05, METAL);
  // Tower and instrument module behind the mirror.
  const zc = 4.7;
  const xm = 0.45;
  b.cyl([0, 0, 0], [0, 0, 1.6], 0.5, 0.5, 8, shade(METAL));
  b.box([-1.0, 0, zc - 0.9], [0.95, 1.35, 1.7], shade(mat(0x4a4338, 0.5)));
  b.box([xm - 0.2, 0, zc], [0.12, 2.6, 2.6], BACKPLANE);
  b.panel([-2.0, 0, zc - 0.6], [0, 1.2, 0], [0, 0, 1.3], shade(mat(0x101012, 0.2)));
  // Primary mirror: 18 gold hexagons, flat edges up and down, a 7 mm gap widened so it reads.
  const R = (SEGMENT / Math.sqrt(3)) * 0.955;
  for (const [cy, cz] of segmentCentres()) {
    const pts: V3[] = [];
    for (let k = 0; k < 6; k++) {
      const a = (Math.PI * k) / 3;
      pts.push([xm, cy + R * Math.cos(a), zc + cz + R * Math.sin(a)]);
    }
    b.polygon(pts, GOLD, BACKPLANE);
  }
  // Aft optics cone at the centre, secondary mirror 7.2 m ahead on its tripod.
  b.cyl([xm, 0, zc], [xm + 1.3, 0, zc], 0.42, 0.3, 10, BACKPLANE);
  const sec: V3 = [xm + 7.2, 0, zc];
  b.cyl(sec, [sec[0] + 0.15, 0, zc], 0.37, 0.37, 12, BACKPLANE, { cap0: GOLD });
  b.strut([xm, 0, zc + 3.25], sec, 0.05, BACKPLANE);
  b.strut([xm, 2.7, zc - 2.6], sec, 0.05, BACKPLANE);
  b.strut([xm, -2.7, zc - 2.6], sec, 0.05, BACKPLANE);
  return assemble([{ name: 'jwst', mesh: b.build(), pivot: [0, 0, 0] }]);
}
