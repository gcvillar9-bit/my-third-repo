import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AU } from '../../../src/core/units';
import {
  buildHole,
  companionOrbit,
  shadowDiameterFromEarth,
  type Catalogue,
} from '../../../src/modules/blackholes/catalog';
import { NT_PEAK_R, gFactor, ntFlux, ntTemperature } from '../../../src/modules/blackholes/disk';
import { B_CRIT } from '../../../src/modules/blackholes/geodesic';
import {
  eccentricAnomaly,
  jdToYear,
  makeOrbit,
  periapsis,
  skyBasis,
  sstarPosition,
  yearToJd,
} from '../../../src/modules/blackholes/sstars';

const cat = JSON.parse(
  readFileSync(join(__dirname, '../../../public/data/blackholes/blackholes.json'), 'utf8'),
) as Catalogue;
const MUAS = (180 / Math.PI) * 3600e6;

describe('accretion disk', () => {
  it('Novikov-Thorne flux vanishes at r_isco = 3 r_s, peaks near 4.8 r_s and turns Newtonian', () => {
    expect(ntFlux(3)).toBe(0);
    expect(ntFlux(3.2)).toBeGreaterThan(0);
    expect(NT_PEAK_R).toBeGreaterThan(4.6);
    expect(NT_PEAK_R).toBeLessThan(5);
    const r = 1e4;
    expect(Math.abs((ntFlux(r) * (2 * r) ** 3) / 2 - 1)).toBeLessThan(0.05);
    expect(ntTemperature(NT_PEAK_R, 1e4)).toBeCloseTo(1e4, 6);
    expect(ntTemperature(50, 1e4)).toBeLessThan(ntTemperature(10, 1e4));
  });

  it('g-factor: approaching side blueshifted, receding redshifted, toggles remove each part', () => {
    const r = 6;
    const approach = gFactor(r, 6);
    const recede = gFactor(r, -6);
    expect(approach).toBeGreaterThan(1);
    expect(recede).toBeLessThan(1);
    expect(approach ** 4 / recede ** 4).toBeGreaterThan(5); // beaming asymmetry
    // Face-on: only gravitational + transverse Doppler redshift, sqrt(1 - 1.5/r).
    expect(gFactor(r, 0)).toBeCloseTo(Math.sqrt(1 - 1.5 / r), 12);
    expect(gFactor(r, 6, { doppler: false })).toBeCloseTo(Math.sqrt(1 - 1 / r), 12);
    expect(gFactor(r, 6, { doppler: false, gravity: false })).toBe(1);
    expect(gFactor(r, 0, { rObs: 26 })).toBeGreaterThan(gFactor(r, 0));
  });
});

describe('S-stars', () => {
  const sgra = buildHole(cat.holes.find((h) => h.id === 'sgra')!);
  const basis = skyBasis(sgra.row.raDeg, sgra.row.decDeg);
  const s2 = makeOrbit(
    cat.sstars.find((s) => s.id === 's2')!,
    sgra.row.massMsun,
    sgra.rs,
  );

  it('solves Kepler’s equation for e up to 0.985', () => {
    for (const e of [0.1, 0.88, 0.985])
      for (const M of [-3, -0.01, 0.001, 0.5, 3.1]) {
        const E = eccentricAnomaly(M, e);
        expect(E - e * Math.sin(E)).toBeCloseTo(M, 10);
      }
  });

  it('S2: period 16.05 yr, pericentre ~2018.38 at ~120 AU, ~12 arcmin precession per orbit', () => {
    expect(s2.period / (365.25 * 86400)).toBeCloseTo(16.05, 1);
    const p = { x: 0, y: 0, z: 0 };
    const radiusAt = (y: number) => {
      sstarPosition(s2, basis, yearToJd(y), p);
      return Math.hypot(p.x, p.y, p.z);
    };
    let best = 0;
    let rBest = Infinity;
    for (let y = 2010; y < 2026; y += 0.0005) {
      const r = radiusAt(y);
      if (r < rBest) {
        rBest = r;
        best = y;
      }
    }
    expect(best).toBeCloseTo(2018.38, 1);
    expect(Math.abs(best - 2018.379)).toBeLessThan(0.003);
    expect(rBest / AU).toBeGreaterThan(110);
    expect(rBest / AU).toBeLessThan(130);
    expect(rBest).toBeCloseTo(periapsis(s2), -9);
    // Next pericentre one period later.
    expect(radiusAt(best + 16.0455)).toBeCloseTo(rBest, -9);
    const arcmin = (s2.dOmega * 180 * 60) / Math.PI;
    expect(arcmin).toBeGreaterThan(11.5);
    expect(arcmin).toBeLessThan(12.8);
    expect(jdToYear(yearToJd(2018.379))).toBeCloseTo(2018.379, 9);
  });
});

describe('catalogue', () => {
  it('every row carries a source, ids are unique and the required objects are present', () => {
    const ids = new Set<string>();
    for (const h of cat.holes) {
      expect(h.source.length).toBeGreaterThan(5);
      expect(ids.has(h.id)).toBe(false);
      ids.add(h.id);
    }
    for (const s of cat.sstars) expect(s.source.length).toBeGreaterThan(5);
    for (const id of ['sgra', 'm87', 'cygx1', 'gaiabh1', 'gaiabh2', 'gaiabh3', 'v404cyg', 'a0620'])
      expect(ids.has(id)).toBe(true);
    for (const id of ['s2', 's29', 's55', 's62', 's4714'])
      expect(cat.sstars.some((s) => s.id === id)).toBe(true);
  });

  it('derives r_s, shadow sizes and the Cyg X-1 binary', () => {
    const sgra = buildHole(cat.holes.find((h) => h.id === 'sgra')!);
    expect(sgra.rs).toBeCloseTo(1.27e10, -8);
    expect(shadowDiameterFromEarth(sgra) * MUAS).toBeGreaterThan(48); // EHT 2022: 51.8 ± 2.3 μas
    expect(shadowDiameterFromEarth(sgra) * MUAS).toBeLessThan(58);
    const m87 = buildHole(cat.holes.find((h) => h.id === 'm87')!);
    expect(shadowDiameterFromEarth(m87) * MUAS).toBeGreaterThan(36); // EHT 2019: 42 ± 3 μas
    expect(shadowDiameterFromEarth(m87) * MUAS).toBeLessThan(45);
    // M87's disk axis lies 17° from the line of sight.
    const n = m87.diskNormal;
    const cosA = n.x * m87.skyDir.x + n.y * m87.skyDir.y + n.z * m87.skyDir.z;
    expect((Math.acos(Math.abs(cosA)) * 180) / Math.PI).toBeCloseTo(17, 6);
    expect(B_CRIT * 2 * sgra.rs).toBeGreaterThan(0);
    const cyg = buildHole(cat.holes.find((h) => h.id === 'cygx1')!);
    const orbit = companionOrbit(cyg)!;
    expect(orbit.a / AU).toBeGreaterThan(0.2);
    expect(orbit.a / AU).toBeLessThan(0.3);
    expect(orbit.radius).toBeLessThan(orbit.a * 0.6);
  });
});
