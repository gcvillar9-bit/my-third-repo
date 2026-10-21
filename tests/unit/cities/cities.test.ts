import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AssetLoader, LabelItem, ViewState } from '../../../src/core/contracts';
import { siteDirection } from '../../../src/modules/atmosphere/public';
import {
  TOWNS_FROM_YEAR,
  citiesAt,
  cityAt,
  formatPop,
  jdOfAstroYear,
  populationAt,
  radiusFor,
  yearOfJd,
  type CityData,
  type CityRow,
} from '../../../src/modules/cities/data';
import history from '../../../src/modules/cities/history.json';
import monuments from '../../../src/modules/cities/monuments.json';
import sites from '../../../src/modules/cities/sites.json';
import { ellipsoid, jdOfYear } from '../../../src/modules/cities/bookmarks';
import { CITIES_VALIDITY, LABEL_HEIGHT_M, cityLabels } from '../../../src/modules/cities/index';
import * as citiesApi from '../../../src/modules/cities/public';
import { loadCities, monumentsNear, setAssets } from '../../../src/modules/cities/state';
import { BUILDINGS, buildBuilding, type BuildingKind } from '../../../src/modules/life/kit/buildings';
import { buildingsAround, herdsAround, townAt, type Town } from '../../../src/modules/life/population';

const data = JSON.parse(readFileSync('public/data/cities/cities.json', 'utf8')) as CityData;
const STYLES = new Set(data.styles);
const DEG = Math.PI / 180;
/** WGS84. */
const EARTH = { id: 'earth', radius: 6_378_137, oblateness: 1 / 298.257223563, fixedFrame: 'earth.fixed' };

describe('city table', () => {
  it('has sources, sorted estimates and known styles', () => {
    expect(history.cities.length).toBeGreaterThan(120);
    for (const c of history.cities) {
      expect(c.source.length, c.name).toBeGreaterThan(5);
      expect(c.pop.length, c.name).toBeGreaterThanOrEqual(3);
      for (let i = 1; i < c.pop.length; i++) expect(c.pop[i][0], c.name).toBeGreaterThan(c.pop[i - 1][0]);
      for (const [, s] of c.styles) expect(STYLES.has(s as never), `${c.name} ${s}`).toBe(true);
    }
    expect(data.cities.length).toBeGreaterThan(history.cities.length);
  });

  it('interpolates populations and respects founding and abandonment', () => {
    const rows = data.cities as CityRow[];
    const rome = rows.find((c) => c[0] === 'Rome')!;
    const p117 = populationAt(rome, 117)!;
    expect(p117).toBeGreaterThan(4e5);
    expect(p117).toBeLessThan(1.6e6);
    expect(populationAt(rome, -2000)).toBeNull(); // before Rome
    const uruk = rows.find((c) => c[0] === 'Uruk')!;
    expect(populationAt(uruk, -3000)).toBeGreaterThan(1e4);
    expect(populationAt(uruk, 1500)).toBeNull(); // abandoned
    expect(cityAt(data, rome, 117)!.style).toBe('classical');
    expect(cityAt(data, rome, 2020)!.style).toBe('modern');
  });

  it('lists the largest cities of a date', () => {
    const at117 = citiesAt(data, 117).map((c) => c.name);
    expect(at117.slice(0, 5)).toContain('Rome');
    expect(at117).not.toContain('Tenochtitlan');
    const today = citiesAt(data, 2020);
    expect(today[0].pop).toBeGreaterThan(2e7);
    expect(citiesAt(data, -3500).length).toBeGreaterThan(2); // Uruk and its neighbours
    expect(citiesAt(data, -9000)).toEqual([]);
  });

  it('starts at one date: the earliest town, the validity range and the public API agree', () => {
    const first = Math.min(...data.cities.map((c) => c[3][0][0]));
    expect(TOWNS_FROM_YEAR).toBe(first);
    expect(data.cities.find((c) => c[3][0][0] === first)![0]).toBe('Jericho');
    expect(citiesApi.TOWNS_FROM_YEAR).toBe(TOWNS_FROM_YEAR);
    expect(yearOfJd(CITIES_VALIDITY.jdMin)).toBeCloseTo(TOWNS_FROM_YEAR, 9);
    expect(yearOfJd(jdOfAstroYear(117.25))).toBeCloseTo(117.25, 9);
    expect(citiesAt(data, TOWNS_FROM_YEAR).map((c) => c.name)).toEqual(['Jericho']);
    expect(citiesAt(data, TOWNS_FROM_YEAR - 1)).toEqual([]);
  });

  it('adds Natural Earth cities that stand by ruins, from 1950', () => {
    const rows = data.cities as CityRow[];
    for (const name of ['Zibo', 'St. Louis', 'Mosul', 'Shiraz', 'Konya']) {
      const row = rows.find((c) => c[0] === name);
      expect(row, name).toBeTruthy();
      expect(row![3][0][0], name).toBe(1950);
      expect(populationAt(row!, 2020), name).toBeGreaterThan(3e5);
    }
    // Their ruins are still there before.
    expect(
      populationAt(
        rows.find((c) => c[0] === 'Cahokia')!,
        1100,
      ),
    ).toBeGreaterThan(1e4);
  });

  it('dates, sizes and formats', () => {
    expect(yearOfJd(jdOfYear(117) + 180)).toBeCloseTo(117.5, 1);
    expect(yearOfJd(jdOfYear(-570) + 180)).toBeCloseTo(-568.5, 1); // 570 BC is astronomical -569
    expect(radiusFor(1e6, 117)).toBeGreaterThan(3000); // about 40 km2 at 25 000 per km2
    expect(radiusFor(1e6, 117)).toBeLessThan(4500);
    expect(formatPop(450_000)).toBe('450k');
    expect(formatPop(37_400_000)).toBe('37M');
  });

  it('has monuments of known kinds and sites in range', () => {
    for (const m of monuments.monuments) expect(BUILDINGS[m.kind as BuildingKind], m.name).toBeTruthy();
    for (const s of sites.sites) {
      expect(Math.abs(s.lat - s.targetLat) + Math.abs(s.lon - s.targetLon), s.id).toBeLessThan(0.02);
    }
  });

  it('draws Hagia Sophia as a church before 1453 and a mosque after', () => {
    const kinds = (jd: number) =>
      monumentsNear(41.0086, 28.9802, jd, 500)
        .filter((m) => m.name === 'Hagia Sophia')
        .map((m) => m.kind);
    expect(kinds(jdOfYear(536) + 180)).toEqual([]);
    expect(kinds(jdOfYear(1000) + 180)).toEqual(['baroqueChurch']);
    expect(kinds(jdOfYear(1452) + 300)).toEqual(['baroqueChurch']);
    expect(kinds(jdOfAstroYear(1453))).toHaveLength(1); // never both
    expect(kinds(jdOfYear(1453) + 180)).toEqual(['mosque']);
    expect(kinds(jdOfYear(2020) + 180)).toEqual(['mosque']);
  });
});

