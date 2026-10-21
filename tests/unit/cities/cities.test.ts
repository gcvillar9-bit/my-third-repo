import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  citiesAt,
  cityAt,
  formatPop,
  populationAt,
  radiusFor,
  yearOfJd,
  type CityData,
  type CityRow,
} from '../../../src/modules/cities/data';
import history from '../../../src/modules/cities/history.json';
import monuments from '../../../src/modules/cities/monuments.json';
import sites from '../../../src/modules/cities/sites.json';
import { jdOfYear } from '../../../src/modules/cities/bookmarks';
import { BUILDINGS, buildBuilding, type BuildingKind } from '../../../src/modules/life/kit/buildings';
import { buildingsAround, herdsAround, townAt, type Town } from '../../../src/modules/life/population';

const data = JSON.parse(readFileSync('public/data/cities/cities.json', 'utf8')) as CityData;
const STYLES = new Set(data.styles);

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
