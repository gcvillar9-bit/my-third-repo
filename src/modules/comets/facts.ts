/** Info cards and search entries for comets (three-free). */
import type { InfoCard, InfoFact, SearchEntry, Vec3d } from '../../core/contracts';
import { v3len, vec3 } from '../../core/math64';
import { jdToIso } from '../../core/time';
import { AU, JD_J2000 } from '../../core/units';
import type { CometDisplay, CometRow } from './data';
import { apparentMagnitude, comaRadius, dustTailLength, ionTailLength } from './model';
import type { CometOrbit } from './orbit';

/** Elements older or younger than this are flagged approximate (planetary perturbations, outgassing). */
export const ELEMENTS_TRUST_YEARS = 15;

const CLASS_LABEL: Record<CometRow['class'], string> = {
  periodic: 'Periodic comet',
  'long-period': 'Long-period comet',
  'non-periodic': 'Non-periodic comet',
};

const sig = (x: number, n = 3): number => (Number.isFinite(x) && x !== 0 ? Number(x.toPrecision(n)) : x);

/** Calendar date of a JD ('1986-02-09'), or the year when outside the JS Date range. */
export function formatDate(jd: number): string {
  const iso = jdToIso(jd);
  return iso ? iso.slice(0, 10) : `year ${Math.round(2000 + (jd - JD_J2000) / 365.25)}`;
}

export function periodText(days: number | null): string {
  if (days == null) return 'unbound';
  const years = days / 365.25;
  return years >= 1000 ? `${sig(years / 1000, 3)} thousand yr` : `${sig(years, 4)} yr`;
}

export function subtitle(row: CometRow): string {
  const p = row.elements.periodDays;
  return row.class === 'periodic' && p
    ? `${CLASS_LABEL[row.class]} · ${periodText(p)}`
    : CLASS_LABEL[row.class];
}

/** Perihelion passages around `jd`: the last one at or before it and the next one after it. */
export function perihelia(orbit: CometOrbit, jd: number): { last: number | null; next: number | null } {
  const P = orbit.periodDays;
  if (!P) return jd >= orbit.tp ? { last: orbit.tp, next: null } : { last: null, next: orbit.tp };
  const k = Math.floor((jd - orbit.tp) / P);
  return { last: orbit.tp + k * P, next: orbit.tp + (k + 1) * P };
}

export interface FactsDeps {
  jd: number;
  display: CometDisplay;
  /** Sun → comet and Earth → comet at `jd`, m (null when the frame is missing). */
  fromSun(id: string, jd: number, out: Vec3d): Vec3d | null;
  fromEarth(id: string, jd: number, out: Vec3d): Vec3d | null;
}

