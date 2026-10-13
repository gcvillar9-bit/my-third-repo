import { readFileSync } from 'node:fs';
import * as Astronomy from 'astronomy-engine';
import { describe, expect, it } from 'vitest';
import type { Body, Vec3d } from '../../../src/core/contracts';
import { FrameTreeImpl, addStandardFrames } from '../../../src/core/frames';
import { qrotate, v3dot, v3len, v3normalize, v3sub, vec3 } from '../../../src/core/math64';
import { parseInstant } from '../../../src/core/time';
import { R_SUN } from '../../../src/core/units';
import {
  IO_SHADOW_UTC,
  SATURN_BACKLIT_UTC,
  buildGiantBookmarks,
  ioShadowPoint,
} from '../../../src/modules/giants/bookmarks';
import { FLOW_CYCLE_S, GIANTS, findRedSpot, flowState, jetSpeed } from '../../../src/modules/giants/model';
import { TRANSIT_CASTERS, createTransitOccluders } from '../../../src/modules/giants/occluders';
import { GIANT_PRIORITY, createGiantShading, meanLuminance } from '../../../src/modules/giants/shading';
import { SUNVIEW_BODIES } from '../../../src/modules/solar-system/bookmarks';
import type { BodiesFile } from '../../../src/modules/solar-system/data';
import { SolarEphemeris } from '../../../src/modules/solar-system/ephemeris';
import { buildFrameDefs } from '../../../src/modules/solar-system/frames';

const rows = (JSON.parse(readFileSync('public/data/solar-system/bodies.json', 'utf8')) as BodiesFile).bodies;
const byId = new Map(rows.map((r) => [r.id, r]));
const eph = new SolarEphemeris(rows);
const frames = new FrameTreeImpl();
addStandardFrames(frames);
for (const f of buildFrameDefs(eph, SUNVIEW_BODIES)) frames.addFrame(f);
const radius = (id: string) => byId.get(id)!.radius * 1e3;
const bookmarks = buildGiantBookmarks(frames, radius);
const bm = (id: string) => bookmarks.find((b) => b.id === id)!;
const KM_PER_AU = 149_597_870.7;
const DEG = Math.PI / 180;
const unit = (v: Vec3d) => v3normalize(vec3(), v);

describe('jupiter-io-shadow bookmark', () => {
  it('is at a time when Io is between the Sun and Jupiter with its shadow on the disk (astronomy-engine)', () => {
    const t = Astronomy.MakeTime(new Date(IO_SHADOW_UTC));
    const h = Astronomy.HelioVector(Astronomy.Body.Jupiter, t);
    const s = unit(vec3(-h.x, -h.y, -h.z)); // Jupiter -> Sun
    const io = Astronomy.JupiterMoons(t).io;
    const p = vec3(io.x * KM_PER_AU, io.y * KM_PER_AU, io.z * KM_PER_AU); // km from Jupiter
    const along = v3dot(p, s);
    expect(along).toBeGreaterThan(0); // Io on the Sun side of Jupiter
    const perp = v3len(v3sub(vec3(), p, vec3(along * s.x, along * s.y, along * s.z)));
    expect(perp).toBeLessThan(0.3 * 71_492); // shadow well inside the disk
  });

  it('aims the camera at a fully shadowed (umbral) point of the lit hemisphere', () => {
    const b = bm('jupiter-io-shadow');
    expect(b.frame).toBe('jupiter');
    const jd = b.jd as number;
    expect(jd).toBeCloseTo(parseInstant(IO_SHADOW_UTC)!, 9);
    const rJ = radius('jupiter');
    const shadow = ioShadowPoint(frames, jd, rJ)!;
    expect(v3len(shadow)).toBeCloseTo(rJ, 0);
    const toSun = frames.relative('jupiter', 'sun', jd, vec3());
    expect(v3dot(unit(shadow), unit(toSun))).toBeGreaterThan(0.9); // near the sub-solar point
    // From the shadow point Io covers the whole solar disk (umbra).
    const io = frames.relative('jupiter', 'io', jd, vec3());
    const toIo = v3sub(vec3(), io, shadow);
    const toS = v3sub(vec3(), toSun, shadow);
    const ioAng = Math.asin(radius('io') / v3len(toIo));
    const sunAng = Math.asin(R_SUN / v3len(toS));
    const sep = Math.acos(Math.min(1, v3dot(unit(toIo), unit(toS))));
    expect(sep + sunAng).toBeLessThan(ioAng);
    // The camera's forward axis (-Z) points at the shadow centre.
    const fwd = qrotate(vec3(), b.quat!, vec3(0, 0, -1));
    const want = unit(v3sub(vec3(), shadow, b.pos));
    expect(v3dot(fwd, want)).toBeGreaterThan(0.999999);
  });
});

