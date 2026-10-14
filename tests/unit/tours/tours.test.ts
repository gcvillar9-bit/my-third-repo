import { describe, expect, it } from 'vitest';
import type { Bookmark, TourDef } from '../../../src/core/contracts';
import { COSMIC_ZOOM } from '../../../src/modules/tours/cosmic-zoom';
import { compileTour, DEFAULT_GOTO_S, TourPlayer, type TourActions } from '../../../src/modules/tours/player';

interface Rec {
  log: string[];
  orbit: number;
  actions: TourActions;
}

/** Recording actions with a fake clock: each instant action is logged with the player's scheduled time. */
function recorder(missing: string[] = [], now: () => number = () => 0): Rec {
  const rec: Rec = { log: [], orbit: 0, actions: null as unknown as TourActions };
  const id = (t: string | Bookmark) => (typeof t === 'string' ? t : t.id);
  rec.actions = {
    has: (t) => !missing.includes(id(t)),
    goto: (t, d) => rec.log.push(`${now().toFixed(3)} goto ${id(t)} ${d.toFixed(3)}`),
    orbit: (_t, r) => (rec.orbit += r),
    setRate: (r) => rec.log.push(`${now().toFixed(3)} rate ${r}`),
    setTime: (jd) => rec.log.push(`${now().toFixed(3)} time ${jd}`),
    caption: (c) => rec.log.push(`${now().toFixed(3)} caption ${c}`),
    setting: (k, v) => rec.log.push(`${now().toFixed(3)} setting ${k}=${String(v)}`),
  };
  return rec;
}

/** Plays a tour to the end with a fixed tick, returning the action log. */
function play(def: TourDef, dt: number, missing: string[] = [], speed = 1) {
  let player: TourPlayer | null = null;
  const rec = recorder(missing, () => player?.status().time ?? 0);
  player = new TourPlayer(def, rec.actions, speed);
  let ticks = 0;
  while (!player.done && ticks++ < 1e6) player.tick(dt);
  return { rec, player, ticks };
}

const SMALL: TourDef = {
  id: 'small',
  title: 'Small',
  steps: [
    { type: 'caption', text: 'intro' },
    { type: 'goto', target: 'a', duration: 2 },
    { type: 'caption', text: 'at a', seconds: 1 },
    { type: 'orbit', target: 'a', degrees: 90, duration: 3 },
    { type: 'goto', target: 'missing', duration: 5 },
    { type: 'caption', text: 'never shown' },
    { type: 'wait', seconds: 4 },
    { type: 'goto', target: 'b' },
    { type: 'timeRate', rate: 1000 },
    { type: 'speak', text: 'ignored' },
    { type: 'caption', text: 'at b' },
    { type: 'wait', seconds: 2 },
  ],
};

