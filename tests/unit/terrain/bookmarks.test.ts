import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FrameTreeImpl, addStandardFrames } from '../../../src/core/frames';
import { qrotate, v3dot, v3len, v3normalize, v3sub, vec3 } from '../../../src/core/math64';
import { SUNVIEW_BODIES } from '../../../src/modules/solar-system/bookmarks';
import type { BodiesFile } from '../../../src/modules/solar-system/data';
import { SolarEphemeris } from '../../../src/modules/solar-system/ephemeris';
import { bodyFromRow, buildFrameDefs } from '../../../src/modules/solar-system/frames';
import {
  APOLLO11_JD,
  MOON_ORBIT_ALT,
  SURFACE_FOV,
  terrainBookmarks,
  unitFromLatLon,
} from '../../../src/modules/terrain/bookmarks';
import { MAX_LEVEL } from '../../../src/modules/terrain/cube';
import { defaultHeightSpec } from '../../../src/modules/terrain/defaults';
import { groundRadius } from '../../../src/modules/terrain/ground';
import {
  createFbmCraters,
  type FbmCratersParams,
} from '../../../src/modules/terrain/height/fbm-craters-lite';

const rows = (JSON.parse(readFileSync('public/data/solar-system/bodies.json', 'utf8')) as BodiesFile).bodies;
const byId = new Map(rows.map((r) => [r.id, r]));
const eph = new SolarEphemeris(rows);
const frames = new FrameTreeImpl();
addStandardFrames(frames);
for (const f of buildFrameDefs(eph, SUNVIEW_BODIES)) frames.addFrame(f);
const moon = bodyFromRow(byId.get('moon')!, eph, byId);
const fn = createFbmCraters(defaultHeightSpec(moon).params as FbmCratersParams);
const c = moon.radius * (1 - (moon.oblateness ?? 0));
const ground = (d: { x: number; y: number; z: number }) => groundRadius(fn, moon.radius, c, d, MAX_LEVEL);
const bms = terrainBookmarks(frames, moon, ground, true);
const bm = (id: string) => bms.find((b) => b.id === id)!;
const DEG = Math.PI / 180;

describe('terrain bookmarks', () => {
  it('apollo11-2m stands 2 m above the mesh at Tranquility Base in a low morning Sun', () => {
    const b = bm('apollo11-2m');
    expect(b.frame).toBe('moon.fixed');
    expect(b.mode).toBe('walk');
    const up = unitFromLatLon(0.674, 23.473);
    expect(v3dot(v3normalize(vec3(), b.pos), up)).toBeCloseTo(1, 12);
    expect(v3len(b.pos) - ground(up)).toBeCloseTo(2, 6);
    const sun = v3normalize(vec3(), frames.convertPoint('sun', vec3(), 'moon.fixed', APOLLO11_JD, vec3()));
    const sunEl = Math.asin(v3dot(sun, up)) / DEG;
    expect(sunEl).toBeGreaterThan(5);
    expect(sunEl).toBeLessThan(20);
    // Earth inside the frame: elevation below the top edge, and roughly in the view direction.
    const earth = v3normalize(
      vec3(),
      v3sub(vec3(), frames.convertPoint('earth', vec3(), 'moon.fixed', APOLLO11_JD, vec3()), b.pos),
    );
    const fwd = qrotate(vec3(), b.quat!, vec3(0, 0, -1));
    const pitch = Math.asin(v3dot(fwd, up));
    const earthEl = Math.asin(v3dot(earth, up));
    expect(earthEl).toBeLessThan(pitch + SURFACE_FOV / 2);
    expect(Math.acos(v3dot(earth, fwd))).toBeLessThan(SURFACE_FOV / 2);
    // The horizon is in the frame (below the centre) and the Sun is behind the camera.
    expect(pitch).toBeGreaterThan(0);
    expect(pitch).toBeLessThan(SURFACE_FOV / 2);
    expect(v3dot(sun, fwd)).toBeLessThan(0);
  });

  it('moon-low-orbit is 50 km up, Sun low, looking down past the terminator-side horizon', () => {
    const b = bm('moon-low-orbit');
    expect(b.frame).toBe('moon.sunview');
    expect(v3len(b.pos) - moon.radius).toBeCloseTo(MOON_ORBIT_ALT, 3);
    const up = v3normalize(vec3(), b.pos);
    const sunEl = Math.asin(up.x) / DEG; // +x points at the Sun in sunview axes
    expect(sunEl).toBeGreaterThan(5);
    expect(sunEl).toBeLessThan(25);
    const fwd = qrotate(vec3(), b.quat!, vec3(0, 0, -1));
    expect(fwd.x).toBeLessThan(0); // towards the terminator
    const dip = Math.acos(moon.radius / v3len(b.pos));
    const pitch = Math.asin(v3dot(fwd, up));
    expect(pitch).toBeLessThan(-dip + 30 * DEG); // horizon below the top edge
    expect(pitch).toBeGreaterThan(-dip - 30 * DEG); // and above the bottom edge
  });

  it('jitter pair differs by exactly 1 mm', () => {
    const a = bm('terrain-jitter-a');
    const b = bm('terrain-jitter-b');
    expect(v3len(v3sub(vec3(), a.pos, b.pos))).toBeCloseTo(1e-3, 9);
    expect(a.rate).toBe(0);
    expect(terrainBookmarks(frames, moon, ground, false).map((x) => x.id)).toEqual([
      'moon-low-orbit',
      'apollo11-2m',
    ]);
  });
});
