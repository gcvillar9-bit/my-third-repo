import { describe, expect, it } from 'vitest';
import { parseEnv } from '../../../src/app/env';
import {
  formatHash,
  instantOf,
  parseHash,
  shareUrl,
  stateFromCamera,
  UrlSync,
  type UrlState,
} from '../../../src/app/url-state';
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

describe('UrlSync (P4-P: no snap back to an applied bookmark)', () => {
  function fakeHost(hash: string) {
    let onChange: () => void = () => {};
    const host = {
      location: { hash, pathname: '/my-third-repo/', search: '', origin: 'http://x' },
      history: {
        state: null,
        replaceState: (_d: unknown, _u: string, url?: string | null) => {
          host.location.hash = url && url.startsWith('#') ? url : '';
        },
      },
      addEventListener: (_t: 'hashchange', cb: () => void) => {
        onChange = cb;
      },
      /** Simulates a navigation that changes the hash (address bar, history step). */
      navigate(h: string) {
        host.location.hash = h;
        onChange();
      },
    };
    return host;
  }
  const live = (x: number): UrlState => ({ f: 'moon.fixed', p: { x, y: 0, z: 0 }, t: '1969-07-21T03:00:00Z' });

  it('replaces the applied #b= hash with the live state at once', () => {
    const host = fakeHost('#b=apollo11-2m');
    const applied: UrlState[] = [];
    const sync = new UrlSync(() => live(1), (s) => applied.push(s), host);
    sync.commit();
    expect(host.location.hash).toBe(formatHash(live(1)));
    sync.tick(500);
    expect(applied).toEqual([]);
  });

  it('ignores hashchanges back to hashes it wrote or already applied', () => {
    const host = fakeHost('#b=apollo11-2m');
    const applied: UrlState[] = [];
    let x = 1;
    const sync = new UrlSync(() => live(x), (s) => applied.push(s), host);
    sync.commit();
    const first = host.location.hash;
    x = 5;
    sync.tick(2000);
    expect(host.location.hash).not.toBe(first);
    host.navigate(first); // e.g. a history step restoring an older written state
    expect(applied).toEqual([]);
    host.navigate('');
    expect(applied).toEqual([]);
  });

  it('applies a genuinely new hash once, then shows the live state again', () => {
    const host = fakeHost('');
    const applied: UrlState[] = [];
    const sync = new UrlSync(() => live(3), (s) => applied.push(s), host);
    host.navigate('#b=apollo11-2m');
    expect(applied).toEqual([{ b: 'apollo11-2m' }]);
    sync.tick(100); // written at once after an applied edit
    expect(host.location.hash).toBe(formatHash(live(3)));
    host.navigate('#b=apollo11-2m'); // the user enters it again: a real request
    expect(applied.length).toBe(2);
  });
});
