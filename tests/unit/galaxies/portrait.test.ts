import { describe, expect, it } from 'vitest';
import {
  armRidgeTheta,
  buildPortraitModel,
  marchPortrait,
  sampleMap,
  skyAimAzimuth,
  tiltToInclination,
  type PortraitModel,
} from '../../../src/modules/galaxies/portrait-model';
import {
  derivePortraitParams,
  type PortraitInput,
  type PortraitParams,
} from '../../../src/modules/galaxies/portrait-params';

const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** Orthographic flux (Σ L dA) of the CPU twin seen from direction v (towards the observer). */
function flux(m: PortraitModel, v: number[], dust: boolean, n = 60, steps = 24): number[] {
  const l = Math.hypot(v[0], v[1], v[2]);
  const w = v.map((x) => x / l);
  const rd = w.map((x) => -x);
  let up = [-w[2] * w[0], -w[2] * w[1], 1 - w[2] * w[2]];
  let ul = Math.hypot(up[0], up[1], up[2]);
  if (ul < 1e-6) {
    up = [0, 1, 0];
    ul = 1;
  }
  up = up.map((x) => x / ul);
  const right = [rd[1] * up[2] - rd[2] * up[1], rd[2] * up[0] - rd[0] * up[2], rd[0] * up[1] - rd[1] * up[0]];
  const half = Math.hypot(m.half[0], m.half[1], m.half[2]);
  // Finer along `up` (the projected disc normal): edge-on layers are a few 0.1 kpc thick.
  const ny = 6 * n;
  const dA = ((2 * half) / n) * ((2 * half) / ny);
  const sum = [0, 0, 0];
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < n; i++) {
      const a = ((i + 0.5) / n) * 2 * half - half;
      const b = ((j + 0.5) / ny) * 2 * half - half;
      const ro = [0, 1, 2].map((c) => w[c] * 10 * half + right[c] * a + up[c] * b);
      const L = marchPortrait(m, ro, rd, { steps, jitter: ((i * 7 + j * 13) % 17) / 17, dust });
      for (let c = 0; c < 3; c++) sum[c] += L[c] * dA;
    }
  return sum;
}

const input = (type: number, extra: Partial<PortraitInput> = {}): PortraitInput => ({
  index: 1234,
  type,
  radiusKpc: 12,
  absMag: -20.5,
  ...extra,
});

describe('galaxy portraits: parameters', () => {
  it('derives plausible defaults for every Hubble type code 0-15', () => {
    for (let t = 0; t < 16; t++) {
      const p = derivePortraitParams(input(t));
      const shares = p.fBulge + p.fOld + p.fYoung + p.fHii + p.fPolar;
      expect(shares, `type ${t}`).toBeCloseTo(1, 6);
      for (const v of [
        p.bulgeReKpc,
        p.bulgeMaxKpc,
        p.discScaleKpc,
        p.hOldKpc,
        p.hYoungKpc,
        p.hDustKpc,
        p.hHiiKpc,
      ])
        expect(Number.isFinite(v) && v > 0, `type ${t}`).toBe(true);
      expect(p.bulgeMaxKpc).toBeGreaterThan(p.bulgeReKpc);
      if (t <= 7) {
        expect(p.fBulge).toBe(1);
        expect(p.dustTau).toBe(0);
        expect(p.bulgeFlat).toBeCloseTo(1 - t / 10, 1);
      } else {
        expect(p.fOld + p.fYoung + p.fHii).toBeGreaterThan(0.2);
        expect(p.pitchRad * (180 / Math.PI)).toBeGreaterThan(3);
        expect(p.pitchRad * (180 / Math.PI)).toBeLessThan(50);
        expect(p.armCount).toBeGreaterThanOrEqual(1);
        expect(p.dustTau).toBeGreaterThan(0);
      }
      if (t >= 12 && t <= 14) expect(p.barStrength).toBe(1);
      // Later types are younger (bluer) and less bulge-dominated.
      if (t === 9 || t === 11) {
        const sa = derivePortraitParams(input(9));
        const sc = derivePortraitParams(input(11));
        expect(sc.fYoung).toBeGreaterThan(sa.fYoung);
        expect(sc.fBulge).toBeLessThan(sa.fBulge);
        expect(sc.pitchRad).toBeGreaterThan(sa.pitchRad * 0.9);
      }
      // A model builds and its amplitudes are finite.
      const m = buildPortraitModel(p, 32);
      for (const a of Object.values(m.amp)) expect(Number.isFinite(a)).toBe(true);
    }
  });

  it('varies between two catalogue indices of the same type, and is stable per index', () => {
    const a = derivePortraitParams(input(11, { index: 100 }));
    const b = derivePortraitParams(input(11, { index: 200 }));
    const a2 = derivePortraitParams(input(11, { index: 100 }));
    expect(a2).toEqual(a);
    const differs = (k: keyof PortraitParams) => a[k] !== b[k];
    expect(differs('armPhaseRad')).toBe(true);
    expect(differs('pitchRad') || differs('armClass') || differs('armCount')).toBe(true);
  });

  it('lets measured inputs override styling and defaults', () => {
    const p = derivePortraitParams(
      input(10, {
        measured: { pitchDeg: 25, bulgeToTotal: 0.1, armCount: 3 },
        look: { pitchDeg: 9, armCount: 2 },
      }),
    );
    expect(p.pitchRad).toBeCloseTo((25 * Math.PI) / 180, 9);
    expect(p.armCount).toBe(3);
    expect(p.fBulge).toBeCloseTo(0.1, 9);
    const q = derivePortraitParams(input(10, { look: { pitchDeg: 9 } }));
    expect(q.pitchRad).toBeCloseTo((9 * Math.PI) / 180, 9);
  });
});

