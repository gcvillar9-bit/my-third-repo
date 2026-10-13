import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Body, HeightFunction } from '../../../src/core/contracts';
import { craterProfile, cratersNear, type CraterParams } from '../../../src/modules/surfaces/craters';
import { createSurfaceHeight, type SurfaceHeightParams } from '../../../src/modules/surfaces/heightfield';
import { Raster, rasterFromPng } from '../../../src/modules/surfaces/raster';
import { SURFACE_BODIES, surfaceHeightSpec, transitionDiameter } from '../../../src/modules/surfaces/specs';
import rasters from '../../../src/modules/surfaces/rasters.json';

const R_MOON = 1737400;
const deg = Math.PI / 180;

const dir = (latDeg: number, lonDeg: number): [number, number, number] => [
  Math.cos(latDeg * deg) * Math.cos(lonDeg * deg),
  Math.cos(latDeg * deg) * Math.sin(lonDeg * deg),
  Math.sin(latDeg * deg),
];

function sampleOne(fn: HeightFunction, d: [number, number, number], level: number): number {
  const out = new Float64Array(1);
  fn.sample(Float64Array.from(d), out, 1, level);
  return out[0];
}

const moonCraters: CraterParams = {
  seed: 12345,
  density: 0.06,
  dMax: 4000,
  dMin: 1,
  transitionD: 15000,
  degrade: 0.7,
};

describe('crater field', () => {
  it('has a cumulative size-frequency slope of -2 +- 0.2', () => {
    const cap = 8000;
    const list = cratersNear(moonCraters, R_MOON, R_MOON, 0, 0, cap, 20);
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i <= 10; i++) {
      const D = 20 * 2 ** (i / 2);
      const n = list.filter((c) => c.D > D).length;
      expect(n).toBeGreaterThan(10);
      xs.push(Math.log10(D));
      ys.push(Math.log10(n));
    }
    const mx = xs.reduce((a, b) => a + b) / xs.length;
    const my = ys.reduce((a, b) => a + b) / ys.length;
    let sxy = 0;
    let sxx = 0;
    for (let i = 0; i < xs.length; i++) {
      sxy += (xs[i] - mx) * (ys[i] - my);
      sxx += (xs[i] - mx) ** 2;
    }
    const slope = sxy / sxx;
    expect(slope).toBeGreaterThan(-2.2);
    expect(slope).toBeLessThan(-1.8);
    // Absolute density: N(>100 m) = C * 100^-2 per m^2 over the cap area, within Poisson + edge noise.
    const expected = (moonCraters.density / 1e4) * Math.PI * cap * cap;
    const n100 = list.filter((c) => c.D > 100).length;
    expect(n100 / expected).toBeGreaterThan(0.85);
    expect(n100 / expected).toBeLessThan(1.15);
  });

  it('gives bowls with raised rims, and central peaks only above the simple-complex transition', () => {
    const p = { ...moonCraters, degrade: 0 };
    const simple = 2000;
    expect(craterProfile(p, simple, 1, 0)).toBeCloseTo(-0.2 * simple, 6);
    expect(craterProfile(p, simple, 1, 1)).toBeCloseTo(0.04 * simple, 6);
    expect(craterProfile(p, simple, 1, 0)).toBeLessThan(craterProfile(p, simple, 1, 0.3));
    expect(craterProfile(p, simple, 1, 1.5)).toBeGreaterThan(0);
    expect(craterProfile(p, simple, 1, 2.6)).toBe(0);
    const complex = 60000;
    expect(craterProfile(p, complex, 1, 0)).toBeGreaterThan(craterProfile(p, complex, 1, 0.3));
    // Transition scales as 1/g: 15 km on the Moon, ~6.6 km on Mercury/Mars.
    expect(transitionDiameter(1.62)).toBeCloseTo(15000, 6);
    expect(transitionDiameter(3.7)).toBeCloseTo(6568, 0);
  });
});

