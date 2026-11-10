import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Vec3d } from '../../../src/core/contracts';
import { qrotate, quat, v3dot, v3len, v3normalize, v3scale, v3sub, vec3 } from '../../../src/core/math64';
import { AU, DAY, GM_SUN, JD_J2000, JULIAN_YEAR } from '../../../src/core/units';
import { buildBookmarks } from '../../../src/modules/spacecraft/bookmarks';
import { jdFromUtc, type CraftFile } from '../../../src/modules/spacecraft/data';
import { formatDate, infoCard, searchEntries } from '../../../src/modules/spacecraft/facts';
import {
  buildFleet,
  contextWeight,
  existsAt,
  fleetValidity,
  FLEET_JD_MAX,
  markerFade,
  positionApproximate,
} from '../../../src/modules/spacecraft/fleet';
import craftFrag from '../../../src/modules/spacecraft/glsl/craft.frag.glsl?raw';
import craftVert from '../../../src/modules/spacecraft/glsl/craft.vert.glsl?raw';
import overlayGlsl from '../../../src/modules/spacecraft/glsl/overlay.glsl?raw';
import { conicSummary, lambert, propagate } from '../../../src/modules/spacecraft/kepler';
import { MODEL_BUILDERS } from '../../../src/modules/spacecraft/models/index';
import { segmentCentres } from '../../../src/modules/spacecraft/models/telescopes';
import {
  astronomyEphemeris,
  ECLIPTIC_NORTH,
  HaloMotion,
  LeoMotion,
  ProbeMotion,
  speedAt,
} from '../../../src/modules/spacecraft/trajectory';
import { JWST_CHECKS, PROBE_CHECKS } from './horizons';

const file = JSON.parse(
  readFileSync(new URL('../../../public/data/spacecraft/craft.json', import.meta.url), 'utf8'),
) as CraftFile;
const eph = astronomyEphemeris();
const fleet = buildFleet(file.craft, eph);
const craft = (id: string) => fleet.find((c) => c.row.id === id)!;
const probe = (id: string) => craft(id).motion as ProbeMotion;
const leo = (id: string) => craft(id).motion as LeoMotion;
const DEG = Math.PI / 180;
const JD_2026 = jdFromUtc('2026-01-01T00:00:00Z');
const JD_2027 = jdFromUtc('2027-01-01T00:00:00Z');

/** Unit vector of a right ascension (hours) and declination (degrees). */
const radec = (h: number, d: number): Vec3d =>
  vec3(
    Math.cos(d * DEG) * Math.cos(h * 15 * DEG),
    Math.cos(d * DEG) * Math.sin(h * 15 * DEG),
    Math.sin(d * DEG),
  );
const angleDeg = (a: Vec3d, b: Vec3d): number =>
  Math.acos(Math.min(1, Math.max(-1, v3dot(a, b) / (v3len(a) * v3len(b))))) / DEG;

describe('spacecraft data', () => {
  it('has the eight craft with sources on every row and position block', () => {
    expect(file.craft.map((c) => c.id)).toEqual([
      'iss',
      'hubble',
      'jwst',
      'voyager1',
      'voyager2',
      'newhorizons',
      'pioneer10',
      'pioneer11',
    ]);
    for (const row of file.craft) {
      expect(row.source.length, row.id).toBeGreaterThan(10);
      expect(row.description.length, row.id).toBeGreaterThan(80);
      expect(row.operator, row.id).toBeTruthy();
      expect(row.radiusM, row.id).toBeGreaterThan(1);
      expect(row.influenceRadiusM, row.id).toBeGreaterThan(100 * row.radiusM);
      expect(Number.isFinite(jdFromUtc(row.launchUtc)), row.id).toBe(true);
      const blocks = [row.orbit?.source, row.halo?.source, row.trajectory?.coast.source].filter(Boolean);
      expect(blocks.length, row.id).toBe(1);
      expect(blocks[0]!.length, row.id).toBeGreaterThan(20);
      if (row.trajectory) {
        expect(row.trajectory.nodeSource.length).toBeGreaterThan(20);
        for (const n of row.trajectory.nodes)
          expect(!!(n.body && n.utc) || !!(n.posKm && n.source)).toBe(true);
      }
    }
  });

  it('keeps launch dates and encounter order straight', () => {
    expect(formatDate(craft('iss').row.launchUtc)).toBe('20 November 1998');
    expect(formatDate(craft('hubble').row.launchUtc)).toBe('24 April 1990');
    expect(formatDate(craft('jwst').row.launchUtc)).toBe('25 December 2021');
    for (const c of fleet) {
      if (!(c.motion instanceof ProbeMotion)) continue;
      const jds = c.motion.nodes.map((n) => n.jd);
      expect([...jds].sort((a, b) => a - b)).toEqual(jds);
      expect(c.motion.launchJd).toBe(jds[0]);
      expect(c.motion.settledJd).toBeGreaterThan(c.motion.coastJd);
    }
  });
});

