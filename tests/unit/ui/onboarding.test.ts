import { describe, expect, it } from 'vitest';
import { markOnboarded, ONBOARDING_KEY, shouldOnboard } from '../../../src/app/onboarding';

const env = (test: boolean, query = '') => ({ test, params: new URLSearchParams(query) });

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

describe('onboarding flag', () => {
  it('shows once per browser: first visit yes, after marking no', () => {
    const s = memory();
    expect(shouldOnboard(env(false), s)).toBe(true);
    markOnboarded(s);
    expect(s.m.get(ONBOARDING_KEY)).toBe('1');
    expect(shouldOnboard(env(false), s)).toBe(false);
  });

  it('never in test mode or with ?ui=0', () => {
    expect(shouldOnboard(env(true), memory())).toBe(false);
    expect(shouldOnboard(env(false, 'ui=0'), memory())).toBe(false);
  });

  it('survives blocked or throwing storage', () => {
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(shouldOnboard(env(false), throwing)).toBe(true);
    expect(() => markOnboarded(throwing)).not.toThrow();
    expect(shouldOnboard(env(false), null)).toBe(true);
    expect(() => markOnboarded(null)).not.toThrow();
  });
});
