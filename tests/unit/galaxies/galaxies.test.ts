import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GALACTIC_TO_SUPERGALACTIC, ICRS_TO_GALACTIC, SSB_IN_MW } from '../../../src/core/frames';
import { qrotate } from '../../../src/core/math64';
import { MPC } from '../../../src/core/units';
import {
  decodeGalaxies,
  encodeGalaxies,
  GALAXY_TYPES,
  galaxyQuat,
  galxBytes,
  morphSprite,
  type GalaxyData,
} from '../../../src/modules/galaxies/format';
import { bakeMorphAtlas, MORPH_NAMES } from '../../../src/modules/galaxies/morph';
import { discNormal, galaxyBookmarks, NAMED, named } from '../../../src/modules/galaxies/named';

const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const file = readFileSync(root('public/data/galaxies/galaxies.bin'));
const buf = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
const data = decodeGalaxies(buf);
const names = (
  JSON.parse(readFileSync(root('public/data/galaxies/names.json'), 'utf8')) as { names: string[] }
).names;

const mul = (m: readonly number[], v: number[]) => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];
/** Sun position in the universe frame, Mpc (independent of the build tool's copies). */
const SUN = mul(GALACTIC_TO_SUPERGALACTIC, [SSB_IN_MW.x / MPC, SSB_IN_MW.y / MPC, SSB_IN_MW.z / MPC]);
const posOf = (d: GalaxyData, i: number) => [d.pos[3 * i], d.pos[3 * i + 1], d.pos[3 * i + 2]];
const distSun = (p: number[]) => Math.hypot(p[0] - SUN[0], p[1] - SUN[1], p[2] - SUN[2]);
const D = Math.PI / 180;

describe('galaxies.bin (GALX v1)', () => {
  it('holds the Celestia catalogue minus the Milky Way (10,937 within 2%)', () => {
    expect(Math.abs(data.count - 10_937) / 10_937).toBeLessThan(0.02);
    expect(buf.byteLength).toBe(galxBytes(data.count));
    expect(names.length).toBe(data.count);
    expect(names.some((n) => n.split(':').includes('Milky Way'))).toBe(false);
    let minDist = Infinity;
    for (let i = 0; i < data.count; i++) minDist = Math.min(minDist, Math.hypot(...posOf(data, i)));
    expect(minDist).toBeGreaterThan(0.01); // nothing at the Galactic centre (closest: dwarfs ~ 20+ kpc)
    for (let i = 0; i < data.count; i++) expect(data.type[i]).toBeLessThan(GALAXY_TYPES.length);
  });

  it('puts M31 at 0.77 Mpc (+-10%) along its ICRS direction', () => {
    const m31 = named('m31');
    expect(names[data.nameIdx[m31.index]]).toContain('M 31');
    const p = posOf(data, m31.index);
    expect(Math.abs(distSun(p) - 0.77) / 0.77).toBeLessThan(0.1);
    // Independent transform with src/core/frames.ts: RA 00h42m44.3s, Dec +41d16m09s.
    const ra = 10.6846 * D;
    const dec = 41.2692 * D;
    const icrs = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
    const sg = mul(GALACTIC_TO_SUPERGALACTIC, mul(ICRS_TO_GALACTIC, icrs));
    const dir = [p[0] - SUN[0], p[1] - SUN[1], p[2] - SUN[2]].map((x) => x / distSun(p));
    expect(Math.acos(Math.min(1, sg[0] * dir[0] + sg[1] * dir[1] + sg[2] * dir[2])) / D).toBeLessThan(0.05);
    // Disc inclination to our line of sight ~77 deg.
    const n = discNormal(m31);
    const c = Math.abs(n.x * dir[0] + n.y * dir[1] + n.z * dir[2]);
    expect(Math.acos(c) / D).toBeGreaterThan(74);
    expect(Math.acos(c) / D).toBeLessThan(80);
  });

  it('places the named galaxies at catalogue distances', () => {
    const expectMpc: Record<string, [number, number]> = {
      lmc: [0.045, 0.055],
      smc: [0.055, 0.067],
      m33: [0.8, 0.95],
      m81: [3.4, 3.9],
      m87: [15, 18],
      cena: [3.2, 4],
    };
    for (const [id, [lo, hi]] of Object.entries(expectMpc)) {
      const g = named(id);
      const d = distSun(posOf(data, g.index));
      expect(d, id).toBeGreaterThan(lo);
      expect(d, id).toBeLessThan(hi);
      expect(Math.abs(d - g.distSunMpc), id).toBeLessThan(1e-3);
    }
    expect(NAMED).toHaveLength(10);
  });

  it('round-trips through the reference encoder byte for byte', () => {
    const again = new Uint8Array(encodeGalaxies(data));
    expect(Buffer.from(again).equals(file)).toBe(true);
    const small: GalaxyData = {
      count: 3,
      pos: new Float32Array([1, 2, 3, -4, 5, -6, 0.5, 0.25, 600]),
      radiusKpc: new Float32Array([10, 20, 1.5]),
      absMag: new Float32Array([-20, -18.5, -22]),
      quat: new Int8Array([0, 0, 0, 127, 127, 0, 0, 0, 64, 64, 64, 64]),
      nameIdx: new Uint16Array([0, 65535, 2]),
      type: new Uint8Array([0, 11, 15]),
    };
    const back = decodeGalaxies(encodeGalaxies(small));
    expect(Array.from(back.pos)).toEqual(Array.from(small.pos));
    expect(Array.from(back.quat)).toEqual(Array.from(small.quat));
    expect(Array.from(back.nameIdx)).toEqual([0, 65535, 2]);
    expect(Array.from(back.type)).toEqual([0, 11, 15]);
    expect(galaxyQuat(back, 2).map((x) => x.toFixed(3))).toEqual(['0.500', '0.500', '0.500', '0.500']);
  });

  it('stores unit quaternions and maps every type to a morphology sprite', () => {
    const q = [0, 0, 0, 0];
    for (let i = 0; i < data.count; i += 97) {
      galaxyQuat(data, i, q);
      expect(Math.hypot(...q)).toBeCloseTo(1, 6);
      const raw = Math.hypot(
        data.quat[4 * i],
        data.quat[4 * i + 1],
        data.quat[4 * i + 2],
        data.quat[4 * i + 3],
      );
      expect(Math.abs(raw / 127 - 1)).toBeLessThan(0.03);
    }
    expect(GALAXY_TYPES.map((_, t) => MORPH_NAMES[morphSprite(t)])).toEqual([
      'E',
      'E',
      'E',
      'E',
      'E',
      'E',
      'E',
      'E',
      'S0',
      'Sa',
      'Sa',
      'Sc',
      'SBb',
      'SBb',
      'SBb',
      'Irr',
    ]);
  });
});