describe('two-body mechanics', () => {
  it('propagates a circular orbit a quarter turn and back', () => {
    const r0 = vec3(AU, 0, 0);
    const v = Math.sqrt(GM_SUN / AU);
    const v0 = vec3(0, v, 0);
    const T = (2 * Math.PI * AU) / v;
    const r = vec3();
    const vv = vec3();
    propagate(r0, v0, T / 4, GM_SUN, r, vv);
    expect(r.x / AU).toBeCloseTo(0, 9);
    expect(r.y / AU).toBeCloseTo(1, 9);
    expect(vv.x / v).toBeCloseTo(-1, 9);
    const back = propagate(r, vv, -T / 4, GM_SUN, vec3());
    expect(back.x / AU).toBeCloseTo(1, 9);
    expect(back.y / AU).toBeCloseTo(0, 9);
  });

  it('conserves energy and angular momentum on a hyperbola over 50 years, both ways', () => {
    const r0 = vec3(9 * AU, 2 * AU, 1 * AU);
    const v0 = vec3(-3e3, 2.1e4, 4e3);
    const s0 = conicSummary(r0, v0, GM_SUN);
    expect(s0.e).toBeGreaterThan(1);
    for (const years of [50, -3, 1e4]) {
      const r = vec3();
      const v = vec3();
      propagate(r0, v0, years * JULIAN_YEAR, GM_SUN, r, v);
      const s = conicSummary(r, v, GM_SUN);
      expect(s.a / s0.a).toBeCloseTo(1, 8);
      expect(s.e / s0.e).toBeCloseTo(1, 8);
      const home = propagate(r, v, -years * JULIAN_YEAR, GM_SUN, vec3());
      expect(v3len(v3sub(vec3(), home, r0)) / AU).toBeLessThan(1e-6);
    }
  });

  it('solves Lambert arcs that the propagator reproduces (ellipse and hyperbola)', () => {
    const r1 = vec3(AU, 0, 0);
    const r2 = vec3(-3 * AU, 4 * AU, 0.3 * AU);
    for (const days of [300, 900, 2500]) {
      const sol = lambert(r1, r2, days * DAY, GM_SUN)!;
      expect(sol).not.toBeNull();
      const end = propagate(r1, sol.v1, days * DAY, GM_SUN, vec3());
      expect(v3len(v3sub(vec3(), end, r2)) / AU).toBeLessThan(1e-7);
    }
    expect(lambert(r1, vec3(-2 * AU, 0, 0), 300 * DAY, GM_SUN)).toBeNull(); // collinear: no plane
  });
});

