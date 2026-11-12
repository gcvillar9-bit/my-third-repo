import { describe, expect, it } from 'vitest';
import { v3dot, v3len, vec3 } from '../../../src/core/math64';
import {
  eclToIcrf,
  fadesAt,
  formatAu,
  GALACTIC_CENTRE_ECL,
  GALACTIC_POLE_ECL,
  icrfToEcl,
} from '../../../src/modules/oort/shared';

const DEG = Math.PI / 180;

describe('oort shared state', () => {
  it('keeps every Oort visual out of the inner Solar System and out of other stars skies', () => {
    // Earth, Pluto, Voyager 1 (about 170 AU): nothing.
    for (const d of [1, 40, 170, 200]) expect(fadesAt(d), `${d} AU`).toEqual([0, 0]);
    // Alpha Centauri is 276,000 AU away.
    expect(fadesAt(276_000)).toEqual([0, 0]);
    expect(fadesAt(1e7)).toEqual([0, 0]);
  });

  it('shows lines before the cloud on the way out, and both across the cloud', () => {
    const [cloud, lines] = fadesAt(400);
    expect(lines).toBe(1);
    expect(cloud).toBeGreaterThan(0);
    expect(cloud).toBeLessThan(0.2);
    for (const d of [1500, 10_000, 170_000, 200_000]) expect(fadesAt(d), `${d} AU`).toEqual([1, 1]);
    const [c, l] = fadesAt(230_000);
    expect(c).toBeCloseTo(0.5, 5);
    expect(l).toBeCloseTo(0.5, 5);
  });

  it('has the Galactic pole 60.2 degrees from the ecliptic pole', () => {
    expect(v3len(GALACTIC_POLE_ECL)).toBeCloseTo(1, 9);
    expect(Math.acos(GALACTIC_POLE_ECL.z) / DEG).toBeCloseTo(60.19, 1);
    expect(v3dot(GALACTIC_POLE_ECL, GALACTIC_CENTRE_ECL)).toBeCloseTo(0, 9);
    // The Galactic centre lies in Sagittarius: ecliptic longitude about 266.8, latitude about -5.5.
    const lon = (Math.atan2(GALACTIC_CENTRE_ECL.y, GALACTIC_CENTRE_ECL.x) / DEG + 360) % 360;
    expect(lon).toBeCloseTo(266.8, 0);
    expect(Math.asin(GALACTIC_CENTRE_ECL.z) / DEG).toBeCloseTo(-5.5, 0);
  });

  it('converts between ecliptic and ICRF axes both ways', () => {
    const v = vec3(0.3, -1.2, 2.5);
    const back = icrfToEcl(vec3(), eclToIcrf(vec3(), v));
    expect(back.x).toBeCloseTo(v.x, 12);
    expect(back.y).toBeCloseTo(v.y, 12);
    expect(back.z).toBeCloseTo(v.z, 12);
    // The ecliptic pole is tilted 23.44 degrees from the celestial pole, towards -y.
    const pole = eclToIcrf(vec3(), vec3(0, 0, 1));
    expect(Math.acos(pole.z) / DEG).toBeCloseTo(23.44, 2);
    expect(pole.y).toBeLessThan(0);
  });

  it('formats distances in AU', () => {
    expect(formatAu(120)).toBe('120 AU');
    expect(formatAu(63241.077)).toBe('63,200 AU');
    expect(formatAu(100000)).toBe('100,000 AU');
  });
});