describe('galaxy portraits: CPU twin', () => {
  const cases: [string, PortraitInput][] = [
    ['E3', input(3)],
    ['S0', input(8)],
    ['Sb', input(10)],
    ['SBc', input(14)],
    ['Irr', input(15, { radiusKpc: 5 })],
    [
      'Sc + cones',
      input(11, {
        look: {
          polar: {
            kind: 'cones',
            share: 0.05,
            lengthFrac: 0.4,
            widthFrac: 0.05,
            openingDeg: 25,
            color: [1, 0.2, 0.2],
          },
        },
      }),
    ],
    [
      'E0 + jet',
      input(0, {
        look: {
          polar: {
            kind: 'jet',
            share: 0.02,
            lengthFrac: 0.1,
            widthFrac: 0.01,
            openingDeg: 1,
            color: [0.8, 0.9, 1],
            axis: [1, 0, 0],
          },
        },
      }),
    ],
  ];

  it('integrates to the catalogue flux with dust off (several types, several directions)', () => {
    for (const [name, inp] of cases) {
      const m = buildPortraitModel(derivePortraitParams(inp), 64);
      for (const v of [
        [0.2, 0.1, 1],
        [0.6, -0.5, 0.4],
        [1, 0.3, 0.05],
      ]) {
        const f = lum(flux(m, v, false));
        expect(f, `${name} from ${v.join(',')}`).toBeGreaterThan(0.96);
        expect(f, `${name} from ${v.join(',')}`).toBeLessThan(1.04);
      }
    }
  });

  it('dust only removes light, more in blue than in red', () => {
    const m = buildPortraitModel(derivePortraitParams(input(10)), 64);
    const off = flux(m, [0.6, 0.1, 0.4], false);
    const on = flux(m, [0.6, 0.1, 0.4], true);
    for (let c = 0; c < 3; c++) expect(on[c]).toBeLessThan(off[c]);
    expect(on[2] / off[2]).toBeLessThan(on[0] / off[0]);
  });

  it('bakes deterministically', () => {
    const p = derivePortraitParams(input(13, { index: 77 }));
    const a = buildPortraitModel(p, 64);
    const b = buildPortraitModel(derivePortraitParams(input(13, { index: 77 })), 64);
    expect(Buffer.from(a.map.buffer).equals(Buffer.from(b.map.buffer))).toBe(true);
    expect(Buffer.from(a.lut.buffer).equals(Buffer.from(b.lut.buffer))).toBe(true);
    expect(a.amp).toEqual(b.amp);
  });

  it('puts the arm ridges on a logarithmic spiral of the stated pitch angle', () => {
    for (const pitchDeg of [12, 25]) {
      const p = derivePortraitParams(
        input(11, {
          measured: { pitchDeg, armCount: 2, armClass: 12, barClass: 'A' },
          look: { flocculence: 0, lopsided: 0, armPhaseDeg: 30 },
        }),
      );
      const m = buildPortraitModel(p, 256);
      const out = [0, 0, 0, 0];
      const ridge = (r: number) => {
        let best = -1;
        let at = 0;
        for (let k = 0; k < 1440; k++) {
          const th = (k / 1440) * Math.PI; // two arms: one period is pi
          const v = sampleMap(m, r * Math.cos(th), r * Math.sin(th), out)[1];
          if (v > best) {
            best = v;
            at = th;
          }
        }
        return at;
      };
      const wrap = (a: number) => a - Math.PI * Math.round(a / Math.PI);
      for (const r of [0.8 * p.discScaleKpc, 1.5 * p.discScaleKpc, 2.4 * p.discScaleKpc]) {
        const expected = armRidgeTheta(p, m.armPhaseRad, r, 0);
        expect(Math.abs(wrap(ridge(r) - expected)), `pitch ${pitchDeg} r ${r.toFixed(1)}`).toBeLessThan(0.08);
      }
      // Winding between two radii: delta theta = ln(r2 / r1) / tan(pitch).
      const r1 = p.discScaleKpc;
      const r2 = 2 * p.discScaleKpc;
      const d = wrap(ridge(r2) - ridge(r1) - Math.log(2) / Math.tan((pitchDeg * Math.PI) / 180));
      expect(Math.abs(d)).toBeLessThan(0.1);
    }
  });

  it('respects the bar angle and length', () => {
    const p = derivePortraitParams(
      input(13, {
        measured: { barClass: 'B', barRadiusFrac: 0.3 },
        look: { barAngleDeg: 35, lopsided: 0, oldArmContrast: 0 },
      }),
    );
    const m = buildPortraitModel(p, 256);
    const L = p.barLengthKpc;
    expect(L).toBeCloseTo(0.3 * 12, 6);
    const out = [0, 0, 0, 0];
    const old = (r: number, th: number) => sampleMap(m, r * Math.cos(th), r * Math.sin(th), out)[0];
    // Angle of the brightest old light on a circle inside the bar.
    let best = -1;
    let at = 0;
    for (let k = 0; k < 720; k++) {
      const th = (k / 720) * Math.PI;
      const v = old(0.6 * L, th);
      if (v > best) {
        best = v;
        at = th;
      }
    }
    expect(Math.abs(at - (35 * Math.PI) / 180)).toBeLessThan((3 * Math.PI) / 180);
    const a = (35 * Math.PI) / 180;
    const along = (r: number) => old(r, a);
    const across = (r: number) => old(r, a + Math.PI / 2);
    expect(along(0.7 * L) / across(0.7 * L)).toBeGreaterThan(2);
    expect(along(1.6 * L) / across(1.6 * L)).toBeLessThan(1.3);
  });

  it('tilts a disc to a requested inclination and aims a bridge on the sky', () => {
    const q = [0.1, 0.2, 0.3, 0.927];
    const ql = Math.hypot(...q);
    const qn = q.map((v) => v / ql);
    const los = [0.3, -0.8, 0.52];
    for (const deg of [10, 45, 84]) {
      const r = tiltToInclination(qn, los, deg);
      const [x, y, z, w] = r;
      const n = [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)];
      const c = Math.abs(n[0] * los[0] + n[1] * los[1] + n[2] * los[2]) / Math.hypot(...los);
      expect((Math.acos(c) * 180) / Math.PI).toBeCloseTo(deg, 4);
    }
    // Face-on observer: the sky direction is the in-plane direction itself.
    expect(skyAimAzimuth([0, 5, 40], [0, 0, 1])).toBeCloseTo(Math.PI / 2, 2);
  });
});
