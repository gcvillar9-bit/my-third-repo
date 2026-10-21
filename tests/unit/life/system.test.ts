import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModuleContext, Quatd, Vec3d, ViewState } from '../../../src/core/contracts';
import { jdFromYearsBP } from '../../../src/core/geotime';
import { JD_J2000 } from '../../../src/core/units';
import { siteDirection } from '../../../src/modules/atmosphere/public';
import { TOWNS_FROM_YEAR } from '../../../src/modules/cities/public';
import { loadCities, monumentsNear, setAssets as setCityAssets } from '../../../src/modules/cities/state';
import { citiesAt, jdOfAstroYear, type CityData } from '../../../src/modules/cities/data';
import monumentsData from '../../../src/modules/cities/monuments.json';
import { SURFACE, type ClimateMap } from '../../../src/modules/paleo/public';
import { setActiveController } from '../../../src/modules/paleo/shading';
import { setActiveSystem } from '../../../src/modules/terrain/public';
import { buildingsAround, localEN, townAt, type Herd, type Town } from '../../../src/modules/life/population';
import {
  LIMITS,
  LifeSystem,
  groundClimate,
  monumentRange,
  orderHerds,
  townYearKey,
  townsAround,
} from '../../../src/modules/life/system';

const M_PER_DEG = 111_195;
const R_EARTH = 6_378_137;

describe('townYearKey (the date step of towns and buildings)', () => {
  it('changes wherever the towns do (cities: a decade before 1800, a year after)', () => {
    const citiesKey = (y: number) => (y < 1800 ? Math.round(y / 10) * 10 : Math.round(y));
    expect(townYearKey(1955)).not.toBe(townYearKey(2025));
    expect(townYearKey(1325)).not.toBe(townYearKey(1315)); // Tenochtitlan's founding
    for (let y = TOWNS_FROM_YEAR; y < 2100; y += 0.37)
      if (citiesKey(y) !== citiesKey(y + 0.37)) expect(townYearKey(y)).not.toBe(townYearKey(y + 0.37));
  });

  it('changes on the whole years where monuments and walls switch', () => {
    expect(townYearKey(1452.6)).not.toBe(townYearKey(1453.2)); // Hagia Sophia becomes a mosque
    expect(townYearKey(1799.7)).not.toBe(townYearKey(1800.2)); // town walls end
  });

  it('is one key before the first towns (no re-picks while the clock runs in deep time)', () => {
    expect(townYearKey(-10_000)).toBe(townYearKey(-66e6));
    expect(Number.isFinite(townYearKey(-7100))).toBe(true);
  });
});

