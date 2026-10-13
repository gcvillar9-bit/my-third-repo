import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Body } from '../../../src/core/contracts';
import { FrameTreeImpl, addStandardFrames } from '../../../src/core/frames';
import { qfromAxisAngle, qrotate, quat, v3dot, v3len, v3normalize, vec3 } from '../../../src/core/math64';
import { parseInstant } from '../../../src/core/time';
import { buildMarsGaleSunset, sunElevation } from '../../../src/modules/atmosphere/bookmarks';
import { atmosphereFrame, selectAtmosphere, stepCounts } from '../../../src/modules/atmosphere/space';
import { SUNVIEW_BODIES } from '../../../src/modules/solar-system/bookmarks';
import type { BodiesFile } from '../../../src/modules/solar-system/data';
import { SolarEphemeris } from '../../../src/modules/solar-system/ephemeris';
import { buildFrameDefs } from '../../../src/modules/solar-system/frames';
import { SUN_RGB } from '../../../src/core/photometry';
import { StaticLutCache } from '../../../src/modules/atmosphere/lut-cache';
import {
  apDepthSlice,
  apSliceDepth,
  buildCpuLuts,
  multiScatterUv,
  skyRadiance,
  skyViewParams,
  skyViewUv,
  transmittance,
  transmittanceParams,
  transmittanceUv,
  type Luts,
} from '../../../src/modules/atmosphere/model';
import {
  ATMOSPHERE_ROWS,
  paramsFromRow,
  physicsHash,
  type AtmosphereParams,
} from '../../../src/modules/atmosphere/params';
import { findSunCrossing } from '../../../src/modules/atmosphere/sun-search';

const DEG = Math.PI / 180;
const R: Record<string, number> = { earth: 6378137, mars: 3396190, venus: 6051800, titan: 2574730 };
const params = (id: string): AtmosphereParams =>
  paramsFromRow(
    ATMOSPHERE_ROWS.find((r) => r.id === id)!,
    R[id],
  );

const lutCache = new Map<string, Luts>();
const luts = (id: string): Luts => {
  if (!lutCache.has(id)) lutCache.set(id, buildCpuLuts(params(id), 16));
  return lutCache.get(id)!;
};

describe('atmosphere parameters', () => {
  it('every row carries sources and sane values', () => {
    for (const row of ATMOSPHERE_ROWS) {
      expect(row.source.length).toBeGreaterThan(5);
      expect(row.rayleigh.source.length).toBeGreaterThan(3);
      expect(row.mie.source.length).toBeGreaterThan(3);
      for (let c = 0; c < 3; c++) expect(row.mie.scattering[c]).toBeLessThanOrEqual(row.mie.extinction[c]);
      expect(row.thicknessM).toBeGreaterThan(0);
    }
    expect(ATMOSPHERE_ROWS.map((r) => r.id).sort()).toEqual(['earth', 'mars', 'titan', 'venus']);
  });

  it('Earth zenith transmittance at 550 nm is 0.85-0.90', () => {
    const p = params('earth');
    const t = transmittance(p, p.bottomKm, 1, 400);
    expect(t[1]).toBeGreaterThan(0.85);
    expect(t[1]).toBeLessThan(0.9);
    // blue is extinguished more than red at the horizon
    const h = transmittance(p, p.bottomKm, 0.02, 400);
    expect(h[2]).toBeLessThan(h[0]);
    // the 40-step LUT integral agrees with the fine one
    expect(transmittance(p, p.bottomKm, 1)[1]).toBeCloseTo(t[1], 2);
  });
});

