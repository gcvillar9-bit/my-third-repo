import { describe, expect, it } from 'vitest';
import type { InfoFact } from '../../../src/core/contracts';
import { v3len, v3sub, vec3 } from '../../../src/core/math64';
import { AU, DAY, PC } from '../../../src/core/units';
import {
  BB_ORBIT_BOOKMARK,
  GLIESE_710_BOOKMARK,
  SCHOLZ_BOOKMARK,
  SEDNA_BOOKMARK,
  SEDNOID_ORBITS_BOOKMARK,
  VISITORS_BOOKMARK,
  buildBookmarks,
} from '../../../src/modules/oort/bodies/bookmarks';
import { FLYBYS, MARKERS, OBJECTS } from '../../../src/modules/oort/bodies/data';
import { objectCard, objectSearchEntries } from '../../../src/modules/oort/bodies/facts';
import {
  approachPhrase,
  flybyCard,
  flybyLabel,
  starMotion,
  starPositionAt,
  yearsToClosest,
} from '../../../src/modules/oort/bodies/flybys';
import { circleFade, labelPoint, shellAlpha, shellCard } from '../../../src/modules/oort/bodies/markers';
import {
  influenceRadius,
  lineAlpha,
  makeObject,
  objectState,
  pointIlluminance,
  speedAtInfinity,
} from '../../../src/modules/oort/bodies/objects';
import { orbitSamples } from '../../../src/modules/oort/bodies/orbits';
import { fadesAt } from '../../../src/modules/oort/shared';

const objects = OBJECTS.objects.map((r) => makeObject(r));
const byId = new Map(objects.map((o) => [o.row.id, o]));
const motions = new Map(FLYBYS.stars.map((s) => [s.id, starMotion(s.astrometry)]));
const YEAR = 365.25;