describe('deep-space probes', () => {
  it('match JPL Horizons within 0.03 AU on every leg and on the coast', () => {
    for (const [id, checks] of Object.entries(PROBE_CHECKS)) {
      for (const c of checks) {
        const p = probe(id).heliocentric(c.jd, vec3());
        const ref = vec3(c.km[0] * 1e3, c.km[1] * 1e3, c.km[2] * 1e3);
        expect(v3len(v3sub(vec3(), p, ref)) / AU, `${id} ${c.phase} JD ${c.jd}`).toBeLessThan(0.03);
      }
    }
  });

  it('stay within 0.003 AU of Horizons ten years before the reference epoch (coast)', () => {
    for (const [id, checks] of Object.entries(PROBE_CHECKS)) {
      const c = checks.find((k) => k.jd === 2457388.5)!;
      const p = probe(id).heliocentric(c.jd, vec3());
      const ref = vec3(c.km[0] * 1e3, c.km[1] * 1e3, c.km[2] * 1e3);
      expect(v3len(v3sub(vec3(), p, ref)) / AU, id).toBeLessThan(0.003);
    }
  });

  it('put Voyager 1 about 170 AU out towards Ophiuchus at 3.57 AU/yr in 2026', () => {
    const m = probe('voyager1');
    const r0 = m.heliocentric(JD_2026, vec3());
    const r1 = m.heliocentric(JD_2027, vec3());
    expect(v3len(r0) / AU).toBeGreaterThan(168.5);
    expect(v3len(r0) / AU).toBeLessThan(170);
    expect(v3len(r1) / AU).toBeLessThan(173.5);
    expect(angleDeg(r0, radec(17 + 13 / 60, 12))).toBeLessThan(1.5);
    expect((v3len(m.velocity(JD_2026, vec3())) * JULIAN_YEAR) / AU).toBeCloseTo(3.57, 1);
    // One light-day from Earth in November 2026.
    const jd = jdFromUtc('2026-11-15T00:00:00Z');
    const dEarth = v3len(v3sub(vec3(), m.ssbPosition(jd, vec3()), eph('earth', jd, vec3())));
    expect(dEarth / 299792458 / 86400).toBeCloseTo(1, 2);
    // The Pale Blue Dot was taken from about 40.5 AU, 32° above the ecliptic.
    const pbd = m.heliocentric(jdFromUtc('1990-02-14T04:48:00Z'), vec3());
    expect(v3len(pbd) / AU).toBeCloseTo(40.5, 0);
    expect(90 - angleDeg(pbd, ECLIPTIC_NORTH as Vec3d)).toBeGreaterThan(31);
    expect(90 - angleDeg(pbd, ECLIPTIC_NORTH as Vec3d)).toBeLessThan(34);
  });

  it('put Voyager 2 about 142 AU out towards Pavo at 3.2 AU/yr in 2026', () => {
    const m = probe('voyager2');
    const r0 = m.heliocentric(JD_2026, vec3());
    expect(v3len(r0) / AU).toBeGreaterThan(141);
    expect(v3len(r0) / AU).toBeLessThan(143);
    expect(angleDeg(r0, radec(20, -59))).toBeLessThan(3);
    expect((v3len(m.velocity(JD_2026, vec3())) * JULIAN_YEAR) / AU).toBeCloseTo(3.2, 1);
    // Neptune flyby: at the planet on the day.
    const jd = m.coastJd;
    const neptune = v3sub(vec3(), eph('neptune', jd, vec3()), eph('sun', jd, vec3()));
    expect(v3len(v3sub(vec3(), m.heliocentric(jd, vec3()), neptune))).toBeLessThan(1e8);
  });

  it('put New Horizons 63 to 66 AU out towards Sagittarius at 2.9 AU/yr in 2026, and at Pluto in 2015', () => {
    const m = probe('newhorizons');
    const r0 = m.heliocentric(JD_2026, vec3());
    const r1 = m.heliocentric(JD_2027, vec3());
    expect(v3len(r0) / AU).toBeGreaterThan(63);
    expect(v3len(r1) / AU).toBeLessThan(67);
    expect(angleDeg(r0, radec(19 + 20 / 60, -20.5))).toBeLessThan(3);
    expect((v3len(m.velocity(JD_2026, vec3())) * JULIAN_YEAR) / AU).toBeCloseTo(2.9, 1);
    const jd = jdFromUtc('2015-07-14T11:49:57Z');
    const pluto = v3sub(vec3(), eph('pluto', jd, vec3()), eph('sun', jd, vec3()));
    expect(v3len(v3sub(vec3(), m.heliocentric(jd, vec3()), pluto))).toBeLessThan(5e7);
    // Arrokoth, 1 January 2019: 43.4 AU from the Sun.
    expect(v3len(m.heliocentric(jdFromUtc('2019-01-01T05:33:00Z'), vec3())) / AU).toBeCloseTo(43.4, 0);
  });

  it('send the Pioneers out on the published hyperbolas', () => {
    const p10 = probe('pioneer10');
    const p11 = probe('pioneer11');
    const s10 = conicSummary(
      p10.heliocentric(JD_2026, vec3()),
      p10.velocity(JD_2026, vec3()),
      GM_SUN,
      ECLIPTIC_NORTH,
    );
    const s11 = conicSummary(
      p11.heliocentric(JD_2026, vec3()),
      p11.velocity(JD_2026, vec3()),
      GM_SUN,
      ECLIPTIC_NORTH,
    );
    expect(s10.vInfinity / 1e3).toBeCloseTo(11.3, 1);
    expect(s10.inclination / DEG).toBeCloseTo(3.1, 0);
    expect(s11.inclination / DEG).toBeCloseTo(16.6, 0);
    expect(angleDeg(p10.heliocentric(JD_2026, vec3()), radec(5 + 14 / 60, 26))).toBeLessThan(3); // Taurus
    expect(angleDeg(p11.heliocentric(JD_2026, vec3()), radec(18 + 54 / 60, -8.6))).toBeLessThan(3); // Scutum
    // Last contact with Pioneer 10 (January 2003) at about 80 AU.
    expect(v3len(p10.heliocentric(jdFromUtc('2003-01-23T00:00:00Z'), vec3())) / AU).toBeCloseTo(80, -1);
  });

  it('are continuous through launch, flybys and the blend, and never run backwards in time order', () => {
    for (const c of fleet) {
      const m = c.motion;
      if (!(m instanceof ProbeMotion)) continue;
      expect(v3len(m.seam) / AU, c.row.id).toBeLessThan(0.08);
      for (const t of [...m.nodes.map((n) => n.jd), m.settledJd]) {
        const a = m.heliocentric(t - 1e-4, vec3());
        const b = m.heliocentric(t + 1e-4, vec3());
        // 17 s apart: under 2000 km even at 60 km/s.
        expect(v3len(v3sub(vec3(), a, b)), `${c.row.id} at JD ${t}`).toBeLessThan(2e6);
      }
      const pts: number[] = [];
      const n = m.samplePath(JD_2026, 48, pts);
      expect(pts.length).toBe(3 * n);
      expect(n).toBe(32 * (m.nodes.length - 1) + 49);
      const end = m.heliocentric(JD_2026, vec3());
      expect(pts[3 * n - 3]).toBe(end.x);
      expect(m.samplePath(m.launchJd - 1, 48, [])).toBe(0);
    }
  });
});

