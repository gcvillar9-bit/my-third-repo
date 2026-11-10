/**
 * Explore panel catalogue: a curated, ordered list of destinations by theme, so people can
 * browse what exists without knowing what to type. Items are plain ids resolved at runtime
 * against the search index (body id, bookmark id, `tour:<id>`, or an exact name such as
 * 'Sirius'), so a build without some module simply shows fewer rows. Bookmarks that no group
 * lists are collected under "More places" (new modules appear without touching this file).
 */
import type { SearchEntry } from '../core/contracts';

export interface ExploreGroup {
  id: string;
  title: string;
  /** One line under the title. */
  blurb: string;
  /** Body ids, bookmark ids, `tour:<id>` or exact entry names, in display order. */
  items: readonly string[];
}

export const EXPLORE_GROUPS: readonly ExploreGroup[] = [
  {
    id: 'tours',
    title: 'Guided tours',
    blurb: 'Sit back: narrated flights you can pause or leave at any time.',
    items: [
      'tour:cosmic-zoom',
      'tour:grand-tour',
      'tour:earth-through-time',
      'tour:black-holes',
      'tour:starlight',
    ],
  },
  {
    id: 'solar-system',
    title: 'Solar System',
    blurb: 'The Sun, planets, moons and small worlds at their real positions.',
    items: [
      'solar-system-overview',
      'sun',
      'mercury',
      'venus',
      'earth',
      'moon',
      'mars',
      'asteroid-belt-3au',
      'ceres',
      'vesta',
      'jupiter',
      'jupiter-moons',
      'io',
      'europa',
      'ganymede',
      'callisto',
      'saturn',
      'enceladus',
      'titan',
      'uranus',
      'neptune',
      'triton',
      'pluto',
      'charon',
    ],
  },
  {
    id: 'sights',
    title: 'Sights of the Solar System',
    blurb: 'Eclipses, ring shadows, sunsets on other worlds.',
    items: [
      'apollo11-2m',
      'moon-low-orbit',
      'mars-gale-sunset',
      'saturn-backlit-2013-07-19',
      'jupiter-io-shadow',
      'uranus-rings',
      'sun-closeup',
      'sun-sunspots',
      'sun-halpha-prominences',
      'eclipse-2027-luxor',
      'eclipse-next-solar',
      'eclipse-next-lunar',
      'halley-1986',
      'hale-bopp-1997',
    ],
  },
  {
    id: 'spacecraft',
    title: 'Spacecraft',
    blurb: 'Stations, telescopes and the probes leaving the Solar System.',
    items: ['iss-over-earth', 'hubble', 'jwst-l2', 'voyager1-looking-back', 'new-horizons'],
  },
  {
    id: 'earth',
    title: 'Earth today',
    blurb: 'Home, from orbit down to the ground.',
    items: [
      'earth-now',
      'earth-dawn-400km',
      'earth-sunrise-400km',
      'earth-limb-400km',
      'earth-night-lights',
      'earth-himalaya',
    ],
  },
  {
    id: 'deep-time',
    title: 'Earth through deep time',
    blurb: 'Drifting continents, ice ages and the life of each era (approximate).',
    items: [
      'earth-pangaea-250ma',
      'life-permian-252ma',
      'life-jurassic-150ma',
      'earth-seaway-90ma',
      'life-trex-66ma',
      'earth-dusk-66ma',
      'life-lucy-3ma',
      'life-mammoth-45ka',
      'earth-lgm-21ka',
    ],
  },
  {
    id: 'cities',
    title: 'Cities through history',
    blurb: 'Stand in the streets of the largest cities of their day (approximate).',
    items: [
      'city-giza-2450bc',
      'city-babylon-570bc',
      'city-rome-117ad',
      'city-labels-117ad',
      'city-paris-1350',
      'city-tenochtitlan-1500',
      'city-newyork-1935',
    ],
  },
  {
    id: 'stars',
    title: 'Stars and constellations',
    blurb: 'Real stars in three dimensions; the figures fall apart as you leave home.',
    items: [
      'orion-from-earth',
      'orion-lines-from-earth',
      'orion-from-200ly',
      'big-dipper-100kyr',
      'sun-from-alpha-cen',
      'Alpha Centauri',
      'Sirius',
      'Betelgeuse',
      'Vega',
      'Polaris',
      'm42-telescope',
      'm42-from-20ly',
      'trapezium-inside',
      'm42-astrophoto',
      'm43-close',
    ],
  },
  {
    id: 'exoplanets',
    title: 'Exoplanets',
    blurb: 'Planets of other stars, with their habitable zones.',
    items: ['trappist-1', 'proxima-b', 'kepler-186f', '51-peg-b'],
  },
  {
    id: 'milky-way',
    title: 'The Milky Way',
    blurb: 'Our galaxy from the inside and from far outside.',
    items: ['mw-band-from-earth', 'mw-above-sun-1kpc', 'mw-outside-100kpc', 'mw-edge-on'],
  },
  {
    id: 'black-holes',
    title: 'Black holes',
    blurb: 'Light bent around the real black holes we know.',
    items: ['sgra-lensing', 'sgra-s2-periapsis', 'm87-shadow', 'cygx1-disk', 'gaia-bh3-dormant'],
  },
  {
    id: 'galaxies',
    title: 'Galaxies and the cosmic web',
    blurb: 'Out past Andromeda to the largest structures there are.',
    items: [
      'local-group',
      'm31-approach',
      'LMC',
      'SMC',
      'M33',
      'M81',
      'M82',
      'M51',
      'M104',
      'Cen A',
      'virgo-cluster',
      'great-attractor',
      'laniakea',
      'cosmic-web-500mpc',
    ],
  },
];

export const MORE_GROUP: Omit<ExploreGroup, 'items'> = {
  id: 'more',
  title: 'More places',
  blurb: 'Other saved views.',
};

export interface ExploreItem {
  key: string;
  entry: SearchEntry;
}

export interface ResolvedGroup {
  group: Omit<ExploreGroup, 'items'>;
  items: ExploreItem[];
}

export interface ExploreLookup {
  byId(id: string): SearchEntry | undefined;
  byName(name: string): SearchEntry | undefined;
  /** Every bookmark entry (for "More places"). */
  bookmarks(): readonly SearchEntry[];
}

/** Bookmarks that exist for tests and tooling, never listed. */
const HIDDEN = /^(debug-|terrain-jitter)/;

/** Resolves the catalogue against what is registered; groups left empty are dropped. */
export function resolveExplore(
  lookup: ExploreLookup,
  groups: readonly ExploreGroup[] = EXPLORE_GROUPS,
): ResolvedGroup[] {
  const out: ResolvedGroup[] = [];
  const listed = new Set<string>();
  for (const g of groups) {
    const items: ExploreItem[] = [];
    for (const key of g.items) {
      // A body id and its bookmark share the id: prefer the body entry (it carries the info card).
      const entry = lookup.byId(key) ?? lookup.byId(`bookmark:${key}`) ?? lookup.byName(key);
      listed.add(`bookmark:${key}`);
      if (!entry || items.some((i) => i.entry.id === entry.id)) continue;
      listed.add(entry.id);
      items.push({ key, entry });
    }
    if (items.length) out.push({ group: g, items });
  }
  const rest = lookup
    .bookmarks()
    .filter((e) => !listed.has(e.id) && !HIDDEN.test(e.id.replace(/^bookmark:/, '')))
    .map((entry) => ({ key: entry.id, entry }));
  if (rest.length) out.push({ group: MORE_GROUP, items: rest });
  return out;
}
