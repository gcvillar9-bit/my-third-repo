/** Info cards and search entries of the oort bodies part (three-free). */
import type { InfoCard, InfoFact, SearchEntry, Vec3d } from '../../../core/contracts';
import { v3len, vec3 } from '../../../core/math64';
import { jdToIso } from '../../../core/time';
import { AU, JD_J2000 } from '../../../core/units';
import { GROUP_PLAIN, GROUP_SUBTITLE, type FlybyStarRow, type OortObjectRow } from './data';
import { objectState, speedAtInfinity, type OortObject } from './objects';

const sig = (x: number, n = 3): number => (Number.isFinite(x) && x !== 0 ? Number(x.toPrecision(n)) : x);

/** Calendar date of a JD ('2076-07-18'), or the year when outside the JS Date range. */
export function formatDate(jd: number): string {
  const iso = jdToIso(jd);
  return iso ? iso.slice(0, 10) : `year ${Math.round(2000 + (jd - JD_J2000) / 365.25)}`;
}

/** '11,400 years' / '2.87 million years' / 'unbound'. */
export function periodText(days: number | null): string {
  if (days == null) return 'unbound';
  const years = days / 365.25;
  if (years >= 1e6) return `${sig(years / 1e6, 3)} million years`;
  return `${sig(years, 3).toLocaleString('en-US')} years`;
}

const auText = (au: number): number => (au >= 1000 ? Math.round(sig(au, 3)) : sig(au, 4));

export interface ObjectFactsDeps {
  jd: number;
  /** Sun → object and Earth → object at `jd`, m (null when a frame is missing). */
  fromSun(id: string, jd: number, out: Vec3d): Vec3d | null;
  fromEarth(id: string, jd: number, out: Vec3d): Vec3d | null;
}

export function objectFacts(o: OortObject, deps: ObjectFactsDeps): InfoFact[] {
  const { row, orbit } = o;
  const el = row.elements;
  const src = el.source;
  const apx = !!el.approximate;
  const ph = row.physical;
  const facts: InfoFact[] = [
    { label: 'Designation', value: row.designation },
    { label: 'Group', value: GROUP_PLAIN[row.group] },
    { label: 'Discovery', value: row.discovered },
    { label: 'Perihelion distance', value: sig(el.q, 4), unit: 'AU', approximate: apx, source: src },
  ];
  if (el.e < 1) {
    facts.push({
      label: 'Semi-major axis',
      value: auText(orbit.a / AU),
      unit: 'AU',
      approximate: apx,
      source: src,
    });
    facts.push({
      label: 'Aphelion distance',
      value: auText(orbit.aphelion / AU),
      unit: 'AU',
      approximate: apx,
      source: src,
    });
  } else {
    facts.push({ label: 'Eccentricity', value: sig(el.e, 5), approximate: apx, source: src });
    facts.push({
      label: 'Speed far from the Sun (v∞)',
      value: sig(speedAtInfinity(orbit) / 1e3, 3),
      unit: 'km/s',
      approximate: apx,
      source: src,
    });
  }
  facts.push({ label: 'Orbital period', value: periodText(el.periodDays), approximate: apx, source: src });
  facts.push({ label: 'Inclination', value: sig(el.i, 4), unit: '°', approximate: apx, source: src });
  facts.push({ label: 'Perihelion date', value: formatDate(el.tp), approximate: apx, source: src });
  facts.push({
    label: row.kind === 'comet' ? 'Nucleus diameter' : 'Diameter',
    value: sig(2 * ph.radiusKm, 3),
    unit: 'km',
    approximate: !!ph.approximate,
    source: ph.source,
  });
  facts.push({
    label: 'Geometric albedo',
    value: ph.albedo,
    approximate: !!ph.approximate,
    source: ph.source,
  });

  const { jd } = deps;
  const tmp = vec3();
  const sun = deps.fromSun(row.id, jd, tmp);
  const rAU = v3len(sun ?? objectState(o, jd, vec3())) / AU;
  facts.push({ label: 'Distance from the Sun', value: auText(rAU), unit: 'AU', approximate: true });
  const earth = deps.fromEarth(row.id, jd, tmp);
  if (earth)
    facts.push({
      label: 'Distance from Earth',
      value: auText(v3len(earth) / AU),
      unit: 'AU',
      approximate: true,
    });
  const vel = vec3();
  objectState(o, jd, vec3(), vel);
  facts.push({
    label: 'Speed relative to the Sun',
    value: sig(v3len(vel) / 1e3, 3),
    unit: 'km/s',
    approximate: true,
  });
  return facts;
}

export function objectCard(o: OortObject, deps: ObjectFactsDeps): InfoCard {
  return {
    title: o.row.name,
    subtitle: GROUP_SUBTITLE[o.row.group],
    facts: objectFacts(o, deps),
    description:
      `${o.row.description} Position from a two-body orbit (no planetary or Galactic perturbations); the ` +
      'surface is a procedural sphere with the measured size and albedo.',
    simulated: true,
    credit: 'Orbits and sizes hand-entered from the sources given on each value (approximate)',
  };
}

export function objectSearchEntries(rows: readonly OortObjectRow[]): SearchEntry[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    aliases: [...new Set([row.designation, row.short, ...row.aliases])].filter((a) => a !== row.name),
    subtitle: GROUP_SUBTITLE[row.group],
    kind: row.kind,
    target: row.id,
    priority: 4,
  }));
}

export function flybySearchEntries(stars: readonly { row: FlybyStarRow; bookmark: string }[]): SearchEntry[] {
  return stars.map(({ row, bookmark }) => ({
    id: row.id,
    name: `${row.name} flyby`,
    aliases: [row.name, ...row.aliases],
    subtitle: 'Star passing through the Oort Cloud',
    kind: 'bookmark' as const,
    target: bookmark,
    priority: 2,
  }));
}