describe('surface height function', () => {
  // Synthetic raster: smooth longitude/latitude pattern, so seams would show as jumps.
  const W = 256;
  const H = 128;
  const data = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const lon = ((x + 0.5) / W) * 2 * Math.PI - Math.PI;
      const lat = Math.PI / 2 - ((y + 0.5) / H) * Math.PI;
      data[y * W + x] = 1000 * Math.cos(lat) * Math.sin(3 * lon) + 500 * Math.sin(lat);
    }
  const params: SurfaceHeightParams = {
    bodyId: 'test',
    radius: R_MOON,
    seed: 7,
    raster: { path: '', offsetM: 0, stepM: 1, minM: -1500, maxM: 1500 },
    craters: { ...moonCraters, dMax: 16000 },
    fbm: { lambda0: 8000, a0: 60, hurst: 0.85 },
    maxAbs: 20000,
  };
  const fn = createSurfaceHeight(params, { height: new Raster(W, H, data) });

  it('is deterministic and independent of the batch (identical heights on shared tile edges)', () => {
    const n = 64;
    const dirs = new Float64Array(3 * n);
    for (let i = 0; i < n; i++) dirs.set(dir(10 + i * 1e-4, 20), 3 * i);
    const all = new Float64Array(n);
    fn.sample(dirs, all, n, 14);
    const fn2 = createSurfaceHeight(params, { height: new Raster(W, H, data) });
    for (let i = 0; i < n; i += 7) {
      const one = new Float64Array(1);
      fn2.sample(dirs.subarray(3 * i, 3 * i + 3), one, 1, 14);
      expect(one[0]).toBe(all[i]);
    }
  });

  it('is continuous across the date line and over the poles', () => {
    for (const level of [0, 8, 16]) {
      const a = sampleOne(fn, dir(20, 180 - 1e-7), level);
      const b = sampleOne(fn, dir(20, -180 + 1e-7), level);
      expect(Math.abs(a - b)).toBeLessThan(0.05);
      const n1 = sampleOne(fn, dir(90 - 1e-7, 10), level);
      const n2 = sampleOne(fn, dir(90 - 1e-7, 190), level);
      expect(Math.abs(n1 - n2)).toBeLessThan(0.05);
    }
  });

  it('changes smoothly between neighbouring vertices (no tile seams in the raster sampling)', () => {
    const level = 12;
    let prev = sampleOne(fn, dir(5, 30), level);
    for (let i = 1; i < 200; i++) {
      const h = sampleOne(fn, dir(5, 30 + i * 2e-5), level);
      expect(Math.abs(h - prev)).toBeLessThan(30); // 0.6 m steps
      prev = h;
    }
  });
});

describe('real rasters (public/data/surfaces)', () => {
  const load = (key: 'moon' | 'mars' | 'earth') => {
    const r = rasters[key];
    return rasterFromPng(readFileSync(resolve('public', r.path)), r.offsetM, r.stepM);
  };
  const at = (r: Raster, lat: number, lon: number, cell: number, radius: number) =>
    r.sample(lon / 360 + 0.5, 0.5 - lat / 180, cell, radius);

  it('Moon: Tycho is a 3-6 km deep bowl', () => {
    const moon = load('moon');
    const [la0, lo0] = [-43.31, -11.36];
    const k = 1 / Math.cos(la0 * deg);
    let floor = Infinity;
    let rim = 0;
    for (let a = 0; a < 8; a++) {
      const [s, c] = [Math.sin((a * Math.PI) / 4), Math.cos((a * Math.PI) / 4)];
      let crest = -Infinity;
      for (let r = 0.2; r <= 1.8; r += 0.1) {
        const h = at(moon, la0 + r * s, lo0 + r * c * k, 1000, R_MOON);
        if (r <= 0.6) floor = Math.min(floor, h);
        if (r >= 1) crest = Math.max(crest, h);
      }
      rim += crest / 8;
    }
    expect(rim - floor).toBeGreaterThan(3000);
    expect(rim - floor).toBeLessThan(6500);
  });

  it('Mars: Olympus Mons stands > 15 km above Hellas', () => {
    const mars = load('mars');
    const olympus = at(mars, 18.65, -133.8, 1000, 3396190);
    const hellas = at(mars, -42.4, 70.5, 1000, 3396190);
    expect(olympus - hellas).toBeGreaterThan(15000);
  });

  it('Earth: the Himalaya are high, the Pacific sits at sea level under the ocean mask', () => {
    const spec = surfaceHeightSpec({ id: 'earth', radius: 6378137, gm: 3.986e14 } as Body)!;
    const p = spec.params as SurfaceHeightParams;
    const ocean = rasterFromPng(readFileSync(resolve('public', rasters.earth.oceanPath)), 0, 1 / 255);
    const fn = createSurfaceHeight(p, { height: load('earth'), ocean });
    expect(sampleOne(fn, dir(28.0, 86.9), 10)).toBeGreaterThan(4000);
    expect(sampleOne(fn, dir(0, -150), 10)).toBe(0);
    expect(sampleOne(fn, dir(38.5, -98), 10)).toBeGreaterThan(150);
  });
});

describe('specs', () => {
  it('registers every listed body at priority 5 with a bound covering its heights', () => {
    for (const id of SURFACE_BODIES) {
      const s = surfaceHeightSpec({ id, radius: 1e6, gm: 1e12 } as Body);
      expect(s, id).toBeDefined();
      expect(s!.priority).toBe(5);
      expect(s!.maxAbsHeight).toBeGreaterThan(0);
    }
    expect(surfaceHeightSpec({ id: 'jupiter', radius: 7e7 } as Body)).toBeUndefined();
    const moon = surfaceHeightSpec({ id: 'moon', radius: R_MOON, gm: 4.9e12 } as Body)!;
    expect(moon.maxAbsHeight).toBeGreaterThan(Math.abs(rasters.moon.minM));
    expect(moon.maxAbsHeight).toBeLessThan(25000);
  });
});
