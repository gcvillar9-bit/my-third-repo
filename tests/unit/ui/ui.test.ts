import { describe, expect, it, vi } from 'vitest';
import type { Body, SearchEntry, SearchProvider, SettingDef } from '../../../src/core/contracts';
import { quat, vec3 } from '../../../src/core/math64';
import { AU, C, LY, MPC } from '../../../src/core/units';
import {
  formatInstant,
  formatLightTime,
  formatRate,
  formatSpeed,
  frameLabel,
  logScaleFraction,
} from '../../../src/ui/format';
import { bodyPriority, declutter, occluded, project, type LabelBox } from '../../../src/ui/labels';
import { bodyEntry, bookmarkEntry, SearchIndex } from '../../../src/ui/search';
import { SettingsStoreImpl } from '../../../src/ui/settings';
import { uiVisible } from '../../../src/ui/index';

const body = (id: string, name: string, kind: Body['kind'], radius = 1e6, parent?: string): Body => ({
  id,
  name,
  kind,
  frame: id,
  radius,
  influenceRadius: radius * 100,
  parent,
});

const star = (id: string, name: string, aliases: string[], priority: number): SearchEntry => ({
  id,
  name,
  aliases,
  kind: 'star',
  target: id,
  priority,
});

describe('palette search ranking', () => {
  const stars: SearchProvider = {
    id: 'stars',
    entries: () => [
      star('hip:32349', 'Sirius', ['α CMa', 'Alpha CMa', 'HIP 32349'], 3.1),
      star('hip:113881', 'Scheat', ['β Peg'], 2.8),
      star('hip:677', 'Alpheratz', ['α And', 'Alpha And'], 2.8),
      star('hip:71683', 'Rigil Kentaurus', ['α¹ Cen', 'Alpha1 Cen', 'Alpha Cen', 'Alpha Centauri'], 3.0),
      star('hip:27989', 'Betelgeuse', ['α Ori', 'Alpha Ori'], 2.9),
      star('hip:24436', 'Rigel', ['β Ori', 'Beta Ori'], 3.0),
      star('star:9000', '9 Sir', [], 0),
    ],
  };
  const bodies = [
    body('saturn', 'Saturn', 'planet', 6e7),
    body('titan', 'Titan', 'moon', 2.6e6, 'saturn'),
    body('debug-sphere', 'Debug sphere', 'minor'),
  ];
  const builtins = () => [
    ...bodies.map((b) => bodyEntry(b, b.parent ? 'Saturn' : undefined)),
    bookmarkEntry({ id: 'debug-sphere', title: 'Debug sphere', frame: 'debug', pos: vec3() }),
  ];
  const index = new SearchIndex(() => [stars], builtins);
  const top = (q: string) => index.search(q, 5).map((r) => r.entry.id);

  it('exact names win, and prefixes beat fuzzy matches', () => {
    expect(top('sirius')[0]).toBe('hip:32349');
    expect(top('Rigel')[0]).toBe('hip:24436');
    expect(top('rig')).toEqual(expect.arrayContaining(['hip:24436', 'hip:71683']));
    expect(top('betel')[0]).toBe('hip:27989');
    expect(top('satrun')[0]).toBe('saturn'); // typo tolerated
  });

  it('matches aliases and designations', () => {
    expect(top('alpha centauri')[0]).toBe('hip:71683');
    expect(top('α Ori')[0]).toBe('hip:27989');
    expect(top('HIP 32349')[0]).toBe('hip:32349');
  });

  it('indexes registered bodies and bookmarks; providers win on duplicate ids', () => {
    const r = index.search('Debug sphere', 5);
    expect(r[0].entry.id).toBe('debug-sphere'); // body before its bookmark (priority)
    expect(r.map((x) => x.entry.id)).toContain('bookmark:debug-sphere');
    expect(index.byId('titan')?.subtitle).toBe('Moon of Saturn');
    const dup = new SearchIndex(
      () => [{ id: 'p', entries: () => [{ ...star('saturn', 'Saturn', [], 0), subtitle: 'from provider' }] }],
      builtins,
    );
    expect(dup.byId('saturn')?.subtitle).toBe('from provider');
  });

  it('breaks near-ties by priority and merges custom provider queries', () => {
    const p: SearchProvider = {
      id: 'q',
      entries: () => [star('a', 'Alpha Low', [], 0), star('b', 'Alpha High', [], 9)],
      query: (text) => (/^ngc\s*\d+$/i.test(text) ? [star('gal:ngc224', 'NGC 224', [], 0)] : []),
    };
    const idx = new SearchIndex(() => [p]);
    expect(idx.search('alpha', 2)[0].entry.id).toBe('b');
    expect(idx.search('NGC 224', 3)[0].entry.id).toBe('gal:ngc224');
    expect(idx.search('', 1)[0].entry.id).toBe('b');
  });

  it('invalidate() picks up new entries', () => {
    const list: SearchEntry[] = [];
    const idx = new SearchIndex(() => [{ id: 'x', entries: () => list }]);
    expect(idx.search('vega')).toHaveLength(0);
    list.push(star('hip:91262', 'Vega', [], 3));
    idx.invalidate();
    expect(idx.search('vega')[0].entry.name).toBe('Vega');
  });
});