describe('oort objects', () => {
  it('every row has sources and builds a finite orbit and a body', () => {
    expect(objects).toHaveLength(8);
    for (const o of objects) {
      const { row, body } = o;
      expect(row.elements.source.length).toBeGreaterThan(10);
      expect(row.physical.source.length).toBeGreaterThan(10);
      expect(row.description.length).toBeGreaterThan(40);
      expect(body.parent).toBe('sun');
      expect(body.simulated).toBe(true);
      expect(body.influenceRadius).toBeGreaterThanOrEqual(1e6);
      expect(body.influenceRadius).toBeLessThanOrEqual(2e8);
      const p = o.orbit.positionAt(row.elements.epoch + 1000, vec3());
      expect(Number.isFinite(v3len(p))).toBe(true);
    }
    expect(influenceRadius(5e5)).toBe(1e8);
    expect(influenceRadius(100)).toBe(1e6);
    expect(byId.get('bernardinelli-bernstein')!.center).toBe('ssb');
    expect(byId.get('sedna')!.center).toBe('sun');
  });

  it("Sedna's aphelion is near 940 AU and it is at q at perihelion", () => {
    const sedna = byId.get('sedna')!;
    expect(sedna.orbit.aphelion / AU).toBeGreaterThan(920);
    expect(sedna.orbit.aphelion / AU).toBeLessThan(960);
    expect(sedna.orbit.radiusAt(sedna.row.elements.tp) / AU).toBeCloseTo(76.19, 3);
    // Period follows from the row: about 11,400 years.
    expect(sedna.row.elements.periodDays! / YEAR).toBeGreaterThan(11_000);
    expect(sedna.row.elements.periodDays! / YEAR).toBeLessThan(11_800);
    // Today (2026) it is inbound near 83-84 AU.
    const r = sedna.orbit.radiusAt(2461041.5) / AU;
    expect(r).toBeGreaterThan(82);
    expect(r).toBeLessThan(86);
  });

  it("Bernardinelli-Bernstein's aphelion is near 40,400 AU", () => {
    const bb = byId.get('bernardinelli-bernstein')!;
    expect(bb.orbit.aphelion / AU).toBeGreaterThan(40_000);
    expect(bb.orbit.aphelion / AU).toBeLessThan(40_800);
  });

  it('the visitors are unbound with speeds at infinity matching vInfKms', () => {
    for (const o of objects.filter((x) => x.row.group === 'interstellar')) {
      expect(o.orbit.e).toBeGreaterThan(1);
      const v = speedAtInfinity(o.orbit) / 1e3;
      expect(Math.abs(v / o.row.vInfKms! - 1)).toBeLessThan(0.04);
    }
  });

  it('unbound states come from CometOrbit and stay on the asymptote a million years out', () => {
    for (const o of objects.filter((x) => x.row.group === 'interstellar')) {
      const tp = o.row.elements.tp;
      for (const dt of [-300, -10, 0, 5, 400, -1.3e6 * YEAR]) {
        const a = objectState(o, tp + dt, vec3());
        const b = o.orbit.positionAt(tp + dt, vec3());
        expect(v3len(v3sub(vec3(), a, b)) / v3len(b)).toBeLessThan(1e-12);
      }
      const t = 1.3e6 * YEAR;
      const vel = vec3();
      const p = o.orbit.stateAt(tp + t, vec3(), vel);
      const vInf = speedAtInfinity(o.orbit);
      expect(v3len(p) / (vInf * t * DAY)).toBeCloseTo(1, 1);
      expect(v3len(vel) / vInf).toBeCloseTo(1, 3);
    }
  });

  it('orbit samples: closed ellipses through q and Q, hyperbolas out to 150,000 AU, smooth', () => {
    for (const o of objects) {
      const { pts, closed } = orbitSamples(o.orbit);
      const n = pts.length / 3;
      let rMin = Infinity;
      let rMax = 0;
      let maxTurn = 0;
      for (let k = 0; k < n; k++) {
        const r = Math.hypot(pts[3 * k], pts[3 * k + 1], pts[3 * k + 2]);
        rMin = Math.min(rMin, r);
        rMax = Math.max(rMax, r);
        if (k > 0 && k < n - 1) {
          const a = [0, 1, 2].map((c) => pts[3 * k + c] - pts[3 * (k - 1) + c]);
          const b = [0, 1, 2].map((c) => pts[3 * (k + 1) + c] - pts[3 * k + c]);
          const cos = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b) || 1);
          maxTurn = Math.max(maxTurn, Math.acos(Math.min(1, cos)));
        }
      }
      expect(closed).toBe(o.orbit.e < 1);
      expect(rMin / o.orbit.q).toBeLessThan(1.01);
      if (closed) expect(rMax / o.orbit.aphelion).toBeGreaterThan(0.99);
      else expect(rMax / AU).toBeCloseTo(150_000, -3);
      expect(maxTurn).toBeLessThan(0.2);
    }
  });

  it('unselected orbit lines vanish with lineFade = 0; a selected one always shows', () => {
    expect(lineAlpha(false, 0, true)).toBe(0);
    expect(lineAlpha(true, 0, true)).toBe(1);
    expect(lineAlpha(false, 0.4, true)).toBe(0.4);
    expect(lineAlpha(true, 1, false)).toBe(0);
    expect(fadesAt(170)[1]).toBe(0);
    expect(lineAlpha(false, fadesAt(170)[1], true)).toBe(0);
  });

  it('point photometry: Sedna from Earth is about magnitude 21', () => {
    const sedna = byId.get('sedna')!;
    const e = pointIlluminance(sedna, 84 * AU, 83 * AU, 0.01);
    const m = -2.5 * Math.log10(e / 2.54e-6);
    expect(m).toBeGreaterThan(20);
    expect(m).toBeLessThan(22);
  });

  it('info cards and search entries', () => {
    const sedna = byId.get('sedna')!;
    const card = objectCard(sedna, {
      jd: 2461041.5,
      fromSun: () => null,
      fromEarth: () => null,
    });
    const fact = (label: string): InfoFact | undefined => card.facts.find((f) => f.label === label);
    expect(card.simulated).toBe(true);
    expect(card.subtitle).toBe('Sednoid · inner Oort Cloud object');
    expect(fact('Aphelion distance')!.value).toBeGreaterThan(900);
    expect(String(fact('Perihelion date')!.value)).toMatch(/^2076-07-1[78]$/);
    expect(fact('Distance from the Sun')!.unit).toBe('AU');
    expect(fact('Speed relative to the Sun')).toBeDefined();
    for (const f of card.facts.filter((x) => x.source)) expect(f.approximate).toBe(true);
    const visitor = objectCard(byId.get('3i-atlas')!, {
      jd: 2461041.5,
      fromSun: () => null,
      fromEarth: () => null,
    });
    expect(visitor.facts.find((f) => f.label.startsWith('Speed far'))!.value).toBeCloseTo(58, -1);
    expect(visitor.facts.find((f) => f.label === 'Orbital period')!.value).toBe('unbound');
    const entries = objectSearchEntries(OBJECTS.objects);
    expect(entries.map((e) => e.subtitle)).toContain('Interstellar visitor');
    expect(entries.find((e) => e.id === 'bernardinelli-bernstein')!.aliases).toContain('C/2014 UN271');
  });
});

