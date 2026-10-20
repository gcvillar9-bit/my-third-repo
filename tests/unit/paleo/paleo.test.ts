import { readFileSync } from 'node:fs';
import { decode } from 'fast-png';
import { describe, expect, it } from 'vitest';
import { yearsBeforePresent } from '../../../src/core/geotime';
import { FOLD_PERIOD_DAYS, foldJd } from '../../../src/core/time';
import { JD_J2000 } from '../../../src/core/units';
import {
  bakeSurface,
  fitMoisture,
  maritimeAt,
  moisture,
  paletteFrom,
  temperatureC,
} from '../../../src/modules/paleo/biome';
import { middayNear, onFoldedDay } from '../../../src/modules/paleo/bookmarks';
import {
  bracketAges,
  gmstAt,
  regimeAt,
  seaLevelAt,
  vegetationAt,
  type PaleoIndex,
} from '../../../src/modules/paleo/climate';
import {
  DEM_H,
  DEM_W,
  MAX_COAST_KM,
  coastDistanceKm,
  decodeElevation,
  sampleField,
  seaAlongRow,
  sliceFields,
} from '../../../src/modules/paleo/fields';
import { PALEO_PRIORITY, PaleoController, createPaleoShading } from '../../../src/modules/paleo/shading';
import sites from '../../../src/modules/paleo/sites.json';
import paleoGlsl from '../../../src/modules/paleo/glsl/paleo-surface.glsl?raw';
import earthGlsl from '../../../src/modules/earth/glsl/shading-earth.glsl?raw';

const index = JSON.parse(readFileSync('public/data/paleo/index.json', 'utf8')) as PaleoIndex;
const grey = (age: number) =>
  decode(readFileSync(`public/data/paleo/dem/${String(age).padStart(3, '0')}.png`)).data as Uint8Array;
const cell = (lat: number, lon: number) => Math.round(89.5 - lat) * DEM_W + Math.round(lon + 179.5);

describe('paleo data and time model', () => {
  it('has 109 maps every 5 Myr with sources', () => {
    expect(index.dem.ages.length).toBe(109);
    expect(index.dem.ages[0]).toBe(0);
    expect(index.dem.ages.at(-1)).toBe(540);
    for (const b of index.biomes) expect(b.source).toMatch(/Blue Marble/);
    for (const v of index.vegetation) expect(v.source.length).toBeGreaterThan(20);
    expect(index.dem.source).toMatch(/CC BY 4\.0/);
  });

  it('brackets ages between maps and holds the ends', () => {
    expect(bracketAges(index.dem.ages, 66)).toEqual({ a: 65, b: 70, w: 0.2 });
    expect(bracketAges(index.dem.ages, 0)).toEqual({ a: 0, b: 0, w: 0 });
    expect(bracketAges(index.dem.ages, 600)).toEqual({ a: 540, b: 540, w: 0 });
  });

  it('follows the ice ages and the long-term climate', () => {
    expect(seaLevelAt(index, 21e3)).toBeLessThan(-115);
    expect(seaLevelAt(index, 21e3)).toBeGreaterThan(-130);
    expect(seaLevelAt(index, 0)).toBe(0);
    expect(seaLevelAt(index, 5e6)).toBe(0);
    expect(gmstAt(index, 0)).toBeCloseTo(14, 0);
    expect(gmstAt(index, 90)).toBeGreaterThan(20); // Cretaceous greenhouse
    expect(gmstAt(index, 600)).toBe(index.climate.rows.at(-1)!.gmstC);
    expect(vegetationAt(index, 500).plants).toBe(0); // bare rock before land plants
    expect(vegetationAt(index, 430).forests).toBe(0);
    expect(vegetationAt(index, 100)).toEqual({ plants: 1, forests: 1, grass: 0 });
  });

  it('picks the look by age', () => {
    expect(regimeAt(index, 100)).toEqual({ synthetic: 0, seaDropM: 0, quaternary: 0 });
    const lgm = regimeAt(index, 21e3);
    expect(lgm.synthetic).toBe(0);
    expect(lgm.quaternary).toBe(1);
    expect(lgm.seaDropM).toBeGreaterThan(115);
    expect(regimeAt(index, 66e6)).toEqual({ synthetic: 1, seaDropM: 0, quaternary: 0 });
    const pliocene = regimeAt(index, 3.8e6);
    expect(pliocene.synthetic).toBeGreaterThan(0.3);
    expect(pliocene.synthetic).toBeLessThan(0.7);
  });
});

