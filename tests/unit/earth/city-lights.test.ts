import { describe, expect, it } from 'vitest';
import { cityLightFraction, yearOfJd } from '../../../src/modules/earth/city-lights';
import table from '../../../src/modules/earth/city-lights.json';
import { JD_J2000 } from '../../../src/core/units';

describe('city lights through time', () => {
  it('has a source on every row and rises monotonically to today', () => {
    for (const r of table.rows) expect(r.source.length, String(r.year)).toBeGreaterThan(10);
    const f = table.rows.map((r) => r.fraction);
    expect(f).toEqual([...f].sort((a, b) => a - b));
    expect(f[0]).toBe(0);
    expect(f.at(-1)).toBe(1);
  });

  it('is dark before electric lighting and full from the map epoch on', () => {
    expect(cityLightFraction(-66e6)).toBe(0);
    expect(cityLightFraction(1066)).toBe(0);
    expect(cityLightFraction(1880)).toBe(0);
    expect(cityLightFraction(1950)).toBeCloseTo(0.042, 6);
    expect(cityLightFraction(1960)).toBeGreaterThan(0.042);
    expect(cityLightFraction(1960)).toBeLessThan(0.22);
    expect(cityLightFraction(2026)).toBe(1);
    expect(cityLightFraction(1e6)).toBe(1);
    expect(cityLightFraction(NaN)).toBe(0);
    expect(yearOfJd(JD_J2000)).toBe(2000);
  });
});

describe('earth shading city-light uniform', () => {
  it('scales the night map by the date', async () => {
    const { createEarthShading, createEarthUniforms } = await import('../../../src/modules/earth/shading');
    const { CITY_LUMINANCE } = await import('../../../src/modules/solar-system/public');
    const body = { id: 'earth', radius: 6378137, frame: 'earth', fixedFrame: 'earth.fixed' } as never;
    const shading = createEarthShading({
      body,
      textures: { uniforms: {}, ensure() {} } as never,
      shared: createEarthUniforms(body),
      atmosphere: {} as never,
      waves: null as never,
    });
    const view = (jd: number) =>
      ({
        jd,
        timeReal: 0,
        pixelAngle: 1e-3,
        toCamera: (_f: string, _l: unknown, out: { x: number; y: number; z: number }) =>
          Object.assign(out, { x: 2e7, y: 0, z: 0 }),
        frameQuat: (_f: string, q: { x: number; y: number; z: number; w: number }) =>
          Object.assign(q, { x: 0, y: 0, z: 0, w: 1 }),
      }) as never;
    const lum = () => shading.uniforms.uEarthCityLuminance.value as number;
    shading.update!(view(JD_J2000 + 26 * 365.25));
    expect(lum()).toBe(CITY_LUMINANCE);
    shading.update!(view(JD_J2000 - 200 * 365.25));
    expect(lum()).toBe(0);
    shading.update!(view(JD_J2000 - 66e6 * 365.25));
    expect(lum()).toBe(0);
  });
});