describe('tour schedule', () => {
  it('compiles to fixed event times and skips a missing stop with its captions and waits', () => {
    const c = compileTour(SMALL, (t) => t !== 'missing');
    expect(c.skipped).toEqual(['missing']);
    expect(c.stops.map((s) => [s.time, s.target])).toEqual([
      [0, 'a'],
      [5, 'b'],
    ]);
    expect(c.total).toBe(5 + DEFAULT_GOTO_S + 2);
    expect(c.events.map((e) => [e.time, e.step.type])).toEqual([
      [0, 'caption'],
      [0, 'goto'],
      [2, 'caption'],
      [3, 'clearCaption'],
      [5, 'goto'],
      [12, 'timeRate'],
      [12, 'caption'],
    ]);
    expect(c.orbits).toEqual([{ start: 2, end: 5, target: 'a', radians: Math.PI / 2 }]);
    expect(JSON.stringify(c.events)).not.toContain('never shown');
  });

  it('is deterministic: the same action log for any tick size (fake clock)', () => {
    const a = play(SMALL, 1 / 60, ['missing']);
    const b = play(SMALL, 0.37, ['missing']);
    const c = play(SMALL, 5, ['missing']);
    expect(a.rec.log.length).toBeGreaterThan(5);
    // Log entries carry the time the action fired; sizes differ only in when a tick lands, so compare actions.
    const strip = (log: string[]) => log.map((l) => l.replace(/^\S+ /, ''));
    expect(strip(b.rec.log)).toEqual(strip(a.rec.log));
    expect(strip(c.rec.log)).toEqual(strip(a.rec.log));
    expect(a.rec.orbit).toBeCloseTo(Math.PI / 2, 9);
    expect(b.rec.orbit).toBeCloseTo(Math.PI / 2, 9);
    expect(c.rec.orbit).toBeCloseTo(Math.PI / 2, 9);
    // Two runs with the same tick give identical logs, timestamps included.
    expect(play(SMALL, 1 / 60, ['missing']).rec.log).toEqual(a.rec.log);
    // Ends with the caption cleared.
    expect(a.rec.log.at(-1)).toMatch(/caption null$/);
    expect(a.player.status().done).toBe(true);
  });

  it('fires events at their scheduled times with a 1/60 s clock', () => {
    const { rec } = play(SMALL, 1 / 60, ['missing']);
    const at = (s: string) => Number(rec.log.find((l) => l.includes(s))!.split(' ')[0]);
    // Actions fire inside the tick that crosses their time; the log holds the tick's start time.
    expect(at('goto a')).toBe(0);
    expect(at('caption at a')).toBeCloseTo(2, 1);
    expect(at('goto b')).toBeCloseTo(5, 1);
    expect(at('rate 1000')).toBeCloseTo(12, 1);
  });

  it('speed scales the schedule and the flight durations', () => {
    const slow = play(SMALL, 1 / 60, ['missing'], 1);
    const fast = play(SMALL, 1 / 60, ['missing'], 10);
    expect(fast.ticks).toBeLessThan(slow.ticks / 8);
    expect(fast.rec.log.find((l) => l.includes('goto a'))).toMatch(/goto a 0\.200$/);
  });

  it('pause holds the schedule, next() jumps to the next stop, stop() clears the caption', () => {
    const rec = recorder(['missing']);
    const p = new TourPlayer(SMALL, rec.actions);
    p.tick(1);
    p.paused = true;
    p.tick(100);
    expect(p.status().time).toBe(1);
    p.paused = false;
    p.next();
    expect(p.status()).toMatchObject({ stop: 2, target: 'b', time: 5 });
    p.stop();
    expect(p.status().done).toBe(true);
    expect(rec.log.at(-1)).toMatch(/caption null$/);
  });

  it('a tour whose every target is missing finishes immediately', () => {
    const p = new TourPlayer(
      { id: 'x', title: 'x', steps: [{ type: 'goto', target: 'gone' }] },
      recorder(['gone']).actions,
    );
    expect(p.done).toBe(true);
  });
});

describe('Cosmic Zoom', () => {
  const ids = COSMIC_ZOOM.steps.flatMap((s) => (s.type === 'goto' ? [s.target as string] : []));

  it('visits the planned stops in order, from the Apollo 11 boot print back home', () => {
    expect(ids).toEqual([
      'apollo11-2m',
      'moon-low-orbit',
      'earth-limb-400km',
      'solar-system-overview',
      'sun-from-alpha-cen',
      'mw-outside-100kpc',
      'sgra-lensing',
      'm31-approach',
      'virgo-cluster',
      'cosmic-web-500mpc',
      'earth-now',
    ]);
  });

  it('skips the galaxy stops when their bookmarks are missing and still ends at home', () => {
    const missing = ['m31-approach', 'virgo-cluster', 'cosmic-web-500mpc'];
    const { rec } = play(COSMIC_ZOOM, 1 / 30, missing);
    const gotos = rec.log.filter((l) => l.includes(' goto ')).map((l) => l.split(' ')[2]);
    expect(gotos).toEqual(ids.filter((i) => !missing.includes(i)));
    expect(rec.log.join('\n')).not.toMatch(/Andromeda|Virgo|cosmic web:/);
    // Time rate is raised for the Solar System and put back afterwards.
    expect(rec.log.filter((l) => l.includes(' rate ')).map((l) => l.split(' ')[2])).toEqual(['2000000', '1']);
  });

  it('lasts a few minutes with every bookmark present and captions every stop', () => {
    const c = compileTour(COSMIC_ZOOM, () => true);
    expect(c.total).toBeGreaterThan(120);
    expect(c.total).toBeLessThan(240);
    expect(c.stops.length).toBe(11);
    for (const s of c.stops)
      expect(
        c.events.some((e) => e.step.type === 'caption' && e.time >= s.time && e.time <= s.time + 10),
      ).toBe(true);
  });
});