describe('HUD unit formatting', () => {
  it('speed: m/s, then multiples of c, then ly/s, then Mpc/s', () => {
    expect(formatSpeed(3.2)).toBe('3.20 m/s');
    expect(formatSpeed(12_345)).toBe('12.3 km/s');
    expect(formatSpeed(0.5 * C)).toBe('0.50 c');
    expect(formatSpeed(3 * C)).toBe('3.00 c');
    expect(formatSpeed(2 * LY)).toBe('2.00 ly/s');
    expect(formatSpeed(250 * MPC)).toBe('250 Mpc/s');
  });

  it('light-time', () => {
    expect(formatLightTime(1)).toBe('3.34 ns');
    expect(formatLightTime(384_400e3)).toBe('1.28 s');
    expect(formatLightTime(AU)).toBe('8.32 min');
    expect(formatLightTime(4.24 * LY)).toBe('4.24 yr');
    expect(formatLightTime(2.5e6 * LY)).toBe('2.50 Myr');
  });

  it('time rate', () => {
    expect(formatRate(0)).toBe('paused');
    expect(formatRate(1)).toBe('1 s/s');
    expect(formatRate(-60)).toBe('−1 min/s');
    expect(formatRate(3600)).toBe('1 h/s');
    expect(formatRate(86400)).toBe('1 day/s');
    expect(formatRate(2.6e6)).toBe('1 month/s');
    expect(formatRate(3.15e7)).toBe('1 yr/s');
    expect(formatRate(3.15e11)).toBe('10 kyr/s');
    expect(formatRate(1e13)).toBe('316.9 kyr/s');
    expect(formatRate(3.15576e13)).toBe('1 Myr/s');
    expect(formatRate(-3.15576e14)).toBe('−10 Myr/s');
  });

  it('instants, date input value and the log scale bar', () => {
    const d = new Date('2026-01-01T12:34:56Z');
    expect(formatInstant(d, 0)).toBe('2026-01-01 12:34:56 UTC');
    expect(formatInstant(null, 2451545 + 365.25 * 1e7)).toBe('year 1.00e7');
    // Deep time from TT (present = 1950.0) with the geologic unit; BC dates with the year first.
    expect(formatInstant(null, 2433282.5 - 365.25 * 66.04e6)).toBe('≈ 66.0 Ma · Late Cretaceous');
    expect(formatInstant(null, 2433282.5 - 365.25 * 21e3)).toBe('≈ 21.0 ka · Pleistocene');
    expect(formatInstant(null, 2433282.5 - 365.25 * 255e6)).toBe('≈ 255.0 Ma · Permian');
    expect(formatInstant(new Date('-000499-03-15T12:00:00Z'), 0)).toBe('500 BC 03-15 12:00 UTC');
    expect(logScaleFraction(1)).toBe(0);
    expect(logScaleFraction(1e27)).toBe(1);
    expect(logScaleFraction(1e9)).toBeCloseTo(1 / 3, 9);
    expect(logScaleFraction(0)).toBe(0);
    const names: Record<string, string> = { earth: 'Earth' };
    expect(
      ['universe', 'mw', 'ssb', 'earth', 'earth.fixed'].map((f) => frameLabel(f, (x) => names[x])),
    ).toEqual(['Universe', 'Milky Way', 'Solar System', 'Earth', 'Earth']);
  });
});

