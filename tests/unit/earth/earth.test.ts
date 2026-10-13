import { Matrix3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { qfromAxisAngle, qrotate, quat, v3dot, v3len, v3normalize, vec3 } from '../../../src/core/math64';
import { buildEarthBookmarks, horizonDipDeg } from '../../../src/modules/earth/bookmarks';
import { cubeSphere, sphereWeight } from '../../../src/modules/earth/clouds';
import { EARTH_PRELUDE, setWorldToBody } from '../../../src/modules/earth/shading';
import { EARTH_MAPS, earthMapPath } from '../../../src/modules/earth/textures';
import { waterNormalPixels, waterWaves, waveSlopeAt } from '../../../src/modules/earth/waves';
import shadingGlsl from '../../../src/modules/earth/glsl/shading-earth.glsl?raw';
import cloudFrag from '../../../src/modules/earth/glsl/cloud.frag.glsl?raw';

const R = 6378137;
const DEG = Math.PI / 180;

describe('procedural water normals', () => {
  it('uses integer wavevectors, so the slope field is exactly periodic', () => {
    const waves = waterWaves(1);
    expect(waves.length).toBe(24);
    for (const w of waves) {
      expect(Number.isInteger(w.kx) && Number.isInteger(w.ky)).toBe(true);
    }
    for (const [x, y] of [
      [0, 0],
      [17.3, 101.9],
      [255.5, 3],
    ]) {
      const a = waveSlopeAt(waves, x, y, 256);
      const b = waveSlopeAt(waves, x + 256, y - 512, 256);
      expect(b[0]).toBeCloseTo(a[0], 9);
      expect(b[1]).toBeCloseTo(a[1], 9);
    }
  });

  it('encodes unit normals that wrap without a seam', () => {
    const n = 256;
    const px = waterNormalPixels(n, 1);
    const dec = (i: number) => [px[4 * i] / 127.5 - 1, px[4 * i + 1] / 127.5 - 1, px[4 * i + 2] / 127.5 - 1];
    let maxInterior = 0;
    let maxWrap = 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const v = dec(y * n + x);
        expect(Math.abs(Math.hypot(v[0], v[1], v[2]) - 1)).toBeLessThan(0.02);
        expect(v[2]).toBeGreaterThan(0.3);
        const r = dec(y * n + ((x + 1) % n));
        const d = Math.hypot(v[0] - r[0], v[1] - r[1]);
        if (x === n - 1) maxWrap = Math.max(maxWrap, d);
        else maxInterior = Math.max(maxInterior, d);
      }
    }
    expect(maxWrap).toBeLessThanOrEqual(maxInterior + 2 / 127.5);
  });
});

describe('earth bookmarks', () => {
  const bms = buildEarthBookmarks(R, 2461041.5);
  const byId = new Map(bms.map((b) => [b.id, b]));

  it('defines the three views', () => {
    expect([...byId.keys()].sort()).toEqual(['earth-dawn-400km', 'earth-limb-400km', 'earth-night-lights']);
    for (const b of bms) {
      expect(b.ev).toBeTypeOf('number');
      expect(b.lookTarget!.length).toBeGreaterThan(20);
    }
  });

  it('puts the orbit views at 400 km with the limb above the screen centre', () => {
    for (const id of ['earth-dawn-400km', 'earth-limb-400km']) {
      const b = byId.get(id)!;
      expect(b.frame).toBe('earth.sunview');
      expect(v3len(b.pos) - R).toBeCloseTo(400e3, 3);
      const up = v3normalize(vec3(), b.pos);
      const fwd = qrotate(vec3(), b.quat!, vec3(0, 0, -1));
      const below = -Math.asin(v3dot(fwd, up)) / DEG; // pitch below the horizontal
      const dip = horizonDipDeg(R, 400e3);
      expect(below - dip).toBeGreaterThan(5); // limb 5-20 deg above centre (upper part of a 60 deg view)
      expect(below - dip).toBeLessThan(20);
      expect(Math.abs(qrotate(vec3(), b.quat!, vec3(1, 0, 0)).z)).toBeLessThan(0.5); // no strong roll
    }
  });

  it('places the dawn view just inside the night side with the Sun to screen-right', () => {
    const b = byId.get('earth-dawn-400km')!;
    const up = v3normalize(vec3(), b.pos);
    const sunEl = Math.asin(up.x) / DEG; // +x is the Sun in sun-view axes
    expect(sunEl).toBeGreaterThan(-3);
    expect(sunEl).toBeLessThan(0);
    const right = qrotate(vec3(), b.quat!, vec3(1, 0, 0));
    expect(right.x).toBeGreaterThan(0.5);
  });

  it('looks straight down on Europe at night from 2000 km', () => {
    const b = byId.get('earth-night-lights')!;
    expect(b.frame).toBe('earth.fixed');
    expect(b.jd).toBe(2461041.5);
    const up = v3normalize(vec3(), b.pos);
    expect(Math.asin(up.z) / DEG).toBeCloseTo(50, 6);
    expect(Math.atan2(up.y, up.x) / DEG).toBeCloseTo(10, 6);
    const fwd = qrotate(vec3(), b.quat!, vec3(0, 0, -1));
    expect(v3dot(fwd, up)).toBeCloseTo(-1, 9);
  });
});

