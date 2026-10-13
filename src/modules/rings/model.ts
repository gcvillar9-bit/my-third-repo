/**
 * Ring model (P3-A): true-radius regions from rings.json, the baked radial profile texture
 * (albedo, normal opacity, dust fraction), the Henyey-Greenstein phase mix and CPU twins of
 * the shaders (ring shadow on the globe, single-scattering radiance) for tests.
 */
import type { Vec3d } from '../../core/contracts';
import data from './rings.json';

export interface RingRegion {
  name: string;
  /** km from the planet centre. */
  inner: number;
  outer: number;
  /** Typical normal optical depth. */
  tau: number;
  /** Effective single-scattering albedo. */
  albedo: number;
  /** Fraction of forward-scattering dust in the phase function, 0..1. */
  dust: number;
  /** Take fine structure from the radial profile image (mean optical depth stays `tau`). */
  map: boolean;
  approximate?: boolean;
  source: string;
}

export interface RingSystemSpec {
  body: string;
  /** Extent of the baked profile, km. */
  inner: number;
  outer: number;
  tint: [number, number, number];
  /** Optional radial profile image (Celestia strip) mapped linearly over [inner, outer] km. */
  profile?: { path: string; inner: number; outer: number };
  source: string;
  regions: RingRegion[];
}

export const RING_SYSTEMS: readonly RingSystemSpec[] = (data as unknown as { systems: RingSystemSpec[] })
  .systems;
export const ringSystem = (body: string): RingSystemSpec | undefined =>
  RING_SYSTEMS.find((s) => s.body === body);

/** Profile texels (power of two so the CPU mip chain halves cleanly). */
export const PROFILE_SIZE = 4096;
/** Henyey-Greenstein asymmetry of macroscopic icy particles (backscattering) and of dust. */
export const G_BACK = -0.35;
export const G_DUST = 0.7;

/** Region covering radius `rKm` (later rows override earlier ones, so gaps win). */
export function regionAt(spec: RingSystemSpec, rKm: number): RingRegion | undefined {
  let hit: RingRegion | undefined;
  for (const reg of spec.regions) if (rKm >= reg.inner && rKm < reg.outer) hit = reg;
  return hit;
}

/** Model normal optical depth at `rKm` (0 outside every region). */
export function opticalDepth(spec: RingSystemSpec, rKm: number): number {
  return regionAt(spec, rKm)?.tau ?? 0;
}

/** Henyey-Greenstein phase normalised over the sphere (integral over 4 pi sr = 1); cos = 1 forward. */
export function hgPhase(cosTheta: number, g: number): number {
  const g2 = g * g;
  return (1 - g2) / (4 * Math.PI * Math.max(1 + g2 - 2 * g * cosTheta, 1e-6) ** 1.5);
}

/** Ring phase: icy particles backscatter, dust forward-scatters (normalised like hgPhase). */
export function ringPhase(cosTheta: number, dust: number): number {
  return (1 - dust) * hgPhase(cosTheta, G_BACK) + dust * hgPhase(cosTheta, G_DUST);
}

/**
 * Single-scattering I/F of a slab (Chandrasekhar): reflection when the Sun and the viewer are on
 * the same side, diffuse transmission otherwise. `p4pi` is the phase normalised to 4 pi.
 * CPU twin of rings.glsl.
 */
export function ringIoF(muSun: number, muView: number, tau: number, albedo: number, p4pi: number): number {
  const m0 = Math.max(Math.abs(muSun), 0.01);
  const m = Math.max(Math.abs(muView), 0.01);
  let f: number;
  if (muSun * muView > 0) f = (m0 / (m0 + m)) * (1 - Math.exp(-tau * (1 / m0 + 1 / m)));
  else if (Math.abs(m0 - m) < 1e-3) f = (tau / m0) * Math.exp(-tau / m0);
  else f = (m0 / (m0 - m)) * (Math.exp(-tau / m0) - Math.exp(-tau / m));
  return ((albedo * p4pi) / 4) * f;
}

export interface ProfileImage {
  width: number;
  /** RGBA8 row. */
  rgba: Uint8Array;
}

interface MapStatsRow {
  alpha: number;
  lum: number;
}

/**
 * Bakes the radial profile, linear RGBA texels over [spec.inner, spec.outer]:
 * R = albedo (times the image's brightness detail), G = normal opacity 1 - exp(-tau),
 * B = dust fraction, A = 1. Eight sub-samples per texel keep narrow ringlets' equivalent width.
 */
