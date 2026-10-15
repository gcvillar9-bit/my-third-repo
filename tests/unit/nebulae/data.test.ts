import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { LUX_MAG0 } from '../../../src/core/photometry';
import { gnomonic, type NebulaMeta } from '../../../src/modules/nebulae/model';
import { luminanceFromMu, muFromLuminance } from '../../../src/modules/nebulae/photometry';
import orion from '../../../src/modules/nebulae/orion.json';

/**
 * The shipped build products (tools/build-nebulae.mjs): registration residuals and the photometric calibration,
 * measured by decoding the WebP the shader reads with the same decode (L = lRef · Σ v^ENC).
 */
const ROOT = new URL('../../../', import.meta.url).pathname;
const meta = JSON.parse(readFileSync(`${ROOT}public/data/nebulae/orion-meta.json`, 'utf8')) as NebulaMeta & {
  registration: {
    stellarium: { maxResidualPx: number; limitPx: number; stars: { px: number }[] };
    hubble: { targets: { px: number }[] } | null;
  };
};
const ARCSEC = Math.PI / 180 / 3600;

let N = 0;
let L: Float64Array;
beforeAll(async () => {
  const { data, info } = await sharp(`${ROOT}public/data/nebulae/orion-emission.webp`)
    .raw()
    .toBuffer({ resolveWithObject: true });
  N = info.width;
  L = new Float64Array(N * N);
  for (let i = 0; i < N * N; i++) {
    let s = 0;
    for (let k = 0; k < 3; k++) s += (data[i * info.channels + k] / 255) ** meta.emission.encodeExp;
    L[i] = s * meta.emission.lRef;
  }
});

/** Pixel centre (continuous coordinates) of a sky position in the emission grid (north up, east left). */
function pixelOf(raDeg: number, decDeg: number): [number, number] {
  const [xi, eta] = gnomonic(raDeg, decDeg);
  const x = meta.field.xiMax;
  return [(1 - xi / x) * 0.5 * N, (1 - eta / x) * 0.5 * N];
}

/** Integrated V magnitude inside a circle (arcmin), optionally excluding another circle. */
function apertureV(cx: number, cy: number, rArcmin: number, ex?: [number, number, number]): number {
  const px = (2 * meta.field.xiMax) / ARCSEC / N;
  const omega = (px * ARCSEC) ** 2;
  let t = 0;
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const d = (Math.hypot(i + 0.5 - cx, j + 0.5 - cy) * px) / 60;
      if (d > rArcmin) continue;
      if (ex && (Math.hypot(i + 0.5 - ex[0], j + 0.5 - ex[1]) * px) / 60 <= ex[2]) continue;
      t += L[j * N + i] * omega;
    }
  return -2.5 * Math.log10(t / LUX_MAG0);
}

describe('nebulae build products', () => {
  it('registers the Stellarium image within 3 px on at least 5 catalogue stars', () => {
    const reg = meta.registration.stellarium;
    expect(reg.stars.length).toBeGreaterThanOrEqual(5);
    expect(reg.limitPx).toBe(orion.registration.maxResidualPx);
    for (const s of reg.stars) expect(s.px).toBeLessThanOrEqual(3);
    expect(reg.maxResidualPx).toBeLessThanOrEqual(3);
  });

  it('registers the Hubble core map from the Trapezium stars (or skips it)', () => {
    const h = meta.registration.hubble;
    if (!h) {
      expect(meta.core).toBeNull();
      return;
    }
    expect(h.targets.length).toBeGreaterThanOrEqual(3);
    for (const t of h.targets) expect(t.px).toBeLessThanOrEqual(3);
    expect(meta.core!.xiMax).toBeLessThan(meta.field.xiMax);
  });

  it('is calibrated to V = 4.0 total, a 16.5 mag/arcsec² core and M43 near V 9', () => {
    const [cx, cy] = pixelOf(orion.center.raDeg, orion.center.decDeg);
    const nu = orion.stars.find((s) => s.id === 'nu-ori')!;
    const [mx, my] = pixelOf(nu.raDeg, nu.decDeg);
    const ph = orion.photometry;
    const total = apertureV(cx, cy, ph.totalApertureArcmin, [mx, my, ph.m43ApertureArcmin]);
    expect(Math.abs(total - ph.totalV)).toBeLessThanOrEqual(0.1);
    const m43 = apertureV(mx, my, ph.m43ApertureArcmin);
    expect(Math.abs(m43 - ph.m43V)).toBeLessThanOrEqual(0.7);
    // Core: the brightest disk of radius coreRadiusArcmin within 4' of θ¹ Ori C.
    const px = (2 * meta.field.xiMax) / ARCSEC / N;
    const r = (ph.coreRadiusArcmin * 60) / px;
    const R = Math.ceil(r);
    const search = Math.ceil(240 / px);
    let best = 0;
    for (let y = Math.floor(cy - search); y <= cy + search; y++)
      for (let x = Math.floor(cx - search); x <= cx + search; x++) {
        let s = 0;
        let n = 0;
        for (let j = -R; j <= R; j++)
          for (let i = -R; i <= R; i++) {
            if (i * i + j * j > r * r) continue;
            s += L[(y + j) * N + x + i];
            n++;
          }
        best = Math.max(best, s / n);
      }
    expect(Math.abs(muFromLuminance(best) - ph.coreMuV)).toBeLessThanOrEqual(0.3);
  });

  it('converts surface brightness both ways (16.5 mag/arcsec² = 0.027 cd/m²)', () => {
    expect(luminanceFromMu(16.5)).toBeCloseTo(0.027, 3);
    expect(muFromLuminance(luminanceFromMu(21.3))).toBeCloseTo(21.3, 10);
  });

  it('keeps the shipped data small', () => {
    const bytes = ['orion-emission.webp', 'orion-maps.webp', 'orion-core.webp', 'orion-meta.json'].reduce(
      (s, f) => s + readFileSync(`${ROOT}public/data/nebulae/${f}`).length,
      0,
    );
    expect(bytes).toBeLessThan(2.5e6);
  });
});