describe('low Earth orbit', () => {
  it('gives the ISS a 92.9 minute, 51.6° orbit near 420 km with a node that regresses 5° a day', () => {
    const m = leo('iss');
    expect(m.period / 60).toBeGreaterThan(92.5);
    expect(m.period / 60).toBeLessThan(93.3);
    expect(m.altitude / 1e3).toBeGreaterThan(405);
    expect(m.altitude / 1e3).toBeLessThan(430);
    expect(m.speed / 1e3).toBeCloseTo(7.66, 1);
    expect((m.nodeRate * DAY) / DEG).toBeCloseTo(-4.95, 1);
    // The radius is constant and the craft is back at the same latitude argument one period later.
    const a = m.position(m.epochJd, vec3());
    const b = m.position(m.epochJd + m.period / DAY, vec3());
    expect(v3len(a)).toBeCloseTo(m.a, 3);
    expect(angleDeg(a, b)).toBeLessThan(0.4); // the node moved 0.32° in one revolution
    // Highest latitude reached over one orbit equals the inclination (equator of date vs ICRF: 0.15°).
    let zMax = 0;
    for (let k = 0; k < 200; k++) {
      const p = m.position(m.epochJd + (k / 200) * (m.period / DAY), vec3());
      zMax = Math.max(zMax, Math.abs(p.z) / v3len(p));
    }
    expect(Math.asin(zMax) / DEG).toBeGreaterThan(51.3);
    expect(Math.asin(zMax) / DEG).toBeLessThan(51.95);
    // At the element-set epoch the argument of latitude is 0.1°: the craft is at its ascending node.
    expect(Math.abs(a.z) / v3len(a)).toBeLessThan(0.01);
    expect(speedAt(m, m.epochJd, 1) / 1e3).toBeCloseTo(7.66, 1);
  });

  it('gives Hubble a 28.5° orbit at the altitude of its element set', () => {
    const m = leo('hubble');
    expect(m.inclination / DEG).toBeCloseTo(28.47, 2);
    expect(m.altitude / 1e3).toBeGreaterThan(440);
    expect(m.altitude / 1e3).toBeLessThan(620);
    expect(m.period / 60).toBeGreaterThan(93);
    expect(m.period / 60).toBeLessThan(97);
  });

  it('flies the ISS belly-down along its orbit and points Hubble by the Sun', () => {
    const m = leo('iss');
    const jd = m.epochJd + 0.123;
    const q = m.orientation(jd, quat());
    expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 12);
    const r = v3normalize(vec3(), m.position(jd, vec3()));
    const nadir = qrotate(vec3(), q, vec3(0, 0, 1));
    expect(v3dot(nadir, r)).toBeCloseTo(-1, 9);
    const ahead = v3normalize(
      vec3(),
      v3sub(vec3(), m.position(jd + 1 / DAY, vec3()), m.position(jd, vec3())),
    );
    expect(v3dot(qrotate(vec3(), q, vec3(1, 0, 0)), ahead)).toBeGreaterThan(0.9999);
    const h = leo('hubble');
    const sun = v3normalize(vec3(), v3sub(vec3(), eph('sun', jd, vec3()), eph('earth', jd, vec3())));
    expect(v3dot(qrotate(vec3(), h.orientation(jd, quat()), vec3(0, 0, 1)), sun)).toBeCloseTo(1, 9);
  });
});

