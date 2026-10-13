import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fromHalf, layoutSections, toHalf } from '../../../tools/lib/binary.mjs';
import {
  BV_UNKNOWN,
  FLAG_DIST_UNKNOWN,
  FLAG_NAMED,
  NAME_NONE,
  STARS_HEADER_BYTES,
  decodeStars,
  encodeStars,
} from '../../../tools/lib/stars-format.mjs';

const pub = (p: string) => fileURLToPath(new URL(`../../../public/${p}`, import.meta.url));

interface NamesJson {
  version: number;
  columns: string[];
  rows: [number, number | null, string | null, string | null, number | null, string | null][];
  constellations: Record<string, string>;
}

describe('binary16', () => {
  it('encodes exact values and rounds to nearest even', () => {
    expect(toHalf(1)).toBe(0x3c00);
    expect(toHalf(-2)).toBe(0xc000);
    expect(toHalf(65504)).toBe(0x7bff);
    expect(toHalf(1e6)).toBe(0x7c00);
    expect(toHalf(0)).toBe(0);
    expect(toHalf(2 ** -24)).toBe(1); // smallest subnormal
    expect(toHalf(1 + 2 ** -11)).toBe(0x3c00); // tie -> even
    expect(toHalf(1 + 3 * 2 ** -11)).toBe(0x3c02); // tie -> even (up)
    for (const v of [0.1, -1.46, 4.83, 15.2, 123.4, -5.469, 2 ** -20]) {
      expect(Math.abs(fromHalf(toHalf(v)) - v)).toBeLessThanOrEqual(Math.abs(v) * 2 ** -11 + 2 ** -25);
    }
    expect(Number.isNaN(fromHalf(toHalf(NaN)))).toBe(true);
  });

  it('lays out 4-byte aligned sections after the header', () => {
    const { buffer, offsets } = layoutSections(10, [new Uint8Array(3), new Float32Array([1.5])], (v, off) =>
      v.setUint32(0, off.length, true),
    );
    expect(offsets).toEqual([12, 16]);
    expect(buffer.byteLength).toBe(20);
    expect(new DataView(buffer.buffer, buffer.byteOffset).getFloat32(16, true)).toBe(1.5);
  });
});

describe('stars.bin encoder/decoder round trip', () => {
  it('round-trips synthetic stars within binary16/quantisation precision', () => {
    const stars = [
      {
        x: 1.5,
        y: -2.25,
        z: 1e5,
        absMag: 1.45,
        vx: 12.5,
        vy: -300,
        vz: 0,
        bv: 0.009,
        flags: 3,
        nameIndex: 0,
      },
      { x: -0.001, y: 7, z: 3, absMag: -5.47, vx: 0, vy: 0, vz: 59000, bv: 1.85, flags: 8 },
      { x: 0, y: 0, z: 1, absMag: 15.9, vx: 1, vy: 2, vz: 3, bv: null },
    ];
    const dec = decodeStars(encodeStars(stars, { namesCount: 1 }));
    expect(dec.count).toBe(3);
    expect(dec.headerBytes).toBe(STARS_HEADER_BYTES);
    expect(dec.namesCount).toBe(1);
    expect(dec.epochYear).toBe(2000);
    stars.forEach((s, i) => {
      expect(dec.positions[i * 3]).toBeCloseTo(s.x, 5);
      expect(dec.positions[i * 3 + 1]).toBeCloseTo(s.y, 5);
      expect(dec.positions[i * 3 + 2]).toBeCloseTo(s.z, 1);
      expect(Math.abs(dec.absMag[i] - s.absMag)).toBeLessThan(0.01);
      expect(Math.abs(dec.velocity[i * 3 + 1] - s.vy)).toBeLessThanOrEqual(Math.abs(s.vy) / 1024 + 1e-3);
      if (s.bv == null) expect(dec.bvCode[i]).toBe(BV_UNKNOWN);
      else expect(Math.abs(dec.bv[i] - s.bv)).toBeLessThanOrEqual(dec.bvStep / 2 + 1e-6);
      expect(dec.flags[i]).toBe(s.flags ?? 0);
    });
    expect(dec.nameIndex[1]).toBe(NAME_NONE);
    expect(() => decodeStars(new Uint8Array(64))).toThrow(/magic/);
  });
});