describe('paleo fields', () => {
  it('decodes the build encoding', () => {
    expect(decodeElevation(128, 11000)).toBe(0);
    expect(decodeElevation(255, 11000)).toBeCloseTo(11000, 6);
    expect(decodeElevation(1, 11000)).toBeCloseTo(-11000, 6);
  });

  it('measures signed coast distances symmetrically', () => {
    const land = new Uint8Array(DEM_W * DEM_H);
    for (let y = 0; y < DEM_H; y++) for (let x = 0; x < 180; x++) land[y * DEM_W + x] = 1; // west half land
    const d = coastDistanceKm(land);
    const k = 90 * DEM_W + 179; // land next to the coast at the equator
    expect(d[k]).toBeGreaterThan(100);
    expect(d[k]).toBeLessThan(120);
    expect(d[k + 1]).toBeCloseTo(-d[k], 3);
    expect(d[90 * DEM_W + 90]).toBe(MAX_COAST_KM); // saturates far inland
    const east = seaAlongRow(land, new Float32Array(DEM_W * DEM_H), 1);
    expect(east.km[k]).toBeGreaterThan(50);
    expect(east.km[k]).toBeLessThan(60);
  });

  it('keeps the bookmark sites true to the maps', () => {
    for (const s of sites.sites) {
      if (s.ageMa < 1 || s.id === 'earth-dusk-66ma') continue;
      const then = grey(s.ageMa)[cell(s.latDeg, s.lonDeg)];
      const now = grey(0)[cell(s.latDeg, s.lonDeg)];
      if (s.id === 'earth-pangaea-250ma') {
        expect(then, s.id).toBeGreaterThanOrEqual(128);
        expect(now, s.id).toBeLessThan(128);
      } else {
        // A shallow sea between two land masses, closed by 70 Ma.
        const m90 = grey(90);
        const e = decodeElevation(then, index.dem.elevationScaleM);
        expect(e, s.id).toBeLessThan(0);
        expect(e, s.id).toBeGreaterThan(-600);
        const landWithin = (dir: number) =>
          [1, 2, 3, 4, 5, 6].some((k) => m90[cell(s.latDeg, s.lonDeg + dir * k)] >= 128);
        expect(landWithin(-1), `${s.id} west`).toBe(true);
        expect(landWithin(1), `${s.id} east`).toBe(true);
        expect(grey(70)[cell(s.latDeg, s.lonDeg)], s.id).toBeGreaterThanOrEqual(128);
        expect(now, s.id).toBeLessThan(256);
      }
    }
  });
});

describe('paleo biomes', () => {
  const today = sliceFields(grey(0), index.dem.elevationScaleM);
  const target = decode(readFileSync('public/data/paleo/modern_moisture.png')).data as Uint8Array;
  const weights = fitMoisture(today, target, 14);
  const m = (lat: number, lon: number) => {
    const k = cell(lat, lon);
    return moisture(weights, lat, maritimeAt(today, k), temperatureC(lat, today.elev[k], 14));
  };

  it('has a plausible temperature profile', () => {
    expect(temperatureC(0, 0, 14)).toBeCloseTo(27, 6);
    expect(temperatureC(90, 0, 14)).toBeCloseTo(-12, 6);
    expect(temperatureC(30, 4500, 14)).toBeGreaterThan(-10); // Tibet: not an ice sheet
    expect(temperatureC(80, 0, 30)).toBeGreaterThan(5); // greenhouse poles
  });

  it('fits a moisture model that tells rainforest from desert today', () => {
    expect(m(-3.5, -60.5)).toBeGreaterThan(0.45); // Amazon
    expect(m(0.5, 22.5)).toBeGreaterThan(0.45); // Congo
    expect(m(50.5, 10.5)).toBeGreaterThan(0.35); // Germany
    expect(m(23.5, 10.5)).toBeLessThan(0.2); // Sahara
    expect(m(-25.5, 133.5)).toBeLessThan(0.25); // central Australia
    expect(m(-3.5, -60.5)).toBeGreaterThan(m(23.5, 10.5) + 0.3);
  });

  it('bakes south-first RGBA with water in alpha', () => {
    const w = 64;
    const h = 32;
    const out = bakeSurface({
      a: today,
      b: today,
      w: 0,
      gmstC: 14,
      veg: vegetationAt(index, 0),
      palette: paletteFrom(index.biomes),
      moistureWeights: weights,
      width: w,
      height: h,
    });
    const at = (lat: number, lon: number) => {
      const y = Math.floor(((lat + 90) / 180) * h);
      const x = Math.floor(((lon + 180) / 360) * w);
      return out.slice((y * w + x) * 4, (y * w + x) * 4 + 4);
    };
    expect(at(0, -170)[3]).toBe(255); // Pacific: water
    expect(at(20, 15)[3]).toBe(0); // Sahara: land
    expect(at(20, 15)[0]).toBeGreaterThan(at(20, 15)[2]); // desert is red-yellow
    expect(at(-80, 0)[0]).toBeGreaterThan(200); // Antarctic ice
  });
});