describe('Webb at L2', () => {
  const m = craft('jwst').motion as HaloMotion;

  it('circles a point 1.5 million km from Earth, straight away from the Sun', () => {
    for (const jd of [JD_2026, JD_2026 + 91, JD_2026 + 182, JD_2026 + 273]) {
      const sun = eph('sun', jd, vec3());
      const earth = v3sub(vec3(), eph('earth', jd, vec3()), sun);
      const l2 = v3sub(vec3(), m.l2Heliocentric(jd, vec3()), earth);
      expect(v3len(l2) / 1e9).toBeGreaterThan(1.45);
      expect(v3len(l2) / 1e9).toBeLessThan(1.56);
      expect(angleDeg(l2, earth)).toBeLessThan(0.3);
      const craftFromEarth = v3sub(vec3(), v3sub(vec3(), m.ssbPosition(jd, vec3()), sun), earth);
      expect(v3len(craftFromEarth) / 1e9).toBeGreaterThan(1.15);
      expect(v3len(craftFromEarth) / 1e9).toBeLessThan(1.8);
      expect(angleDeg(craftFromEarth, earth)).toBeLessThan(40);
      // Never in Earth's shadow: at least 100,000 km off the Sun-Earth line.
      const off = Math.sin(angleDeg(craftFromEarth, earth) * DEG) * v3len(craftFromEarth);
      expect(off).toBeGreaterThan(1e8);
    }
  });

  it('follows the real 2026 path within 80,000 km (JPL Horizons)', () => {
    for (const c of JWST_CHECKS) {
      const p = v3sub(vec3(), m.ssbPosition(c.jd, vec3()), eph('earth', c.jd, vec3()));
      const ref = vec3(c.km[0] * 1e3, c.km[1] * 1e3, c.km[2] * 1e3);
      expect(v3len(v3sub(vec3(), p, ref)) / 1e3, `JD ${c.jd}`).toBeLessThan(80_000);
    }
  });

  it('leaves Earth at launch and reaches the halo on arrival day', () => {
    const d = (jd: number) => v3len(v3sub(vec3(), m.ssbPosition(jd, vec3()), eph('earth', jd, vec3())));
    expect(d(m.launchJd)).toBeLessThan(7e6);
    let prev = 0;
    for (let k = 0; k <= 10; k++) {
      const x = d(m.launchJd + ((m.settledJd - m.launchJd) * k) / 10);
      expect(x).toBeGreaterThan(prev);
      prev = x;
    }
    expect(Math.abs(d(m.settledJd - 1e-6) - d(m.settledJd + 1e-6))).toBeLessThan(1e5);
    // Hot side (-z) to the Sun.
    const jd = JD_2026 + 40;
    const toSun = v3scale(vec3(), m.heliocentric(jd, vec3()), -1);
    const hot = qrotate(vec3(), m.orientation(jd, quat()), vec3(0, 0, -1));
    expect(angleDeg(hot, toSun)).toBeLessThan(1e-4);
  });
});