describe('passing stars', () => {
  it('Gliese 710 passes about 10,500 AU from the Sun in about 1.29 Myr', () => {
    const m = motions.get('gliese-710')!;
    expect(yearsToClosest(m) / 1e6).toBeGreaterThan(1.25);
    expect(yearsToClosest(m) / 1e6).toBeLessThan(1.33);
    expect(m.closestDist / AU).toBeGreaterThan(9_500);
    expect(m.closestDist / AU).toBeLessThan(11_500);
    // Distance today from the parallax.
    expect(v3len(m.r0) / PC).toBeCloseTo(1000 / 52.3963, 3);
  });

  it("Scholz's Star passed about 66,000 AU from the Sun about 80,000 years ago", () => {
    const m = motions.get('scholz-star')!;
    expect(yearsToClosest(m)).toBeGreaterThan(-90_000);
    expect(yearsToClosest(m)).toBeLessThan(-70_000);
    expect(m.closestDist / AU).toBeGreaterThan(60_000);
    expect(m.closestDist / AU).toBeLessThan(72_000);
  });

  it('linear motion: the closest point is perpendicular to the velocity and is the minimum', () => {
    for (const m of motions.values()) {
      const p = starPositionAt(m, m.closestJd, vec3());
      expect(v3len(v3sub(vec3(), p, m.closestPoint)) / AU).toBeLessThan(1e-3);
      const dot = (p.x * m.v.x + p.y * m.v.y + p.z * m.v.z) / (v3len(p) * m.speed);
      expect(Math.abs(dot)).toBeLessThan(1e-9);
      for (const dt of [-1000 * YEAR, 1000 * YEAR])
        expect(v3len(starPositionAt(m, m.closestJd + dt, vec3()))).toBeGreaterThan(m.closestDist);
    }
  });

  it('labels switch between future and past wording', () => {
    const g = FLYBYS.stars.find((s) => s.id === 'gliese-710')!;
    const m = motions.get('gliese-710')!;
    expect(flybyLabel(g, m, 2461041.5)).toBe('Gliese 710 · closest in 1.29 million years');
    expect(approachPhrase(m, m.closestJd + 2e5 * YEAR)).toBe('passed 200,000 years ago');
    expect(approachPhrase(m, m.closestJd)).toBe('closest now');
    const s = FLYBYS.stars.find((x) => x.id === 'scholz-star')!;
    expect(flybyLabel(s, motions.get('scholz-star')!, 2461041.5)).toBe(
      "Scholz's Star · passed 80,000 years ago",
    );
  });

  it('info cards list the published approaches with sources', () => {
    for (const s of FLYBYS.stars) {
      const card = flybyCard(s, motions.get(s.id)!, 2461041.5);
      const published = card.facts.filter((f) => f.label === 'Closest approach (published)');
      expect(published).toHaveLength(s.published.length);
      for (const f of published) expect(f.source).toBeTruthy();
      const model = card.facts.find((f) => f.label.startsWith('Closest approach (this model'))!;
      expect(model.approximate).toBe(true);
      expect(card.facts.some((f) => f.label.startsWith('Distance from the Sun'))).toBe(true);
      expect(card.facts.find((f) => f.label === 'Spectral type')!.value).toBe(s.spectral);
    }
  });
});

