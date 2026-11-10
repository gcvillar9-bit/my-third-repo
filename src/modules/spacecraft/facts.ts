/**
 * Info cards and search entries (three-free). Static facts come from craft.json; distances, speed,
 * light time, altitude and period are computed for the clock's date from the motion models.
 */
import type { InfoCard, InfoFact, JD, SearchEntry } from '../../core/contracts';
import { v3dist, vec3 } from '../../core/math64';
import { AU, C, JULIAN_YEAR, KM } from '../../core/units';
import type { CraftRow } from './data';
import { existsAt, positionApproximate, type Craft } from './fleet';
import { HaloMotion, LeoMotion, ProbeMotion, speedAt, type Ephemeris } from './trajectory';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** '1977-09-05T12:56:00Z' → '5 September 1977'. */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Rounds to `n` significant digits. */
export function sig(x: number, n = 4): number {
  if (!Number.isFinite(x) || x === 0) return x;
  return Number(x.toPrecision(n));
}

const SUBTITLE: Record<CraftRow['kind'], string> = {
  leo: 'Spacecraft in low Earth orbit',
  l2: 'Space telescope at the Sun-Earth L2 point',
  probe: 'Deep-space probe',
};

export function subtitle(row: CraftRow): string {
  if (row.id === 'iss') return 'Space station in low Earth orbit';
  if (row.id === 'hubble') return 'Space telescope in low Earth orbit';
  return SUBTITLE[row.kind];
}

/** Live facts for the clock's date. */
export function liveFacts(craft: Craft, jd: JD, eph: Ephemeris): InfoFact[] {
  const { row, motion } = craft;
  const approx = positionApproximate(craft, jd);
  const facts: InfoFact[] = [];
  const p = motion.ssbPosition(jd, vec3());
  const dSun = v3dist(p, eph('sun', jd, vec3()));
  const dEarth = v3dist(p, eph('earth', jd, vec3()));
  if (motion instanceof LeoMotion) {
    const src = row.orbit?.source;
    facts.push(
      { label: 'Altitude', value: sig(motion.altitude / KM, 3), unit: 'km', approximate: true, source: src },
      {
        label: 'Orbital period',
        value: sig(motion.period / 60, 4),
        unit: 'min',
        approximate: true,
        source: src,
      },
      { label: 'Speed around Earth', value: sig(motion.speed / KM, 3), unit: 'km/s', approximate: true },
      { label: 'Inclination', value: sig(row.orbit?.inclinationDeg ?? 0, 4), unit: '°', source: src },
      { label: 'Distance from the Sun', value: sig(dSun / AU, 4), unit: 'AU' },
      { label: 'Place along the orbit', value: 'drifts from the real one within days', approximate: true },
    );
  } else if (motion instanceof HaloMotion) {
    const src = row.halo?.source;
    facts.push(
      {
        label: 'Distance from Earth',
        value: sig(dEarth / 1e9, 3),
        unit: 'million km',
        approximate: true,
        source: src,
      },
      { label: 'Distance from the Sun', value: sig(dSun / AU, 4), unit: 'AU', approximate: true },
      {
        label: 'Speed around the Sun',
        value: sig(speedAt(motion, jd, 3600, true) / KM, 3),
        unit: 'km/s',
        approximate: true,
      },
      { label: 'Light time to Earth', value: sig(dEarth / C, 3), unit: 's', approximate: true },
    );
  } else if (motion instanceof ProbeMotion) {
    const src = jd >= motion.coastJd ? row.trajectory?.coast.source : row.trajectory?.nodeSource;
    const v = speedAt(motion, jd, 3600, true);
    facts.push(
      {
        label: 'Distance from the Sun',
        value: sig(dSun / AU, 4),
        unit: 'AU',
        approximate: approx,
        source: src,
      },
      { label: 'Distance from Earth', value: sig(dEarth / AU, 4), unit: 'AU', approximate: approx },
      { label: 'Speed relative to the Sun', value: sig(v / KM, 3), unit: 'km/s', approximate: approx },
      {
        label: 'Speed in AU per year',
        value: sig((v * JULIAN_YEAR) / AU, 3),
        unit: 'AU/yr',
        approximate: approx,
      },
      lightTime(dEarth, approx),
    );
    const flybys = motion.nodes.filter((n) => n.body && n.body !== 'earth');
    for (const n of flybys) {
      const node = row.trajectory?.nodes.find((r) => r.label === n.label);
      if (node?.utc)
        facts.push({ label: n.label, value: formatDate(node.utc), source: row.trajectory?.nodeSource });
    }
  }
  return facts;
}

function lightTime(d: number, approximate: boolean): InfoFact {
  const s = d / C;
  if (s < 5400) return { label: 'One-way light time', value: sig(s / 60, 3), unit: 'min', approximate };
  return { label: 'One-way light time', value: sig(s / 3600, 4), unit: 'h', approximate };
}

export function infoCard(craft: Craft, jd: JD, eph: Ephemeris): InfoCard {
  const { row } = craft;
  const facts: InfoFact[] = [
    { label: 'Operator', value: row.operator, source: row.source },
    {
      label: 'Launched',
      value: row.launchNote ? `${formatDate(row.launchUtc)} (${row.launchNote})` : formatDate(row.launchUtc),
      source: row.source,
    },
    { label: 'Mass', value: row.massKg, unit: 'kg', approximate: !!row.massApproximate, source: row.source },
    { label: 'Size', value: row.size, source: row.source },
  ];
  const live = existsAt(craft, jd);
  if (live) facts.push(...liveFacts(craft, jd, eph));
  else
    facts.push({
      label: 'At this date',
      value:
        jd < craft.motion.launchJd ? 'not launched yet (not shown)' : 'beyond the model range (not shown)',
    });
  for (const f of row.facts) facts.push({ ...f, source: row.source });
  return {
    title: row.name,
    subtitle: subtitle(row),
    facts,
    description: row.description,
    simulated: true,
    credit:
      'Positions: JPL Horizons and CelesTrak (craft.json). Model: procedural, to scale; attitude illustrative.',
  };
}

export function searchEntries(fleet: readonly Craft[]): SearchEntry[] {
  return fleet.map(({ row }) => ({
    id: row.id,
    name: row.name,
    aliases: [...new Set([...(row.shortName ? [row.shortName] : []), ...row.aliases, row.id])],
    subtitle: subtitle(row),
    kind: 'spacecraft' as const,
    target: row.id,
    priority: 5,
  }));
}
