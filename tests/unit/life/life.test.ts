import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  SPECIES,
  biomeOf,
  candidates,
  floraFor,
  presence,
  type Occurrences,
} from '../../../src/modules/life/ecology';
import flora from '../../../src/modules/life/flora.json';
import { featuredHerds } from '../../../src/modules/life/bookmarks';
import { buildCreature } from '../../../src/modules/life/kit/creatures';
import { PART } from '../../../src/modules/life/kit/mesh';
import { MODELS } from '../../../src/modules/life/kit/models';
import { PLANTS, buildPlant, type PlantKind } from '../../../src/modules/life/kit/plants';
import {
  herdsAround,
  localEN,
  memberAt,
  plantsAround,
  type Climate,
  type LifeLimits,
} from '../../../src/modules/life/population';
import { eraKey } from '../../../src/modules/life/system';
import sites from '../../../src/modules/life/sites.json';
import vert from '../../../src/modules/life/glsl/life.vert.glsl?raw';
import frag from '../../../src/modules/life/glsl/life.frag.glsl?raw';

const occ = JSON.parse(readFileSync('public/data/life/occurrences.json', 'utf8')) as Occurrences;
const sp = (id: string) => SPECIES.find((s) => s.id === id)!;
const LAND = 1;
const forest: Climate = { at: () => ({ kind: LAND, tempC: 15, moisture: 0.55 }) };
const lim: LifeLimits = {
  treeRadius: 160,
  tuftRadius: 45,
  herdRadius: 360,
  maxPlants: 900,
  maxCreatures: 50,
};

describe('life data', () => {
  it('has a model for every species and sources everywhere', () => {
    for (const s of SPECIES) {
      expect(MODELS[s.model], s.id).toBeTruthy();
      expect(s.source.length, s.id).toBeGreaterThan(15);
      expect(s.firstMa, s.id).toBeGreaterThan(s.lastMa);
      expect(!!s.pbdb !== !!s.regions, `${s.id}: pbdb or regions`).toBe(true);
      if (s.pbdb) expect(occ.species[s.id]?.length, s.id).toBeGreaterThan(5);
    }
    expect(new Set(SPECIES.map((s) => s.id)).size).toBe(SPECIES.length);
  });

  it('covers 0-470 Ma with contiguous flora eras naming only known plants', () => {
    const eras = [...flora.eras].sort((a, b) => a.toMa - b.toMa);
    expect(eras[0].toMa).toBe(0);
    for (let i = 1; i < eras.length; i++) expect(eras[i].toMa).toBe(eras[i - 1].fromMa);
    expect(eras.at(-1)!.fromMa).toBe(470);
    for (const e of flora.eras)
      for (const mix of Object.values(e.mix))
        for (const [k] of mix) expect(PLANTS[k as PlantKind], String(k)).toBeTruthy();
    expect(floraFor(500, 'forest')).toBeNull(); // bare rock before land plants
    expect(floraFor(66, 'forest')!.kinds).toContain('broadleaf');
    expect(floraFor(66, 'grassland')!.kinds).not.toContain('grass'); // no grasslands before about 20 Ma
    expect(floraFor(0, 'grassland')!.kinds).toContain('grass');
    expect(floraFor(320, 'forest')!.kinds).toContain('lycopsid');
  });

  it('classifies biomes from the climate map', () => {
    expect(biomeOf(0, 20, 0.5)).toBeNull(); // sea
    expect(biomeOf(2, -20, 0.5)).toBeNull(); // land ice
    expect(biomeOf(LAND, 26, 0.7)).toBe('rainforest');
    expect(biomeOf(LAND, 25, 0.05)).toBe('desert');
    expect(biomeOf(LAND, -8, 0.3)).toBe('tundra');
    expect(biomeOf(LAND, 10, 0.5)).toBe('forest');
  });
});

describe('life ranges', () => {
  it('puts T. rex in Late Cretaceous Laramidia only', () => {
    const rex = sp('tyrannosaurid');
    expect(presence(rex, occ, 50, -79.5, 66.5)).toBeGreaterThan(0.5);
    expect(presence(rex, occ, 50, -79.5, 120)).toBe(0); // too early
    expect(presence(rex, occ, 50, -79.5, 0)).toBe(0); // extinct
    expect(presence(rex, occ, -30, 20, 66.5)).toBe(0); // not in southern Africa
  });

  it('follows the human story', () => {
    expect(presence(sp('australopithecus'), occ, 11.1, 40.6, 3.2)).toBe(1);
    expect(presence(sp('australopithecus'), occ, 48, 2, 3.2)).toBe(0);
    expect(presence(sp('neanderthal'), occ, 48, 2, 0.05)).toBe(1);
    expect(presence(sp('neanderthal'), occ, 48, 2, 0.02)).toBe(0); // gone by 40 ka
    expect(presence(sp('sapiens'), occ, 40, -100, 0.02)).toBe(0); // Americas before 16 ka
    expect(presence(sp('sapiens'), occ, 40, -100, 0.01)).toBe(1);
    expect(presence(sp('sapiens'), occ, -25, 135, 0.06)).toBe(1); // Sahul from 65 ka
  });

  it('has the featured herds of every bookmark live where and when they are placed', () => {
    for (const f of featuredHerds()) {
      const p = presence(sp(f.species), occ, f.lat, f.lon, f.ageMa);
      expect(p, f.id).toBeGreaterThan(0.2);
    }
    expect(featuredHerds().length).toBe(sites.sites.reduce((n, s) => n + s.herds.length, 0));
  });

  it('offers only species of the time as candidates', () => {
    const now = candidates(occ, 0.5, 36, 0, 'savanna').map((c) => c.species.id);
    expect(now).toEqual(expect.arrayContaining(['elephant', 'zebra', 'giraffe', 'lion']));
    expect(now).not.toContain('tyrannosaurid');
    const k = candidates(occ, 50, -79.5, 66.5, 'savanna').map((c) => c.species.id);
    expect(k).toEqual(expect.arrayContaining(['tyrannosaurid', 'ceratopsid', 'hadrosaur']));
    expect(k).not.toContain('sapiens');
  });
});