describe('LUT parameterisations', () => {
  it('transmittance uv round-trips', () => {
    const p = params('earth');
    for (const [u, v] of [
      [0.1, 0.2],
      [0.5, 0.5],
      [0.9, 0.05],
      [0.3, 0.95],
    ]) {
      const [r, mu] = transmittanceParams(p, u, v);
      const [u2, v2] = transmittanceUv(p, r, mu);
      expect(u2).toBeCloseTo(u, 6);
      expect(v2).toBeCloseTo(v, 6);
    }
  });

  it('sky-view uv round-trips above and below the horizon', () => {
    const p = params('mars');
    const h = 0.002;
    const r = p.bottomKm + h;
    for (const [su, sv] of [
      [0.2, 0.1],
      [0.7, 0.45],
      [0.5, 0.7],
      [0.9, 0.95],
    ]) {
      const [vzc, lvc] = skyViewParams(p, r, h, su, sv);
      const [u2, v2] = skyViewUv(p, r, h, sv >= 0.5, vzc, lvc);
      expect(u2).toBeCloseTo(su, 4);
      expect(v2).toBeCloseTo(sv, 4);
    }
  });

  it('aerial-perspective slices are quadratic and invertible', () => {
    const p = params('earth');
    expect(apSliceDepth(p, 32)).toBeCloseTo(p.apMaxKm, 9);
    expect(apSliceDepth(p, 16)).toBeCloseTo(p.apMaxKm / 4, 9);
    expect(apDepthSlice(p, apSliceDepth(p, 7.3))).toBeCloseTo(7.3, 9);
  });

  it('multi-scattering uv lands on texel centres at the range ends', () => {
    const p = params('earth');
    expect(multiScatterUv(p, p.bottomKm, -1)).toEqual([0.5 / 32, 0.5 / 32]);
    const [u, v] = multiScatterUv(p, p.topKm, 1);
    expect(u).toBeCloseTo(1 - 0.5 / 32, 12);
    expect(v).toBeCloseTo(1 - 0.5 / 32, 12);
  });
});

describe('sky colour (CPU twin)', () => {
  const ratio = (L: number[]) => (L[2] * SUN_RGB[2]) / (L[0] * SUN_RGB[0]);

  it('Mars low-Sun sky near the Sun is blue (B/R > 1.1)', () => {
    const p = params('mars');
    const L = skyRadiance(p, luts('mars'), 0.002, 8, 0, 3);
    expect(ratio(L)).toBeGreaterThan(1.1);
  });

  it('Mars sky away from the Sun is butterscotch (B/R < 1)', () => {
    const p = params('mars');
    expect(ratio(skyRadiance(p, luts('mars'), 0.002, 20, 90, 3))).toBeLessThan(1);
    expect(ratio(skyRadiance(p, luts('mars'), 0.002, 30, 180, 40))).toBeLessThan(1);
  });

  it('Earth daytime zenith sky is blue and of plausible luminance', () => {
    const p = params('earth');
    const L = skyRadiance(p, luts('earth'), 0.001, 90, 0, 45);
    expect(L[2]).toBeGreaterThan(1.5 * L[0]);
    const lum = 0.2126 * L[0] + 0.7152 * L[1] + 0.0722 * L[2];
    // per unit illuminance: ~6000 cd/m2 under 1.2e5 lx
    expect(lum).toBeGreaterThan(0.01);
    expect(lum).toBeLessThan(0.2);
  });
});

describe('static LUT cache', () => {
  it('builds once, ignores source-only edits and rebuilds (disposing) on physics changes', () => {
    const disposed: number[] = [];
    let n = 0;
    const cache = new StaticLutCache<number>(
      () => ++n,
      (v) => disposed.push(v),
    );
    const p = params('earth');
    expect(cache.get(p)).toBe(1);
    expect(cache.get({ ...p })).toBe(1);
    expect(cache.get({ ...p, approximate: true, sunTransmittanceInPost: true, apMaxKm: 64 })).toBe(1);
    expect(cache.builds).toBe(1);
    const changed = { ...p, mieG: [0.7, 0.7, 0.7] as [number, number, number] };
    expect(physicsHash(changed)).not.toBe(physicsHash(p));
    expect(cache.get(changed)).toBe(2);
    expect(disposed).toEqual([1]);
    expect(cache.builds).toBe(2);
    expect(cache.peek(p)).toBeUndefined();
    expect(cache.peek(changed)).toBe(2);
    cache.clear();
    expect(disposed).toEqual([1, 2]);
  });
});

describe('sun search', () => {
  it('finds the setting crossing on a synthetic rotating planet', () => {
    // elevation = asin(cos(lat) cos(H)), sidereal day 1.0275 d, lat 20 deg; Sun on the equator
    const lat = (20 * Math.PI) / 180;
    const P = 1.0275;
    const el = (jd: number) => Math.asin(Math.cos(lat) * Math.cos((2 * Math.PI * (jd - 100)) / P));
    const target = (3 * Math.PI) / 180;
    const jd = findSunCrossing(el, 100.1, { target, setting: true })!;
    expect(jd).toBeGreaterThan(100.1);
    expect(el(jd)).toBeCloseTo(target, 8);
    expect(el(jd + 0.001)).toBeLessThan(target);
    const rise = findSunCrossing(el, 100.1, { target, setting: false })!;
    expect(rise).toBeGreaterThan(jd);
    expect(el(rise + 0.001)).toBeGreaterThan(target);
    expect(findSunCrossing(() => -1, 0, { target, setting: true, maxDays: 1 })).toBeNull();
  });
});

