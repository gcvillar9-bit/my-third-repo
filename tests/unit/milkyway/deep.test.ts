import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEEP_BUDGET,
  decodeDeepStars,
  deepAbsMag,
  deepBv,
  deepCoord,
  deepPointArrays,
} from '../../../src/modules/milkyway/atlas/deep';

const root = (p: string) => new URL(`../../../${p}`, import.meta.url);
const DATA = 'public/data/milkyway/atlas/';
const file = (name: string) => {
  const b = readFileSync(root(`${DATA}${name}`));
  return decodeDeepStars(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
};
const meta = JSON.parse(readFileSync(root(`${DATA}deep-stars.json`), 'utf8')) as {
  license: string;
  sources: { cite: string; url: string; license: string; stars: number }[];
  count: { a: number; b: number };
  encoding: { s: number; R: number };
  stat: Record<string, number>;
};
const a = file('deep-stars-a.bin');
const b = file('deep-stars-b.bin');

/** Distance from the Sun (pc) and apparent magnitude of star i. */
const star = (f: typeof a, i: number) => {
  const d = Math.hypot(deepCoord(f.x[i], f.s, f.R), deepCoord(f.y[i], f.s, f.R), deepCoord(f.z[i], f.s, f.R));
  const M = deepAbsMag(f.mag[i]);
  return { d, M, m: M + 5 * Math.log10(d / 10) };
};

describe('deep stars', () => {
  it('ships two tiers with their sources and licence', () => {
    expect(a.count).toBe(meta.count.a);
    expect(b.count).toBe(meta.count.b);
    expect(a.count + b.count).toBeGreaterThan(1_000_000);
    expect(meta.sources.map((s) => s.stars).reduce((x, y) => x + y, 0)).toBe(a.count + b.count);
    expect(meta.sources[0].cite).toMatch(/AT-HYG v4\.0/);
    expect(meta.sources[0].license).toBe('CC-BY-SA-4.0');
    expect(meta.sources[1].cite).toMatch(/Zari et al\. 2021/);
    expect(meta.license).toBe('CC-BY-SA-4.0'); // derived from a share-alike catalogue
    for (const s of meta.sources) expect(s.url).toMatch(/^https:\/\//);
    expect([a.s, a.R]).toEqual([meta.encoding.s, meta.encoding.R]);
  });

  it('never repeats a star of the bright-star catalogue or of an open cluster', () => {
    // The build drops rows with a HYG id, Gaia ids of HYG stars, kept cluster members and
    // everything brighter than magnitude 7 (HYG is complete there).
    expect(meta.stat.hyg).toBeGreaterThan(110_000);
    expect(meta.stat.zariInHyg).toBeGreaterThan(1000);
    expect(meta.stat.cluster + meta.stat.zariCluster).toBeGreaterThan(10_000);
    let brightest = 99;
    for (const f of [a, b])
      for (let i = 0; i < f.count; i += 7) brightest = Math.min(brightest, star(f, i).m);
    expect(brightest).toBeGreaterThan(6.8);
  });

  it('sorts each tier from the most to the least luminous star and splits them as documented', () => {
    for (const f of [a, b])
      for (let i = 1; i < f.count; i++) expect(f.mag[i]).toBeGreaterThanOrEqual(f.mag[i - 1]);
    // Tier A: apparent magnitude <= 10 or more luminous than M = -3 (stored to 0.1 mag).
    for (let i = 0; i < a.count; i += 11) {
      const s = star(a, i);
      expect(s.m <= 10.15 || s.M <= -2.95, `a ${i}`).toBe(true);
    }
    for (let i = 0; i < b.count; i += 37) {
      const s = star(b, i);
      expect(s.m).toBeGreaterThan(9.85);
      expect(s.M).toBeGreaterThan(-3.05);
    }
  });

  it('reaches from the solar neighbourhood to the far disc', () => {
    let near = 0;
    let far = 0;
    let max = 0;
    for (const f of [a, b])
      for (let i = 0; i < f.count; i += 5) {
        const { d } = star(f, i);
        if (d < 200) near++;
        if (d > 3000) far++;
        max = Math.max(max, d);
        expect(d).toBeGreaterThan(1);
      }
    expect(near).toBeGreaterThan(10_000);
    expect(far).toBeGreaterThan(5_000); // the hot luminous stars of the young disc
    expect(max).toBeLessThanOrEqual(meta.encoding.R * 1.8);
    // The coordinate encoding keeps 0.1% beyond 10 pc.
    for (const v of [12, 150, 2000, 12000]) {
      const q = Math.round((32767 * Math.log(1 + v / a.s)) / Math.log(1 + a.R / a.s));
      expect(deepCoord(q, a.s, a.R) / v).toBeCloseTo(1, 3);
      expect(deepCoord(-q, a.s, a.R)).toBeCloseTo(-deepCoord(q, a.s, a.R), 9);
    }
  });

  it('turns a prefix of each tier into point arrays within the preset budgets', () => {
    const arrays = deepPointArrays([
      { stars: a, limit: 1000 },
      { stars: b, limit: 500 },
    ]);
    expect(arrays.mag.length).toBe(1500);
    expect(arrays.pos.length).toBe(4500);
    expect(arrays.blob).toBeUndefined();
    // Colours are scaled to a maximum of 255 and the magnitude carries the scale.
    for (let k = 0; k < 1500; k += 97)
      expect(Math.max(arrays.col[3 * k], arrays.col[3 * k + 1], arrays.col[3 * k + 2])).toBe(255);
    expect(arrays.pos[0]).toBeCloseTo(deepCoord(a.x[0], a.s, a.R), 3);
    expect(deepBv(255)).toBe(0.65);
    expect(DEEP_BUDGET.potato[0]).toBeLessThanOrEqual(100_000); // potato point budget
    expect(DEEP_BUDGET.potato[1]).toBe(0);
    expect(DEEP_BUDGET.ultra).toEqual([Infinity, Infinity]);
  });
});
