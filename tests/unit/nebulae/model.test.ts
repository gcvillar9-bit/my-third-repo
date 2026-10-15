import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  bowlZ,
  columnLayers,
  D_PC,
  emptyLayers,
  marchRay,
  MODEL,
  nebulaGlslDefines,
  profileCdf,
  segmentFraction,
  skyPc,
  thickness,
  volumeBox,
  zRange,
  type ColumnSample,
  type FieldSampler,
  type NebulaMeta,
} from '../../../src/modules/nebulae/model';
import orion from '../../../src/modules/nebulae/orion.json';

const ROOT = new URL('../../../', import.meta.url).pathname;
const meta = JSON.parse(readFileSync(`${ROOT}public/data/nebulae/orion-meta.json`, 'utf8')) as NebulaMeta;
const XI = meta.field.xiMax;

/** Deterministic hash noise in [0, 1). */
const hash = (x: number, y: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** A synthetic field: bright core, structure, dust lanes and noise maps everywhere. */
const synthetic: FieldSampler = (xi, eta, out) => {
  const r = Math.hypot(xi, eta) / XI;
  const base = 0.02 * Math.exp(-r * 8) + 1e-4;
  const tex = 0.6 + 0.8 * hash(Math.floor(xi / (XI / 300)), Math.floor(eta / (XI / 300)));
  out.S[0] = base * tex;
  out.S[1] = 0.6 * base * tex;
  out.S[2] = 0.3 * base;
  out.tau = 2 * hash(Math.floor(xi / (XI / 50)) + 7, Math.floor(eta / (XI / 50)));
  out.disp = 2 * hash(Math.floor(xi / (XI / 120)), Math.floor(eta / (XI / 120)) + 3) - 1;
  out.thick = 2 * hash(Math.floor(xi / (XI / 80)) + 11, Math.floor(eta / (XI / 80))) - 1;
  return out;
};

const earthRay = (xi: number, eta: number) => {
  const n = Math.hypot(xi, eta, 1);
  return { o: { x: 0, y: 0, z: -D_PC }, d: { x: xi / n, y: eta / n, z: 1 / n } };
};

describe('nebulae depth model', () => {
  it('puts the ionization front 0.2 pc behind θ¹ Ori C, concave towards Earth', () => {
    expect(bowlZ(0, 0)).toBeCloseTo(orion.geometry.bowl.z0Pc, 6);
    // Away from the Bar (towards the NW) the front rises monotonically towards Earth (smaller z).
    let prev = bowlZ(0, 0);
    for (let r = 0.25; r <= 6; r += 0.25) {
      const z = bowlZ(-r * 0.7071, r * 0.7071);
      expect(z).toBeLessThan(prev);
      prev = z;
    }
    expect(bowlZ(-4.2, 4.2)).toBeGreaterThan(orion.geometry.veil.zPc);
    // Concave: the second derivative near the centre is negative (towards Earth on both sides).
    const h = 0.3;
    expect(bowlZ(-h, 0) + bowlZ(h, 0)).toBeLessThan(2 * bowlZ(0, 0) + 1e-9);
  });

  it('raises the Orion Bar escarpment 0.23 pc SE of θ¹ Ori C', () => {
    const [nx, ny] = MODEL.barNormal;
    expect(nx).toBeGreaterThan(0); // towards the east
    expect(ny).toBeLessThan(0); // and the south
    const at = (s: number) => bowlZ(nx * s, ny * s);
    const step = at(MODEL.barDistance - 2 * MODEL.barWidth) - at(MODEL.barDistance + 2 * MODEL.barWidth);
    const smooth =
      bowlZ(-nx * (MODEL.barDistance - 2 * MODEL.barWidth), -ny * (MODEL.barDistance - 2 * MODEL.barWidth)) -
      bowlZ(-nx * (MODEL.barDistance + 2 * MODEL.barWidth), -ny * (MODEL.barDistance + 2 * MODEL.barWidth));
    expect(step - smooth).toBeCloseTo(MODEL.barRise, 2);
  });

  it('thickens the emitting layer from ~0.1 pc at the core to ~1 pc outwards', () => {
    expect(thickness(0, 0)).toBeCloseTo(0.1, 6);
    expect(thickness(10, 0)).toBeCloseTo(1, 6);
    expect(thickness(0, 1)).toBeCloseTo(0.1 * (1 + MODEL.thicknessNoise), 6);
  });

  it('orders every column: veil in front, emission, dark cloud behind, all inside the box', () => {
    const [zMin, zMax] = zRange();
    const L = emptyLayers();
    for (let k = 0; k < 2000; k++) {
      const X = (hash(k, 1) * 2 - 1) * 6.5;
      const Y = (hash(k, 2) * 2 - 1) * 6.5;
      columnLayers(X, Y, { tau: hash(k, 3) * 2, disp: hash(k, 4) * 2 - 1, thick: hash(k, 5) * 2 - 1 }, L);
      expect(L.veilZ + L.veilHw).toBeLessThan(L.sheetZ - L.sheetHw);
      expect(L.omcZ - L.omcHw).toBeGreaterThan(L.sheetZ + L.sheetHw);
      if (L.w43 > 0) {
        expect(L.veilZ + L.veilHw).toBeLessThan(L.m43Z - L.m43Hw);
        expect(L.omcZ - L.omcHw).toBeGreaterThan(L.m43Z + L.m43Hw);
      }
      expect(L.veilZ - L.veilHw).toBeGreaterThanOrEqual(zMin);
      expect(L.omcZ + L.omcHw).toBeLessThanOrEqual(zMax);
      expect(L.veilTau).toBeLessThanOrEqual(MODEL.tauMax + 1e-12);
    }
  });

  it('makes M43 a 0.6 pc ball around NU Ori', () => {
    const nu = orion.stars.find((s) => s.id === 'nu-ori')!;
    const c = skyPc(nu.raDeg, nu.decDeg);
    expect(Math.hypot(c.x, c.y)).toBeGreaterThan(0.8);
    const L = columnLayers(c.x, c.y, { tau: 0, disp: 0, thick: 0 }, emptyLayers());
    expect(L.w43).toBe(1);
    expect(L.m43Hw).toBeCloseTo(orion.geometry.m43.radiusPc, 6);
    const off = columnLayers(c.x + 0.7, c.y, { tau: 0, disp: 0, thick: 0 }, emptyLayers());
    expect(off.w43).toBe(0);
  });

  it('integrates a layer exactly for any step size', () => {
    expect(profileCdf(-1)).toBe(0);
    expect(profileCdf(1)).toBe(1);
    for (const n of [1, 2, 3, 7, 40]) {
      let s = 0;
      for (let i = 0; i < n; i++) {
        const ua = -1.3 + (2.6 * i) / n;
        const ub = -1.3 + (2.6 * (i + 1)) / n;
        s += segmentFraction(ua, ub, ub - ua);
      }
      expect(s).toBeCloseTo(1, 12);
    }
  });

  it('conserves every Earth column within 3% (the view from Earth is the photo)', () => {
    const cs: ColumnSample = { S: [0, 0, 0], tau: 0, disp: 0, thick: 0 };
    let worst = 0;
    for (const steps of [24, 48, 96]) {
      for (let k = 0; k < 120; k++) {
        const xi = (hash(k, 9) * 2 - 1) * 0.85 * XI;
        const eta = (hash(k, 10) * 2 - 1) * 0.85 * XI;
        const { o, d } = earthRay(xi, eta);
        const r = marchRay(o, d, steps, hash(k, 11), synthetic, XI);
        synthetic(xi, eta, cs);
        for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(r.L[c] / cs.S[c] - 1));
      }
    }
    expect(worst).toBeLessThan(0.03);
  });

  it('dims the background through the veil and the dark cloud, and hides the far side', () => {
    const { o, d } = earthRay(0, 0);
    const front = marchRay(o, d, 48, 0.5, synthetic, XI);
    expect(front.T).toBeLessThan(0.01); // OMC-1 behind the core is opaque
    const back = marchRay({ x: 0, y: 0, z: 30 }, { x: 0, y: 0, z: -1 }, 48, 0.5, synthetic, XI);
    expect(back.L[0] + back.L[1] + back.L[2]).toBeLessThan(0.01 * (front.L[0] + front.L[1] + front.L[2]));
  });

  it('is deterministic', () => {
    const a = marchRay({ x: 1, y: -2, z: -5 }, { x: -0.1, y: 0.3, z: 0.95 }, 48, 0.37, synthetic, XI);
    const b = marchRay({ x: 1, y: -2, z: -5 }, { x: -0.1, y: 0.3, z: 0.95 }, 48, 0.37, synthetic, XI);
    expect(a).toEqual(b);
  });

  it('bounds the work: at most steps + 1 column evaluations per ray', () => {
    for (let k = 0; k < 50; k++) {
      const o = { x: (hash(k, 1) - 0.5) * 4, y: (hash(k, 2) - 0.5) * 4, z: (hash(k, 3) - 0.5) * 3 };
      const d = { x: hash(k, 4) - 0.5, y: hash(k, 5) - 0.5, z: hash(k, 6) - 0.5 };
      const n = Math.hypot(d.x, d.y, d.z);
      const r = marchRay(o, { x: d.x / n, y: d.y / n, z: d.z / n }, 32, 0.5, synthetic, XI);
      expect(r.evals).toBeLessThanOrEqual(33);
      expect(Number.isFinite(r.L[0] + r.L[1] + r.L[2] + r.T)).toBe(true);
    }
  });

  it('shares every model constant with the GLSL twin', () => {
    const glsl = ['model.glsl', 'march.glsl', 'display.glsl']
      .map((f) => readFileSync(`${ROOT}src/modules/nebulae/${f}`, 'utf8'))
      .join('\n');
    const defines = nebulaGlslDefines(meta);
    const defined = new Set([...defines.matchAll(/#define (NEB_\w+)/g)].map((m) => m[1]));
    const used = new Set([...glsl.matchAll(/\bNEB_\w+/g)].map((m) => m[0]));
    for (const u of used) expect(defined, `${u} is not defined by nebulaGlslDefines`).toContain(u);
    for (const d of defined) expect(used, `${d} is unused in GLSL`).toContain(d);
    expect(glsl).not.toMatch(/#define NEB_/);
    // The twins implement the same pieces.
    for (const fn of [
      'nebBowlZ',
      'nebThickness',
      'nebColumn',
      'nebCdf',
      'nebFraction',
      'nebCentre',
      'nebEdge',
      'nebStep',
      'nebSegment',
    ])
      expect(glsl).toContain(`${fn}(`);
    expect(defines).toContain(`#define NEB_D ${D_PC}.0`);
    expect(volumeBox(XI).half).toBeGreaterThan(XI * D_PC);
  });
});
