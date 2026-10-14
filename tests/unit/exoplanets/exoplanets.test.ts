import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  classify,
  equilibriumTemp,
  habitableZone,
  radiusFromMass,
} from '../../../src/modules/exoplanets/classify';
import { hostOf, planetCount, planetsOf, type SystemsFile } from '../../../src/modules/exoplanets/data';
import { EXOPLANET_BOOKMARKS } from '../../../src/modules/exoplanets/public';

const ROOT = new URL('../../../', import.meta.url).pathname;
const file = JSON.parse(readFileSync(`${ROOT}public/data/exoplanets/systems.json`, 'utf8')) as SystemsFile;
const sys = (id: string) => file.systems.find((s) => s.id === id)!;

describe('exoplanet catalogue', () => {
  it('holds at least 4000 confirmed planets with unique system ids', () => {
    expect(planetCount(file)).toBeGreaterThanOrEqual(4000);
    expect(file.count).toBe(planetCount(file));
    expect(new Set(file.systems.map((s) => s.id)).size).toBe(file.systems.length);
    for (const b of EXOPLANET_BOOKMARKS) expect(sys(b.system)).toBeDefined();
  });

  it('links nearby hosts to HYG and keeps TRAPPIST-1 as a custom host with seven planets', () => {
    expect(sys('proxima-centauri').star).toBeGreaterThanOrEqual(0);
    expect(sys('51-peg').star).toBeGreaterThanOrEqual(0);
    const t = sys('trappist-1');
    expect(t.star).toBe(-1);
    const planets = planetsOf(t, hostOf(t));
    expect(planets.map((p) => p.suffix)).toEqual(['b', 'c', 'd', 'e', 'f', 'g', 'h']);
  });
});

describe('classification and habitable zone', () => {
  it('puts the Earth in the Sun habitable zone (Kopparapu 2013 conservative)', () => {
    const [inner, outer] = habitableZone(1, 5780);
    expect(inner).toBeGreaterThan(0.93);
    expect(inner).toBeLessThan(1);
    expect(outer).toBeGreaterThan(1.6);
    expect(outer).toBeLessThan(1.75);
    expect(equilibriumTemp(5772, 1, 1)).toBeGreaterThan(250);
    expect(equilibriumTemp(5772, 1, 1)).toBeLessThan(260);
  });

  it('classifies famous planets', () => {
    expect(classify(1, 255)).toBe('ocean');
    expect(classify(11, 1260)).toBe('hot-jupiter');
    expect(classify(11, 120)).toBe('gas-giant');
    expect(classify(2.5, 400)).toBe('sub-neptune');
    expect(classify(1.2, 1500)).toBe('lava');
    expect(classify(1, 120)).toBe('ice');
    expect(radiusFromMass(1)).toBeCloseTo(1.008, 3);
    expect(radiusFromMass(317.8)).toBeGreaterThan(10);

    const peg = sys('51-peg');
    const pegHost = hostOf(peg);
    expect(planetsOf(peg, pegHost)[0].cls).toBe('hot-jupiter');
    const prox = sys('proxima-centauri');
    const proxHost = hostOf(prox);
    const b = planetsOf(prox, proxHost).find((p) => p.suffix === 'b')!;
    expect(b.aAU).toBeGreaterThan(proxHost.hz[0]);
    expect(b.aAU).toBeLessThan(proxHost.hz[1]);
    const t = sys('trappist-1');
    const tHost = hostOf(t);
    const e = planetsOf(t, tHost).find((p) => p.suffix === 'e')!;
    expect(e.aAU).toBeGreaterThan(tHost.hz[0]);
    expect(e.aAU).toBeLessThan(tHost.hz[1]);
  });
});