describe('labels', () => {
  const box = (id: string, priority: number, left: number, top: number): LabelBox => ({
    item: { id, text: id, frame: 'ssb', local: vec3(), priority },
    x: left,
    y: top,
    left,
    top,
    w: 40,
    h: 15,
  });

  it('declutter keeps the higher priority of overlapping labels and caps at 64', () => {
    const out = declutter([box('low', 1, 0, 0), box('high', 5, 10, 5), box('apart', 0, 200, 200)]);
    expect(out.map((b) => b.item.id)).toEqual(['high', 'apart']);
    const many = Array.from({ length: 200 }, (_, i) =>
      box(`l${i}`, i, (i % 20) * 50, Math.floor(i / 20) * 20),
    );
    expect(declutter(many)).toHaveLength(64);
    expect(declutter(many)[0].item.id).toBe('l199');
  });

  it('projects to CSS pixels and rejects points behind the camera', () => {
    const p = { x: 0, y: 0, depth: 0 };
    expect(project(vec3(0, 0, -10), quat(), Math.PI / 2, 400, 200, p)).not.toBeNull();
    expect([p.x, p.y]).toEqual([200, 100]);
    project(vec3(0, 10, -10), quat(), Math.PI / 2, 400, 200, p);
    expect(p.y).toBeCloseTo(0, 9);
    expect(project(vec3(0, 0, 10), quat(), 1, 400, 200, p)).toBeNull();
  });

  it('ray-sphere occlusion hides labels behind bodies', () => {
    const occ = [{ id: 'moon', c: vec3(0, 0, -100), r: 10 }];
    expect(occluded(vec3(0, 0, -1000), occ, 'star')).toBe(true);
    expect(occluded(vec3(0, 200, -1000), occ, 'star')).toBe(false);
    expect(occluded(vec3(0, 0, -50), occ, 'probe')).toBe(false);
    expect(occluded(vec3(0, 0, -100), occ, 'moon')).toBe(false);
  });

  it('body priority: planets above moons above minor bodies', () => {
    const planet = bodyPriority(body('mars', 'Mars', 'planet', 3.4e6));
    const moon = bodyPriority(body('titan', 'Titan', 'moon', 2.6e6));
    const minor = bodyPriority(body('x', 'X', 'minor', 1e4));
    expect(planet).toBeGreaterThan(moon);
    expect(moon).toBeGreaterThan(minor);
  });
});

describe('settings store and shell visibility', () => {
  it('applies defaults, persisted values, coercion and onChange', () => {
    const mem = new Map<string, string>([['cosmos.setting.a.persisted', 'false']]);
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    };
    const store = new SettingsStoreImpl(storage);
    const onChange = vi.fn();
    const num: SettingDef = {
      id: 'a.n',
      label: 'n',
      group: 'g',
      type: 'number',
      default: 1,
      min: 0,
      max: 2,
      onChange,
    };
    store.register(num);
    expect(onChange).toHaveBeenCalledWith(1);
    store.set('a.n', 5);
    expect(store.get('a.n')).toBe(2);
    const persisted: SettingDef = {
      id: 'a.persisted',
      label: 'p',
      group: 'g',
      type: 'boolean',
      default: true,
      persist: true,
    };
    store.register(persisted);
    expect(store.get('a.persisted')).toBe(false);
    store.set('a.persisted', true);
    expect(mem.get('cosmos.setting.a.persisted')).toBe('true');
    const seen: unknown[] = [];
    store.subscribe('a.n', (v) => seen.push(v));
    store.set('a.n', 0.5);
    expect(seen).toEqual([0.5]);
  });

  it('the shell is hidden in test mode unless ?ui=1, and ?ui=0 hides it anywhere', () => {
    expect(uiVisible(new URLSearchParams(''), false)).toBe(true);
    expect(uiVisible(new URLSearchParams('test=1'), true)).toBe(false);
    expect(uiVisible(new URLSearchParams('test=1&ui=1'), true)).toBe(true);
    expect(uiVisible(new URLSearchParams('ui=0'), false)).toBe(false);
  });
});