describe('morphology atlas', () => {
  it('bakes six flux-normalised sprites with dark tile borders', () => {
    const a = bakeMorphAtlas(32);
    expect(a.width).toBe(96);
    expect(a.height).toBe(64);
    expect(a.gains).toHaveLength(6);
    for (let k = 0; k < 6; k++) {
      const x0 = (k % 3) * 32;
      const y0 = Math.floor(k / 3) * 32;
      let sum = 0;
      let border = 0;
      for (let j = 0; j < 32; j++)
        for (let i = 0; i < 32; i++) {
          const p = 4 * ((y0 + j) * 96 + x0 + i);
          const v = ((a.data[p] / 255) ** 2 + (a.data[p + 1] / 255) ** 2) * a.gains[k];
          sum += v;
          if (i === 0 || j === 0 || i === 31 || j === 31) border = Math.max(border, a.data[p], a.data[p + 1]);
        }
      expect(sum / 1024, MORPH_NAMES[k]).toBeGreaterThan(0.9);
      expect(sum / 1024, MORPH_NAMES[k]).toBeLessThan(1.1);
      expect(border, MORPH_NAMES[k]).toBe(0);
    }
  });
});

describe('galaxy bookmarks', () => {
  it('frames Andromeda at about a third of the view and Virgo from 5 Mpc', () => {
    const [m31b, local, virgo] = galaxyBookmarks();
    expect(m31b.id).toBe('m31-approach');
    const m31 = named('m31');
    const toGal = m31.pos.map((x, i) => x * MPC - [m31b.pos.x, m31b.pos.y, m31b.pos.z][i]);
    const dist = Math.hypot(...toGal);
    const hfov = 2 * Math.atan(Math.tan(m31b.fovY! / 2) * (16 / 9));
    expect((2 * Math.atan((m31.radiusKpc * 3.0856775814913673e19) / dist)) / hfov).toBeCloseTo(1 / 3, 1);
    // The camera looks at M31: rotated -Z points along the line of sight.
    const fwd = qrotate({ x: 0, y: 0, z: 0 }, m31b.quat!, { x: 0, y: 0, z: -1 });
    expect((fwd.x * toGal[0] + fwd.y * toGal[1] + fwd.z * toGal[2]) / dist).toBeGreaterThan(0.9999);
    expect(local.id).toBe('local-group');
    // Milky Way, M31, M33 and the Magellanic Clouds all inside the 16:9 frustum.
    const q = local.quat!;
    const qi = { x: -q.x, y: -q.y, z: -q.z, w: q.w };
    const tanV = Math.tan(local.fovY! / 2);
    for (const p of [[0, 0, 0], ...['m31', 'm33', 'lmc', 'smc'].map((id) => named(id).pos)]) {
      const c = qrotate({ x: 0, y: 0, z: 0 }, qi, {
        x: p[0] * MPC - local.pos.x,
        y: p[1] * MPC - local.pos.y,
        z: p[2] * MPC - local.pos.z,
      });
      expect(c.z).toBeLessThan(0);
      expect(Math.abs(c.y / c.z)).toBeLessThan(0.9 * tanV);
      expect(Math.abs(c.x / c.z)).toBeLessThan(0.9 * tanV * (16 / 9));
    }
    const m87 = named('m87');
    expect(virgo.id).toBe('virgo-cluster');
    expect(
      Math.hypot(
        m87.pos[0] * MPC - virgo.pos.x,
        m87.pos[1] * MPC - virgo.pos.y,
        m87.pos[2] * MPC - virgo.pos.z,
      ) / MPC,
    ).toBeCloseTo(5, 3);
  });
});
