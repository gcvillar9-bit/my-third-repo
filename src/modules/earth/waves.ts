/**
 * Procedural, exactly tileable water-normal map (no download): a sum of cosine waves with
 * integer wavevectors (cycles per tile) spread around a wind direction, amplitude ~ k^-1.6.
 * Slopes come from the analytic gradient, so the map wraps without seams.
 */
import { DataTexture, LinearMipmapLinearFilter, LinearFilter, RGBAFormat, RepeatWrapping } from 'three';

export interface Wave {
  kx: number;
  ky: number;
  amp: number;
  phase: number;
}

/** Deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 24 waves, |k| from 3 to ~40 cycles per tile within +-55 deg of the +x wind. */
export function waterWaves(seed = 1, count = 24): Wave[] {
  const rand = rng(seed);
  const out: Wave[] = [];
  const seen = new Set<string>();
  for (let i = 0; out.length < count && i < count * 8; i++) {
    const k = 3 * 1.12 ** (out.length + rand());
    const th = (rand() * 2 - 1) * ((55 * Math.PI) / 180);
    const kx = Math.round(k * Math.cos(th));
    const ky = Math.round(k * Math.sin(th));
    const key = `${kx},${ky}`;
    if ((kx === 0 && ky === 0) || seen.has(key)) continue;
    seen.add(key);
    out.push({ kx, ky, amp: Math.hypot(kx, ky) ** -1.6, phase: rand() * 2 * Math.PI });
  }
  return out;
}

/** Height-field slope (dh/dx, dh/dy) at texel coordinates (x, y), unscaled; period `size`. */
export function waveSlopeAt(waves: readonly Wave[], x: number, y: number, size: number): [number, number] {
  let sx = 0;
  let sy = 0;
  const w = (2 * Math.PI) / size;
  for (const v of waves) {
    const s = -v.amp * Math.sin(w * (v.kx * x + v.ky * y) + v.phase);
    sx += s * w * v.kx;
    sy += s * w * v.ky;
  }
  return [sx, sy];
}

/** RGBA8 tangent-space normals (xyz * 0.5 + 0.5), RMS slope `rmsSlope`. */
export function waterNormalPixels(size = 256, seed = 1, rmsSlope = 0.22): Uint8Array {
  const waves = waterWaves(seed);
  const sx = new Float64Array(size * size);
  const sy = new Float64Array(size * size);
  let ss = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [a, b] = waveSlopeAt(waves, x, y, size);
      sx[y * size + x] = a;
      sy[y * size + x] = b;
      ss += a * a + b * b;
    }
  }
  const scale = rmsSlope / Math.sqrt(ss / (size * size) || 1);
  const px = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const nx = -sx[i] * scale;
    const ny = -sy[i] * scale;
    const l = Math.hypot(nx, ny, 1);
    px[4 * i] = Math.round((nx / l) * 127.5 + 127.5);
    px[4 * i + 1] = Math.round((ny / l) * 127.5 + 127.5);
    px[4 * i + 2] = Math.round((1 / l) * 127.5 + 127.5);
    px[4 * i + 3] = 255;
  }
  return px;
}

/** 256x256 repeat-wrapped, mipmapped DataTexture of waterNormalPixels (linear data). */
export function createWaterNormalTexture(size = 256, seed = 1): DataTexture {
  const tex = new DataTexture(waterNormalPixels(size, seed), size, size, RGBAFormat);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
