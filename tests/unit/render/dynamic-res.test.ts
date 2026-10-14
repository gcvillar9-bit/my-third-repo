import { describe, expect, it } from 'vitest';
import { DynamicResolution } from '../../../src/render/dynamic-res';

/** Feeds `seconds` of frames at a fixed interval; returns every scale change. */
function run(d: DynamicResolution, fps: number | ((scale: number) => number), seconds: number): number[] {
  const changes: number[] = [];
  let t = 0;
  while (t < seconds * 1000) {
    const f = typeof fps === 'number' ? fps : fps(d.scale);
    const dt = 1000 / f;
    t += dt;
    const s = d.sample(dt);
    if (s !== null) changes.push(s);
  }
  return changes;
}

describe('DynamicResolution', () => {
  it('holds full resolution at 60 fps', () => {
    const d = new DynamicResolution();
    expect(run(d, 60, 20)).toEqual([]);
    expect(d.scale).toBe(1);
  });

  it('steps down slowly at 30 fps and stops at the floor', () => {
    const d = new DynamicResolution({ min: 0.5 });
    const changes = run(d, 30, 3);
    // At most one change per cooldown: no sudden jump to the floor.
    expect(changes.length).toBeLessThanOrEqual(2);
    expect(changes[0]).toBe(0.95);
    run(d, 30, 30);
    expect(d.scale).toBe(0.5);
  });

  it('takes double steps when far too slow (15 fps)', () => {
    const d = new DynamicResolution();
    const changes = run(d, 15, 2.5);
    expect(changes[0]).toBe(0.9);
  });

  it('sees vsync-quantised 50 fps (16.7/33.3 ms mix) as too slow', () => {
    const d = new DynamicResolution();
    let changed: number | null = null;
    for (let i = 0; i < 200 && changed === null; i++) changed = d.sample(i % 5 === 4 ? 33.3 : 16.7);
    expect(changed).toBe(0.95);
  });

  it('ignores single hitches and stalls', () => {
    const d = new DynamicResolution();
    let t = 0;
    for (let i = 0; i < 1200; i++) {
      const dt = i % 30 === 0 ? 45 : 1000 / 60; // a 45 ms hitch twice a second
      t += dt;
      expect(d.sample(dt)).toBeNull();
    }
    expect(d.sample(2000)).toBeNull(); // tab was hidden
    expect(d.scale).toBe(1);
    expect(t).toBeGreaterThan(10_000);
  });

  it('recovers after the load drops, but only after the hold', () => {
    const d = new DynamicResolution();
    run(d, 30, 6);
    const low = d.scale;
    expect(low).toBeLessThan(1);
    const up = run(d, 60, 3);
    expect(up).toEqual([]); // < upHoldMs of headroom: no change yet
    run(d, 60, 60);
    expect(d.scale).toBe(1);
  });

  it('settles instead of oscillating when one step up is too slow', () => {
    // GPU-bound scene: 60 fps at or below 0.8, 48 fps above.
    const d = new DynamicResolution({}, 0.85);
    const changes = run(d, (s) => (s <= 0.8 + 1e-6 ? 60 : 48), 120);
    const ups = changes.filter((s, i) => i > 0 && s > changes[i - 1]).length;
    expect(ups).toBeLessThanOrEqual(4); // backed-off hold: 4 s, 8 s, 16 s, 32 s, 60 s
    expect(d.scale).toBeLessThanOrEqual(0.85);
  });

  it('respects per-preset bounds and quantises', () => {
    const d = new DynamicResolution({ min: 0.75, max: 1 }, 0.333);
    expect(d.scale).toBe(0.75);
    d.setBounds(0.5, 0.9);
    expect(d.scale).toBe(0.75);
    d.reset(1);
    expect(d.scale).toBe(0.9);
  });
});
