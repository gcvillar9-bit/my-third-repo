import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pub = (p: string) => fileURLToPath(new URL(`../../../public/${p}`, import.meta.url));

interface Elements {
  epoch: number;
  frame: string;
  center: string;
  a: number;
  e: number;
  i: number;
  node: number;
  argPeri: number;
  meanAnomaly: number;
  period: number;
  axes?: { x: number[]; y: number[]; z: number[] };
  source: string;
}
interface BodyRow {
  id: string;
  name: string;
  kind: string;
  parent: string | null;
  ephemeris: 'astronomy-engine' | 'kepler';
  radius: number;
  radiusEquatorial?: number;
  radiusPolar?: number;
  oblateness?: number;
  gm: number;
  albedoGeometric?: number;
  albedoBond?: number;
  rotation?: { ra0?: number; dec0?: number; w0?: number; wdot?: number; periodHours?: number };
  elements?: Elements;
  textures?: Record<string, string | Record<string, string>>;
  rings?: { inner: number; outer: number };
  source: string;
}

const doc = JSON.parse(readFileSync(pub('data/solar-system/bodies.json'), 'utf8')) as {
  version: number;
  frames: Record<string, string>;
  bodies: BodyRow[];
};
const byId = new Map(doc.bodies.map((b) => [b.id, b]));
const KINDS = ['star', 'planet', 'dwarf', 'moon', 'minor'];
const AE = ['sun', 'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'moon'];
const GALILEAN = ['io', 'europa', 'ganymede', 'callisto'];

describe('bodies.json schema', () => {
  it('lists the Sun, 8 planets, the Moon, >= 25 other moons and the dwarf/minor planets', () => {
    expect(doc.version).toBe(1);
    for (const id of [...AE, ...GALILEAN, 'pluto', 'charon', 'ceres', 'vesta', 'eris', 'haumea', 'makemake'])
      expect(byId.has(id), id).toBe(true);
    const otherMoons = doc.bodies.filter((b) => b.kind === 'moon' && !['moon', 'charon'].includes(b.id));
    expect(otherMoons.length).toBeGreaterThanOrEqual(25);
    expect(new Set(doc.bodies.map((b) => b.id)).size).toBe(doc.bodies.length);
  });

  it('has radius, GM, kind, parent and source on every row', () => {
    for (const b of doc.bodies) {
      expect(KINDS, b.id).toContain(b.kind);
      expect(b.radius, b.id).toBeGreaterThan(0);
      expect(b.gm, b.id).toBeGreaterThan(0);
      expect(typeof b.source, b.id).toBe('string');
      expect(b.source.length, b.id).toBeGreaterThan(5);
      if (b.id === 'sun') expect(b.parent).toBeNull();
      else expect(byId.has(b.parent as string), b.id).toBe(true);
      if (b.radiusEquatorial && b.radiusPolar)
        expect(b.oblateness).toBeCloseTo(1 - b.radiusPolar / b.radiusEquatorial, 5);
      if (b.rotation?.wdot) expect(b.rotation.periodHours).toBeCloseTo((24 * 360) / b.rotation.wdot, 4);
    }
    expect(byId.get('earth')!.radiusEquatorial).toBeCloseTo(6378.1366, 3);
    expect(byId.get('saturn')!.oblateness).toBeCloseTo(0.09796, 4);
    expect(byId.get('earth')!.gm).toBeCloseTo(398600.4355, 3);
    expect(byId.get('venus')!.rotation!.periodHours).toBeLessThan(0); // retrograde
  });

  it('has Keplerian elements for every body astronomy-engine does not cover', () => {
    for (const b of doc.bodies) {
      const covered = AE.includes(b.id) || GALILEAN.includes(b.id) || b.id === 'pluto';
      expect(b.ephemeris, b.id).toBe(covered ? 'astronomy-engine' : 'kepler');
      if (covered && b.id !== 'pluto') continue;
      const e = b.elements!;
      expect(e, b.id).toBeDefined();
      expect(Object.keys(doc.frames), b.id).toContain(e.frame);
      expect(e.center === 'ssb' || byId.has(e.center), b.id).toBe(true);
      expect(e.a, b.id).toBeGreaterThan(1000);
      expect(e.e, b.id).toBeGreaterThanOrEqual(0);
      expect(e.e, b.id).toBeLessThan(1);
      expect(e.period, b.id).toBeGreaterThan(0);
      expect(e.epoch, b.id).toBeGreaterThan(2_400_000);
      expect(e.source, b.id).toMatch(/Celestia/);
      if (e.frame === 'icrf-axes') {
        const { x, z } = e.axes!;
        expect(Math.hypot(...x)).toBeCloseTo(1, 6);
        expect(x[0] * z[0] + x[1] * z[1] + x[2] * z[2]).toBeCloseTo(0, 6);
      }
      // Kepler's third law against the parent's GM (Hyperion is resonance-perturbed, ~2%).
      const mu = (e.center === 'ssb' ? byId.get('sun')!.gm : byId.get(e.center)!.gm) + b.gm;
      const t = (2 * Math.PI * Math.sqrt(e.a ** 3 / mu)) / 86400;
      expect(Math.abs(t / e.period - 1), b.id).toBeLessThan(b.id === 'hyperion' ? 0.03 : 0.01);
    }
    const titan = byId.get('titan')!.elements!;
    expect(titan.period).toBeCloseTo(15.945, 2);
    expect(titan.center).toBe('saturn');
    expect(byId.get('charon')!.elements!.a).toBeCloseTo(19595.764, 2);
  });

  it('references textures that exist, with ring data for Saturn and Uranus', () => {
    const paths: string[] = [];
    for (const b of doc.bodies) {
      for (const v of Object.values(b.textures ?? {}))
        paths.push(...(typeof v === 'string' ? [v] : Object.values(v)));
    }
    expect(paths.length).toBeGreaterThan(40);
    for (const p of paths) expect(existsSync(pub(p)), p).toBe(true);
    for (const id of ['earth', 'moon', 'mars', 'jupiter', 'saturn', 'titan', 'pluto'])
      expect(byId.get(id)!.textures, id).toBeDefined();
    expect(byId.get('saturn')!.rings!.inner).toBeGreaterThan(70000);
    expect(byId.get('uranus')!.rings!.outer).toBeGreaterThan(50000);
  });
});
