import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SPECIES, biomeOf, presence, type Occurrences } from '../../../src/modules/life/ecology';
import { citiesAt, type CityData } from '../../../src/modules/cities/data';
import { SURFACE } from '../../../src/modules/paleo/public';
import monuments from '../../../src/modules/cities/monuments.json';
import citySites from '../../../src/modules/cities/sites.json';
import { BUILDINGS, type BuildingKind } from '../../../src/modules/life/kit/buildings';
import {
  M_PER_DEG,
  buildingsAround,
  herdsAround,
  localEN,
  plantsAround,
  type Building,
  type Climate,
  type Landmark,
  type LifeLimits,
  type Town,
} from '../../../src/modules/life/population';

const occ = JSON.parse(readFileSync('public/data/life/occurrences.json', 'utf8')) as Occurrences;
const sp = (id: string) => SPECIES.find((s) => s.id === id)!;
// paleo's surface kinds (contract C2), as ecology.ts biomeOf reads them.
const LAND = SURFACE.land;
/** Sea floor bared by the ice-age sea level. */
const SHELF = SURFACE.shelf;
const forest: Climate = { at: () => ({ kind: LAND, tempC: 15, moisture: 0.55 }) };
const steppe: Climate = { at: () => ({ kind: LAND, tempC: 5, moisture: 0.2 }) };
const lim: LifeLimits = {
  treeRadius: 160,
  tuftRadius: 45,
  herdRadius: 360,
  maxPlants: 900,
  maxCreatures: 50,
  buildingRadius: 450,
  maxBuildings: 500,
};

/** Footprint radius of a building or monument (the circle through its corners), m. */
const reach = (b: { kind: string; scale: number }) =>
  Math.hypot(...BUILDINGS[b.kind as BuildingKind].half) * b.scale;
/** (lat, lon) of a point east and north of a town's centre, m. */
const offset = (t: Town, e: number, n: number): [number, number] => [
  t.lat + n / M_PER_DEG,
  t.lon + e / (M_PER_DEG * Math.cos((t.lat * Math.PI) / 180)),
];

describe('life placement grid', () => {
  it('shows the same cells on both sides of the antimeridian', () => {
    // Taveuni (Fiji): the 180th meridian crosses land.
    const cache = new Map();
    const east = plantsAround(-16.85, 180, 700, 0, forest, lim, cache);
    const cells = cache.size;
    expect(east.length).toBeGreaterThan(100);
    expect(plantsAround(-16.85, -180, 700, 0, forest, lim, cache)).toEqual(east);
    expect(cache.size).toBe(cells);
    expect(plantsAround(-16.85, -180, 700, 0, forest, lim, new Map())).toEqual(east);
    // Stepping 110 m across it keeps most cells (a fresh cache, so only this step's cells count).
    const step = new Map();
    plantsAround(-16.85, 179.9995, 700, 0, forest, lim, step);
    const before = step.size;
    plantsAround(-16.85, -179.9995, 700, 0, forest, lim, step);
    expect(step.size - before).toBeLessThan(before / 2);
    // Herds too (Chukotka in the last glacial: mammoths, horses, bison).
    const herds = (lon: number) =>
      herdsAround(66, lon, 900, 0.02, steppe, occ, lim, new Map(), new Map()).map((h) => [
        h.key,
        h.species.id,
        h.lat,
        h.lon,
      ]);
    expect(herds(180).length).toBeGreaterThan(0);
    expect(herds(-180)).toEqual(herds(180));
  });

  it('treats exposed shelf as land', () => {
    expect(biomeOf(SHELF, 10, 0.5)).toBe('forest');
    expect(biomeOf(SHELF, 5, 0.2)).toBe(biomeOf(LAND, 5, 0.2));
    // Doggerland in the last glacial.
    const shelf: Climate = { at: () => ({ kind: SHELF, tempC: 5, moisture: 0.2 }) };
    expect(plantsAround(54, 3, 900, 0.02, shelf, lim, new Map()).length).toBeGreaterThan(50);
  });
});