describe('atmosphere frame and selection', () => {
  it('maps the camera into atmosphere space (km, ellipsoid scaled to a sphere)', () => {
    const q = qfromAxisAngle(quat(), v3normalize(vec3(), vec3(1, 2, 3)), 0.7);
    // camera 400 km above the north pole: body centre is -z (body axes) from the camera
    const camWorld = qrotate(vec3(), q, vec3(0, 0, 6356752 + 400e3));
    const rel = vec3(-camWorld.x, -camWorld.y, -camWorld.z);
    const sunW = qrotate(vec3(), q, vec3(1.5e11, 0, 0));
    const sunRel = vec3(sunW.x + rel.x, sunW.y + rel.y, sunW.z + rel.z);
    const f = atmosphereFrame(rel, q, 0.003353, sunRel);
    expect(f.cam[0]).toBeCloseTo(0, 6);
    expect(f.cam[1]).toBeCloseTo(0, 6);
    expect(f.cam[2]).toBeCloseTo((6356.752 + 400) / (1 - 0.003353), 6);
    expect(f.sun[0]).toBeCloseTo(1, 9);
    expect(f.sunDist).toBeCloseTo(1.5e11, 0);
    expect(f.camR).toBeCloseTo(Math.hypot(...f.cam), 9);
  });

  it('prefers the atmosphere the camera is in, else the largest on screen above 4 px', () => {
    const pa = 1e-3;
    const earth = { id: 'earth', dist: 6.8e6, topM: 6.478e6 };
    const marsFar = { id: 'mars', dist: 1e11, topM: 3.5e6 };
    expect(selectAtmosphere([marsFar, { ...earth, dist: 6.4e6 }], pa)).toBe('earth');
    expect(selectAtmosphere([marsFar, earth], pa)).toBe('earth');
    expect(selectAtmosphere([marsFar], pa)).toBeNull();
    expect(selectAtmosphere([{ ...earth, dist: 6.478e6 / (2e-3 * 0.5) }], pa)).toBeNull(); // 2 px
  });

  it('scales raymarch steps with the quality knob', () => {
    expect(stepCounts(8)).toEqual({ sky: 24, aerial: 8, march: 24 });
    expect(stepCounts(64)).toEqual({ sky: 64, aerial: 32, march: 48 });
  });
});

describe('mars-gale-sunset bookmark', () => {
  it('stands at Gale crater with the Sun setting through 3 deg, looking at it', () => {
    const rows = (JSON.parse(readFileSync('public/data/solar-system/bodies.json', 'utf8')) as BodiesFile)
      .bodies;
    const eph = new SolarEphemeris(rows);
    const frames = new FrameTreeImpl();
    addStandardFrames(frames);
    for (const f of buildFrameDefs(eph, SUNVIEW_BODIES)) frames.addFrame(f);
    const mars = {
      id: 'mars',
      name: 'Mars',
      kind: 'planet',
      frame: 'mars',
      fixedFrame: 'mars.fixed',
      radius: 3396190,
      influenceRadius: 1e9,
    } as Body;
    const jd0 = parseInstant('2026-01-01T00:00:00Z')!;
    const bm = buildMarsGaleSunset(frames, mars, jd0)!;
    expect(bm.id).toBe('mars-gale-sunset');
    const jd = bm.jd as number;
    expect(jd).toBeGreaterThan(jd0);
    expect(jd - jd0).toBeLessThan(1.1);
    expect(sunElevation(frames, 'mars.fixed', bm.pos, jd) / DEG).toBeCloseTo(3, 4);
    expect(sunElevation(frames, 'mars.fixed', bm.pos, jd + 0.01)).toBeLessThan(3 * DEG);
    expect(v3len(bm.pos) - mars.radius).toBeCloseTo(2, 6);
    const up = v3normalize(vec3(), bm.pos);
    expect(Math.asin(up.z) / DEG).toBeCloseTo(-5.4, 6);
    const fwd = qrotate(vec3(), bm.quat!, vec3(0, 0, -1));
    const sunW = frames.delta('mars.fixed', bm.pos, 'sun', vec3(), jd, vec3());
    const sun = v3normalize(vec3(), frames.fromWorldDir('mars.fixed', sunW, jd, vec3()));
    expect(Math.acos(Math.min(1, v3dot(fwd, sun))) / DEG).toBeCloseTo(5, 0); // Sun 5 deg below centre
  });
});