describe('scale shells', () => {
  const fadeAt = (d: number) => fadesAt(d)[1];

  it('every shell is hidden at 1 AU and at 40 AU (inner Solar System)', () => {
    for (const s of MARKERS.shells)
      for (const d of [1, 40, 170]) expect(shellAlpha(s.radiusAu, d, fadeAt(d), true)).toBe(0);
  });

  it('shells show where expected and hide when tiny or deep inside', () => {
    const alpha = (id: string, d: number) =>
      shellAlpha(MARKERS.shells.find((s) => s.id === id)!.radiusAu, d, fadeAt(d), true);
    // Sednoid view (2,500 AU): heliopause, 550 AU, 1,000 AU on; 1 light-year off (deep inside).
    expect(alpha('heliopause', 2500)).toBeGreaterThan(0.9);
    expect(alpha('gravity-lens', 2500)).toBeGreaterThan(0.9);
    expect(alpha('au-1000', 2500)).toBeGreaterThan(0.9);
    expect(alpha('light-year', 2500)).toBeLessThan(0.05);
    // Gliese 710 view (40,000 AU): 10,000 AU on; heliopause off (too small).
    expect(alpha('au-10000', 40_000)).toBeGreaterThan(0.9);
    expect(alpha('heliopause', 40_000)).toBe(0);
    // The markers switch.
    expect(shellAlpha(1000, 2500, 1, false)).toBe(0);
  });

  it('great circles fade edge-on and at least one always shows', () => {
    const n = vec3(0, 0, 1);
    expect(circleFade(n, vec3(0, 0, 5))).toBe(1);
    expect(circleFade(n, vec3(5, 0, 0))).toBe(0);
    for (const c of [vec3(1, 2, 3), vec3(-3, 0.1, 0.2), vec3(0, 1, 1)]) {
      const best = Math.max(circleFade(vec3(1, 0, 0), c), circleFade(vec3(0, 1, 0), c), circleFade(n, c));
      expect(best).toBe(1);
    }
  });

  it('labels sit on the shells at spread longitudes; cards have sources', () => {
    const seen = new Set<string>();
    MARKERS.shells.forEach((s, i) => {
      const p = labelPoint(i, s.radiusAu, vec3());
      expect(v3len(p) / AU).toBeCloseTo(s.radiusAu, 6);
      seen.add((Math.atan2(p.y, p.x) * 10).toFixed(0));
      const card = shellCard(s);
      expect(card.facts[0].source).toBe(s.source);
    });
    expect(seen.size).toBe(MARKERS.shells.length);
  });
});

describe('bookmarks', () => {
  const list = buildBookmarks(byId, motions);
  const get = (id: string) => list.find((b) => b.id === id)!;

  it('all six exist with unique ids, a lookTarget and a finite pose', () => {
    expect(list.map((b) => b.id).sort()).toEqual(
      [
        SEDNOID_ORBITS_BOOKMARK,
        GLIESE_710_BOOKMARK,
        SCHOLZ_BOOKMARK,
        VISITORS_BOOKMARK,
        BB_ORBIT_BOOKMARK,
        SEDNA_BOOKMARK,
      ].sort(),
    );
    for (const b of list) {
      expect(b.lookTarget!.length).toBeGreaterThan(60);
      expect(Number.isFinite(v3len(b.pos))).toBe(true);
      const q = b.quat!;
      expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 9);
      expect(typeof b.jd).toBe('number');
    }
  });

  it('distances and dates', () => {
    expect(v3len(get(SEDNOID_ORBITS_BOOKMARK).pos) / AU).toBeCloseTo(2500, 6);
    expect(v3len(get(VISITORS_BOOKMARK).pos) / AU).toBeCloseTo(650, 6);
    const g = get(GLIESE_710_BOOKMARK);
    expect(g.jd).toBe(motions.get('gliese-710')!.closestJd);
    expect(v3len(g.pos) / AU).toBeCloseTo(40_000, 3);
    const s = get(SCHOLZ_BOOKMARK);
    expect(((s.jd as number) - 2461041.5) / YEAR).toBeLessThan(-70_000);
    // Everything stays inside the lines' far fade (200,000 AU) and outside the near fade (400 AU).
    for (const b of list.filter((x) => x.frame === 'sun')) {
      const d = v3len(b.pos) / AU;
      expect(fadesAt(d)[1]).toBe(1);
    }
    const sedna = get(SEDNA_BOOKMARK);
    expect(sedna.frame).toBe('sedna');
    expect(sedna.lookAt).toBe('sedna');
    expect(v3len(sedna.pos) / 5e5).toBeCloseTo(3.2, 6);
    expect(sedna.ev!).toBeGreaterThanOrEqual(2);
    expect(sedna.ev!).toBeLessThanOrEqual(4);
  });

  it('the Sedna close-up sees the lit side', () => {
    const sedna = byId.get('sedna')!;
    const b = get(SEDNA_BOOKMARK);
    const p = sedna.orbit.positionAt(b.jd as number, vec3());
    // Camera direction from Sedna has a positive component towards the Sun.
    expect(-(b.pos.x * p.x + b.pos.y * p.y + b.pos.z * p.z) / (v3len(b.pos) * v3len(p))).toBeGreaterThan(0.5);
  });
});
