import { describe, expect, it } from 'vitest';
import { frankotChellappa } from '../../../tools/lib/fft.mjs';

/** Central-difference slopes (x periodic, y one-sided at the edges). */
function slopes(z: Float64Array, w: number, h: number) {
  const p = new Float64Array(w * h);
  const q = new Float64Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      p[y * w + x] = (z[y * w + ((x + 1) % w)] - z[y * w + ((x - 1 + w) % w)]) / 2;
      const y0 = Math.max(0, y - 1);
      const y1 = Math.min(h - 1, y + 1);
      q[y * w + x] = (z[y1 * w + x] - z[y0 * w + x]) / (y1 - y0);
    }
  return { p, q };
}

function relRms(a: Float64Array, b: Float64Array): number {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i] / n;
    mb += b[i] / n;
  }
  let e = 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    e += (a[i] - ma - (b[i] - mb)) ** 2;
    lo = Math.min(lo, b[i]);
    hi = Math.max(hi, b[i]);
  }
  return Math.sqrt(e / n) / (hi - lo);
}

describe('Frankot-Chellappa (tools/lib/fft.mjs)', () => {
  const w = 256;
  const h = 128;

  it('recovers a synthetic sphere cap plus Gaussian bumps with RMS error < 2% of the relief', () => {
    const z = new Float64Array(w * h);
    const R = 40;
    const a = 30;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const r2 = (x - 80) ** 2 + (y - 64) ** 2;
        let v = r2 < a * a ? Math.sqrt(R * R - r2) - Math.sqrt(R * R - a * a) : 0;
        v -= 12 * Math.exp(-((x - 180) ** 2 + (y - 50) ** 2) / (2 * 12 ** 2)); // a crater-like dip
        v += 5 * Math.exp(-((x - 200) ** 2 + (y - 95) ** 2) / (2 * 6 ** 2));
        z[y * w + x] = v;
      }
    const { p, q } = slopes(z, w, h);
    const rec = frankotChellappa(p, q, w, h);
    expect(relRms(rec, z)).toBeLessThan(0.02);
  });

  it('is linear in the slopes and returns a zero-mean field; regularisation only removes long waves', () => {
    const z = new Float64Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) z[y * w + x] = Math.exp(-((x - 128) ** 2 + (y - 64) ** 2) / (2 * 5 ** 2));
    const { p, q } = slopes(z, w, h);
    const a = frankotChellappa(p, q, w, h);
    const b = frankotChellappa(
      p.map((v) => 3 * v),
      q.map((v) => 3 * v),
      w,
      h,
    );
    let mean = 0;
    for (let i = 0; i < a.length; i++) {
      expect(b[i]).toBeCloseTo(3 * a[i], 9);
      mean += a[i];
    }
    expect(Math.abs(mean / a.length)).toBeLessThan(1e-12);
    // A narrow bump (sigma 5 px) survives a cutoff at w/4 = 64 px almost unchanged.
    const reg = frankotChellappa(p, q, w, h, { lambda: ((2 * Math.PI) / (w / 4)) ** 2 });
    expect(relRms(reg, z)).toBeLessThan(0.03);
  });
});