describe('fleet', () => {
  it('shows no craft before its launch and none beyond the model range', () => {
    for (const c of fleet) {
      expect(existsAt(c, c.motion.launchJd - 1e-3), c.row.id).toBe(false);
      expect(existsAt(c, c.motion.launchJd + 1e-3), c.row.id).toBe(true);
      expect(existsAt(c, FLEET_JD_MAX + 1), c.row.id).toBe(false);
      expect(c.body.kind).toBe('spacecraft');
      expect(c.body.frame).toBe(c.row.id);
      expect(c.body.fixedFrame).toBe(`${c.row.id}.fixed`);
      expect(c.frame.parent).toBe(c.row.kind === 'leo' ? 'earth' : 'ssb');
      expect(c.frame.influenceRadius).toBe(0); // raised only while the craft is registered
      // The position is a pure function of the date.
      const a = c.frame.positionAt(JD_2026 + 12.3, vec3());
      c.frame.positionAt(JD_J2000, vec3());
      const b = c.frame.positionAt(JD_2026 + 12.3, vec3());
      expect([b.x, b.y, b.z]).toEqual([a.x, a.y, a.z]);
    }
    expect(existsAt(craft('iss'), jdFromUtc('1998-11-19T00:00:00Z'))).toBe(false);
    expect(existsAt(craft('hubble'), jdFromUtc('1990-04-23T00:00:00Z'))).toBe(false);
    expect(existsAt(craft('jwst'), jdFromUtc('2021-12-24T00:00:00Z'))).toBe(false);
    // Before launch a probe's frame is parked at Earth (hidden), not on a backwards extrapolation.
    const v1 = probe('voyager1');
    const jd = v1.launchJd - 300;
    const earth = v3sub(vec3(), eph('earth', jd, vec3()), eph('sun', jd, vec3()));
    expect(v3len(v3sub(vec3(), v1.heliocentric(jd, vec3()), earth))).toBeLessThan(1e7);
    const range = fleetValidity(fleet);
    expect(range.beyond).toBe('hidden');
    expect(range.jdMin).toBe(craft('pioneer10').motion.launchJd);
  });

  it('flags approximate positions: always for LEO and L2, for probes until the coast settles', () => {
    expect(positionApproximate(craft('iss'), JD_2026)).toBe(true);
    expect(positionApproximate(craft('jwst'), JD_2026)).toBe(true);
    const v1 = craft('voyager1');
    expect(positionApproximate(v1, jdFromUtc('1979-06-01T00:00:00Z'))).toBe(true); // Jupiter to Saturn
    expect(positionApproximate(v1, jdFromUtc('1981-06-01T00:00:00Z'))).toBe(true); // blend after Saturn
    expect(positionApproximate(v1, JD_2026)).toBe(false);
    expect(positionApproximate(v1, JD_2026 + 200 * 365.25)).toBe(true);
    expect(positionApproximate(craft('pioneer10'), JD_2026)).toBe(true); // silent since 2003
  });

  it('shows markers by context: low orbits near Earth, probes inside the Solar System', () => {
    const px = (60 * DEG) / 270; // potato
    expect(contextWeight(6.8e6, 2e7, px)).toBe(1); // ISS orbit from 20,000 km
    expect(contextWeight(6.8e6, 3.8e8, px)).toBe(0); // from the Moon
    expect(contextWeight(170 * AU, 70 * AU, px)).toBe(1); // Voyager 1 from the overview
    expect(contextWeight(170 * AU, 2e5 * AU, px)).toBe(0); // from the nearest stars
    expect(markerFade(1)).toBe(1);
    expect(markerFade(30)).toBe(0);
  });

  it('writes info cards with live facts, approximate flags and sources', () => {
    const card = infoCard(craft('voyager1'), JD_2026, eph);
    expect(card.title).toBe('Voyager 1');
    expect(card.simulated).toBe(true);
    const fact = (label: string) => card.facts.find((f) => f.label === label)!;
    expect(fact('Distance from the Sun').value).toBeCloseTo(169.3, 0);
    expect(fact('Distance from the Sun').approximate).toBe(false);
    expect(fact('Distance from the Sun').source).toContain('JPL Horizons');
    expect(fact('One-way light time').unit).toBe('h');
    expect(fact('One-way light time').value).toBeCloseTo(23.5, 0);
    expect(fact('Speed relative to the Sun').value).toBeCloseTo(16.9, 1);
    expect(fact('Saturn flyby').value).toBe('12 November 1980');
    expect(fact('Launched').value).toContain('5 September 1977');
    const iss = infoCard(craft('iss'), JD_2026, eph);
    const issFact = (label: string) => iss.facts.find((f) => f.label === label)!;
    expect(issFact('Altitude').approximate).toBe(true);
    expect(issFact('Orbital period').value).toBeCloseTo(92.9, 0);
    expect(issFact('Mass').approximate).toBe(true);
    const early = infoCard(craft('jwst'), jdFromUtc('2000-01-01T00:00:00Z'), eph);
    expect(early.facts.find((f) => f.label === 'At this date')!.value).toContain('not launched');
    expect(early.facts.find((f) => f.label === 'Distance from Earth')).toBeUndefined();
    const webb = infoCard(craft('jwst'), JD_2026, eph);
    expect(webb.facts.find((f) => f.label === 'Distance from Earth')!.approximate).toBe(true);
  });

  it('answers the names people type', () => {
    const entries = searchEntries(fleet);
    const find = (text: string) =>
      entries.filter((e) =>
        [e.name, ...(e.aliases ?? [])].some((n) => n.toLowerCase() === text.toLowerCase()),
      );
    expect(find('ISS').map((e) => e.id)).toEqual(['iss']);
    expect(find('International Space Station').map((e) => e.id)).toEqual(['iss']);
    expect(find('Zarya').map((e) => e.id)).toEqual(['iss']);
    expect(find('JWST').map((e) => e.id)).toEqual(['jwst']);
    expect(find('Webb').map((e) => e.id)).toEqual(['jwst']);
    expect(find('James Webb Space Telescope').map((e) => e.id)).toEqual(['jwst']);
    expect(find('HST').map((e) => e.id)).toEqual(['hubble']);
    expect(find('Hubble').map((e) => e.id)).toEqual(['hubble']);
    expect(find('Voyager').map((e) => e.id)).toEqual(['voyager1', 'voyager2']);
    expect(find('Voyager 1').map((e) => e.id)).toEqual(['voyager1']);
    for (const e of entries) {
      expect(e.kind).toBe('spacecraft');
      expect(e.target).toBe(e.id);
    }
  });
});

