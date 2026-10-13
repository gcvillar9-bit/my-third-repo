import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  G_BACK,
  G_DUST,
  bakeProfile,
  decodePngStrip,
  hgPhase,
  mipChain,
  opticalDepth,
  profileAt,
  regionAt,
  ringIoF,
  ringPhase,
  ringSunTransmission,
  ringSystem,
} from '../../../src/modules/rings/model';
import { RING_BODIES, ringShadowUniforms } from '../../../src/modules/rings/public';
import { ringWeight } from '../../../src/modules/rings/render';

const saturn = ringSystem('saturn')!;
const uranus = ringSystem('uranus')!;
const DEG = Math.PI / 180;

async function saturnImage() {
  const buf = readFileSync('public/textures/solar-system/saturn_rings_profile.png');
  return decodePngStrip(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
}

describe('ring model radii', () => {
  it('puts the Cassini Division at 117,580-122,170 km between the B and A rings', () => {
    expect(regionAt(saturn, 117_579)?.name).toBe('B ring');
    expect(regionAt(saturn, 117_580)?.name).toBe('Cassini Division');
    expect(regionAt(saturn, 122_169)?.name).toBe('Cassini Division');
    expect(regionAt(saturn, 122_170)?.name).toBe('A ring');
    const div = opticalDepth(saturn, 119_900);
    expect(opticalDepth(saturn, 110_000)).toBeGreaterThan(10 * div);
    expect(opticalDepth(saturn, 126_000)).toBeGreaterThan(3 * div);
  });

  it('keeps the Cassini Division open in the baked profile with the Celestia strip', async () => {
    const img = await saturnImage();
    expect(img.width).toBe(4096);
    const prof = bakeProfile(saturn, undefined, img);
    const mean = (a: number, b: number) => {
      let s = 0;
      for (let r = a; r < b; r += 50) s += profileAt(saturn, prof, r, 1);
      return s / Math.ceil((b - a) / 50);
    };
    const cassini = mean(117_800, 121_900);
    expect(mean(100_000, 116_000)).toBeGreaterThan(4 * cassini);
    expect(mean(123_000, 133_000)).toBeGreaterThan(2 * cassini);
    expect(profileAt(saturn, prof, 133_589, 1)).toBeLessThan(0.05); // Encke Gap
  });

  it('spans the D ring (66,900 km) to the F ring (140,180 km)', () => {
    expect(saturn.inner).toBe(66_900);
    expect(regionAt(saturn, 66_901)?.name).toBe('D ring');
    expect(regionAt(saturn, 140_180)?.name).toBe('F ring');
    expect(saturn.outer).toBeGreaterThan(140_205);
    for (const id of RING_BODIES) expect(ringSystem(id)).toBeDefined();
  });

  it("makes Uranus's epsilon ring the brightest (largest equivalent width x albedo)", () => {
    const strength = uranus.regions.map((r) => ({
      name: r.name,
      s: (r.outer - r.inner) * (1 - Math.exp(-r.tau)) * r.albedo,
    }));
    strength.sort((a, b) => b.s - a.s);
    expect(strength[0].name).toBe('epsilon');
    expect(regionAt(uranus, 51_149)?.name).toBe('epsilon');
    // Narrow ringlets survive the bake and the mip chain by equivalent width.
    const prof = bakeProfile(uranus);
    const chain = mipChain(prof);
    expect(chain.length).toBe(13);
    const sum = (a: Float32Array) =>
      a.reduce((acc, v, i) => (i % 4 === 1 ? acc + v : acc), 0) / (a.length / 4);
    expect(sum(chain[6])).toBeCloseTo(sum(prof), 6);
    expect(sum(prof)).toBeGreaterThan(0);
  });
});

describe('ring photometry', () => {
  it('normalises the Henyey-Greenstein phase over the sphere', () => {
    for (const g of [-0.35, 0, 0.5, 0.7, 0.9]) {
      let s = 0;
      const n = 20000;
      for (let i = 0; i < n; i++) {
        const mu = -1 + (2 * (i + 0.5)) / n;
        s += 2 * Math.PI * hgPhase(mu, g) * (2 / n);
      }
      expect(s).toBeCloseTo(1, 3);
    }
    expect(hgPhase(1, G_DUST)).toBeGreaterThan(10 * hgPhase(-1, G_DUST));
    expect(hgPhase(-1, G_BACK)).toBeGreaterThan(hgPhase(1, G_BACK));
    expect(ringPhase(0.3, 0.4)).toBeCloseTo(0.6 * hgPhase(0.3, G_BACK) + 0.4 * hgPhase(0.3, G_DUST), 12);
  });

  it('makes dusty rings glow when backlit and the dense B ring backscatter on its lit face', () => {
    const mu0 = Math.sin(17 * DEG);
    const p4 = (cos: number, dust: number) => 4 * Math.PI * ringPhase(cos, dust);
    // Backlit (viewer on the unlit face, looking towards the Sun): forward scattering, cos = 0.99.
    const dustyBacklit = ringIoF(mu0, -mu0, 0.1, 0.6, p4(0.99, 1));
    const dustyFrontlit = ringIoF(mu0, mu0, 0.1, 0.6, p4(-0.99, 1));
    expect(dustyBacklit).toBeGreaterThan(5 * dustyFrontlit);
    // Lit B ring at low phase beats the same ring at high phase.
    expect(ringIoF(mu0, 0.5, 2, 0.95, p4(-0.95, 0))).toBeGreaterThan(ringIoF(mu0, 0.5, 2, 0.95, p4(0.5, 0)));
    // Thin-slab limit: I/F -> albedo P tau / (4 mu) on both faces.
    const thin = (0.5 * 1 * 1e-4) / (4 * 0.5);
    expect(ringIoF(0.3, 0.5, 1e-4, 0.5, 1) / thin).toBeCloseTo(1, 3);
    expect(ringIoF(0.3, -0.5, 1e-4, 0.5, 1) / thin).toBeCloseTo(1, 3);
  });
});

describe('ring shadow on the globe', () => {
  const R = 60_268e3;
  const centre = { x: 0, y: 0, z: 0 };
  const normal = { x: 0, y: 0, z: 1 };
  const sun = { x: Math.cos(17 * DEG), y: 0, z: Math.sin(17 * DEG) }; // Sun 17 deg north of the rings
  const opacity = (r: number) => 1 - Math.exp(-opticalDepth(saturn, r));
  const surface = (latDeg: number) => ({
    x: R * Math.cos(latDeg * DEG),
    y: 0,
    z: R * Math.sin(latDeg * DEG),
  });
  const hitRadius = (latDeg: number) => {
    const p = surface(latDeg);
    const t = -p.z / sun.z;
    return Math.hypot(p.x + t * sun.x, p.z + t * sun.z) / 1e3;
  };

  it('shadows a sunlit point below the ring plane under the B ring, not one above it', () => {
    const p = surface(-12);
    expect(p.x * sun.x + p.z * sun.z).toBeGreaterThan(0); // the point faces the Sun
    expect(regionAt(saturn, hitRadius(-12))?.name).toBe('B ring');
    expect(ringSunTransmission(p, sun, centre, normal, opacity)).toBeLessThan(0.01);
    expect(ringSunTransmission(surface(30), sun, centre, normal, opacity)).toBe(1);
    expect(ringSunTransmission(surface(-60), sun, centre, normal, opacity)).toBe(1); // ray passes outside the F ring
  });

  it('lets light through the Cassini Division (exp(-tau / mu0))', () => {
    let lat = -12;
    while (hitRadius(lat) < 119_800) lat -= 0.05;
    const t = ringSunTransmission(surface(lat), sun, centre, normal, opacity);
    expect(t).toBeCloseTo(Math.exp(-0.1 / Math.sin(17 * DEG)), 3);
  });

  it('shares ring-shadow uniforms per ringed planet only', () => {
    const u = ringShadowUniforms('saturn')!;
    expect(u).toBe(ringShadowUniforms('saturn'));
    expect(u.uRingShadowRange.value.x).toBe(66_900e3);
    expect(ringShadowUniforms('jupiter')).toBeUndefined();
    expect(ringWeight(2)).toBe(0);
    expect(ringWeight(10)).toBe(1);
  });
});