describe('life kit', () => {
  it('builds finite creatures that stand on the ground', () => {
    for (const [id, m] of Object.entries(MODELS)) {
      const b = buildCreature(m.spec);
      const { pos, joint } = b.arrays();
      expect(b.triangles, id).toBeGreaterThan(100);
      expect(b.triangles, id).toBeLessThan(2500);
      let minY = Infinity;
      for (let i = 0; i < pos.length; i++) expect(Number.isFinite(pos[i]), id).toBe(true);
      for (let i = 1; i < pos.length; i += 3) minY = Math.min(minY, pos[i]);
      if (m.gait.kind !== 'fly') {
        expect(minY, id).toBeGreaterThan(-0.15);
        expect(minY, id).toBeLessThan(0.2);
      }
      const parts = new Set<number>();
      for (let i = 3; i < joint.length; i += 4) parts.add(joint[i]);
      if (m.gait.kind === 'walk')
        for (const p of [PART.legFL, PART.legFR, PART.legBL, PART.legBR]) expect(parts.has(p), id).toBe(true);
      if (m.gait.kind === 'fly') expect(parts.has(PART.wingL) && parts.has(PART.wingR), id).toBe(true);
    }
  });

  it('builds every plant with sway weights from 0 at the root', () => {
    for (const kind of Object.keys(PLANTS) as PlantKind[]) {
      const b = buildPlant(kind, 3);
      const { pos, bend } = b.arrays();
      expect(b.triangles, kind).toBeGreaterThan(5);
      for (let i = 0; i < pos.length; i++) expect(Number.isFinite(pos[i]), kind).toBe(true);
      for (let i = 3; i < bend.length; i += 4) {
        expect(bend[i], kind).toBeGreaterThanOrEqual(0);
        expect(bend[i], kind).toBeLessThanOrEqual(1);
      }
      expect(b.bounds().height, kind).toBeLessThan(PLANTS[kind].height * 1.6 + 0.5);
    }
  });

  it('includes the log-depth chunk calls and no reserved uniform names twice', () => {
    expect(vert).toContain('LOG_DEPTH_VERTEX()');
    expect(frag).toContain('LOG_DEPTH_FRAGMENT()');
    expect(frag).toContain('atmoSunTransmittance');
  });
});

describe('life population', () => {
  it('is deterministic and respects the radii and caps', () => {
    const a = plantsAround(45, 10, 700, 66, forest, lim, new Map());
    const b = plantsAround(45, 10, 700, 66, forest, lim, new Map());
    expect(a.length).toBeGreaterThan(100);
    expect(a.length).toBeLessThanOrEqual(lim.maxPlants);
    expect(b).toEqual(a);
    for (const p of a) {
      const d = Math.hypot(...localEN(45, 10, p.lat, p.lon));
      expect(d).toBeLessThanOrEqual(PLANTS[p.kind].height > 3 ? lim.treeRadius : lim.tuftRadius);
    }
    // No plants before land plants evolved.
    expect(plantsAround(45, 10, 800, 500, forest, lim, new Map())).toEqual([]);
  });

  it('fills herds from the species of the time and adds the featured ones', () => {
    const climate: Climate = { at: () => ({ kind: LAND, tempC: 22, moisture: 0.33 }) }; // savanna
    const site = sites.sites.find((s) => s.id === 'life-trex-66ma')!;
    const herds = herdsAround(
      site.latDeg,
      site.lonDeg,
      eraKey(66.5),
      66.5,
      climate,
      occ,
      lim,
      new Map(),
      new Map(),
      featuredHerds(),
      eraKey,
    );
    const ids = new Set(herds.map((h) => h.species.id));
    expect(ids.has('tyrannosaurid')).toBe(true);
    expect(ids.has('ceratopsid')).toBe(true);
    for (const h of herds) expect(h.species.lastMa).toBeLessThan(67);
  });

  it('moves members along smooth loops with matching velocities', () => {
    const climate: Climate = { at: () => ({ kind: LAND, tempC: 22, moisture: 0.33 }) };
    const herds = herdsAround(
      11.1,
      40.6,
      eraKey(3.2),
      3.2,
      climate,
      occ,
      lim,
      new Map(),
      new Map(),
      featuredHerds(),
      eraKey,
    );
    const m = herds[0].members[0];
    const p0 = memberAt(m, 100, { e: 0, n: 0, ve: 0, vn: 0 });
    const a = { ...p0 };
    const b = memberAt(m, 100.01, { e: 0, n: 0, ve: 0, vn: 0 });
    expect((b.e - a.e) / 0.01).toBeCloseTo(a.ve, 1);
    expect((b.n - a.n) / 0.01).toBeCloseTo(a.vn, 1);
  });
});