describe('paleo shading and bookmarks', () => {
  it('wraps the earth shading with the paleo hooks and no reserved uniforms', () => {
    const base = {
      bodyId: 'earth',
      priority: 10,
      glsl: '/* earth */',
      uniforms: { uEarthDay: { value: null }, uEarthCloudZonal: { value: 0 } },
      defines: { SURFACE_DETAIL_MASK: 1 },
      update: () => {},
    };
    const ctl = new PaleoController({} as never, base.uniforms.uEarthCloudZonal);
    const s = createPaleoShading(base, ctl);
    expect(s.priority).toBe(PALEO_PRIORITY);
    expect(s.defines).toMatchObject({ EARTH_PALEO: 1, SURFACE_DETAIL_MASK: 1 });
    expect(s.uniforms.uEarthDay).toBe(base.uniforms.uEarthDay);
    expect(s.glsl).toContain('void earthPaleoSurface(');
    for (const name of Object.keys(ctl.uniforms)) expect(name).toMatch(/^uPaleo/);
    for (const name of ['uExposure', 'uFade', 'uSunPos', 'uMorph', 'uDetailOrigin'])
      expect(paleoGlsl).not.toMatch(new RegExp(`uniform\\s+\\w+\\s+${name}\\s*;`));
    // The earth shading only calls the hooks under EARTH_PALEO.
    expect(earthGlsl.match(/#ifdef EARTH_PALEO/g)?.length).toBe(3);
  });

  it('stays idle (today’s look) in the present and the recent past', () => {
    const zonal = { value: 0.5 };
    const ctl = new PaleoController({} as never, zonal);
    ctl.update(JD_J2000 + 26 * 365.25);
    expect(ctl.uniforms.uPaleoMix.value).toBe(0);
    expect(ctl.uniforms.uPaleoSeaDrop.value).toBe(0);
    expect(zonal.value).toBe(0);
  });

  it('puts deep dates on the wanted folded day with the time of day kept', () => {
    const deep = JD_J2000 - 250e6 * 365.25;
    const jd = onFoldedDay(deep, 355);
    expect(foldJd(jd) - JD_J2000).toBeCloseTo(355, 4);
    expect(Math.abs(jd - deep)).toBeLessThanOrEqual(FOLD_PERIOD_DAYS / 2);
    expect(Math.abs(yearsBeforePresent(jd) - (250e6 - 50))).toBeLessThanOrEqual(2.01); // J2000 is 50 yr after 1950
    // Midday search finds the maximum of a smooth daily curve.
    const noon = middayNear((t) => Math.cos(2 * Math.PI * (t - 0.3)), 0);
    expect(noon).toBeCloseTo(0.3, 2);
  });

  it('samples fields bilinearly with longitude wrap', () => {
    const f = new Float32Array(DEM_W * DEM_H);
    f[90 * DEM_W] = 10;
    f[90 * DEM_W + DEM_W - 1] = 20;
    expect(sampleField(f, -0.5, -180)).toBeCloseTo(15, 6); // between the last and the first column
  });
});