describe('life presence', () => {
  it('keeps each species inside its own first and last appearance', () => {
    const rex = sp('tyrannosaurid');
    // A Maastrichtian find (paleo-coordinates 24 N 76 W, 100.5-66 Ma).
    expect(occ.species.tyrannosaurid).toContainEqual([19, -102.5, 24, -76, 100.5, 66]);
    expect(presence(rex, occ, 24, -76, 66.5)).toBe(1);
    expect(presence(rex, occ, 24, -76, 66)).toBe(1);
    // Just after the K-Pg extinction (the find's slack would still match it).
    expect(presence(rex, occ, 24, -76, 65.9)).toBe(0);
    expect(presence(rex, occ, 24, -76, 64)).toBe(0);
    for (const id of ['titanosaur', 'hadrosaur', 'pterosaur'])
      expect(presence(sp(id), occ, 24, -76, 64)).toBe(0);
    // The end-Permian: the Russian Platform bookmark has gorgonopsians at 252.5 Ma, not after 252 Ma.
    expect(presence(sp('gorgonopsid'), occ, 33, 38, 252.5)).toBeGreaterThan(0.2);
    expect(presence(sp('gorgonopsid'), occ, 33, 38, 251.9)).toBe(0);
    expect(presence(sp('pareiasaur'), occ, 33, 38, 251.9)).toBe(0);
    // Before its first appearance.
    expect(presence(sp('ceratopsid'), occ, 50, -79.5, 83.1)).toBe(0);
  });
});

