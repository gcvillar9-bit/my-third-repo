import { describe, expect, it } from 'vitest';
import { MW_FRAME, ROOT_FRAME, SSB_FRAME, type FrameDef } from '../../../src/core/contracts';
import { addStandardFrames, FrameTreeImpl, SGRA_DEC, SGRA_RA } from '../../../src/core/frames';
import { qfromAxisAngle, qrotate, quat, v3len, v3set, v3sub, vec3 } from '../../../src/core/math64';
import { R0_GALACTIC } from '../../../src/core/units';

const fixed = (
  id: string,
  parent: string,
  x: number,
  y: number,
  z: number,
  r = 1,
  rot?: number,
): FrameDef => ({
  id,
  parent,
  influenceRadius: r,
  positionAt: (_jd, out) => v3set(out, x, y, z),
  ...(rot !== undefined
    ? {
        orientationAt: (_jd: number, out: ReturnType<typeof quat>) => qfromAxisAngle(out, vec3(1, 2, 3), rot),
      }
    : {}),
});

describe('frame tree', () => {
  it('keeps an object 1 m away below 1 mm error with the anchor 1e22 m from the root', () => {
    const t = new FrameTreeImpl();
    t.addFrame(fixed('far', ROOT_FRAME, 1e22, -3.3e21, 7.7e21, 1e12, 0.7));
    t.addFrame(fixed('mid', 'far', 1.234567e15, 9.87e14, -5e14, 1e9, -1.1));
    // Camera at a point of 'mid'; the object frame sits exactly 1 m along mid's +x from it.
    const cam = { frame: 'mid', local: vec3(123456789.123, -98765.4321, 5555.5) };
    t.addFrame(fixed('obj', 'mid', cam.local.x + 1, cam.local.y, cam.local.z, 10));
    const d = t.toCamera(cam, 'obj', vec3(), 2451545, vec3());
    expect(Math.abs(v3len(d) - 1)).toBeLessThan(1e-3);
    // Direction: mid's +x axis in world axes.
    const ex = t.toWorldDir('mid', vec3(1, 0, 0), 2451545, vec3());
    expect(v3len(v3sub(vec3(), d, ex))).toBeLessThan(1e-3);
    // Moon-at-1.7 m variant (precision torture): sub-millimetre too.
    const d2 = t.delta('mid', cam.local, 'mid', vec3(cam.local.x, cam.local.y + 1.7, cam.local.z), 0, vec3());
    expect(Math.abs(v3len(d2) - 1.7)).toBeLessThan(1e-3);
  });

  it('finds lowest common ancestors and paths', () => {
    const t = new FrameTreeImpl();
    t.addFrame(fixed('a', ROOT_FRAME, 1, 0, 0));
    t.addFrame(fixed('b', 'a', 1, 0, 0));
    t.addFrame(fixed('c', 'a', 0, 1, 0));
    t.addFrame(fixed('d', ROOT_FRAME, 0, 0, 1));
    expect(t.lca('b', 'c')).toBe('a');
    expect(t.lca('b', 'd')).toBe(ROOT_FRAME);
    expect(t.lca('b', 'b')).toBe('b');
    expect(t.path('b')).toEqual([ROOT_FRAME, 'a', 'b']);
    expect(() => t.addFrame(fixed('a', ROOT_FRAME, 0, 0, 0))).toThrow();
    expect(() => t.addFrame(fixed('x', 'nope', 0, 0, 0))).toThrow();
    expect(() => t.removeFrame('a')).toThrow();
    t.removeFrame('c');
    expect(t.has('c')).toBe(false);
    expect(t.children('a')).toEqual(['b']);
  });

  it('converts points between rotated frames and back', () => {
    const t = new FrameTreeImpl();
    t.addFrame(fixed('a', ROOT_FRAME, 1e11, 2e10, 0, 1e9, 0.4));
    t.addFrame(fixed('b', 'a', 3e8, 0, -1e7, 1e7, 2.1));
    t.addFrame(fixed('c', ROOT_FRAME, -5e11, 0, 0, 1e9, -0.9));
    const p = vec3(1234.5, -678.9, 42);
    const inC = t.convertPoint('b', p, 'c', 0, vec3());
    const back = t.convertPoint('c', inC, 'b', 0, vec3());
    expect(v3len(v3sub(vec3(), back, p))).toBeLessThan(1e-3);
    // delta is antisymmetric and consistent with convertPoint.
    const d1 = t.delta('b', p, 'c', vec3(), 0, vec3());
    const d2 = t.delta('c', vec3(), 'b', p, 0, vec3());
    expect(v3len(vec3(d1.x + d2.x, d1.y + d2.y, d1.z + d2.z))).toBeLessThan(1e-3);
    const len = v3len(t.convertPoint('b', p, 'c', 0, vec3()));
    expect(Math.abs(v3len(d1) - len) / len).toBeLessThan(1e-12);
  });

  it('re-anchors to the deepest influence sphere with 10% hysteresis', () => {
    const t = new FrameTreeImpl();
    t.addFrame(fixed('sys', ROOT_FRAME, 1e15, 0, 0, 1e12));
    t.addFrame(fixed('planet', 'sys', 1e10, 0, 0, 1000));
    t.addFrame(fixed('planet.fixed', 'planet', 0, 0, 0, 1000, 0.5));
    const at = (dx: number) => vec3(1e10 + dx, 0, 0);
    expect(t.findAnchor('sys', at(950), 0)).toBe('planet.fixed');
    const noFixed = (id: string) => !id.endsWith('.fixed');
    expect(t.findAnchor('sys', at(950), 0, undefined, 0.1, noFixed)).toBe('planet');
    expect(t.findAnchor('sys', at(1050), 0)).toBe('sys');
    expect(t.findAnchor('sys', at(1050), 0, 'planet', 0.1, noFixed)).toBe('planet');
    expect(t.findAnchor('sys', at(1099), 0, 'planet', 0.1, noFixed)).toBe('planet');
    expect(t.findAnchor('sys', at(1101), 0, 'planet', 0.1, noFixed)).toBe('sys');
    expect(t.findAnchor('sys', vec3(2e12, 0, 0), 0, 'planet')).toBe(ROOT_FRAME);
  });

  it('caches per jd and re-evaluates when jd changes', () => {
    const t = new FrameTreeImpl();
    let calls = 0;
    t.addFrame({
      id: 'moving',
      parent: ROOT_FRAME,
      influenceRadius: 1,
      positionAt: (jd, out) => (calls++, v3set(out, jd, 0, 0)),
    });
    const out = vec3();
    t.relative(ROOT_FRAME, 'moving', 10, out);
    t.relative(ROOT_FRAME, 'moving', 10, out);
    expect(calls).toBe(1);
    expect(t.relative(ROOT_FRAME, 'moving', 11, out).x).toBe(11);
    expect(calls).toBe(2);
  });

  it('places Sgr A* at its ICRS position and R0 from the SSB, with world axes = ssb axes', () => {
    const t = new FrameTreeImpl();
    addStandardFrames(t);
    addStandardFrames(t); // idempotent
    const d = t.relative(SSB_FRAME, MW_FRAME, 0, vec3());
    expect(v3len(d) / R0_GALACTIC).toBeCloseTo(1, 12);
    const ra = Math.atan2(d.y, d.x) + 2 * Math.PI;
    const dec = Math.asin(d.z / v3len(d));
    expect(ra).toBeCloseTo(SGRA_RA, 9);
    expect(dec).toBeCloseTo(SGRA_DEC, 9);
    const q = t.orientation(SSB_FRAME, 0, quat());
    expect(Math.abs(q.w)).toBeCloseTo(1, 12);
    // Galactic north pole (mw +z) is at ICRS RA 192.86°, Dec +27.13°.
    const n = t.toWorldDir(MW_FRAME, vec3(0, 0, 1), 0, vec3());
    expect((Math.atan2(n.y, n.x) * 180) / Math.PI + 360).toBeCloseTo(192.86, 1);
    expect((Math.asin(n.z) * 180) / Math.PI).toBeCloseTo(27.13, 1);
    // A rotation round trip through fromWorldDir.
    const v = vec3(0.3, -0.5, 0.8);
    const w = t.fromWorldDir(MW_FRAME, t.toWorldDir(MW_FRAME, v, 0, vec3()), 0, vec3());
    expect(v3len(v3sub(vec3(), v, w))).toBeLessThan(1e-12);
    expect(v3len(qrotate(vec3(), quat(), v))).toBeCloseTo(v3len(v), 12);
  });
});