export function bakeProfile(spec: RingSystemSpec, size = PROFILE_SIZE, image?: ProfileImage): Float32Array {
  const out = new Float32Array(size * 4);
  const prof = spec.profile;
  const sampleImg = (rKm: number): MapStatsRow | null => {
    if (!image || !prof) return null;
    const u = (rKm - prof.inner) / (prof.outer - prof.inner);
    if (u < 0 || u >= 1) return null;
    const i = Math.min(image.width - 1, Math.floor(u * image.width)) * 4;
    const px = image.rgba;
    return { alpha: px[i + 3] / 255, lum: (px[i] + px[i + 1] + px[i + 2]) / 765 };
  };
  // Mean image opacity and brightness per mapped region, so tau stays the region's mean.
  const means = new Map<RingRegion, MapStatsRow>();
  for (const reg of spec.regions) {
    if (!reg.map) continue;
    let a = 0;
    let l = 0;
    let n = 0;
    for (let k = 0; k < 256; k++) {
      const s = sampleImg(reg.inner + ((k + 0.5) / 256) * (reg.outer - reg.inner));
      if (!s) continue;
      a += s.alpha;
      l += s.lum;
      n++;
    }
    if (n && a > 0 && l > 0) means.set(reg, { alpha: a / n, lum: l / n });
  }
  const SUB = 8;
  const span = spec.outer - spec.inner;
  for (let t = 0; t < size; t++) {
    let alb = 0;
    let op = 0;
    let dust = 0;
    for (let k = 0; k < SUB; k++) {
      const r = spec.inner + ((t + (k + 0.5) / SUB) / size) * span;
      const reg = regionAt(spec, r);
      if (!reg) continue;
      let tau = reg.tau;
      let albedo = reg.albedo;
      const mean = means.get(reg);
      const s = mean ? sampleImg(r) : null;
      if (mean && s) {
        tau *= Math.min(3, s.alpha / mean.alpha);
        albedo *= Math.min(1.5, Math.max(0.5, s.lum / mean.lum));
      }
      const a = 1 - Math.exp(-tau);
      op += a;
      alb += albedo * a;
      dust += reg.dust * a;
    }
    out[4 * t] = op > 0 ? alb / op : 0;
    out[4 * t + 1] = op / SUB;
    out[4 * t + 2] = op > 0 ? dust / op : 0;
    out[4 * t + 3] = 1;
  }
  return out;
}

/** Box-filtered mip chain of a 1-texel-high RGBA float row (level 0 included), down to 1 texel. */
export function mipChain(level0: Float32Array): Float32Array[] {
  const chain = [level0];
  let cur = level0;
  while (cur.length > 4) {
    const w = cur.length / 8;
    const next = new Float32Array(w * 4);
    for (let i = 0; i < w * 4; i++) {
      const c = i % 4;
      const x = (i - c) / 4;
      next[i] = 0.5 * (cur[8 * x + c] + cur[8 * x + 4 + c]);
    }
    chain.push(next);
    cur = next;
  }
  return chain;
}

/** Profile texel value (linear interpolation) at radius rKm; channel 1 = normal opacity. */
export function profileAt(spec: RingSystemSpec, profile: Float32Array, rKm: number, channel: number): number {
  const size = profile.length / 4;
  const x = ((rKm - spec.inner) / (spec.outer - spec.inner)) * size - 0.5;
  if (x < -0.5 || x > size - 0.5) return 0;
  const i0 = Math.max(0, Math.floor(x));
  const i1 = Math.min(size - 1, i0 + 1);
  const f = Math.min(1, Math.max(0, x - i0));
  return profile[4 * i0 + channel] * (1 - f) + profile[4 * i1 + channel] * f;
}

/**
 * Fraction of sunlight reaching point `p` on the globe through the ring plane (ray-plane
 * intersection along the Sun direction). CPU twin of ring-shadow.glsl. Vectors share one frame;
 * `centre` is the planet centre, `normal` the unit ring-plane normal, `sunDir` unit, metres.
 */
export function ringSunTransmission(
  p: Vec3d,
  sunDir: Vec3d,
  centre: Vec3d,
  normal: Vec3d,
  opacityAt: (rKm: number) => number,
): number {
  const dn = sunDir.x * normal.x + sunDir.y * normal.y + sunDir.z * normal.z;
  if (Math.abs(dn) < 1e-4) return 1;
  const dx = p.x - centre.x;
  const dy = p.y - centre.y;
  const dz = p.z - centre.z;
  const t = -(dx * normal.x + dy * normal.y + dz * normal.z) / dn;
  if (t <= 0) return 1;
  const r = Math.hypot(dx + t * sunDir.x, dy + t * sunDir.y, dz + t * sunDir.z) / 1e3;
  const a0 = Math.min(opacityAt(r), 0.9999);
  return (1 - a0) ** (1 / Math.abs(dn));
}

/**
 * Decodes the first row of an 8-bit RGBA PNG (the Celestia ring strips are 4096x1) with the
 * platform DecompressionStream (browsers and Node 22).
 */
export async function decodePngStrip(buf: ArrayBuffer): Promise<ProfileImage> {
  const b = new Uint8Array(buf);
  const dv = new DataView(buf);
  if (b[0] !== 0x89 || b[1] !== 0x50) throw new Error('rings: not a PNG');
  let o = 8;
  let width = 0;
  const idat: Uint8Array[] = [];
  while (o + 8 <= b.length) {
    const len = dv.getUint32(o);
    const type = String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
    if (type === 'IHDR') {
      width = dv.getUint32(o + 8);
      if (b[o + 16] !== 8 || b[o + 17] !== 6 || b[o + 20] !== 0) throw new Error('rings: need 8-bit RGBA');
    } else if (type === 'IDAT') idat.push(b.subarray(o + 8, o + 8 + len));
    else if (type === 'IEND') break;
    o += 12 + len;
  }
  const stream = new Blob(idat as BlobPart[]).stream().pipeThrough(new DecompressionStream('deflate'));
  const raw = new Uint8Array(await new Response(stream).arrayBuffer());
  const filter = raw[0];
  const rgba = new Uint8Array(width * 4);
  for (let i = 0; i < width * 4; i++) {
    const x = raw[1 + i];
    const a = i >= 4 ? rgba[i - 4] : 0; // the row above is all zero for row 0
    rgba[i] = (filter === 1 || filter === 4 ? x + a : filter === 3 ? x + (a >> 1) : x) & 255;
  }
  return { width, rgba };
}
