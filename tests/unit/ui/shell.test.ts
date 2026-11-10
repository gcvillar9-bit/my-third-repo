import { describe, expect, it } from 'vitest';
import type { SearchEntry } from '../../../src/core/contracts';
import { HELP_SECTIONS, HELP_TEXT } from '../../../src/ui/app';
import { formatLatLon, pickCandidate, PICK_SLOP_PX, TEST_BOOKMARK } from '../../../src/ui/controller';
import { EXPLORE_GROUPS, resolveExplore, type ExploreLookup } from '../../../src/ui/explore';
import { SearchIndex } from '../../../src/ui/search';

const entry = (id: string, name: string, extra: Partial<SearchEntry> = {}): SearchEntry => ({
  id,
  name,
  kind: 'other',
  target: id,
  ...extra,
});

function lookupOf(entries: SearchEntry[]): ExploreLookup {
  const byId = new Map(entries.map((e) => [e.id, e]));
  return {
    byId: (id) => byId.get(id),
    byName: (name) => entries.find((e) => e.name.toLowerCase() === name.toLowerCase()),
    bookmarks: () => entries.filter((e) => e.id.startsWith('bookmark:')),
  };
}

describe('Explore catalogue', () => {
  it('has unique group ids and no item listed twice in a group', () => {
    expect(new Set(EXPLORE_GROUPS.map((g) => g.id)).size).toBe(EXPLORE_GROUPS.length);
    for (const g of EXPLORE_GROUPS) {
      expect(new Set(g.items).size, g.id).toBe(g.items.length);
      expect(g.blurb.length, g.id).toBeGreaterThan(10);
    }
  });

  it('resolves bodies, bookmarks, tours and names, and drops what is not registered', () => {
    const entries = [
      entry('mars', 'Mars', { kind: 'planet' }),
      entry('bookmark:mars', 'Mars'),
      entry('bookmark:apollo11-2m', 'Apollo 11 landing site'),
      entry('tour:cosmic-zoom', 'Tour: Cosmic Zoom', { kind: 'tour' }),
      entry('hip:32349', 'Sirius', { kind: 'star' }),
      entry('bookmark:somewhere-new', 'Somewhere new'),
      entry('bookmark:terrain-jitter-a', 'Terrain jitter A (test)'),
      entry('bookmark:debug-sphere', 'Debug sphere'),
    ];
    const groups = resolveExplore(lookupOf(entries));
    const ids = (g: string) => groups.find((x) => x.group.id === g)?.items.map((i) => i.entry.id);
    expect(ids('tours')).toEqual(['tour:cosmic-zoom']);
    // The body entry wins over the bookmark of the same id.
    expect(ids('solar-system')).toEqual(['mars']);
    expect(ids('sights')).toEqual(['bookmark:apollo11-2m']);
    expect(ids('stars')).toEqual(['hip:32349']);
    // Groups with nothing registered are dropped; unlisted bookmarks land in "More places".
    expect(groups.some((g) => g.group.id === 'black-holes')).toBe(false);
    expect(ids('more')).toEqual(['bookmark:somewhere-new']);
  });

  it('never lists a bookmark twice: once in its group, not again under More places', () => {
    const entries = [entry('bookmark:earth-now', 'Earth now'), entry('bookmark:mars', 'Mars')];
    const groups = resolveExplore(lookupOf(entries));
    const all = groups.flatMap((g) => g.items.map((i) => i.entry.id));
    expect(new Set(all).size).toBe(all.length);
    expect(groups.some((g) => g.group.id === 'more')).toBe(false);
  });
});

describe('search by exact name', () => {
  it('matches names and aliases without case or accents, preferring the higher priority', () => {
    const idx = new SearchIndex(
      () => [],
      () => [
        entry('a', 'Sirius', { priority: 1 }),
        entry('b', 'Sirius', { priority: 5 }),
        entry('c', 'Alpha Centauri', { aliases: ['Rigil Kentaurus'] }),
      ],
    );
    expect(idx.byName('sirius')?.id).toBe('b');
    expect(idx.byName('rigil kentaurus')?.id).toBe('c');
    expect(idx.byName('Siri')).toBeUndefined();
  });
});

describe('picking a world under the pointer', () => {
  const c = (id: string, x: number, y: number, r: number, depth: number, priority = 50) => ({
    id,
    x,
    y,
    r,
    depth,
    priority,
  });

  it('takes the nearest disc that contains the point', () => {
    const moonInFront = [c('jupiter', 200, 200, 80, 7e8), c('io', 230, 210, 6, 4e8)];
    expect(pickCandidate(moonInFront, 231, 211)).toBe('io');
    expect(pickCandidate(moonInFront, 160, 200)).toBe('jupiter');
    // A moon behind the planet is hidden by it.
    const moonBehind = [c('jupiter', 200, 200, 80, 7e8), c('io', 230, 210, 6, 9e8)];
    expect(pickCandidate(moonBehind, 231, 211)).toBe('jupiter');
  });

  it('gives points some slack and returns null on empty sky', () => {
    const pts = [c('mars', 100, 100, 0.2, 1e11, 80), c('phobos', 104, 100, 0.01, 1e11, 45)];
    expect(pickCandidate(pts, 100 + PICK_SLOP_PX - 1, 100)).toBe('phobos');
    expect(pickCandidate(pts, 101, 101)).toBe('mars');
    // Equally close: the more important body wins.
    expect(pickCandidate(pts, 102, 100)).toBe('mars');
    expect(pickCandidate(pts, 300, 300)).toBeNull();
  });
});

describe('surface position readout', () => {
  it('formats planetocentric latitude and east longitude', () => {
    expect(formatLatLon({ x: 1, y: 0, z: 0 })).toBe('0.00°N 0.00°E');
    expect(formatLatLon({ x: 0, y: -1, z: 1 })).toBe('45.00°N 90.00°W');
    expect(formatLatLon({ x: -1, y: 1e-9, z: -1e-9 })).toBe('0.00°S 180.00°E');
    expect(formatLatLon({ x: 0, y: 0, z: 0 })).toBe('');
  });
});

describe('help and housekeeping', () => {
  it('lists every shortcut once per section and keeps the plain-text form', () => {
    for (const s of HELP_SECTIONS) expect(new Set(s.rows.map((r) => r[0])).size, s.title).toBe(s.rows.length);
    expect(HELP_TEXT).toContain('X explore');
    expect(HELP_TEXT).toContain('Shift+G land');
    expect(HELP_TEXT).toContain('Shift+O orbit lines');
  });

  it('recognises test-only bookmarks by their title', () => {
    expect(TEST_BOOKMARK.test('Terrain jitter A (test)')).toBe(true);
    expect(TEST_BOOKMARK.test('Earth: dawn from 400 km')).toBe(false);
  });
});