describe('city labels', () => {
  const rows = data.cities as CityRow[];
  beforeAll(async () => {
    setAssets({ json: async () => data, track: (p: Promise<unknown>) => p } as unknown as AssetLoader);
    await loadCities();
  });
  afterAll(() => setAssets(null));

  /**
   * A view with Earth at the origin and its fixed axes as world axes, the camera `alt` m above the ellipsoid
   * at (lat, lon) and the camera's ground `ground` m above the ellipsoid (null: no ground known).
   */
  const viewAt = (year: number, lat: number, lon: number, alt: number, ground: number | null = 0) => {
    const up = siteDirection(lat, lon);
    const r = ellipsoid(up, EARTH.radius, EARTH.oblateness) + alt;
    const pos = { x: up.x * r, y: up.y * r, z: up.z * r };
    return {
      pos,
      view: {
        jd: jdOfYear(year) + 180,
        toCamera: (
          _f: string,
          l: { x: number; y: number; z: number },
          out: { x: number; y: number; z: number },
        ) => Object.assign(out, { x: l.x - pos.x, y: l.y - pos.y, z: l.z - pos.z }),
        frameQuat: (_f: string, out: object) => Object.assign(out, { x: 0, y: 0, z: 0, w: 1 }),
        nearestSurface: () => (ground === null ? null : { bodyId: 'earth', altitude: alt - ground }),
      } as unknown as ViewState,
    };
  };
  const labels = (year: number, lat: number, lon: number, alt: number, ground: number | null = 0) => {
    const { view, pos } = viewAt(year, lat, lon, alt, ground);
    const out: LabelItem[] = [];
    cityLabels(view, out, EARTH);
    return { out, pos, names: out.map((l) => l.id.slice(5)) };
  };
  /** Angle between a label and the camera seen from Earth's centre, rad. */
  const angle = (l: LabelItem, p: { x: number; y: number; z: number }) =>
    Math.acos(
      (l.local.x * p.x + l.local.y * p.y + l.local.z * p.z) /
        (Math.hypot(l.local.x, l.local.y, l.local.z) * Math.hypot(p.x, p.y, p.z)),
    );

  it('stands labels 50 m above the ellipsoid', () => {
    const { out } = labels(2020, 41.89, 12.49, 3e6);
    expect(out.length).toBeGreaterThan(10);
    for (const l of out) {
      const r = Math.hypot(l.local.x, l.local.y, l.local.z);
      const dir = { x: l.local.x / r, y: l.local.y / r, z: l.local.z / r };
      expect(r - ellipsoid(dir, EARTH.radius, EARTH.oblateness)).toBeCloseTo(LABEL_HEIGHT_M, 6);
    }
  });

  it('names no city beyond the horizon at street level', () => {
    const rome = sites.sites.find((s) => s.id === 'city-rome-117ad')!;
    const { out, pos, names } = labels(117, rome.lat, rome.lon, 2);
    expect(names).toContain('Rome');
    for (const n of ['Florentia', 'Ravenna', 'Genoa', 'Milan', 'Naples']) expect(names).not.toContain(n);
    // Horizon from 2 m plus that of a label 50 m up: about 30 km.
    for (const l of out) expect(angle(l, pos) * EARTH.radius, l.id).toBeLessThan(31_000);
  });

  it('takes the horizon from the ground under the camera on a high plateau', () => {
    const site = sites.sites.find((s) => s.id === 'city-tenochtitlan-1500')!;
    // The walker's eye 1.7 m above the Valley of Mexico (2240 m): Cholula, 97 km away, is beyond the horizon.
    const walk = labels(1500, site.lat, site.lon, 2241.7, 2240);
    expect(walk.names).toContain('Tenochtitlan / Mexico City');
    expect(walk.names).not.toContain('Cholula');
    for (const l of walk.out) expect(angle(l, walk.pos) * EARTH.radius, l.id).toBeLessThan(31_000);
    // Without a known ground the ellipsoid's horizon from 2242 m reaches it.
    expect(labels(1500, site.lat, site.lon, 2241.7, null).names).toContain('Cholula');
  });

  it('picks the largest cities within the horizon cap, not the world', () => {
    const { out, pos, names } = labels(2020, 40.85, 14.27, 300_000); // over Naples
    expect(names).toContain('Naples');
    expect(names).toContain('Rome');
    const cap = Math.acos(EARTH.radius / (EARTH.radius + 300_000)) + 0.01;
    for (const l of out) expect(angle(l, pos), l.id).toBeLessThan(cap);
    expect(names).not.toContain('Tokyo');
    expect(out).toHaveLength(120);
    // Largest first among the visible ones: nothing skipped is bigger than the smallest shown.
    const shown = new Set(names);
    const smallest = Math.min(
      ...names.map((n) =>
        populationAt(
          rows.find((c) => c[0] === n)!,
          2020,
        )!,
      ),
    );
    expect(smallest).toBeGreaterThan(0);
    for (const c of citiesAt(data, 2020))
      if (!shown.has(c.id) && c.pop > smallest) {
        const u = siteDirection(c.lat, c.lon);
        const r = Math.hypot(pos.x, pos.y, pos.z);
        expect(Math.acos((u.x * pos.x + u.y * pos.y + u.z * pos.z) / r), c.id).toBeGreaterThan(cap - 0.02);
      }
  });

  it('starts with the first town', () => {
    expect(labels(-8100, 31.87, 35.44, 1e6).out).toEqual([]);
    expect(labels(-7990, 31.87, 35.44, 1e6).names).toEqual(['Jericho']);
  });
});