describe('life settlements', () => {
  const babylon: Town = {
    id: 'babylon',
    name: 'Babylon',
    lat: 32.54,
    lon: 44.42,
    pop: 60000,
    style: 'mesopotamian',
    radiusM: 900,
  };

  it('clears monument lots and lets a monument stand in for the landmark of its kind', () => {
    const [mLat, mLon] = offset(babylon, 300, -200);
    const etemenanki: Landmark = { name: 'Etemenanki', kind: 'ziggurat', lat: mLat, lon: mLon, scale: 1.4 };
    const around = (marks: Landmark[]) =>
      buildingsAround(babylon.lat, babylon.lon, [babylon], marks, -570, 3000, 1e6);
    const inFootprint = (list: Building[]) =>
      list.filter(
        (b) =>
          b.kind !== 'ziggurat' &&
          b.kind !== 'wall' &&
          Math.hypot(...localEN(mLat, mLon, b.lat, b.lon)) < reach(b) + reach(etemenanki),
      );
    const plain = around([]);
    expect(plain.filter((b) => b.kind === 'ziggurat')).toHaveLength(1);
    expect(inFootprint(plain).length).toBeGreaterThan(0);
    const real = around([etemenanki]);
    const zig = real.filter((b) => b.kind === 'ziggurat');
    expect(zig).toHaveLength(1);
    expect([zig[0].lat, zig[0].lon]).toEqual([mLat, mLon]);
    expect(inFootprint(real)).toEqual([]);
    // A monument of another kind in the way leaves the style landmark out.
    const palace: Landmark = {
      name: 'Palace',
      kind: 'palaceHall',
      lat: babylon.lat,
      lon: babylon.lon,
      scale: 1,
    };
    const centre = around([palace]);
    expect(centre.filter((b) => b.kind === 'ziggurat')).toHaveLength(0);
    expect(centre.filter((b) => b.kind === 'palaceHall')).toHaveLength(1);
  });

  it('keeps houses off the real monuments at the city bookmarks', () => {
    const cities = JSON.parse(readFileSync('public/data/cities/cities.json', 'utf8')) as CityData;
    let checked = 0;
    for (const site of citySites.sites.filter((s) => s.mode === 'walk')) {
      const near = (la: number, lo: number, m: number) =>
        Math.hypot(...localEN(site.lat, site.lon, la, lo)) < m;
      const towns = citiesAt(cities, site.year).filter((t) => near(t.lat, t.lon, t.radiusM + 2000));
      const marks: Landmark[] = monuments.monuments
        .filter((m) => {
          // Standing at the bookmark's year, as cities monumentsNear (historical years: BC to astronomical).
          const year = (y: number) => (y < 0 ? y + 1 : y);
          const end = m.end === undefined ? Infinity : year(m.end);
          return year(m.from) <= site.year && site.year < end && near(m.lat, m.lon, 1800);
        })
        .map((m) => ({ name: m.name, kind: m.kind, lat: m.lat, lon: m.lon, scale: m.scale ?? 1 }));
      const list = buildingsAround(site.lat, site.lon, towns, marks, site.year, 450, 500);
      for (const m of marks) {
        const at = (b: Building) => Math.hypot(...localEN(m.lat, m.lon, b.lat, b.lon));
        const own = list.filter((b) => b.kind === m.kind && at(b) < 1);
        expect(own, m.name).toHaveLength(1);
        const inside = list.filter((b) => b !== own[0] && b.kind !== 'wall' && at(b) < reach(b) + reach(m));
        expect(inside, m.name).toEqual([]);
        // No generic landmark of the same kind in town (New York keeps two of its three towers).
        const real = (b: Building) =>
          marks.some((o) => o.kind === b.kind && o.lat === b.lat && o.lon === b.lon);
        const generic = list.filter((b) => b.kind === m.kind && at(b) < 2500 && !real(b));
        if (m.kind !== 'tower') expect(generic, m.name).toEqual([]);
        checked++;
      }
    }
    // Etemenanki, Temple of Jupiter, Templo Mayor, Notre-Dame, Empire State Building (and Giza's pyramids).
    expect(checked).toBeGreaterThanOrEqual(5);
  });

  it('opens a gate in the wall on each of the four main streets', () => {
    for (const radiusM of [250, 300, 357, 450, 600, 1000]) {
      const t: Town = { ...babylon, style: 'medieval-european', pop: 10000, radiusM };
      const walls = buildingsAround(t.lat, t.lon, [t], [], 1200, 5000, 1e6).filter((b) => b.kind === 'wall');
      expect(walls.length, `${radiusM}`).toBeGreaterThan(50);
      // The footprint of each segment: 24 m long, 6 m thick, with a 8 m tower at its +z (clockwise) end.
      const pts: [number, number][] = [];
      const centres = walls.map((w) => {
        const [e, n] = localEN(t.lat, t.lon, w.lat, w.lon);
        const [fe, fn] = [Math.sin(w.heading), Math.cos(w.heading)];
        const [re, rn] = [Math.cos(w.heading), -Math.sin(w.heading)];
        for (let s = -12; s <= 16; s += 0.5)
          for (const q of [-4, 0, 4]) pts.push([e + re * s + fe * q, n + rn * s + fn * q]);
        return { a: Math.atan2(e - 11, n - 11), e, n };
      });
      // The main streets run 0..22 m east of the centre (north and south) and 0..22 m north (east, west).
      const street = (x: number) => x > 0.5 && x < 21.5;
      expect(
        pts.filter(([e, n]) => n > 0 && street(e)),
        `north gate ${radiusM}`,
      ).toEqual([]);
      expect(
        pts.filter(([e, n]) => n < 0 && street(e)),
        `south gate ${radiusM}`,
      ).toEqual([]);
      expect(
        pts.filter(([e, n]) => e > 0 && street(n)),
        `east gate ${radiusM}`,
      ).toEqual([]);
      expect(
        pts.filter(([e, n]) => e < 0 && street(n)),
        `west gate ${radiusM}`,
      ).toEqual([]);
      // Closed everywhere else: exactly four gaps between neighbouring segments.
      centres.sort((p, q) => p.a - q.a);
      const gaps = centres.filter((p, i) => {
        const q = centres[(i + 1) % centres.length];
        return Math.hypot(q.e - p.e, q.n - p.n) > 28;
      });
      expect(gaps, `${radiusM}`).toHaveLength(4);
    }
  });
});
