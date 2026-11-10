import { describe, expect, it } from 'vitest';
import {
  AutoQuality,
  devicePreset,
  initialQuality,
  QUALITY_AUTO_KEY,
  QUALITY_KEY,
  storeAutoLevel,
  storeQualityChoice,
} from '../../../src/app/auto-quality';
import { splashFraction } from '../../../src/app/splash';

function memoryStore(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    map: m,
  };
}

const desktop = { coarsePointer: false };

describe('quality choice at boot', () => {
  it('prefers ?q=, then the stored choice, then the device default', () => {
    expect(initialQuality('ultra', memoryStore({ [QUALITY_KEY]: 'low' }), desktop)).toEqual({
      preset: 'ultra',
      auto: false,
    });
    expect(initialQuality(null, memoryStore({ [QUALITY_KEY]: 'low' }), desktop)).toEqual({
      preset: 'low',
      auto: false,
    });
    expect(initialQuality('bogus', null, desktop)).toEqual({ preset: 'medium', auto: true });
    expect(initialQuality(null, null, { coarsePointer: true })).toEqual({ preset: 'low', auto: true });
    expect(devicePreset({ coarsePointer: false, memoryGb: 2 })).toBe('low');
    expect(devicePreset({ coarsePointer: false, memoryGb: 8 })).toBe('medium');
  });

  it('starts from the last automatic level only when it is lower than the device default', () => {
    expect(initialQuality(null, memoryStore({ [QUALITY_AUTO_KEY]: 'potato' }), desktop)).toEqual({
      preset: 'potato',
      auto: true,
    });
    expect(initialQuality(null, memoryStore({ [QUALITY_AUTO_KEY]: 'ultra' }), desktop).preset).toBe('medium');
  });

  it('stores and clears the choice, surviving a blocked storage', () => {
    const s = memoryStore();
    storeQualityChoice(s, 'high');
    storeAutoLevel(s, 'low');
    expect(s.map.get(QUALITY_KEY)).toBe('high');
    storeQualityChoice(s, null);
    expect(s.map.size).toBe(0);
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(() => storeQualityChoice(blocked, 'low')).not.toThrow();
    expect(initialQuality(null, blocked, desktop).preset).toBe('medium');
  });
});

describe('AutoQuality', () => {
  it('steps down after a sustained slow spell at the lowest resolution, then waits', () => {
    const a = new AutoQuality({ slowMs: 40, holdMs: 3000, settleMs: 2000 });
    let out: string | null = null;
    let t = 0;
    while (!out && t < 10_000) {
      out = a.sample(100, 100, true, 'medium');
      t += 100;
    }
    expect(out).toBe('low');
    expect(t).toBe(3000);
    // Settling: no second step straight away.
    for (let i = 0; i < 19; i++) expect(a.sample(100, 100, true, 'low')).toBeNull();
  });

  it('does nothing while resolution can still drop, on fast frames, or at potato', () => {
    const a = new AutoQuality({ slowMs: 40, holdMs: 1000, settleMs: 0 });
    for (let i = 0; i < 100; i++) expect(a.sample(100, 100, false, 'medium')).toBeNull();
    for (let i = 0; i < 100; i++) expect(a.sample(16, 16, true, 'medium')).toBeNull();
    let last: string | null = 'x';
    for (let i = 0; i < 20; i++) last = a.sample(100, 100, true, 'potato');
    expect(last).toBeNull();
  });

  it('a fast spell clears the slow timer', () => {
    const a = new AutoQuality({ slowMs: 40, holdMs: 1000, settleMs: 0 });
    for (let i = 0; i < 9; i++) expect(a.sample(100, 100, true, 'high')).toBeNull();
    expect(a.sample(16, 16, true, 'high')).toBeNull();
    for (let i = 0; i < 9; i++) expect(a.sample(100, 100, true, 'high')).toBeNull();
    expect(a.sample(100, 100, true, 'high')).toBe('medium');
  });
});

describe('splash progress', () => {
  it('is monotonic and bounded', () => {
    expect(splashFraction(0, 0)).toBeCloseTo(0.04);
    const a = splashFraction(5, 10);
    expect(a).toBeCloseTo(0.5);
    // More work queued: the bar holds instead of jumping back.
    expect(splashFraction(5, 40, a)).toBe(a);
    expect(splashFraction(40, 40, a)).toBeCloseTo(0.96);
  });
});
