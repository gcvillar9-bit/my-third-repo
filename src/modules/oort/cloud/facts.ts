/** Info card and search entry of the Oort Cloud (three-free). */
import type { Bookmark, InfoCard, InfoFact, SearchEntry } from '../../../core/contracts';
import { AU, C, LY } from '../../../core/units';
import { formatAu } from '../shared';
import { meanSpacingAu, regionAt, type DensityProfile } from './density';
import facts from './facts.json';
import model from './model.json';

export const CLOUD_INFO_ID = 'oort-cloud';

const sig = (x: number, n = 2): number => Number(x.toPrecision(n));

/** Apparent magnitude of the Sun seen from `dAu` (inverse-square law from -26.74 at 1 AU). */
export const sunMagnitudeAt = (dAu: number): number => -26.74 + 5 * Math.log10(dAu);

/** '8.3 min', '23 h', '173 days', '2.7 years'. */
export function formatLightTime(seconds: number): string {
  if (seconds < 120) return `${sig(seconds)} s`;
  if (seconds < 7200) return `${sig(seconds / 60)} min`;
  if (seconds < 2 * 86400) return `${sig(seconds / 3600)} h`;
  const days = seconds / 86400;
  if (days < 365.25) return `${Math.round(days)} days`;
  return `${sig(days / 365.25)} years`;
}

/** 'about 1.5 × 10^12' style with a superscript exponent. */
function formatCount(n: number): string {
  const e = Math.floor(Math.log10(n));
  const sup = String(e)
    .split('')
    .map((d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(d)])
    .join('');
  return `about ${sig(n / 10 ** e)} × 10${sup}`;
}

/** Orbital period for a semi-major axis in AU, formatted ('1 million years'). */
export function periodText(aAu: number): string {
  const yr = aAu ** 1.5;
  return yr >= 1e6 ? `${sig(yr / 1e6)} million years` : `${Math.round(yr).toLocaleString('en-US')} years`;
}

export function staticFacts(density: DensityProfile | null): InfoFact[] {
  const pop = model.population;
  const sa = model.semiMajorAxis;
  const outerAu = sa.breaksAu[sa.breaksAu.length - 1];
  const [extent, ...history] = facts.rows;
  const out: InfoFact[] = [
    {
      label: extent.label,
      value: `${extent.value} (${sig((outerAu * AU) / LY)} light-years)`,
      approximate: extent.approximate,
      source: extent.source,
    },
    {
      label: 'Comets larger than 1 km (outer cloud)',
      value: formatCount(pop.outerCount),
      approximate: true,
      source: pop.source,
    },
  ];
  if (density)
    out.push({
      label: 'Comets larger than 1 km (whole model)',
      value: formatCount(density.totalComets),
      approximate: true,
      source: sa.source,
    });
  out.push(
    {
      label: 'Total mass',
      value: `about ${pop.massEarth}`,
      unit: 'Earth masses',
      approximate: true,
      source: pop.source,
    },
    { label: 'Orbital period at 10,000 AU', value: periodText(10_000), source: "Kepler's third law" },
  );
  for (const row of history) out.push({ label: row.label, value: row.value, source: row.source });
  return out;
}

/** Facts for the camera's position (distance from the Sun in AU). */
export function liveFacts(sunDistAu: number, density: DensityProfile | null): InfoFact[] {
  const out: InfoFact[] = [
    { label: 'Your distance from the Sun', value: formatAu(sunDistAu) },
    { label: 'Light travel time from the Sun', value: formatLightTime((sunDistAu * AU) / C) },
    {
      label: 'The Sun from here',
      value: `magnitude ${sunMagnitudeAt(Math.max(sunDistAu, 1e-3)).toFixed(1)}`,
    },
    { label: 'Region here (model)', value: regionAt(sunDistAu).name, approximate: true },
  ];
  const spacing = density ? meanSpacingAu(density, sunDistAu) : Infinity;
  if (Number.isFinite(spacing))
    out.push({
      label: 'Mean spacing between comets here (model)',
      value: formatAu(spacing),
      approximate: true,
      source: model.population.source,
    });
  return out;
}

export function cloudInfoCard(sunDistAu: number, density: DensityProfile | null): InfoCard {
  return {
    title: 'Oort Cloud',
    subtitle: 'Simulated comet cloud (statistical model)',
    facts: [...liveFacts(sunDistAu, density), ...staticFacts(density)],
    description:
      'A vast swarm of icy bodies left over from the birth of the planets, thought to surround the Sun out to ' +
      'about 100,000 AU, more than a third of the way to the nearest star; it has never been seen directly. ' +
      'Its inner part began as a disc near the ecliptic, and the tide of the Milky Way has slowly twisted it ' +
      'into a spiral about the Galactic pole (Nesvorný et al. 2025), while passing stars have made the outer ' +
      'cloud round. Each point here stands for millions of comets, and its brightness is artificial: the real ' +
      'cloud is far too faint to see.',
    simulated: true,
    credit:
      'Statistical model (not a catalogue): Duncan, Quinn & Tremaine (1987), Heisler & Tremaine (1986), ' +
      'Boe et al. (2019), Nesvorný et al. (2025)',
  };
}

export function cloudSearchEntry(target: Bookmark): SearchEntry {
  return {
    id: CLOUD_INFO_ID,
    name: 'Oort Cloud',
    aliases: [
      'Öpik-Oort cloud',
      'Opik-Oort cloud',
      'Hills cloud',
      'Inner Oort Cloud',
      'Outer Oort Cloud',
      'Oort spiral',
      'comet cloud',
    ],
    subtitle: 'Simulated comet cloud around the Solar System',
    kind: 'other',
    target,
    priority: 3,
  };
}
