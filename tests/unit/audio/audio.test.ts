import { describe, expect, it } from 'vitest';
import {
  classifyZone,
  densityAt,
  GALAXY_EDGE_M,
  gravityPitch,
  HELIO_EDGE_M,
  PAD_VOICES,
  rumbleLevel,
  stepRate,
  whooshParams,
  windParams,
  ZONES,
  type FilteredGain,
} from '../../../src/modules/audio/mapping';
import {
  AUDIO_ENABLED_SETTING,
  AUDIO_SILENCE_SETTING,
  AUDIO_VOLUME_SETTING,
} from '../../../src/modules/audio/public';
import { audible, audioSettingDefs, DEFAULT_AUDIO_PREFS } from '../../../src/modules/audio/settings';
import { SettingsStoreImpl, type KeyValueStorage } from '../../../src/ui/settings';

const AU = 1.495978707e11;
const PC = 3.0857e16;
const R_EARTH = 6.371e6;
const fg = (): FilteredGain => ({ gain: -1, cutoff: -1 });

describe('audio zones', () => {
  const far = { dSun: 1e30, dGalaxy: 1e30 };
  it('classifies from surface to cosmic web', () => {
    expect(classifyZone({ altitude: 2, radius: R_EARTH, dSun: AU, dGalaxy: 8e3 * PC })).toBe('surface');
    expect(classifyZone({ altitude: 4e5, radius: R_EARTH, dSun: AU, dGalaxy: 8e3 * PC })).toBe('orbit');
    expect(classifyZone({ altitude: 3 * AU, radius: R_EARTH, dSun: 5 * AU, dGalaxy: 8e3 * PC })).toBe(
      'interplanetary',
    );
    expect(classifyZone({ altitude: Infinity, radius: 1, dSun: 10 * PC, dGalaxy: 8e3 * PC })).toBe(
      'interstellar',
    );
    expect(classifyZone({ altitude: Infinity, radius: 1, dSun: 5e3 * PC, dGalaxy: 3e3 * PC })).toBe(
      'galactic',
    );
    expect(classifyZone({ altitude: Infinity, radius: 1, ...far })).toBe('cosmic');
  });
  it('uses the documented edges and has a pad voice per zone', () => {
    expect(classifyZone({ altitude: Infinity, radius: 1, dSun: HELIO_EDGE_M * 0.99, dGalaxy: 1 })).toBe(
      'interplanetary',
    );
    expect(classifyZone({ altitude: Infinity, radius: 1, dSun: 1e30, dGalaxy: GALAXY_EDGE_M * 1.01 })).toBe(
      'cosmic',
    );
    for (const z of ZONES) expect(PAD_VOICES[z].intervals.length).toBeGreaterThan(2);
  });
});