describe('townsAround', () => {
  const town = (id: string, de: number, dn: number, radiusM: number): Town => ({
    id,
    name: id,
    lat: 45 + dn / M_PER_DEG,
    lon: 10 + de / (M_PER_DEG * Math.cos((45 * Math.PI) / 180)),
    pop: 1e5,
    style: 'medieval-european',
    radiusM,
  });

  it('keeps towns whose houses are within the building radius (ultra: 2.2 km, not herdRadius + 500)', () => {
    // Edge 1.8 km away: the old herdRadius + 500 range (1.6 km on ultra) dropped its houses.
    const t = town('a', 2100, 0, 300);
    expect(townsAround([t], 45, 10, LIMITS.ultra).built).toEqual([t]);
  });

  it('keeps town centres (landmarks) within 4x the building radius', () => {
    // Potato: 4 x 450 m = 1.8 km; a 250 m town 1.7 km away shows its temple.
    const t = town('b', 0, 1700, 250);
    expect(townsAround([t], 45, 10, LIMITS.potato).built).toEqual([t]);
    expect(townsAround([town('c', 0, 2200, 250)], 45, 10, LIMITS.potato).built).toEqual([]);
  });

  it('passes every town that has a building in range (walls past the edge, landmarks off the centre)', () => {
    // Cameras on rings around one town (at 45 N 10 E), across the band where its last buildings drop out.
    const cases: { t: Town; year: number; q: string; from: number; to: number }[] = [
      // A walled town: the wall ring stands about 30 m past the edge (potato: 450 m building radius).
      { t: { ...town('walled', 0, 0, 2000), pop: 4e4 }, year: 1500, q: 'potato', from: 2380, to: 2620 },
      // A metro: its second and third towers stand 60-80 m off the centre (potato: landmarks to 1.8 km).
      {
        t: { ...town('metro', 0, 0, 1200), pop: 3e6, style: 'modern' },
        year: 2020,
        q: 'potato',
        from: 1700,
        to: 1940,
      },
      {
        t: { ...town('metro', 0, 0, 900), pop: 2e6, style: 'modern' },
        year: 2020,
        q: 'ultra',
        from: 8700,
        to: 8940,
      },
    ];
    let seen = 0;
    for (const { t, year, q, from, to } of cases) {
      const lim = LIMITS[q];
      for (let a = 0; a < 360; a += 30)
        for (let d = from; d <= to; d += 15) {
          const s = Math.sin((a * Math.PI) / 180);
          const c = Math.cos((a * Math.PI) / 180);
          const lat = t.lat + (d * c) / M_PER_DEG;
          const lon = t.lon + (d * s) / (M_PER_DEG * Math.cos((t.lat * Math.PI) / 180));
          const { built } = townsAround([t], lat, lon, lim);
          const pick = (towns: Town[]) => buildingsAround(lat, lon, towns, [], year, lim.buildingRadius, 1e6);
          const want = pick([t]);
          expect(pick(built)).toEqual(want);
          seen += want.length ? 1 : 0;
        }
    }
    expect(seen).toBeGreaterThan(20); // the bands do hold buildings
  });

  it('finds the town (farmland ring) for every herd a pick can place, wherever the camera stands', () => {
    const lim = LIMITS.potato;
    const big = town('london', 0, 0, 5000);
    const small = town('village', 7000, 300, 600);
    const all = [big, small];
    // Herd points out to the corner of the square of herd cells (cellsAround) around each camera.
    const reach = Math.SQRT2 * lim.herdRadius;
    for (let k = 0; k < 400; k++) {
      const ce = 14_000 * Math.sin(k * 1.7) - 2000;
      const cn = 9000 * Math.cos(k * 2.3);
      const camLat = 45 + cn / M_PER_DEG;
      const camLon = 10 + ce / (M_PER_DEG * Math.cos((45 * Math.PI) / 180));
      const { near } = townsAround(all, camLat, camLon, lim);
      for (let j = 0; j < 8; j++) {
        const a = (j / 8) * 2 * Math.PI;
        const hLat = camLat + (reach * Math.sin(a)) / M_PER_DEG;
        const hLon = camLon + (reach * Math.cos(a)) / (M_PER_DEG * Math.cos((camLat * Math.PI) / 180));
        expect(townAt(near, hLat, hLon)?.town.id).toBe(townAt(all, hLat, hLon)?.town.id);
      }
    }
  });

  it('measures the farmland ring from the town centre (a big town at high latitude)', () => {
    // A 28 km metro at 56 N: across 45 km the camera's east-west scale is off by about 1%.
    const lim = LIMITS.potato;
    const t: Town = { ...town('metro', 0, 0, 28_000), lat: 55.75, lon: 37.62, style: 'modern' };
    // The corners of the square of herd cells: half a cell past the radius, and 30% of a cell of jitter.
    const corner = lim.herdRadius + 0.8 * 240;
    for (let a = 0; a < 360; a += 3)
      for (let d = 1.6 * t.radiusM - 1500; d <= 1.6 * t.radiusM + 1500; d += 50) {
        const camLat = t.lat + (d * Math.cos((a * Math.PI) / 180)) / M_PER_DEG;
        const camLon =
          t.lon + (d * Math.sin((a * Math.PI) / 180)) / (M_PER_DEG * Math.cos((t.lat * Math.PI) / 180));
        const { near } = townsAround([t], camLat, camLon, lim);
        for (const [se, sn] of [
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
        ]) {
          const hLat = camLat + (sn * corner) / M_PER_DEG;
          const hLon = camLon + (se * corner) / (M_PER_DEG * Math.cos((camLat * Math.PI) / 180));
          expect(townAt(near, hLat, hLon)?.town.id).toBe(townAt([t], hLat, hLon)?.town.id);
        }
      }
  });
});

