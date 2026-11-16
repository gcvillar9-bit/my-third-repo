import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FeatureFile } from '../../../src/modules/milkyway/atlas/types';
import { MODEL } from '../../../src/modules/milkyway/model';

/**
 * The galaxy model against the measured values of the atlas. Every fact in features-structure.json
 * carries a quote that the atlas build checks against the fetched paper, so a model number that
 * equals a fact is tied to that paper (docs/modules/milkyway.md, 'Model values against the cited papers').
 */
const file = JSON.parse(
  readFileSync(
    new URL('../../../public/data/milkyway/atlas/features-structure.json', import.meta.url),
    'utf8',
  ),
) as FeatureFile;
const feature = (id: string) => {
  const f = file.features.find((x) => x.id === id);
  if (!f) throw new Error(`no structure feature ${id}`);
  return f;
};
const fact = (id: string, label: string) => {
  const f = (feature(id).facts ?? []).find((x) => x.label.startsWith(label));
  if (!f) throw new Error(`${id}: no fact "${label}"`);
  return f.value;
};

describe('milkyway-model.json against the atlas facts', () => {
  it('gives the bulge the axis ratios and the angle of Bland-Hawthorn & Gerhard 2016', () => {
    const b = MODEL.bulge;
    expect(b.y0 / b.x0).toBeCloseTo(fact('bulge', 'Axis ratio seen from above') as number, 9);
    expect(b.z0 / b.x0).toBeCloseTo(fact('bulge', 'Axis ratio seen edge-on') as number, 9);
    expect(MODEL.bar.angleDeg).toBe(fact('bulge', 'Bar angle of the bulge'));
  });

  it('draws the long bar with its measured half-length and names its measured angle range', () => {
    expect(MODEL.bar.halfLength).toBe(fact('long-bar', 'Half-length'));
    // One angle for the bulge and the long bar (model choice): the source names the long bar's own range.
    const [lo, hi] = String(fact('long-bar', 'Angle of the long bar')).match(/\d+/g)!.map(Number);
    expect([lo, hi]).toEqual([28, 33]);
    expect(MODEL.bar.source).toContain(`${lo} to ${hi} deg`);
    expect(lo - MODEL.bar.angleDeg).toBeGreaterThan(0); // below the range: the source must say so
    expect(MODEL.bar.source).toContain(`${lo - MODEL.bar.angleDeg} to ${hi - MODEL.bar.angleDeg} deg below`);
  });

  it('holds the azimuth ranges and widths of Reid et al. 2019 Table 2', () => {
    const arms = file.features.filter((f) => f.shape?.kind === 'log-spiral');
    for (const row of MODEL.arms) {
      const a = arms.find((f) => f.shape?.kind === 'log-spiral' && f.shape.rKinkKpc === row.rKink);
      expect(a, row.segment).toBeDefined();
      if (a?.shape?.kind !== 'log-spiral') continue;
      expect(row.betaMeasured, row.segment).toEqual(a.shape.betaMeasuredDeg);
      expect(row.width, row.segment).toBe(a.shape.widthKpc);
    }
  });

  it('has the disc scales of Bland-Hawthorn & Gerhard 2016 and labels the thick-disc normalisation', () => {
    expect(MODEL.thinDisk.hz * 1000).toBe(fact('thin-disc', 'Scale height'));
    expect(MODEL.thinDisk.hR).toBe(fact('thin-disc', 'Radial scale length'));
    expect(MODEL.thickDisk.hz * 1000).toBe(fact('thick-disc', 'Scale height'));
    expect(MODEL.thickDisk.hR).toBe(fact('thick-disc', 'Radial scale length'));
    // `norm` is a mid-plane density ratio (Juric et al. 2008). The review's two ratios are named in
    // the source so the 12% cannot be read as its surface density ratio again.
    const fRho = fact('thick-disc', 'Thick/thin local density ratio');
    const fSigma = fact('thick-disc', 'Thick/thin surface density ratio');
    expect(MODEL.thickDisk.source).toContain(`f_rho = ${fRho}%`);
    expect(MODEL.thickDisk.source).toContain(`${fSigma}% +- 4% is the surface density ratio`);
    expect(MODEL.thickDisk.source).toMatch(/Juric et al\. 2008/);
    const surfaceRatio = (MODEL.thickDisk.norm * MODEL.thickDisk.hz) / MODEL.thinDisk.hz;
    expect(MODEL.thickDisk.source).toContain(`= ${surfaceRatio.toFixed(2)}`);
  });
});