describe('audio parameter mappings', () => {
  it('whoosh is silent when still and grows with speed and acceleration', () => {
    expect(whooshParams(0, 0, fg()).gain).toBe(0);
    const cruise = whooshParams(1, 0, fg());
    const fast = whooshParams(5, 0, fg());
    const accel = whooshParams(1, 4, fg());
    expect(cruise.gain).toBeGreaterThan(0);
    expect(fast.gain).toBeGreaterThan(cruise.gain);
    expect(accel.gain).toBeGreaterThan(cruise.gain);
    expect(fast.cutoff).toBeGreaterThan(cruise.cutoff);
    expect(fast.gain).toBeLessThanOrEqual(0.22);
    expect(whooshParams(1, -4, fg()).gain).toBeCloseTo(accel.gain, 9);
  });
  it('wind follows density x speed^2 and vanishes in vacuum', () => {
    expect(windParams(0, 300, 0, fg()).gain).toBe(0);
    const still = windParams(1.225, 0, 2, fg()).gain;
    const breeze = windParams(1.225, 10, 2, fg()).gain;
    const gale = windParams(1.225, 100, 2, fg()).gain;
    expect(still).toBeGreaterThan(0);
    expect(breeze).toBeGreaterThan(still);
    expect(gale).toBeGreaterThan(breeze);
    expect(gale).toBeLessThanOrEqual(0.4);
    expect(windParams(0.02, 10, 2, fg()).gain).toBeLessThan(breeze);
  });
  it('density proxy: exponential below the top, zero above or without a row', () => {
    expect(densityAt('earth', 0)).toBeCloseTo(1.225, 6);
    expect(densityAt('earth', 8500)).toBeCloseTo(1.225 / Math.E, 6);
    expect(densityAt('earth', 2e5)).toBe(0);
    expect(densityAt('moon', 0)).toBe(0);
    expect(densityAt('venus', 0)).toBeGreaterThan(densityAt('titan', 0));
    expect(densityAt('titan', 0)).toBeGreaterThan(densityAt('mars', 0));
  });
  it('black-hole rumble rises monotonically on approach', () => {
    const rs = 1.2e10;
    expect(rumbleLevel(1e7 * rs, rs)).toBe(0);
    expect(rumbleLevel(Infinity, rs)).toBe(0);
    const a = rumbleLevel(1e5 * rs, rs);
    const b = rumbleLevel(1e3 * rs, rs);
    const c = rumbleLevel(3 * rs, rs);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(rumbleLevel(0.5 * rs, rs)).toBeLessThanOrEqual(1);
  });
  it('footsteps: rate by speed, pitch by gravity', () => {
    expect(stepRate(0)).toBe(0);
    expect(stepRate(1.4)).toBeGreaterThan(1.5);
    expect(stepRate(20)).toBe(4);
    expect(gravityPitch(9.81)).toBeCloseTo(1, 9);
    expect(gravityPitch(1.62)).toBeLessThan(gravityPitch(3.71));
    expect(gravityPitch(1e-3)).toBe(0.55);
  });
});

describe('audio settings', () => {
  const fakeStorage = (init: Record<string, string> = {}) => {
    const data = new Map(Object.entries(init));
    const s: KeyValueStorage & { data: Map<string, string> } = {
      data,
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
    };
    return s;
  };

  it('defaults: sound on, volume 0.5, realistic silence off', () => {
    const prefs = { ...DEFAULT_AUDIO_PREFS };
    const store = new SettingsStoreImpl(fakeStorage());
    for (const d of audioSettingDefs(prefs, () => undefined)) store.register(d);
    expect(prefs).toEqual({ enabled: true, volume: 0.5, silence: false });
    expect(audible(prefs)).toBe(true);
  });

  it('persists changes and restores them (corrupt values fall back)', () => {
    const storage = fakeStorage();
    const prefs = { ...DEFAULT_AUDIO_PREFS };
    let calls = 0;
    const store = new SettingsStoreImpl(storage);
    for (const d of audioSettingDefs(prefs, () => calls++)) store.register(d);
    store.set(AUDIO_ENABLED_SETTING, false);
    store.set(AUDIO_VOLUME_SETTING, 0.8);
    store.set(AUDIO_SILENCE_SETTING, true);
    expect(calls).toBe(6);
    expect(storage.data.get(`cosmos.setting.${AUDIO_VOLUME_SETTING}`)).toBe('0.8');

    const prefs2 = { ...DEFAULT_AUDIO_PREFS };
    const store2 = new SettingsStoreImpl(storage);
    for (const d of audioSettingDefs(prefs2, () => undefined)) store2.register(d);
    expect(prefs2).toEqual({ enabled: false, volume: 0.8, silence: true });
    expect(audible(prefs2)).toBe(false);

    const prefs3 = { ...DEFAULT_AUDIO_PREFS };
    const bad = fakeStorage({ [`cosmos.setting.${AUDIO_VOLUME_SETTING}`]: '{nope' });
    const store3 = new SettingsStoreImpl(bad);
    for (const d of audioSettingDefs(prefs3, () => undefined)) store3.register(d);
    expect(prefs3.volume).toBe(0.5);
    store3.set(AUDIO_VOLUME_SETTING, 0);
    expect(audible(prefs3)).toBe(false);
  });

  it('survives a throwing storage', () => {
    const throwing: KeyValueStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const prefs = { ...DEFAULT_AUDIO_PREFS };
    const store = new SettingsStoreImpl(throwing);
    for (const d of audioSettingDefs(prefs, () => undefined)) store.register(d);
    expect(() => store.set(AUDIO_ENABLED_SETTING, false)).not.toThrow();
    expect(prefs.enabled).toBe(false);
  });
});