describe('bookmarks', () => {
  const bookmarks = buildBookmarks(fleet, eph);

  it('are the five views, each with a 2026 date, an exposure and a description', () => {
    expect(bookmarks.map((b) => b.id)).toEqual([
      'iss-over-earth',
      'hubble-over-earth',
      'jwst-l2',
      'voyager1-looking-back',
      'new-horizons',
    ]);
    for (const b of bookmarks) {
      expect(b.lookTarget!.length, b.id).toBeGreaterThan(60);
      expect(typeof b.ev, b.id).toBe('number');
      expect(b.jd as number, b.id).toBeGreaterThan(JD_2026);
      expect(b.jd as number, b.id).toBeLessThan(JD_2027);
      const c = craft(b.lookAt!);
      expect(b.frame).toBe(`${c.row.id}.fixed`);
      // Outside the collision sphere, close enough to fill the frame.
      expect(v3len(b.pos), b.id).toBeGreaterThan(1.5 * c.row.radiusM);
      expect(v3len(b.pos), b.id).toBeLessThan(8 * c.row.radiusM);
      expect(Math.hypot(b.quat!.x, b.quat!.y, b.quat!.z, b.quat!.w)).toBeCloseTo(1, 9);
    }
    // camera.goto resolves bookmark ids before body ids: a clash would turn a search pick into a time jump.
    for (const b of bookmarks)
      expect(
        fleet.some((c) => c.row.id === b.id),
        b.id,
      ).toBe(false);
  });

  it('catch the ISS and Hubble in daylight', () => {
    for (const id of ['iss-over-earth', 'hubble-over-earth']) {
      const b = bookmarks.find((k) => k.id === id)!;
      const m = leo(b.lookAt!);
      const jd = b.jd as number;
      const r = v3normalize(vec3(), m.position(jd, vec3()));
      const sun = v3normalize(vec3(), v3sub(vec3(), eph('sun', jd, vec3()), eph('earth', jd, vec3())));
      expect(v3dot(r, sun), id).toBeGreaterThan(0.3);
      // The highest Sun of that revolution: a quarter turn either way it stands lower.
      for (const dt of [-0.25, 0.25]) {
        const p = v3normalize(vec3(), m.position(jd + (dt * m.period) / DAY, vec3()));
        expect(v3dot(p, sun), id).toBeLessThan(v3dot(r, sun));
      }
      expect(jd - m.epochJd).toBeLessThan(0.07);
    }
  });
});

