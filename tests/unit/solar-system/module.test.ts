import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FrameTreeImpl, addStandardFrames } from '../../../src/core/frames';
import { qrotate, v3dot, v3len, v3normalize, vec3 } from '../../../src/core/math64';
import { magFromIlluminance } from '../../../src/core/photometry';
import { parseInstant } from '../../../src/core/time';
import { buildBookmarks, SUNVIEW_BODIES } from '../../../src/modules/solar-system/bookmarks';
import type { BodiesFile } from '../../../src/modules/solar-system/data';
import { SolarEphemeris } from '../../../src/modules/solar-system/ephemeris';
import { bodyFacts, infoCard, searchEntries } from '../../../src/modules/solar-system/facts';
import { bodyFromRow, buildFrameDefs } from '../../../src/modules/solar-system/frames';
import { occluderCandidates } from '../../../src/modules/solar-system/index';
import { pointIlluminance } from '../../../src/modules/solar-system/render/points';
import { SceneState, sphereWeight } from '../../../src/modules/solar-system/render/scene-state';
import { equirectStats } from '../../../src/modules/solar-system/render/shading';
import { cubeSphereArrays } from '../../../src/modules/solar-system/render/sphere';
import { orbitOpacity } from '../../../src/modules/solar-system/render/orbits';

const rows = (JSON.parse(readFileSync('public/data/solar-system/bodies.json', 'utf8')) as BodiesFile).bodies;
const byId = new Map(rows.map((r) => [r.id, r]));
const eph = new SolarEphemeris(rows);
const frames = new FrameTreeImpl();
addStandardFrames(frames);
for (const f of buildFrameDefs(eph, SUNVIEW_BODIES)) frames.addFrame(f);
const JD = parseInstant('2026-01-01T00:00:00Z')!;
const fact = (id: string, label: string) =>
  bodyFacts(byId.get(id)!, eph, JD).find((f) => f.label.startsWith(label));

describe('solar-system facts and search', () => {
  it('computes Earth facts from data', () => {
    expect(Number(fact('earth', 'Surface gravity')!.value)).toBeCloseTo(9.82, 1);
    expect(Number(fact('earth', 'Day length')!.value)).toBeCloseTo(23.93, 1);
    expect(Number(fact('earth', 'Year length')!.value)).toBeCloseTo(365.26, 0);
    expect(Number(fact('earth', 'Distance from the Sun')!.value)).toBeCloseTo(0.9833, 3);
    expect(Number(fact('earth', 'Light-time from the Sun')!.value)).toBeCloseTo(8.18, 1);
    expect(Number(fact('earth', 'Escape velocity')!.value)).toBeCloseTo(11.2, 1);
  });

  it('gives every body an info card and a search entry', () => {
    for (const row of rows) {
      const card = infoCard(row, eph, byId, JD);
      expect(card.title).toBe(row.name);
      expect(card.facts.length).toBeGreaterThan(4);
      for (const f of card.facts)
        expect(typeof f.value === 'string' || Number.isFinite(f.value), `${row.id} ${f.label}`).toBe(true);
    }
    const entries = searchEntries(rows);
    expect(entries).toHaveLength(rows.length);
    expect(entries.find((e) => e.id === 'titan')!.subtitle).toBe('Moon of Saturn');
    expect(Number(fact('titan', 'Orbital period')!.value)).toBeCloseTo(15.95, 1);
    expect(fact('venus', 'Day length')!.label).toContain('retrograde');
  });
});