describe('earth shading and clouds', () => {
  const reserved = [
    'uExposure',
    'uFade',
    'uPixelAngle',
    'uRadii',
    'uBodyToWorld',
    'uSunPos',
    'uSunIlluminance',
  ];

  it('defines shadeSurface and declares no provider-reserved uniforms', () => {
    const glsl = EARTH_PRELUDE + shadingGlsl;
    expect(glsl).toMatch(/vec3 shadeSurface\(SurfaceInput s\)/);
    for (const name of reserved) expect(glsl).not.toMatch(new RegExp(`uniform\\s+\\w+\\s+${name}\\s*;`));
    expect(glsl).toContain('atmoSunTransmittance');
    expect(cloudFrag).toContain('LOG_DEPTH_FRAGMENT');
  });

  it('reuses the solar-system Earth maps at the preset tier', () => {
    expect(EARTH_MAPS.map((m) => earthMapPath(m, 2048))).toEqual([
      'textures/solar-system/earth_day_2k.webp',
      'textures/solar-system/earth_night_2k.webp',
      'textures/solar-system/earth_brc_2k.webp',
      'textures/solar-system/earth_spec_2k.webp',
    ]);
    expect(earthMapPath(EARTH_MAPS[0], 4096)).toBe('textures/solar-system/earth_day_4k.webp');
    expect(earthMapPath(EARTH_MAPS[3], 8192)).toBe('textures/solar-system/earth_spec_2k.webp');
  });

  it('builds a unit cube-sphere and fades it like the planet sphere', () => {
    const { pos, index } = cubeSphere(8);
    expect(pos.length / 3).toBe(6 * 81);
    expect(index.length).toBe(6 * 64 * 6);
    for (let i = 0; i < pos.length; i += 3)
      expect(Math.hypot(pos[i], pos[i + 1], pos[i + 2])).toBeCloseTo(1, 6);
    expect(sphereWeight(1.5)).toBe(0);
    expect(sphereWeight(3)).toBe(1);
    expect(sphereWeight(2.25)).toBeCloseTo(0.5, 9);
  });

  it('world-to-body matrix inverts the body-fixed orientation', () => {
    const q = qfromAxisAngle(quat(), v3normalize(vec3(), vec3(0.3, -0.5, 0.8)), 1.1);
    const v = vec3(0.2, 0.7, -0.4);
    const w = qrotate(vec3(), q, v);
    const back = new Vector3(w.x, w.y, w.z).applyMatrix3(setWorldToBody(new Matrix3(), q));
    expect(back.x).toBeCloseTo(v.x, 9);
    expect(back.y).toBeCloseTo(v.y, 9);
    expect(back.z).toBeCloseTo(v.z, 9);
  });
});