describe('models', () => {
  const expected: Record<string, { radius: [number, number]; maxTriangles: number }> = {
    iss: { radius: [62, 75], maxTriangles: 6000 },
    hubble: { radius: [6.5, 10.5], maxTriangles: 2000 },
    jwst: { radius: [10.5, 12.5], maxTriangles: 2000 },
    voyager: { radius: [12, 14.5], maxTriangles: 3000 },
    newhorizons: { radius: [2, 3], maxTriangles: 2000 },
    pioneer: { radius: [6, 7], maxTriangles: 2500 },
  };

  it('are finite, to scale, cheap, and wound consistently with their normals', () => {
    for (const [id, build] of Object.entries(MODEL_BUILDERS)) {
      const model = build();
      const want = expected[id];
      expect(model.radius, id).toBeGreaterThan(want.radius[0]);
      expect(model.radius, id).toBeLessThan(want.radius[1]);
      expect(model.triangles, id).toBeGreaterThan(200);
      expect(model.triangles, id).toBeLessThan(want.maxTriangles);
      for (const part of model.parts) {
        const { position, normal, color, triangles } = part.mesh;
        expect(position.length).toBe(9 * triangles);
        expect(normal.length).toBe(12 * triangles);
        expect(color.length).toBe(12 * triangles);
        let bad = 0;
        for (let t = 0; t < triangles; t++) {
          const p = (k: number) => [
            position[9 * t + 3 * k],
            position[9 * t + 3 * k + 1],
            position[9 * t + 3 * k + 2],
          ];
          const [a, b, c] = [p(0), p(1), p(2)];
          const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
          const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
          const g = [
            e1[1] * e2[2] - e1[2] * e2[1],
            e1[2] * e2[0] - e1[0] * e2[2],
            e1[0] * e2[1] - e1[1] * e2[0],
          ];
          const area = Math.hypot(g[0], g[1], g[2]);
          if (!(area > 0) || ![...a, ...b, ...c].every(Number.isFinite)) bad++;
          for (let k = 0; k < 3; k++) {
            const n = [normal[12 * t + 4 * k], normal[12 * t + 4 * k + 1], normal[12 * t + 4 * k + 2]];
            const len = Math.hypot(n[0], n[1], n[2]);
            if (Math.abs(len - 127) > 3) bad++;
            // Stored normal on the side the winding faces (smooth shading tilts it, never flips it).
            if ((n[0] * g[0] + n[1] * g[1] + n[2] * g[2]) / (len * area) < 0.3) bad++;
          }
        }
        expect(bad, `${id}/${part.name}`).toBe(0);
      }
    }
  });

  it('give the ISS a turning array part and Webb 18 segments in permanent shade', () => {
    const iss = MODEL_BUILDERS.iss();
    expect(iss.parts.map((p) => p.name)).toEqual(['hull', 'arrays']);
    expect(iss.parts[1].track).toBe('sun-y');
    // Arrays reach 36.5 m either side of the truss and 53 m along it.
    const a = iss.parts[1].mesh.position;
    let xMax = 0;
    let yMax = 0;
    for (let i = 0; i < a.length; i += 3) {
      xMax = Math.max(xMax, Math.abs(a[i]));
      yMax = Math.max(yMax, Math.abs(a[i + 1]));
    }
    expect(2 * xMax).toBeCloseTo(73, 0);
    expect(2 * yMax).toBeGreaterThan(105);
    expect(2 * yMax).toBeLessThan(110);
    const centres = segmentCentres();
    expect(centres.length).toBe(18);
    const span = Math.max(...centres.map((c) => c[1])) - Math.min(...centres.map((c) => c[1])) + 1.32;
    expect(span).toBeCloseTo(6.6, 1);
    const jwst = MODEL_BUILDERS.jwst().parts[0].mesh;
    let shaded = 0;
    for (let i = 3; i < jwst.normal.length; i += 4) if (jwst.normal[i] > 0) shaded++;
    expect(shaded).toBeGreaterThan(0.5 * (jwst.normal.length / 4));
    expect(shaded).toBeLessThan(jwst.normal.length / 4);
    const voyager = MODEL_BUILDERS.voyager().parts[0].mesh;
    for (let i = 3; i < voyager.normal.length; i += 4) expect(voyager.normal[i]).toBe(0);
  });

  it('shade with log depth, the shared exposure and the eclipse chunk', () => {
    expect(craftVert).toContain('LOG_DEPTH_VERTEX()');
    expect(craftFrag).toContain('LOG_DEPTH_FRAGMENT()');
    expect(craftFrag).toContain('sunVisibility(');
    expect(craftFrag).toContain('uExposure');
    expect(overlayGlsl).toContain('LOG_DEPTH_VERTEX()');
    expect(overlayGlsl.split(/^\/\/#fragment$/m).length).toBe(2);
  });
});

describe('paths and the scale of the view', () => {
  it('hides a path far larger than the neighbourhood the camera is in', async () => {
    const { neighbourhoodWeight } = await import('../../../src/modules/spacecraft/render');
    const AU = 1.495978707e11;
    // Voyager 1's path (170 AU) from 12,756 km above Earth: gone. From 70 AU out: drawn.
    expect(neighbourhoodWeight(170 * AU, 1.2756e7)).toBe(0);
    expect(neighbourhoodWeight(170 * AU, 20 * AU)).toBe(1);
    // In between it fades, and an unknown neighbourhood hides nothing.
    const mid = neighbourhoodWeight(60 * AU, AU);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(neighbourhoodWeight(170 * AU, Infinity)).toBe(1);
  });
});
