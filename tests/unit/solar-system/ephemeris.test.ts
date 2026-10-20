import { readFileSync } from 'node:fs';
import {
  AstroTime,
  BaryState,
  Body as AeBody,
  GeoMoon,
  JupiterMoons,
  Observer,
  ObserverVector,
} from 'astronomy-engine';
import { describe, expect, it } from 'vitest';
import { FrameTreeImpl, addStandardFrames } from '../../../src/core/frames';
import { qrotate, quat, v3cross, v3dot, v3len, v3normalize, v3sub, vec3 } from '../../../src/core/math64';
import { parseInstant } from '../../../src/core/time';
import { AU, JD_J2000 } from '../../../src/core/units';
import type { BodiesFile, BodyRow } from '../../../src/modules/solar-system/data';
import { gmSI } from '../../../src/modules/solar-system/data';
import { SolarEphemeris } from '../../../src/modules/solar-system/ephemeris';
import { buildFrameDefs, fixedFrameId } from '../../../src/modules/solar-system/frames';
import {
  KeplerOrbit,
  conicFromState,
  keplerPeriodDays,
  solveKepler,
} from '../../../src/modules/solar-system/kepler';

const file = JSON.parse(readFileSync('public/data/solar-system/bodies.json', 'utf8')) as BodiesFile;
const rows = file.bodies;
const byId = new Map(rows.map((r) => [r.id, r]));
const eph = new SolarEphemeris(rows);
const frames = new FrameTreeImpl();
addStandardFrames(frames);
for (const f of buildFrameDefs(eph, ['earth'])) frames.addFrame(f);
const JD = parseInstant('2026-01-01T00:00:00Z')!;
const DEG = Math.PI / 180;

/** Sidereal period (days) of `id` around its parent, measured by unwrapping the in-plane angle. */
function measuredPeriod(id: string, guessDays: number, jd0 = JD): number {
  const r0 = vec3();
  const v0 = vec3();
  eph.stateAt(id, jd0, r0, v0);
  const n = v3normalize(vec3(), v3cross(vec3(), r0, v0));
  const e1 = v3normalize(vec3(), r0);
  const e2 = v3cross(vec3(), n, e1);
  const steps = 400;
  const dt = (1.2 * guessDays) / steps;
  let total = 0;
  let prev = 0;
  const p = vec3();
  for (let k = 1; k <= steps; k++) {
    eph.positionAt(id, jd0 + k * dt, p);
    const ang = Math.atan2(v3dot(p, e2), v3dot(p, e1));
    let d = ang - prev;
    if (d < -Math.PI) d += 2 * Math.PI;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (total + d >= 2 * Math.PI) return (k - 1 + (2 * Math.PI - total) / d) * dt;
    total += d;
    prev = ang;
  }
  return NaN;
}

describe('solar-system kepler', () => {
  it('solves Kepler equation to 1e-12 for e in [0, 0.99]', () => {
    for (const e of [0, 0.01, 0.2, 0.5, 0.8, 0.95, 0.99]) {
      for (let M = -10; M <= 10; M += 0.37) {
        const E = solveKepler(M, e);
        expect(Math.abs(E - e * Math.sin(E) - M)).toBeLessThan(1e-12);
      }
    }
  });

  it('round-trips a Kepler orbit through its osculating conic', () => {
    const titan = byId.get('titan')!;
    const orbit = eph.kepler('titan')!;
    const r = orbit.positionAt(JD, vec3());
    const v = orbit.velocityAt(JD, vec3());
    const mu = (4 * Math.PI ** 2 * orbit.a ** 3) / (titan.elements!.period * 86400) ** 2;
    const c = conicFromState(r, v, mu)!;
    expect(c.a / orbit.a).toBeCloseTo(1, 9);
    expect(c.e).toBeCloseTo(orbit.e, 9);
    expect(v3dot(c.P, orbit.P)).toBeCloseTo(1, 9);
  });

  it('has elements whose periods follow Kepler III within 1% (Hyperion 2.5%)', () => {
    for (const row of rows) {
      if (row.ephemeris !== 'kepler' || !row.elements || row.elements.center === 'ssb') continue;
      const center = byId.get(row.elements.center)!;
      const p = keplerPeriodDays(row.elements.a * 1e3, gmSI(center) + gmSI(row));
      const tol = row.id === 'hyperion' ? 0.025 : 0.01;
      expect(Math.abs(p / row.elements.period - 1), row.id).toBeLessThan(tol);
    }
  });
});