describe('town buildings', () => {
  const rome: Town = {
    id: 'Rome',
    name: 'Rome',
    lat: 41.89,
    lon: 12.49,
    pop: 1e6,
    style: 'classical',
    radiusM: 3600,
  };
  it('builds finite, closed-looking models', () => {
    for (const k of Object.keys(BUILDINGS) as BuildingKind[]) {
      const b = buildBuilding(k, 3);
      const { pos } = b.arrays();
      expect(b.triangles, k).toBeGreaterThan(5);
      for (const v of pos) expect(Number.isFinite(v), k).toBe(true);
      expect(b.bounds().height, k).toBeLessThan(BUILDINGS[k].height * 1.4 + 2);
    }
  });

  it('places a landmark at the centre, houses in blocks and walls at the edge', () => {
    const near = buildingsAround(rome.lat, rome.lon, [rome], [], 117, 450, 500);
    expect(near.length).toBeGreaterThan(50);
    expect(near.length).toBeLessThanOrEqual(500);
    const kinds = new Set(near.map((b) => b.kind));
    expect(kinds.has('temple')).toBe(true);
    expect([...kinds].every((k) => ['temple', 'stoneHouse', 'insula', 'wall'].includes(k))).toBe(true);
    const edge = buildingsAround(rome.lat + 3600 / 111_195, rome.lon, [rome], [], 117, 300, 500);
    expect(edge.some((b) => b.kind === 'wall')).toBe(true);
    // No walls in the modern city.
    const modern = buildingsAround(
      rome.lat + 3600 / 111_195,
      rome.lon,
      [{ ...rome, style: 'modern' }],
      [],
      2020,
      300,
      500,
    );
    expect(modern.some((b) => b.kind === 'wall')).toBe(false);
    // Nor in a walled style after 1800 (the year gate, not the style).
    const late = buildingsAround(rome.lat + 3600 / 111_195, rome.lon, [rome], [], 1900, 300, 500);
    expect(late.length).toBeGreaterThan(0);
    expect(late.some((b) => b.kind === 'wall')).toBe(false);
  });

  it('faces the Temple of Jupiter up a clear street from the Rome bookmark', () => {
    const site = sites.sites.find((s) => s.id === 'city-rome-117ad')!;
    const jupiter = monuments.monuments.find((m) => m.name === 'Temple of Jupiter Optimus Maximus')!;
    expect([site.targetLat, site.targetLon]).toEqual([jupiter.lat, jupiter.lon]);
    const town = cityAt(
      data,
      (data.cities as CityRow[]).find((c) => c[0] === 'Rome')!,
      117,
    )!;
    const lms = [{ ...jupiter, scale: jupiter.scale ?? 1 }];
    const built = buildingsAround(site.lat, site.lon, [town], lms, 117, 450, 500);
    expect(built.some((b) => b.kind === 'temple')).toBe(true);
    // East-north metres from the standpoint.
    const en = (lat: number, lon: number) => [
      (lon - site.lon) * 111_195 * Math.cos(site.lat * DEG),
      (lat - site.lat) * 111_195,
    ];
    const [te, tn] = en(jupiter.lat, jupiter.lon);
    const bearing = Math.atan2(te, tn) / DEG;
    expect(Math.abs(bearing)).toBeLessThan(10); // ahead: the half field of view is 33-40 degrees
    expect(Math.hypot(te, tn)).toBeGreaterThan(100);
    expect(Math.hypot(te, tn)).toBeLessThan(250);
    // No house footprint crosses the line of sight to the temple's front.
    const len = Math.hypot(te, tn) - 32;
    for (const b of built) {
      if (b.kind === 'temple') continue;
      const [e, n] = en(b.lat, b.lon);
      const along = Math.max(0, Math.min(len, (e * te + n * tn) / Math.hypot(te, tn)));
      const off = Math.hypot(e - (along * te) / Math.hypot(te, tn), n - (along * tn) / Math.hypot(te, tn));
      const [hx, hz] = BUILDINGS[b.kind].half;
      expect(off, `${b.kind} at ${e.toFixed(0)}, ${n.toFixed(0)}`).toBeGreaterThan(
        Math.hypot(hx, hz) * b.scale,
      );
    }
  });

  it('fills streets with people and keeps wild animals out', () => {
    const climate = { at: () => ({ kind: 1, tempC: 16, moisture: 0.3 }) };
    const herds = herdsAround(
      rome.lat,
      rome.lon,
      300,
      0.0018,
      climate,
      null,
      {
        treeRadius: 160,
        tuftRadius: 45,
        herdRadius: 500,
        maxPlants: 900,
        maxCreatures: 50,
        buildingRadius: 450,
        maxBuildings: 500,
      },
      new Map(),
      new Map(),
      [],
      () => 300,
      (la, lo) => townAt([rome], la, lo),
    );
    expect(herds.length).toBeGreaterThan(0);
    for (const h of herds) expect(['townsfolk', 'cattle', 'sheep'], h.species.id).toContain(h.species.id);
  });
});
