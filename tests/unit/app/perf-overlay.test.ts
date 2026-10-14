import { describe, expect, it } from 'vitest';
import { gpuTimerSupported } from '../../../src/app/perf-overlay';

describe('perf overlay', () => {
  it('detects GPU timer queries without throwing', () => {
    expect(gpuTimerSupported(null)).toBe(false);
    expect(gpuTimerSupported({ getExtension: () => null })).toBe(false);
    expect(gpuTimerSupported({ getExtension: () => ({}) as never })).toBe(true);
    expect(
      gpuTimerSupported({
        getExtension: () => {
          throw new Error('lost context');
        },
      }),
    ).toBe(false);
  });
});