describe('solar-system bodies, frames and bookmarks', () => {
  it('registers a body per row with sane influence radii', () => {
    for (const row of rows) {
      const b = bodyFromRow(row, eph, byId);
      expect(b.influenceRadius, row.id).toBeGreaterThan(b.radius);
      expect(frames.has(b.frame) && frames.has(b.fixedFrame!)).toBe(true);
    }
    const moon = bodyFromRow(byId.get('moon')!, eph, byId);
    expect(moon.influenceRadius).toBeLessThan(1e8); // well inside the Earth-Moon distance
  });

  it('builds bookmarks in existing frames with the required ids', () => {
    const bms = buildBookmarks(eph, JD);
    const ids = new Set(bms.map((b) => b.id));
    for (const id of [
      'earth-now',
      'saturn',
      'jupiter-moons',
      'titan',
      'solar-system-overview',
      'mars',
      'moon',
    ])
      expect(ids.has(id), id).toBe(true);
    expect(ids.size).toBe(bms.length);
    for (const b of bms) {
      expect(frames.has(b.frame), b.id).toBe(true);
      expect(b.ev).toBeGreaterThan(-5);
      expect(b.lookAt && byId.has(b.lookAt)).toBe(true);
    }
  });

  it("puts 'earth-now' over the dawn terminator, looking at Earth with the Sun to screen-right", () => {
    const bm = buildBookmarks(eph, JD).find((b) => b.id === 'earth-now')!;
    expect(bm.pos.y).toBeLessThan(0); // Earth turns towards +y: dawn is at -y
    expect(Math.abs(bm.pos.x)).toBeLessThan(0.3 * v3len(bm.pos));
    const fwd = qrotate(vec3(), bm.quat!, vec3(0, 0, -1));
    const toEarth = v3normalize(vec3(), vec3(-bm.pos.x, -bm.pos.y, -bm.pos.z));
    expect(v3dot(fwd, toEarth)).toBeGreaterThan(0.9999);
    const right = qrotate(vec3(), bm.quat!, vec3(1, 0, 0));
    expect(right.x).toBeGreaterThan(0.8); // +x of the sun-view frame is the Sun
    // In world axes, sun-view +x really points at the Sun.
    const x = frames.toWorldDir('earth.sunview', vec3(1, 0, 0), JD, vec3());
    const sun = v3normalize(vec3(), frames.relative('earth', 'sun', JD, vec3()));
    expect(v3dot(x, sun)).toBeGreaterThan(0.999999);
  });

  it('lists eclipse occluders for Earth, the Moon and Jupiter', () => {
    const occ = occluderCandidates(rows);
    expect(occ.get('earth')).toContain('moon');
    expect(occ.get('moon')).toContain('earth');
    expect(occ.get('jupiter')).toEqual(expect.arrayContaining(['io', 'europa', 'ganymede', 'callisto']));
    expect(occ.get('io')).toEqual(expect.arrayContaining(['jupiter', 'europa']));
    expect(occ.get('sun')).toEqual([]);
  });
});

describe('solar-system photometry and geometry', () => {
  const sceneFromEarth = () => {
    const bodies = rows.map((r) => bodyFromRow(r, eph, byId));
    const scene = new SceneState(bodies);
    const pixelAngle = Math.PI / 3 / 270;
    const view = {
      frameIndex: 0,
      pixelAngle,
      sunToCamera: (out: { x: number; y: number; z: number }) =>
        frames.relative('earth', 'sun', JD, out as never),
      toCamera: (frame: string, _l: unknown, out: { x: number; y: number; z: number }) =>
        frames.relative('earth', frame, JD, out as never),
    };
    scene.update(view as never);
    return scene;
  };

  it('gives planet points the right apparent magnitude from Earth (Jan 2026)', () => {
    const scene = sceneFromEarth();
    const mag = (id: string) => magFromIlluminance(pointIlluminance(scene.get(id)!));
    expect(mag('jupiter')).toBeGreaterThan(-3.2);
    expect(mag('jupiter')).toBeLessThan(-2.3);
    expect(mag('saturn')).toBeGreaterThan(0.3); // globe only; rings nearly edge-on in 2026
    expect(mag('saturn')).toBeLessThan(1.5);
    expect(mag('sun')).toBeCloseTo(-26.74 + 5 * Math.log10(0.9833), 2);
    expect(scene.get('moon')!.pxDiam).toBeGreaterThan(1.5); // the Moon is resolved at 270 px / 60 deg
  });

  it('crossfades points and spheres smoothly between 1.5 and 3 px', () => {
    expect(sphereWeight(1)).toBe(0);
    expect(sphereWeight(1.5)).toBe(0);
    expect(sphereWeight(2.25)).toBeCloseTo(0.5, 6);
    expect(sphereWeight(3)).toBe(1);
    expect(orbitOpacity(1e9, 1e12, 0.004)).toBe(0);
    expect(orbitOpacity(1e12, 1e12, 0.004)).toBe(1);
  });

  it('builds a closed, outward-facing unit cube-sphere', () => {
    const { pos, index } = cubeSphereArrays(8);
    for (let i = 0; i < pos.length; i += 3)
      expect(Math.hypot(pos[i], pos[i + 1], pos[i + 2])).toBeCloseTo(1, 5);
    for (let t = 0; t < index.length; t += 3) {
      const [a, b, c] = [index[t], index[t + 1], index[t + 2]].map((k) =>
        vec3(pos[3 * k], pos[3 * k + 1], pos[3 * k + 2]),
      );
      const n = vec3(
        (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y),
        (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z),
        (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x),
      );
      expect(v3dot(n, a)).toBeGreaterThan(0);
    }
    expect(index.length).toBe(6 * 8 * 8 * 6);
  });

  it('normalises albedo maps by their area-weighted linear mean', () => {
    const w = 4;
    const h = 2;
    const px = new Uint8ClampedArray(w * h * 4).fill(255);
    const st = equirectStats(px, w, h);
    expect(st.mean).toBeCloseTo(1, 6);
    expect(st.tint[0]).toBeCloseTo(1, 6);
    for (let i = 0; i < px.length; i += 4) [px[i], px[i + 1], px[i + 2]] = [188, 188, 188]; // sRGB 188 ~ linear 0.5
    expect(equirectStats(px, w, h).mean).toBeCloseTo(0.503, 2);
  });
});
