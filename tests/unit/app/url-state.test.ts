import { describe, expect, it } from 'vitest';
import { parseEnv } from '../../../src/app/env';
import { formatHash, instantOf, parseHash, shareUrl, stateFromCamera } from '../../../src/app/url-state';
import { jdToIso, utcToTt } from '../../../src/core/time';

describe('URL state', () => {
  it('round-trips camera hashes exactly', () => {
    const h =
      '#f=earth&p=6371000.123456789,-1.5e-7,1.5e21&q=0,0.7071067812,0,0.7071067812&t=2026-03-04T05%3A06%3A07.089Z';
    const s = parseHash(h);
    expect(s.f).toBe('earth');
    expect(s.p).toEqual({ x: 6371000.123456789, y: -1.5e-7, z: 1.5e21 });
    expect(s.q!.w).toBeCloseTo(0.7071067812, 12);
    expect(s.t).toBe('2026-03-04T05:06:07.089Z');
    expect(formatHash(s)).toBe(h);
    expect(parseHash(formatHash(s))).toEqual(s);
  });

  it('round-trips a camera state and instant through the hash', () => {
    const jd = utcToTt(2461103.712);
    const cam = {
      frame: 'star:32349',
      local: { x: Math.PI * 1e25, y: -2 / 3, z: 1e-3 },
      quat: { x: 0.1, y: 0.2, z: 0.3, w: Math.sqrt(0.86) },
      fovY: 1,
    };
    const back = parseHash(formatHash(stateFromCamera(cam, jd)));
    expect(back.f).toBe(cam.frame);
    expect(back.p).toEqual(cam.local);
    expect(back.q!.w).toBeCloseTo(cam.quat.w, 9);
    expect(Math.abs(instantOf(back.t)! - jd) * 86400).toBeLessThan(1e-3);
    expect(jdToIso(instantOf(back.t)!)).toBe(back.t);
  });

  it('handles bookmarks, junk and share links', () => {
    expect(parseHash('#b=earth-now')).toEqual({ b: 'earth-now' });
    expect(formatHash({ b: 'saturn', f: 'ignored' })).toBe('#b=saturn');
    expect(parseHash('#p=1,2&q=a,b,c,d')).toEqual({});
    expect(formatHash({})).toBe('');
    const url = shareUrl(
      { origin: 'https://x.io', pathname: '/my-third-repo/', search: '?test=1&q=potato&b=earth&debug' },
      { b: 'saturn' },
    );
    expect(url).toBe('https://x.io/my-third-repo/?q=potato&debug=#b=saturn');
  });

  it('parses the boot environment', () => {
    const env = parseEnv('?test=1&q=potato&seed=7&perf=1', '/my-third-repo/');
    expect(env).toMatchObject({ test: true, debug: false, perf: true, seed: 7, baseUrl: '/my-third-repo/' });
    expect(parseEnv('?debug', '/').debug).toBe(true);
  });
});