describe('monumentRange', () => {
  it('reaches every monument standing in for a landmark the pick draws (no swap on approach)', () => {
    // A monument in town replaces the style landmark of its kind, drawn out to 4x the building radius.
    const data = JSON.parse(readFileSync('public/data/cities/cities.json', 'utf8')) as CityData;
    const rows = monumentsData.monuments as {
      name: string;
      lat: number;
      lon: number;
      from: number;
      end?: number;
    }[];
    const astro = (y: number) => (y < 0 ? y + 1 : y);
    const isMonument = (b: { lat: number; lon: number }) =>
      rows.some((m) => m.lat === b.lat && m.lon === b.lon);
    let cases = 0;
    for (const q of ['potato', 'ultra']) {
      const lim = LIMITS[q];
      for (const m of rows) {
        const from = astro(m.from);
        const last = m.end === undefined ? 2025 : astro(m.end) - 1;
        for (const year of [from + 0.5, last + 0.5]) {
          const jd = jdOfAstroYear(year);
          for (const t of citiesAt(data, Math.floor(year))) {
            const [e, n] = localEN(t.lat, t.lon, m.lat, m.lon);
            const d = Math.hypot(e, n);
            if (d > t.radiusM) continue;
            // The camera at the edge of the centre landmark's range, on the side away from the monument.
            const s = (4 * lim.buildingRadius - 1) / Math.max(d, 1e-9);
            const lat = t.lat - (n * s) / M_PER_DEG;
            const lon = t.lon - (e * s) / (M_PER_DEG * Math.cos((t.lat * Math.PI) / 180));
            const pick = (rangeM: number) =>
              buildingsAround(
                lat,
                lon,
                [t],
                monumentsNear(lat, lon, jd, rangeM),
                year,
                lim.buildingRadius,
                1e6,
              ).filter((b) => !isMonument(b));
            expect(pick(monumentRange(lim)), `${m.name} in ${t.name} (${q})`).toEqual(pick(1e5));
            cases++;
          }
        }
      }
    }
    expect(cases).toBeGreaterThan(20);
  });
});

describe('orderHerds', () => {
  const herd = (key: string, de: number, dn: number): Herd =>
    ({
      key,
      lat: dn / M_PER_DEG,
      lon: de / M_PER_DEG,
      members: [],
      species: { id: key },
    }) as unknown as Herd;

  it('puts the hand-placed herds first, then the nearest (the creature cap drops the farthest)', () => {
    const list = [
      herd('1,1,0', 300, 0),
      herd('featured:far', 0, 85),
      herd('0,0,0', -20, -20),
      herd('featured:near', 0, 14),
      herd('2,2,0', 0, 120),
    ];
    expect(orderHerds(list, 0, 0).map((h) => h.key)).toEqual([
      'featured:near',
      'featured:far',
      '0,0,0',
      '2,2,0',
      '1,1,0',
    ]);
  });
});

