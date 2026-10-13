import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildGlobularPoints,
  clusterCentrePc,
  createGlobularInfo,
  createGlobularSearch,
  kingDensity,
  mulberry32,
  sampleKingRadii,
  type GlobularFile,
} from '../../../src/modules/milkyway/globulars';

const file = JSON.parse(
  readFileSync(new URL('../../../public/data/milkyway/globulars.json', import.meta.url), 'utf8'),
) as GlobularFile;

describe('globular clusters', () => {
  it('ships the Celestia/Baumgardt catalogue with sane parameters', () => {
    expect(file.rows.length).toBeGreaterThan(150);
    const tuc = file.rows.find((r) => r[0] === '47 Tuc')!;
    expect(tuc[4]).toBeGreaterThan(4300); // ~4.5 kpc
    expect(tuc[4]).toBeLessThan(4700);
    expect(tuc[6] / tuc[5]).toBeCloseTo(10 ** 2.31, -1); // King concentration c = 2.31
    expect(file.rows.some((r) => r[0].includes('Cen') || r[1].some((a) => a.includes('NGC 5139')))).toBe(
      true,
    );
    for (const r of file.rows) {
      expect(r[5]).toBeGreaterThan(0);
      expect(r[6]).toBeGreaterThan(0); // a few clusters have rt <~ rc in the file; the sampler clamps rt >= 1.5 rc
      expect(r[7]).toBeLessThan(3); // M_V: faint halo clusters reach about +1.2
    }
  });

  it('samples King (1962) radii inside the tidal radius, more concentrated for higher c', () => {
    expect(kingDensity(0, 1, 100)).toBeGreaterThan(kingDensity(1, 1, 100));
    expect(kingDensity(100, 1, 100)).toBe(0);
    const frac = (rc: number, rt: number) => {
      const r = sampleKingRadii(4000, rc, rt, mulberry32(7));
      expect(Math.max(...r)).toBeLessThanOrEqual(rt);
      return r.filter((x) => x < 2 * rc).length / r.length;
    };
    const loose = frac(1, 10 ** 0.8);
    const dense = frac(1, 10 ** 2.3);
    expect(dense).toBeLessThan(loose); // in units of rc the dense cluster has a long envelope
    expect(dense).toBeGreaterThan(0.01);
  });

  it('builds deterministic point clouds that carry the integrated magnitude', () => {
    const rows = file.rows.slice(0, 5);
    const a = buildGlobularPoints(rows, 32, 1);
    const b = buildGlobularPoints(rows, 32, 1);
    expect(a.count).toBe(160);
    expect(Array.from(a.pos)).toEqual(Array.from(b.pos));
    // Sum of point fluxes = cluster flux.
    const flux = Array.from(a.mag.slice(0, 32)).reduce((s, m) => s + 10 ** (-0.4 * m), 0);
    expect(-2.5 * Math.log10(flux)).toBeCloseTo(rows[0][7], 4);
    // Points sit within the tidal radius of their cluster.
    const c = clusterCentrePc(rows[1]);
    for (let i = 32; i < 64; i++) {
      const d = Math.hypot(a.pos[3 * i] - c.x, a.pos[3 * i + 1] - c.y, a.pos[3 * i + 2] - c.z);
      expect(d).toBeLessThanOrEqual(rows[1][6] * 1.0001 + 1e-3);
    }
  });

  it('offers search entries and info cards', async () => {
    const search = createGlobularSearch(file.rows);
    const tuc = search.entries().find((e) => e.name === '47 Tuc')!;
    expect(tuc.kind).toBe('cluster');
    expect(tuc.aliases).toContain('NGC 104');
    const card = await createGlobularInfo(file.rows).info(tuc.id);
    expect(card!.facts.find((f) => f.label === 'Distance')!.value).toBeCloseTo(4.52, 1);
    expect(await createGlobularInfo(file.rows).info('nope')).toBeNull();
  });
});
