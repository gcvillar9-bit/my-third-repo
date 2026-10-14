/**
 * systems.json (tools/build-exoplanets.mjs) and the derived per-planet values used at runtime.
 */
import { SUN_ABS_MAG_V } from '../../core/photometry';
import { estimateRadiusRsun, luminosityLsun } from '../starsystems/public';
import {
  aFromPeriod,
  bolometricCorrectionV,
  classify,
  equilibriumTemp,
  habitableZone,
  periodFromA,
  radiusFromMass,
  type PlanetClass,
} from './classify';

export const SYSTEMS_PATH = 'data/exoplanets/systems.json';

/** [suffix, radiusEarth, massEarth, periodDays, aAU, e, inclDeg, teqK, year, method] */
export type PlanetRow = [
  string,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  string | null,
];

export interface SystemRow {
  id: string;
  name: string;
  ra: number | null;
  dec: number | null;
  dist: number | null;
  /** stars.bin index of the HYG host, or -1. */
  star: number;
  teff: number | null;
  rad: number | null;
  mass: number | null;
  binary: number;
  planets: PlanetRow[];
}

export interface SystemsFile {
  version: number;
  source: string;
  count: number;
  systems: SystemRow[];
}

export interface Host {
  teff: number;
  radiusRsun: number;
  massMsun: number;
  lumLsun: number;
  absMagV: number;
  hz: [number, number];
  approximate: boolean;
}

export interface Planet {
  id: string;
  name: string;
  suffix: string;
  rEarth: number;
  mEarth: number | null;
  radiusDerived: boolean;
  aAU: number;
  periodDays: number;
  e: number;
  inclDeg: number;
  teq: number;
  teqDerived: boolean;
  cls: PlanetClass;
  year: number | null;
  method: string | null;
}

/** Host parameters with fall-backs (HYG absolute magnitude when linked). */
export function hostOf(s: SystemRow, hyg?: { absMag: number; teff: number }): Host {
  const teff = s.teff ?? hyg?.teff ?? 5772;
  const radiusRsun = s.rad ?? (hyg ? estimateRadiusRsun(hyg.absMag, teff) : 1);
  const massMsun = s.mass ?? Math.max(0.08, Math.min(3, radiusRsun ** 1.25));
  const lumLsun = luminosityLsun(radiusRsun, teff);
  const absMagV = hyg?.absMag ?? SUN_ABS_MAG_V - 2.5 * Math.log10(lumLsun) - bolometricCorrectionV(teff);
  return {
    teff,
    radiusRsun,
    massMsun,
    lumLsun,
    absMagV,
    hz: habitableZone(lumLsun, teff),
    approximate: s.teff == null || s.rad == null,
  };
}

/** Derived planets of a system; planets with neither period nor semi-major axis are skipped. */
export function planetsOf(s: SystemRow, host: Host): Planet[] {
  const out: Planet[] = [];
  for (const [suffix, r, m, p, a, e, incl, teq, year, method] of s.planets) {
    if (p == null && a == null) continue;
    const aAU = a ?? aFromPeriod(p!, host.massMsun);
    const periodDays = p ?? periodFromA(aAU, host.massMsun);
    const rEarth = r ?? radiusFromMass(m ?? 1);
    const t = teq ?? equilibriumTemp(host.teff, host.radiusRsun, aAU);
    out.push({
      id: `exo:${s.id}:${suffix.toLowerCase()}`,
      name: `${s.name} ${suffix}`,
      suffix,
      rEarth,
      mEarth: m,
      radiusDerived: r == null,
      aAU,
      periodDays,
      e: Math.min(0.95, Math.max(0, e ?? 0)),
      inclDeg: incl ?? (method === 'transit' ? 89.5 : 60),
      teq: t,
      teqDerived: teq == null,
      cls: classify(rEarth, t),
      year,
      method,
    });
  }
  return out;
}

/** Total confirmed planets in the file. */
export const planetCount = (f: SystemsFile): number => f.systems.reduce((n, s) => n + s.planets.length, 0);
