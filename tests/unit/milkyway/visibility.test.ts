import { describe, expect, it } from 'vitest';
import type { PointArrays } from '../../../src/modules/milkyway/atlas/points';
import {
  CORE_SIGMA,
  MIN_BLOB_PEAK,
  MIN_PEAK,
  orderByVisibility,
} from '../../../src/modules/milkyway/atlas/visibility';

/** Deterministic pseudo-random numbers in [0, 1). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0), s / 4294967296);
}

function sample(n: number, seed: number): PointArrays {
  const r = lcg(seed);
  const data: PointArrays = {
    pos: new Float32Array(n * 3),
    mag: new Float32Array(n),
    col: new Uint8Array(n * 3),
    blob: new Float32Array(n),
    ext: new Uint8Array(n),
  };
  for (let i = 0; i < n; i++) {
    const d = 3 * Math.pow(10, 4.5 * r());
    const u = 2 * r() - 1;
    const a = 2 * Math.PI * r();
    const s = Math.sqrt(1 - u * u);
    data.pos.set([d * s * Math.cos(a), d * s * Math.sin(a), d * u], 3 * i);
    data.mag[i] = -9 + 22 * r();
    // The colour carries the row number, to check that the columns of a point stay together.
    data.col.set([i & 255, (i >> 8) & 255, 7], 3 * i);
    data.blob![i] = r() < 0.2 ? 5 + 50 * r() : 0;
    data.ext![i] = r() < 0.5 ? 1 : 0;
  }
  return data;
}

/** The brightness cut of points.glsl with no extinction (extinction only dims), camera at `cam` (pc). */
function passes(data: PointArrays, i: number, scale: number, pixelAngle: number, cam: number[]): boolean {
  const d = Math.hypot(data.pos[3 * i] - cam[0], data.pos[3 * i + 1] - cam[1], data.pos[3 * i + 2] - cam[2]);
  const m = data.mag[i] + 5 * Math.log10(d / 10);
  const blob = data.blob![i];
  const sigma = blob > 0 ? Math.hypot(CORE_SIGMA, blob / (d * pixelAngle)) : CORE_SIGMA;
  const peak = (scale * Math.pow(10, -0.4 * m)) / (2 * Math.PI * sigma * sigma);
  return peak >= (blob > 0 ? MIN_BLOB_PEAK : MIN_PEAK);
}

describe('atlas point draw range near the Sun', () => {
  const input = sample(20000, 7);
  const order = orderByVisibility(input);
  const data = order.data;
  const n = data.mag.length;

  it('keeps every point, with its columns together', () => {
    expect(n).toBe(input.mag.length);
    const seen = new Uint8Array(n);
    for (let j = 0; j < n; j++) {
      const i = data.col[3 * j] | (data.col[3 * j + 1] << 8);
      // 20000 rows need more than 16 bits only above 65535, so the row number is exact here.
      expect(seen[i]).toBe(0);
      seen[i] = 1;
      expect(data.mag[j]).toBe(input.mag[i]);
      expect(data.pos[3 * j + 2]).toBe(input.pos[3 * i + 2]);
      expect(data.blob![j]).toBe(input.blob![i]);
      expect(data.ext![j]).toBe(input.ext![i]);
    }
  });

  it('never leaves out a point that passes the brightness cut', () => {
    const c = order.nearPc * 0.999;
    expect(order.nearPc).toBeGreaterThan(0.02);
    const cams = [
      [0, 0, 0],
      [c, 0, 0],
      [0, -c, 0],
      [-c * 0.6, 0, c * 0.8],
    ];
    let partial = 0;
    for (let e = -12; e <= 14; e++) {
      const scale = Math.pow(10, e);
      const count = order.countFor(scale);
      if (count > 0 && count < n) partial++;
      for (const cam of cams)
        for (let j = count; j < n; j++)
          if (passes(data, j, scale, 1e-3, cam)) throw new Error(`point ${j} left out at scale 1e${e}`);
    }
    // The range of scales covers "none", "some" and "all".
    expect(order.countFor(1e-12)).toBe(0);
    expect(order.countFor(1e14)).toBe(n);
    expect(partial).toBeGreaterThan(5);
  });

  it('is tight: few of the points it keeps are below the cut', () => {
    const scale = 1e3;
    const count = order.countFor(scale);
    let pass = 0;
    for (let j = 0; j < count; j++)
      if (passes({ ...data, blob: new Float32Array(n) }, j, scale, 1e-3, [0, 0, 0])) pass++;
    expect(count).toBeGreaterThan(100);
    // Bins of 0.25 mag and a margin of 0.1 mag, and clumps have a cut 2.5 mag lower.
    expect(pass / count).toBeGreaterThan(0.5);
  });

  it('handles an empty layer and a point at the Sun', () => {
    const empty = orderByVisibility({
      pos: new Float32Array(0),
      mag: new Float32Array(0),
      col: new Uint8Array(0),
    });
    expect(empty.countFor(1)).toBe(0);
    const atSun = orderByVisibility({
      pos: new Float32Array([0, 0, 0, 10, 0, 0]),
      mag: new Float32Array([5, 5]),
      col: new Uint8Array(6),
    });
    // No distance from the Sun is "near" when a point sits on it: the layer then draws everything.
    expect(atSun.nearPc).toBe(0);
    expect(atSun.countFor(1e14)).toBe(2);
  });
});