describe('saturn-backlit-2013-07-19 bookmark', () => {
  it("puts the camera inside Saturn's umbra on the unlit side of the rings", () => {
    const b = bm('saturn-backlit-2013-07-19');
    const jd = b.jd as number;
    expect(jd).toBeCloseTo(parseInstant(SATURN_BACKLIT_UTC)!, 9);
    const toSun = frames.relative('saturn', 'sun', jd, vec3());
    const camToSun = v3sub(vec3(), toSun, b.pos);
    const camToSat = v3scaleNeg(b.pos);
    const satAng = Math.asin(radius('saturn') / v3len(camToSat));
    const sunAng = Math.asin(R_SUN / v3len(camToSun));
    const sep = Math.acos(Math.min(1, v3dot(unit(camToSat), unit(camToSun))));
    expect(sep + sunAng).toBeLessThan(satAng); // Sun fully hidden behind Saturn
    const pole = frames.toWorldDir('saturn.fixed', vec3(0, 0, 1), jd, vec3());
    const sunLat = Math.asin(v3dot(unit(toSun), pole)) / DEG;
    expect(sunLat).toBeGreaterThan(10); // 2013: northern summer, rings open ~17 deg
    expect(sunLat).toBeLessThan(25);
    expect(v3dot(b.pos, pole) * v3dot(toSun, pole)).toBeLessThan(0); // camera below the lit face
  });

  it('aims uranus-rings at the ring ansa with the bright globe just off-screen', () => {
    const b = bm('uranus-rings');
    const fwd = qrotate(vec3(), b.quat!, vec3(0, 0, -1));
    const toPlanet = unit(v3scaleNeg(b.pos));
    const off = Math.acos(v3dot(fwd, toPlanet));
    const halfH = Math.atan(Math.tan(b.fovY! / 2) * (480 / 270));
    const limb = Math.asin(radius('uranus') / v3len(b.pos));
    expect(off - limb).toBeGreaterThan(halfH); // globe outside a 16:9 view
    const eps = Math.atan(51_149e3 / v3len(b.pos));
    expect(eps - off).toBeLessThan(halfH); // epsilon ansa inside it
  });
});

function v3scaleNeg(v: Vec3d): Vec3d {
  return vec3(-v.x, -v.y, -v.z);
}

describe('gas-giant shading', () => {
  const jupiter = GIANTS.find((g) => g.id === 'jupiter')!;

  it('has the fastest prograde jet at 23.7 N on Jupiter and a retrograde equator on Neptune', () => {
    let best = -Infinity;
    let at = 0;
    for (let lat = -80; lat <= 80; lat += 0.1) {
      const u = jetSpeed(jupiter, lat * DEG);
      if (u > best) [best, at] = [u, lat];
    }
    expect(at).toBeCloseTo(23.7, 0);
    expect(best).toBeGreaterThan(130);
    expect(
      jetSpeed(
        GIANTS.find((g) => g.id === 'neptune')!,
        0,
      ),
    ).toBeLessThan(-300);
  });

  it('crossfades the two flow phases so each wraps while invisible', () => {
    const j0 = 2461000.5;
    const at = (frac: number) => flowState(cycleJd(j0, frac), 0);
    const cycleJd = (base: number, frac: number) => {
      const t = (base - 2451545) * 86400;
      const start = Math.floor(t / FLOW_CYCLE_S) * FLOW_CYCLE_S;
      return 2451545 + (start + frac * FLOW_CYCLE_S) / 86400;
    };
    expect(at(0.001).wB).toBeGreaterThan(0.99); // A wraps at p = 0 under full weight of B
    expect(at(0.5).wB).toBeLessThan(0.01); // B wraps at p = 0.5 under full weight of A
    expect(at(0.25).tA).toBeCloseTo(0.25 * FLOW_CYCLE_S, 0);
    expect(at(0.25).tB).toBeCloseTo(0.75 * FLOW_CYCLE_S, 0);
    expect(flowState(j0, 1).amp).toBe(1);
    expect(flowState(j0, FLOW_CYCLE_S).amp).toBe(0); // high warp freezes the flow
  });

  it('finds a red spot near 22 S in a synthetic map', () => {
    const w = 256;
    const h = 128;
    const px = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = 4 * (y * w + x);
        const band = (Math.floor(y / 6) % 2) * 30;
        px.set([180 + band, 170 + band, 150 + band, 255], i);
        const lat = 90 - ((y + 0.5) / h) * 180;
        const dx = (x - 77) / 4;
        const dy = (lat + 22) / 3;
        if (dx * dx + dy * dy < 1) px.set([200, 110, 80, 255], i);
      }
    const spot = findRedSpot(px, w, h, -22, 7)!;
    expect(spot.u).toBeCloseTo(77.5 / w, 2);
    expect(spot.latDeg).toBeCloseTo(-22, 0);
    expect(findRedSpot(new Uint8ClampedArray(w * h * 4).fill(128), w, h, -22, 7)).toBeNull();
    expect(meanLuminance(new Uint8ClampedArray(16).fill(255), 2, 2)).toBeCloseTo(1, 6);
  });

  it('overrides the four giants at priority 10 with the ring shadow on Saturn and Uranus only', () => {
    const deps = {
      assets: {} as never,
      quality: { knobs: { maxTextureSize: 2048 } } as never,
    };
    for (const spec of GIANTS) {
      const body = { id: spec.id, frame: spec.id, radius: radius(spec.id) } as Body;
      const s = createGiantShading(spec, body, byId.get(spec.id)!, deps);
      expect(s.priority).toBe(GIANT_PRIORITY);
      expect(s.glsl).toContain('vec3 shadeSurface(SurfaceInput s)');
      const ringed = spec.id === 'saturn' || spec.id === 'uranus';
      expect(!!s.defines?.RING_SHADOW).toBe(ringed);
      expect('uRingShadowProfile' in s.uniforms).toBe(ringed);
    }
  });

  it('names the Galilean moons and Titan as transit casters', () => {
    const reg = { body: (id: string) => ({ id, radius: radius(id) }) } as never;
    const p = createTransitOccluders(reg);
    expect(p.receivers).toEqual(['jupiter', 'saturn']);
    const ids = p.occluders({} as never).map((o) => o.bodyId);
    expect(ids).toEqual([...TRANSIT_CASTERS.jupiter, ...TRANSIT_CASTERS.saturn]);
    expect(p.occluders({} as never)[0].radius).toBeCloseTo(radius('io'), 0);
  });
});