export function cometFacts(row: CometRow, orbit: CometOrbit, deps: FactsDeps): InfoFact[] {
  const { jd, display } = deps;
  const el = row.elements;
  const elSource = el.source;
  const facts: InfoFact[] = [{ label: 'Designation', value: row.designation }];
  const years = el.periodDays ? el.periodDays / 365.25 : null;
  // Periods of long-period comets change at every passage through the planetary region.
  facts.push({
    label: 'Orbital period',
    value: periodText(el.periodDays),
    approximate: !!el.approximate || years == null || years > 200,
    source: elSource,
  });
  facts.push({
    label: 'Perihelion distance',
    value: sig(el.q, 4),
    unit: 'AU',
    approximate: !!el.approximate,
    source: elSource,
  });
  facts.push({ label: 'Eccentricity', value: sig(el.e, 6), approximate: !!el.approximate, source: elSource });
  facts.push({
    label: 'Inclination',
    value: sig(el.i, 4),
    unit: '°',
    approximate: !!el.approximate,
    source: elSource,
  });
  const { last, next } = perihelia(orbit, jd);
  // Only the passage the elements were fitted to is exact; the others are two-body extrapolations.
  const exact = (t: number) => Math.abs(t - orbit.tp) < 1 && !el.approximate;
  const longPeriod = years == null || years > 200;
  if (last != null && !(longPeriod && last !== orbit.tp))
    facts.push({ label: 'Last perihelion', value: formatDate(last), approximate: !exact(last) });
  if (next != null && !(longPeriod && next !== orbit.tp))
    facts.push({ label: 'Next perihelion', value: formatDate(next), approximate: !exact(next) });

  const tmp = vec3();
  const sun = deps.fromSun(row.id, jd, tmp);
  const rAU = (sun ? v3len(sun) : orbit.radiusAt(jd)) / AU;
  const farFromEpoch = Math.abs(jd - el.epoch) > ELEMENTS_TRUST_YEARS * 365.25;
  facts.push({ label: 'Distance from the Sun', value: sig(rAU, 4), unit: 'AU', approximate: farFromEpoch });
  const earth = deps.fromEarth(row.id, jd, tmp);
  if (earth) {
    const dAU = v3len(earth) / AU;
    facts.push({ label: 'Distance from Earth', value: sig(dAU, 4), unit: 'AU', approximate: farFromEpoch });
    const m = apparentMagnitude(row, rAU, dAU, display);
    facts.push({
      label: 'Magnitude from Earth (estimate)',
      value: Number.isFinite(m) ? Number(m.toFixed(1)) : 'inactive (too far from the Sun)',
      approximate: true,
      source: row.photometry.source,
    });
  }
  const ion = ionTailLength(row, rAU, display);
  const dust = dustTailLength(row, rAU, display);
  if (ion > 0 || dust > 0) {
    facts.push({
      label: 'Coma diameter (model)',
      value: sig((2 * comaRadius(row, rAU, display)) / 1e3, 2),
      unit: 'km',
      approximate: true,
    });
    facts.push({
      label: 'Tail length (model)',
      value: sig(Math.max(ion, dust) / 1e9, 2),
      unit: 'million km',
      approximate: true,
    });
  }
  const ph = row.physical;
  facts.push({
    label: 'Nucleus size (longest axis)',
    value: sig(2 * ph.radiusKm, 3),
    unit: 'km',
    approximate: true,
    source: ph.source,
  });
  if (ph.rotationHours)
    facts.push({
      label: 'Rotation period',
      value: sig(ph.rotationHours, 3),
      unit: 'h',
      approximate: true,
      source: ph.source,
    });
  facts.push({
    label: 'Geometric albedo',
    value: ph.albedo,
    approximate: !!ph.approximate,
    source: ph.source,
  });
  facts.push({
    label: 'Orbit elements epoch',
    value: formatDate(el.epoch),
    approximate: farFromEpoch || !!el.approximate,
    source: elSource,
  });
  return facts;
}

export function infoCard(row: CometRow, orbit: CometOrbit, deps: FactsDeps): InfoCard {
  const far = Math.abs(deps.jd - row.elements.epoch) > ELEMENTS_TRUST_YEARS * 365.25;
  return {
    title: row.name,
    subtitle: subtitle(row),
    facts: cometFacts(row, orbit, deps),
    description:
      `Known for its ${row.apparition}. The position follows a two-body orbit from elements fitted near ` +
      `${formatDate(row.elements.epoch)}` +
      (far
        ? '; this far from that date it is approximate (planets and outgassing shift comet orbits). '
        : '. ') +
      'The nucleus shape, coma and tails are a procedural model driven by the distance from the Sun.',
    simulated: true,
    credit:
      'Orbits: Celestia comets.ssc (JPL SBDB / Horizons) and Stellarium; brightness laws and shapes hand-entered (approximate)',
  };
}

export function searchEntries(rows: readonly CometRow[]): SearchEntry[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    aliases: [...new Set([row.designation, row.short, ...row.aliases])].filter((a) => a !== row.name),
    subtitle: subtitle(row),
    kind: 'comet' as const,
    target: row.id,
    priority: 4,
  }));
}