describe('public/data/stars (HYG v4.1)', () => {
  const dec = decodeStars(readFileSync(pub('data/stars/stars.bin')));
  const names = JSON.parse(readFileSync(pub('data/stars/names.json'), 'utf8')) as NamesJson;
  const byProper = (n: string) => {
    const row = names.rows.find((r) => r[2] === n);
    if (!row) throw new Error(`${n} missing from names.json`);
    return row;
  };
  const dist = (i: number) =>
    Math.hypot(dec.positions[i * 3], dec.positions[i * 3 + 1], dec.positions[i * 3 + 2]);
  const raDec = (i: number) => {
    const [x, y, z] = [dec.positions[i * 3], dec.positions[i * 3 + 1], dec.positions[i * 3 + 2]];
    const d = Math.hypot(x, y, z);
    return [((Math.atan2(y, x) * 180) / Math.PI + 360) % 360, (Math.asin(z / d) * 180) / Math.PI];
  };

  it('has ~119k stars, a consistent header and no Sun', () => {
    expect(dec.count).toBeGreaterThan(115_000);
    expect(dec.count).toBeLessThan(125_000);
    expect(dec.namesCount).toBe(names.rows.length);
    expect(names.columns).toEqual(['star', 'hip', 'proper', 'bayer', 'flamsteed', 'con']);
    for (let i = 0; i < dec.count; i++) if (dist(i) < 1e-3) throw new Error(`star ${i} at the origin`);
  });

  it('places Sirius correctly with sane photometry and motion', () => {
    const [i, hip, , bayer, flam, con] = byProper('Sirius');
    expect(i).toBe(0); // brightest star first
    expect([hip, bayer, flam, con]).toEqual([32349, 'α', 9, 'CMa']);
    expect(dist(i)).toBeCloseTo(2.637, 2);
    const [ra, de] = raDec(i);
    expect(ra).toBeCloseTo(101.287, 1);
    expect(de).toBeCloseTo(-16.716, 1);
    expect(dec.absMag[i]).toBeCloseTo(1.454, 2);
    const app = dec.absMag[i] + 5 * Math.log10(dist(i) / 10);
    expect(app).toBeCloseTo(-1.44, 1);
    const v = Math.hypot(dec.velocity[i * 3], dec.velocity[i * 3 + 1], dec.velocity[i * 3 + 2]);
    expect(v).toBeGreaterThan(10); // Sirius moves ~18 km/s relative to the Sun
    expect(v).toBeLessThan(25);
    expect(dec.nameIndex[i]).toBe(0);
    expect(dec.flags[i] & FLAG_NAMED).toBeTruthy();
  });

  it('gives Betelgeuse B-V ~1.85 and Rigel a blue colour', () => {
    const b = byProper('Betelgeuse')[0];
    expect(dec.bv[b]).toBeCloseTo(1.85, 1);
    expect(Math.abs(dec.bv[b] - 1.85)).toBeLessThan(0.02);
    expect(dec.bv[byProper('Rigel')[0]]).toBeLessThan(0);
  });

  it('is sorted brightest first and cross-links names both ways', () => {
    let prev = -Infinity;
    let unsorted = 0;
    for (let i = 0; i < dec.count; i++) {
      const m = dec.absMag[i] + 5 * Math.log10(dist(i) / 10);
      if (m < prev - 0.03) unsorted++; // tolerance: binary16 absMag rounding
      prev = Math.max(prev, m);
    }
    // Sorting uses HYG 'mag'; a handful of HYG rows have absmag inconsistent with mag and dist.
    expect(unsorted).toBeLessThanOrEqual(5);
    names.rows.forEach((r, k) => {
      expect(dec.nameIndex[r[0]]).toBe(k);
      expect(dec.flags[r[0]] & FLAG_NAMED).toBeTruthy();
      if (r[5]) expect(names.constellations[r[5]]).toBeTruthy();
    });
  });

  it('flags HYG placeholder distances and zeroes their velocity', () => {
    let n = 0;
    for (let i = 0; i < dec.count; i++) {
      if (!(dec.flags[i] & FLAG_DIST_UNKNOWN)) continue;
      n++;
      expect(dec.velocity[i * 3] === 0 && dec.velocity[i * 3 + 2] === 0).toBe(true);
    }
    expect(n).toBeGreaterThan(1000);
    expect(n).toBeLessThan(20000);
  });
});
