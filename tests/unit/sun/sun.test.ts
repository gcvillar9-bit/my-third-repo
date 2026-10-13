import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SUN_DISK_LUMINANCE, SUN_TEFF } from '../../../src/core/photometry';
import {
  GRAN_MEAN,
  GRAN_STD,
  NET_MEAN,
  coronaBrightness,
  diskLuminance,
  granuleRaw,
  limbCoefficients,
  limbDiskMean,
  limbProfile,
  networkRaw,
  worley,
} from '../../../src/modules/sun/photometry';
import { starSurface } from '../../../src/modules/sun/public';

const GLSL = readFileSync(new URL('../../../src/modules/sun/glsl/photosphere.glsl', import.meta.url), 'utf8');

describe('sun photometry', () => {
  it('Neckel limb darkening: I(1) = 1, darker at the limb and in the blue', () => {
    for (const lam of [0.45, 0.55, 0.65]) {
      expect(limbCoefficients(lam).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
      expect(limbProfile(1, lam)).toBeCloseTo(1, 10);
    }
    expect(limbProfile(0.5, 0.55)).toBeGreaterThan(0.66);
    expect(limbProfile(0.5, 0.55)).toBeLessThan(0.76);
    expect(limbProfile(0.1, 0.45)).toBeLessThan(limbProfile(0.1, 0.65));
    const m = limbDiskMean(0.55);
    expect(m).toBeGreaterThan(0.75);
    expect(m).toBeLessThan(0.86);
  });

  it('disk luminance scales with Teff and matches the Sun', () => {
    expect(diskLuminance(SUN_TEFF) / SUN_DISK_LUMINANCE).toBeCloseTo(1, 10);
    expect(diskLuminance(10000)).toBeGreaterThan(5 * SUN_DISK_LUMINANCE);
    expect(diskLuminance(3500)).toBeLessThan(0.1 * SUN_DISK_LUMINANCE);
  });

  it('Baumbach corona is ~1e-6 of the disk near the limb and falls steeply', () => {
    expect(coronaBrightness(1)).toBeGreaterThan(3e-6);
    expect(coronaBrightness(1)).toBeLessThan(5e-6);
    expect(coronaBrightness(2) / coronaBrightness(1.1)).toBeLessThan(0.05);
  });

  it('granulation field statistics match the constants baked into the shader', () => {
    let s = 0;
    let s2 = 0;
    let n = 0;
    let net = 0;
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32) * 400 - 200;
    for (let i = 0; i < 6000; i++) {
      const p: [number, number, number] = [rnd(), rnd(), rnd()];
      const g = granuleRaw(worley(p, 1234 + i, 110, 70));
      s += g;
      s2 += g * g;
      net += networkRaw(worley(p, 0, 1, 1));
      n++;
    }
    const mean = s / n;
    const std = Math.sqrt(s2 / n - mean * mean);
    expect(Math.abs(mean - GRAN_MEAN)).toBeLessThan(0.015);
    expect(Math.abs(std / GRAN_STD - 1)).toBeLessThan(0.08);
    expect(Math.abs(net / n / NET_MEAN - 1)).toBeLessThan(0.1);
    for (const [k, v] of [
      ['GRAN_MEAN', GRAN_MEAN],
      ['GRAN_STD', GRAN_STD],
      ['NET_MEAN', NET_MEAN],
    ] as const)
      expect(GLSL).toContain(`#define ${k} ${v}`);
  });

  it('starSurface builds a priority-10 shading with a normalised disk mean', () => {
    const sh = starSurface(5772, 6.957e8, { bodyId: 'hip:1' });
    expect(sh.bodyId).toBe('hip:1');
    expect(sh.priority).toBe(10);
    expect(sh.glsl).toContain('vec3 shadeSurface(SurfaceInput s)');
    const i0 = sh.uniforms.uStarI0.value as { y: number };
    expect(i0.y * limbDiskMean(0.55)).toBeGreaterThan(0.8 * SUN_DISK_LUMINANCE);
    expect(i0.y * limbDiskMean(0.55)).toBeLessThan(1.3 * SUN_DISK_LUMINANCE);
  });
});
