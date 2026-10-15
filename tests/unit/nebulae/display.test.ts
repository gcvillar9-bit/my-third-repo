import { describe, expect, it } from 'vitest';
import { luminance } from '../../../src/core/photometry';
import { qlookRotation, quat, vec3 } from '../../../src/core/math64';
import {
  ASTRO,
  ASTRO_BASIS,
  astrophotoTransform,
  linesRgb,
  REALISTIC_BASIS,
  styleRgb,
} from '../../../src/modules/nebulae/display';
import { Q_LOCAL_TO_ICRS, localAxesIcrs, toLocal, toWorld } from '../../../src/modules/nebulae/frame';
import { D_PC } from '../../../src/modules/nebulae/model';
import { apparentPx, MIN_PX, RES_DIVISOR, screenRect, STEPS } from '../../../src/modules/nebulae/render';
import { AUTO_OFF_PC, StyleAuto } from '../../../src/modules/nebulae/style';
import type { NebulaStyle } from '../../../src/modules/nebulae/display';

const XI = Math.tan((0.9 * Math.PI) / 180);
const chroma = (c: number[]) => Math.max(...c) - Math.min(...c);

describe('nebula display styles', () => {
  it('gives each realistic component unit luminance and its true hue', () => {
    for (const b of REALISTIC_BASIS) expect(luminance(b[0], b[1], b[2])).toBeCloseTo(1, 6);
    const [ha, oiii, sc] = REALISTIC_BASIS;
    expect(ha[0]).toBeGreaterThan(5 * ha[1]); // Hα 656 nm: deep red
    expect(oiii[1]).toBeGreaterThan(oiii[0]); // [OIII] 501 nm: green-teal
    expect(oiii[2]).toBeGreaterThan(oiii[0]);
    expect(sc[2]).toBeGreaterThan(sc[0]); // hot scattered starlight: blue-white
    for (const c of [...ha, ...oiii, ...sc]) expect(c).toBeGreaterThanOrEqual(0);
    // Out-of-gamut lines are brought in by adding white, which keeps the luminance.
    const pure = linesRgb([[520, 1]]);
    expect(Math.min(...pure)).toBeGreaterThanOrEqual(0);
    expect(luminance(pure[0], pure[1], pure[2])).toBeCloseTo(1, 6);
  });

  it('keeps the luminance in Realistic and only recolours in Astrophoto', () => {
    const L: [number, number, number] = [0.01, 0.004, 0.002];
    const r = styleRgb('realistic', L);
    expect(luminance(r[0], r[1], r[2])).toBeCloseTo(0.016, 9);
    const a = styleRgb('astrophoto', L);
    expect(luminance(a[0], a[1], a[2])).toBeCloseTo(0.016, 9);
    for (const b of ASTRO_BASIS) expect(luminance(b[0], b[1], b[2])).toBeCloseTo(1, 6);
    const [ha, oiii] = ASTRO_BASIS;
    expect(ha[0]).toBeGreaterThan(ha[1]); // magenta-red
    expect(ha[2]).toBeGreaterThan(ha[1]);
    expect(oiii[1] + oiii[2]).toBeGreaterThan(4 * oiii[0]); // teal
  });

  it('stretches faint light with asinh and boosts saturation ×1.6', () => {
    const grey = (y: number): [number, number, number] => [y, y, y];
    // Reference level maps to itself, faint light is lifted a lot, the curve stays monotonic.
    expect(luminance(...astrophotoTransform(grey(1)))).toBeCloseTo(1, 6);
    const faint = luminance(...astrophotoTransform(grey(0.01)));
    expect(faint / 0.01).toBeGreaterThan(5);
    let prev = 0;
    for (let y = 1e-4; y < 10; y *= 1.5) {
      const v = luminance(...astrophotoTransform(grey(y)));
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
    const c: [number, number, number] = [0.3, 0.2, 0.25];
    const out = astrophotoTransform(c);
    const k = luminance(...out) / luminance(...c);
    expect(chroma(out)).toBeCloseTo(ASTRO.saturation * chroma(c) * k, 6);
    expect(astrophotoTransform([0, 0, 0])).toEqual([0, 0, 0]);
  });
});

describe('nebula frame and screen footprint', () => {
  it('uses east, north and the line of sight as right-handed local axes', () => {
    const { e, n, l } = localAxesIcrs();
    const cross = vec3(e.y * n.z - e.z * n.y, e.z * n.x - e.x * n.z, e.x * n.y - e.y * n.x);
    expect(cross.x).toBeCloseTo(l.x, 12);
    expect(cross.y).toBeCloseTo(l.y, 12);
    expect(cross.z).toBeCloseTo(l.z, 12);
    const w = toWorld(vec3(0, 0, 1), vec3());
    expect(w.x).toBeCloseTo(l.x, 12);
    const back = toLocal(toWorld(vec3(0.3, -0.2, 0.9), vec3()), vec3());
    expect(back.x).toBeCloseTo(0.3, 12);
    expect(Q_LOCAL_TO_ICRS.w * Q_LOCAL_TO_ICRS.w + Q_LOCAL_TO_ICRS.x ** 2).toBeLessThanOrEqual(1);
  });

  it('marches only the screen rect and skips the nebula below 4 px', () => {
    // From Earth, looking at θ¹ Ori C through a 2.5° field: the 1.8° box covers most of the frame.
    const { l } = localAxesIcrs();
    const q = qlookRotation(quat(), l, vec3(0, 0, 1));
    const fov = (2.5 * Math.PI) / 180;
    const r = screenRect(vec3(0, 0, -D_PC), q, fov, 16 / 9, XI)!;
    expect(r.full).toBe(false);
    expect(r.y1 - r.y0).toBeGreaterThan(1.2);
    // Through a 40° field it is a small rect.
    const small = screenRect(vec3(0, 0, -D_PC), q, (40 * Math.PI) / 180, 16 / 9, XI)!;
    expect(small.x1 - small.x0).toBeLessThan(0.1);
    // Looking away: off screen.
    const away = qlookRotation(quat(), vec3(-l.x, -l.y, -l.z), vec3(0, 0, 1));
    expect(screenRect(vec3(0, 0, -D_PC), away, fov, 16 / 9, XI)).toBeNull();
    // Inside the box: the whole screen.
    expect(screenRect(vec3(0, 0, -0.2), q, fov, 16 / 9, XI)!.full).toBe(true);
    // Size: ~12 px from Earth on a 40° / 270 px view, below MIN_PX from 4 kpc.
    const pa = (40 * Math.PI) / 180 / 270;
    expect(apparentPx(vec3(0, 0, -D_PC), pa, XI)).toBeGreaterThan(MIN_PX);
    expect(apparentPx(vec3(0, 0, -4000), pa, XI)).toBeLessThan(MIN_PX);
  });

  it('uses the design step and resolution table', () => {
    expect(STEPS).toEqual({ potato: 24, low: 32, medium: 48, high: 96, ultra: 128 });
    expect(RES_DIVISOR).toEqual({ potato: 4, low: 3, medium: 3, high: 2, ultra: 1 });
    // Medium inside the nebula at 1280x720 stays under 8M fragment steps.
    expect((Math.ceil(1280 / 3) * Math.ceil(720 / 3) * STEPS.medium) / 1e6).toBeLessThan(8);
  });
});

describe('nebula style auto-on / auto-off', () => {
  const machine = () => {
    const writes: NebulaStyle[] = [];
    let value: NebulaStyle = 'realistic';
    const m: StyleAuto = new StyleAuto((v) => {
      writes.push(v);
      value = v;
      m.changed(); // the settings store notifies synchronously
    });
    return { m, writes, value: () => value };
  };

  it('switches Astrophoto on when arriving at its bookmark and off when leaving the nebula', () => {
    const { m, writes, value } = machine();
    m.start(null, false);
    expect(writes).toEqual([]);
    m.arrived(true, false);
    expect(value()).toBe('astrophoto');
    expect(m.autoOn).toBe(true);
    m.distance(AUTO_OFF_PC - 1);
    expect(value()).toBe('astrophoto');
    m.distance(AUTO_OFF_PC + 1);
    expect(value()).toBe('realistic');
    expect(m.autoOn).toBe(false);
  });

  it('goes back to Realistic on arrival at another bookmark, not when staying', () => {
    const { m, value } = machine();
    m.start(null, true);
    expect(value()).toBe('astrophoto');
    m.arrived(true, false); // still there: no change
    expect(value()).toBe('astrophoto');
    m.arrived(false, true);
    expect(value()).toBe('realistic');
  });

  it('never undoes a choice the user made', () => {
    const { m, value } = machine();
    m.start(null, true);
    m.changed(); // user changed the setting (not ours)
    expect(m.autoOn).toBe(false);
    m.distance(AUTO_OFF_PC * 10);
    m.arrived(false, true);
    expect(value()).toBe('astrophoto');
  });

  it('lets ?nebulae.style= win over the initial bookmark', () => {
    const { m, value } = machine();
    m.start('realistic', true);
    expect(value()).toBe('realistic');
    expect(m.autoOn).toBe(false);
    const b = machine();
    b.m.start('astrophoto', false);
    expect(b.value()).toBe('astrophoto');
    b.m.distance(1e6);
    expect(b.value()).toBe('astrophoto');
  });
});