describe('solar-system ephemeris', () => {
  it('matches astronomy-engine BaryState through the frame tree within 1e-9 AU', () => {
    const t = AstroTime.FromTerrestrialTime(JD - JD_J2000);
    const map: [string, AeBody][] = [
      ['sun', AeBody.Sun],
      ['mercury', AeBody.Mercury],
      ['earth', AeBody.Earth],
      ['mars', AeBody.Mars],
      ['jupiter', AeBody.Jupiter],
      ['saturn', AeBody.Saturn],
      ['neptune', AeBody.Neptune],
      ['pluto', AeBody.Pluto],
    ];
    for (const [id, b] of map) {
      const ref = BaryState(b, t);
      const p = frames.relative('ssb', id, JD, vec3());
      const err = Math.hypot(p.x / AU - ref.x, p.y / AU - ref.y, p.z / AU - ref.z);
      expect(err, id).toBeLessThan(1e-9);
    }
    const moon = GeoMoon(t);
    const pm = frames.relative('earth', 'moon', JD, vec3());
    expect(Math.hypot(pm.x / AU - moon.x, pm.y / AU - moon.y, pm.z / AU - moon.z)).toBeLessThan(1e-9);
    const jm = JupiterMoons(t);
    const pg = frames.relative('jupiter', 'ganymede', JD, vec3());
    const g = jm.ganymede;
    expect(Math.hypot(pg.x / AU - g.x, pg.y / AU - g.y, pg.z / AU - g.z)).toBeLessThan(1e-9);
  });

  it('places Earth perihelion near 0.9833 AU in early January 2026', () => {
    const start = parseInstant('2026-01-01T00:00:00Z')!;
    let best = Infinity;
    let bestJd = 0;
    for (let k = 0; k <= 8 * 48; k++) {
      const jd = start + k / 48;
      const d = v3len(eph.relative('sun', 'earth', jd, vec3())) / AU;
      if (d < best) [best, bestJd] = [d, jd];
    }
    expect(best).toBeGreaterThan(0.9832);
    expect(best).toBeLessThan(0.9834);
    expect(bestJd - start).toBeGreaterThan(1.5); // 2026-01-03 ~17h UTC
    expect(bestJd - start).toBeLessThan(4);
  });

  it('reproduces moon periods from the data within 0.5%', () => {
    let n = 0;
    for (const row of rows) {
      if (row.kind !== 'moon') continue;
      const ref = row.elements?.period ?? Math.abs(row.rotation!.periodHours!) / 24;
      const measured = measuredPeriod(row.id, ref);
      expect(Math.abs(measured / ref - 1), row.id).toBeLessThan(0.005);
      n++;
    }
    expect(n).toBeGreaterThanOrEqual(26);
  });

  it('freezes positions beyond J2000 ± 10 kyr', () => {
    const far = JD_J2000 + 4e6;
    const a = eph.positionAt('mars', far, vec3());
    const b = eph.positionAt('mars', far + 1000, vec3());
    expect(v3len(v3sub(vec3(), a, b))).toBe(0);
    expect(Number.isFinite(a.x)).toBe(true);
  });
});

describe('solar-system rotation', () => {
  const axis = (id: string, jd: number, v: [number, number, number]) =>
    qrotate(vec3(), frames.orientation(fixedFrameId(id), jd, quat()), vec3(...v));

  it("keeps Earth's pole near the ICRF pole and spins once per sidereal day", () => {
    const z = axis('earth', JD, [0, 0, 1]);
    expect(Math.acos(z.z) / DEG).toBeLessThan(0.5);
    const x0 = axis('earth', JD, [1, 0, 0]);
    const x1 = axis('earth', JD + 0.99726958, [1, 0, 0]);
    expect(Math.acos(Math.min(1, v3dot(x0, x1))) / DEG).toBeLessThan(0.05);
    const x2 = axis('earth', JD + 0.25, [1, 0, 0]);
    expect(Math.abs(v3dot(x0, x2))).toBeLessThan(0.03); // a quarter turn later
  });

  // Before J2000 the pole of date lies on the far side of the J2000 pole (RA ~12h): RotationAxis-based
  // Earth spun the prime meridian 180 deg off there (night-lights bookmark in daylight with ?t=1990).
  const EARTH_DATES = [
    '1800-01-01T00:00:00Z',
    '1990-01-01T00:00:00Z',
    '1999-12-31T00:00:00Z',
    '2000-01-02T00:00:00Z',
    '2026-01-01T00:00:00Z',
    '2100-06-01T12:00:00Z',
  ];

  it("turns Earth's prime meridian with the IERS Earth Rotation Angle before and after J2000", () => {
    for (const iso of EARTH_DATES) {
      const jd = parseInstant(iso)!;
      const ut = AstroTime.FromTerrestrialTime(jd - JD_J2000).ut;
      const f = (0.779057273264 + 1.00273781191135448 * ut) % 1;
      const era = 360 * (f < 0 ? f + 1 : f);
      const x = axis('earth', jd, [1, 0, 0]);
      const diff = ((Math.atan2(x.y, x.x) / DEG - era + 540) % 360) - 180;
      expect(Math.abs(diff), iso).toBeLessThan(0.02);
    }
  });

  it("matches astronomy-engine's observer geodesy (ObserverVector)", () => {
    for (const iso of EARTH_DATES) {
      const jd = parseInstant(iso)!;
      const t = AstroTime.FromTerrestrialTime(jd - JD_J2000);
      for (const [lat, lon] of [
        [0, 0],
        [0, 90],
        [90, 0],
      ]) {
        const o = ObserverVector(t, new Observer(lat, lon, 0), false);
        const want = v3normalize(vec3(), vec3(o.x, o.y, o.z));
        const c = Math.cos(lat * DEG);
        const got = axis('earth', jd, [
          c * Math.cos(lon * DEG),
          c * Math.sin(lon * DEG),
          Math.sin(lat * DEG),
        ]);
        expect(Math.acos(Math.min(1, v3dot(want, got))) / DEG, `${iso} ${lat},${lon}`).toBeLessThan(0.001);
      }
    }
  });

  it('points the Moon and Triton prime meridians at their planets', () => {
    for (const [id, parent, tol] of [
      ['moon', 'earth', 10],
      ['triton', 'neptune', 1],
      ['io', 'jupiter', 3],
    ] as const) {
      const toParent = v3normalize(vec3(), eph.relative(id, parent, JD, vec3()));
      const x = axis(id, JD, [1, 0, 0]);
      expect(Math.acos(Math.min(1, v3dot(x, toParent))) / DEG, id).toBeLessThan(tol);
    }
  });

  it("uses IAU poles (Saturn's north pole at dec ~83.5 deg)", () => {
    const z = axis('saturn', JD, [0, 0, 1]);
    expect(Math.asin(z.z) / DEG).toBeCloseTo(83.54, 1);
    const kep = new KeplerOrbit(byId.get('mimas')!.elements!, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(kep.a).toBeGreaterThan(1e8);
  });
});

export type { BodyRow };
