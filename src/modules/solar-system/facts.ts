/**
 * Info cards and search entries computed from bodies.json plus the live ephemeris (three-free).
 */
import { PlanetOrbitalPeriod, Body as AeBody } from 'astronomy-engine';
import type { InfoCard, InfoFact, SearchEntry } from '../../core/contracts';
import { v3len, vec3 } from '../../core/math64';
import { AU, C, G } from '../../core/units';
import type { BodyRow } from './data';
import { equatorialRadius, gmSI } from './data';
import type { SolarEphemeris } from './ephemeris';
import { conicFromState, keplerPeriodDays } from './kepler';

const AE_PERIOD: Record<string, AeBody> = {
  mercury: AeBody.Mercury,
  venus: AeBody.Venus,
  earth: AeBody.Earth,
  mars: AeBody.Mars,
  jupiter: AeBody.Jupiter,
  saturn: AeBody.Saturn,
  uranus: AeBody.Uranus,
  neptune: AeBody.Neptune,
  pluto: AeBody.Pluto,
};

const KIND_LABEL: Record<string, string> = {
  star: 'Star',
  planet: 'Planet',
  dwarf: 'Dwarf planet',
  minor: 'Asteroid',
};

/** Rounds to `sig` significant digits (keeps integers readable). */
export function sig(x: number, n = 4): number {
  if (!Number.isFinite(x) || x === 0) return x;
  return Number(x.toPrecision(n));
}

export function subtitle(row: BodyRow, rowsById: Map<string, BodyRow>): string {
  if (row.kind === 'moon') return `Moon of ${rowsById.get(row.parent ?? '')?.name ?? row.parent}`;
  return KIND_LABEL[row.kind] ?? row.kind;
}

/** Sidereal orbital period around the parent, days (null for the Sun). */
export function orbitalPeriodDays(row: BodyRow, eph: SolarEphemeris, jd: number): number | null {
  if (row.id === 'sun') return null;
  if (row.elements && row.ephemeris === 'kepler') return row.elements.period;
  const ae = AE_PERIOD[row.id];
  if (ae !== undefined) return PlanetOrbitalPeriod(ae);
  const r = vec3();
  const v = vec3();
  eph.stateAt(row.id, jd, r, v);
  const c = conicFromState(r, v, eph.mu(row.id));
  return c ? keplerPeriodDays(c.a, eph.mu(row.id)) : null;
}

function duration(hours: number): { value: number; unit: string } {
  const h = Math.abs(hours);
  return h < 48 ? { value: sig(h), unit: 'h' } : { value: sig(h / 24), unit: 'd' };
}

/** Facts for one body at `jd`: radius, mass, gravity, escape velocity, day, year, distance, light-time. */
export function bodyFacts(row: BodyRow, eph: SolarEphemeris, jd: number): InfoFact[] {
  const facts: InfoFact[] = [];
  const src = row.source;
  const approx = !!row.approximate;
  const R = row.radius * 1e3;
  const gm = gmSI(row);
  facts.push({
    label: 'Mean radius',
    value: sig(row.radius, 5),
    unit: 'km',
    approximate: approx,
    source: src,
  });
  if (row.radiusEquatorial && Math.abs(equatorialRadius(row) - R) > 1)
    facts.push({ label: 'Equatorial radius', value: sig(row.radiusEquatorial, 5), unit: 'km', source: src });
  facts.push({
    label: 'Mass',
    value: (gm / G).toExponential(3),
    unit: 'kg',
    approximate: approx,
    source: src,
  });
  facts.push({ label: 'Surface gravity', value: sig(gm / R ** 2, 3), unit: 'm/s²', approximate: approx });
  facts.push({
    label: 'Escape velocity',
    value: sig(Math.sqrt((2 * gm) / R) / 1e3, 3),
    unit: 'km/s',
    approximate: approx,
  });
  const rot = row.rotation;
  if (rot?.periodHours) {
    const d = duration(rot.periodHours);
    facts.push({
      label: rot.periodHours < 0 ? 'Day length (sidereal, retrograde)' : 'Day length (sidereal)',
      ...d,
      approximate: !!rot.approximate,
      source: src,
    });
  } else if (rot?.chaotic) facts.push({ label: 'Rotation', value: 'chaotic' });
  const period = orbitalPeriodDays(row, eph, jd);
  if (period !== null) {
    const isMoon = row.kind === 'moon';
    facts.push(
      period > 730 && !isMoon
        ? { label: 'Year length', value: sig(period / 365.25), unit: 'yr' }
        : { label: isMoon ? 'Orbital period' : 'Year length', value: sig(period), unit: 'd' },
    );
  }
  if (row.id !== 'sun') {
    const d = v3len(eph.relative('sun', row.id, jd, vec3()));
    facts.push({ label: 'Distance from the Sun', value: sig(d / AU), unit: 'AU' });
    facts.push({ label: 'Light-time from the Sun', value: sig(d / C / 60, 3), unit: 'min' });
    if (row.id !== 'earth') {
      const de = v3len(eph.relative('earth', row.id, jd, vec3()));
      facts.push({ label: 'Distance from Earth', value: sig(de / AU), unit: 'AU' });
    }
  }
  if (row.albedoGeometric !== undefined)
    facts.push({ label: 'Geometric albedo', value: row.albedoGeometric, source: src });
  if (row.teff) facts.push({ label: 'Effective temperature', value: row.teff, unit: 'K', source: src });
  return facts;
}

export function infoCard(
  row: BodyRow,
  eph: SolarEphemeris,
  rowsById: Map<string, BodyRow>,
  jd: number,
): InfoCard {
  return {
    title: row.name,
    subtitle: subtitle(row, rowsById),
    facts: bodyFacts(row, eph, jd),
    credit:
      'Data: bodies.json (IAU WGCCRE, JPL, Celestia); ephemerides: astronomy-engine and Kepler elements',
  };
}

export function searchEntries(rows: readonly BodyRow[]): SearchEntry[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    aliases: row.id !== row.name.toLowerCase() ? [row.id] : undefined,
    subtitle: subtitle(row, byId),
    kind: row.kind,
    target: row.id,
    priority: row.kind === 'star' || row.kind === 'planet' ? 10 : row.kind === 'dwarf' ? 6 : 3,
  }));
}