describe('groundClimate', () => {
  // Two cells: west of Greenwich `kind0`, east `kind1` (25 C, moist).
  const map = (kind0: number, kind1: number, modern = true): ClimateMap => ({
    key: 'k',
    ageMa: 0.021,
    modern,
    width: 2,
    height: 1,
    data: new Uint8Array([kind0, 85, 120, 128, kind1, 85, 120, 128]),
  });

  it('keeps exposed shelves land: no terrain demotion (the terrain has no bathymetry)', () => {
    const aboveSea = vi.fn(() => 0);
    expect(groundClimate(map(SURFACE.shelf, SURFACE.land), 54.5, -2, aboveSea).kind).toBe(SURFACE.shelf);
    expect(aboveSea).not.toHaveBeenCalled();
  });

  it('still turns land at sea level into water and dry ground the map calls sea into land', () => {
    const m = map(SURFACE.sea, SURFACE.land);
    expect(groundClimate(m, 10, 5, () => 0).kind).toBe(SURFACE.sea);
    expect(groundClimate(m, 10, 5, () => 30).kind).toBe(SURFACE.land);
    expect(groundClimate(m, 10, -5, () => 30).kind).toBe(SURFACE.land);
    expect(groundClimate(m, 10, -5, () => 0).kind).toBe(SURFACE.sea);
  });

  it('leaves deep time to the paleo map', () => {
    const aboveSea = vi.fn(() => 0);
    expect(groundClimate(map(SURFACE.sea, SURFACE.land, false), 10, 5, aboveSea).kind).toBe(SURFACE.land);
    expect(aboveSea).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------
// The system on fakes: paleo climate, terrain heights, assets, and a view standing on the ground.
// ---------------------------------------------------------------------------------------------

/** A uniform warm savanna (deep-time map: the terrain does not decide the coast). */
function savanna(): ClimateMap {
  const width = 8;
  const height = 4;
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([SURFACE.land, 85, 89, 128], i * 4);
  return { key: 's', ageMa: 0, modern: false, width, height, data };
}

interface Rig {
  sys: LifeSystem;
  terrain: { h: number; gen: number };
  resolveOcc: () => void;
}

function rig(opts: { occPending?: boolean } = {}): Rig {
  const terrain = { h: 0, gen: 1 };
  setActiveSystem({
    heightAt: () => (terrain.gen ? terrain.h : null),
    heightGeneration: () => terrain.gen,
  } as never);
  const map = savanna();
  setActiveController({ climate: () => Promise.resolve(map) } as never);
  let resolveOcc = () => {};
  const occ = opts.occPending
    ? new Promise((res) => (resolveOcc = () => res({ species: {} })))
    : Promise.resolve({ species: {} });
  const ctx = {
    assets: { json: () => occ, track: <T>(p: Promise<T>) => p },
    registry: { body: () => ({ radius: R_EARTH, oblateness: 0 }) },
    render: { uniforms: { uExposure: { value: 1 } } },
    quality: {},
  } as unknown as Pick<ModuleContext, 'assets' | 'registry' | 'render' | 'quality'>;
  return { sys: new LifeSystem(ctx), terrain, resolveOcc };
}

/** A view standing `alt` m above the ground at (lat, lon), body axes = world axes. */
function view(
  lat: number,
  lon: number,
  jd: number,
  timeReal: number,
  quality = 'potato',
  alt = 2,
): ViewState {
  const up = siteDirection(lat, lon);
  const cam = { x: up.x * (R_EARTH + alt), y: up.y * (R_EARTH + alt), z: up.z * (R_EARTH + alt) };
  return {
    jd,
    timeReal,
    dtReal: 1 / 60,
    quality,
    nearestSurface: () => ({ bodyId: 'earth', altitude: alt }),
    toCamera: (_f: string, l: Vec3d, out: Vec3d) => {
      out.x = l.x - cam.x;
      out.y = l.y - cam.y;
      out.z = l.z - cam.z;
      return out;
    },
    frameQuat: (_f: string, out: Quatd) => Object.assign(out, { x: 0, y: 0, z: 0, w: 1 }),
    sunToCamera: (out: Vec3d) => Object.assign(out, { x: 1.496e11, y: 0, z: 0 }),
  } as unknown as ViewState;
}

const settle = () => new Promise((r) => setTimeout(r, 0));

/** Steps until the system shows (climate and occurrences resolve on microtasks). */
async function stepShown(sys: LifeSystem, v: ViewState): Promise<void> {
  for (let i = 0; i < 4 && !sys.debug().visible; i++) {
    sys.update(v);
    await settle();
  }
  sys.update(v);
}

interface InstancedMesh {
  name: string;
  geometry: { instanceCount: number; getAttribute(n: string): { array: Float32Array } };
  material: { uniforms: Record<string, { value: { x: number; y: number; z: number } | number }> };
}

/** The first plant model with instances. */
function plantMesh(sys: LifeSystem): InstancedMesh {
  const meshes = sys.group.children as unknown as InstancedMesh[];
  return meshes.find((m) => m.name.startsWith('life.p:') && m.geometry.instanceCount > 0)!;
}

const LUCY = { lat: 11.1, lon: 40.6, jd: jdFromYearsBP(3.2e6) };

afterEach(() => {
  setActiveSystem(null);
  setActiveController(null);
  setCityAssets(null);
  delete LIMITS.capped;
});

describe('LifeSystem', () => {
  it('waits for the fossil occurrences before the first pick (herds would be cached without them)', async () => {
    const { sys, resolveOcc } = rig({ occPending: true });
    const v = view(LUCY.lat, LUCY.lon, LUCY.jd, 1);
    for (let i = 0; i < 4; i++) {
      sys.update(v);
      await settle();
    }
    expect(sys.debug().climate).not.toBe(''); // the climate is in
    expect(sys.debug().visible).toBe(false);
    expect(sys.debug().herds).toEqual([]);
    resolveOcc();
    await settle();
    sys.update(v);
    expect(sys.debug().visible).toBe(true);
  });

  it('reports the animals drawn under the cap, the hand-placed herds first', async () => {
    const { sys } = rig();
    LIMITS.capped = { ...LIMITS.potato, maxCreatures: 8 };
    await stepShown(sys, view(LUCY.lat, LUCY.lon, LUCY.jd, 1, 'capped'));
    const c = sys.shown().creatures;
    const species = Object.entries(c).filter(([k]) => k.startsWith('species:'));
    expect(species.reduce((s, [, n]) => s + n, 0)).toBe(8);
    // Featured at the Lucy site: 6 australopithecus at 14 m, 3 giraffes at 67 m, 4 elephants at 90 m.
    expect(c['species:australopithecus']).toBe(6);
    expect(c['species:giraffe']).toBe(2);
    expect(c['species:elephant']).toBeUndefined();
  });

  it('re-seats plants and the anchor when the terrain height function changes (HD blocks)', async () => {
    const { sys, terrain } = rig();
    const v = view(LUCY.lat, LUCY.lon, LUCY.jd, 1);
    await stepShown(sys, v);
    const before = plantMesh(sys);
    expect(before).toBeDefined();
    terrain.h = 60;
    terrain.gen = 2;
    sys.update(view(LUCY.lat, LUCY.lon, LUCY.jd, 1.3));
    const m = plantMesh(sys);
    expect(m.material.uniforms.uGroundRkm.value as number).toBeCloseTo((R_EARTH + 60) / 1000, 6);
    // Plants sit on the new ground: offsets from the (new) anchor stay tangent, not 60 m below.
    const up = siteDirection(LUCY.lat, LUCY.lon);
    const pos = m.geometry.getAttribute('iPos').array;
    for (let i = 0; i < m.geometry.instanceCount; i++) {
      const radial = pos[i * 3] * up.x + pos[i * 3 + 1] * up.y + pos[i * 3 + 2] * up.z;
      expect(Math.abs(radial)).toBeLessThan(1);
    }
  });

  it('crossing an anchor cell only rewrites offsets until the next pick is due', async () => {
    const { sys } = rig();
    // Just south of an anchor boundary (0.002 degree grid: 11.101 N).
    const lat0 = 11.10099;
    await stepShown(sys, view(lat0, LUCY.lon, LUCY.jd, 1));
    const pickTime = (sys as unknown as { pickTime: number }).pickTime;
    const world = (lat: number) => {
      // Camera-relative anchor + offset of the first plant, back in body axes.
      const m = plantMesh(sys);
      const a = m.material.uniforms.uAnchorRel.value as { x: number; y: number; z: number };
      const p = m.geometry.getAttribute('iPos').array;
      const up = siteDirection(lat, LUCY.lon);
      const r = R_EARTH + 2;
      return [a.x + p[0] + up.x * r, a.y + p[1] + up.y * r, a.z + p[2] + up.z * r];
    };
    const w0 = world(lat0);
    const lat1 = lat0 + 3 / M_PER_DEG; // 3 m north: a new anchor cell
    sys.update(view(lat1, LUCY.lon, LUCY.jd, 1.02));
    expect((sys.debug().anchor as number[])[0]).toBeCloseTo(11.102, 9);
    expect((sys as unknown as { pickTime: number }).pickTime).toBe(pickTime);
    const w1 = world(lat1);
    for (let k = 0; k < 3; k++) expect(w1[k]).toBeCloseTo(w0[k], 1);
  });

  it('re-picks the towns when the date changes inside one era (1955 vs 2025)', async () => {
    // A modern town founded in 1979 around the camera (Shenzhen-like).
    const city: CityData = {
      styles: ['modern'],
      cities: [
        [
          'New Town',
          22.55,
          114.06,
          [[1979, 0]],
          [
            [1980, 3e5],
            [2025, 1.7e7],
          ],
          null,
        ],
      ],
    } as unknown as CityData;
    setCityAssets({ json: () => Promise.resolve(city), track: <T>(p: Promise<T>) => p } as never);
    await loadCities();
    const { sys } = rig();
    const jd2025 = JD_J2000 + 25.5 * 365.25;
    await stepShown(sys, view(22.55, 114.06, jd2025, 1));
    expect(Object.keys(sys.shown().buildings).length).toBeGreaterThan(0);
    expect(sys.shown().creatures['species:people']).toBeGreaterThan(0);
    // Same place (walk mode: the camera does not move), the clock set back to 1955 (the same era 0).
    const jd1955 = JD_J2000 - 44.5 * 365.25;
    sys.update(view(22.55, 114.06, jd1955, 2));
    expect(sys.debug().era).toBe(0);
    expect(sys.shown().buildings).toEqual({});
    expect(sys.shown().creatures['species:people']).toBeUndefined();
  });
});
