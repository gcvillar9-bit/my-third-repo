/**
 * stars.bin v1: encoder and reference decoder (byte-exact spec in docs/modules/data-formats.md).
 *
 * Header (64 bytes, little-endian):
 *   0  u8[4] magic 'STAR'        4  u16 version (1)        6  u16 headerBytes (64)
 *   8  u32 count                 12 f32 bvMin              16 f32 bvStep
 *   20 u32 offPosition (f32 x,y,z per star, parsecs, ICRS equatorial, Sun-centred, epoch J2000)
 *   24 u32 offAbsMag   (f16 per star, absolute V magnitude)
 *   28 u32 offVelocity (f16 vx,vy,vz per star, km/s, same axes)
 *   32 u32 offNameIndex (u16 per star, row in names.json, 0xFFFF = unnamed)
 *   36 u32 offBv       (u8 per star, B-V = bvMin + code*bvStep, 255 = unknown)
 *   40 u32 offFlags    (u8 per star, FLAG_* bits)
 *   44 u32 namesCount  48 f32 epochYear (2000.0)  52..63 reserved (0)
 * Sections start 4-byte aligned; stars are sorted by apparent magnitude (brightest first).
 */
import { layoutSections, packHalfArray, unpackHalfArray } from './binary.mjs';

export const STARS_MAGIC = 'STAR';
export const STARS_VERSION = 1;
export const STARS_HEADER_BYTES = 64;
export const BV_MIN = -0.5;
export const BV_STEP = 0.014; // 254 steps -> -0.5 .. 3.056
export const BV_UNKNOWN = 255;
export const NAME_NONE = 0xffff;

export const FLAG_NAMED = 1; // has a names.json row (proper, Bayer or Flamsteed)
export const FLAG_VARIABLE = 2; // HYG 'var' set
export const FLAG_MULTIPLE = 4; // member of a multiple system (HYG 'base' set)
export const FLAG_DIST_UNKNOWN = 8; // no usable parallax: HYG placeholder distance 100000 pc, velocity zeroed
export const FLAG_HIPPARCOS = 16; // has a Hipparcos id

export function quantizeBv(bv) {
  if (bv == null || !Number.isFinite(bv)) return BV_UNKNOWN;
  return Math.max(0, Math.min(254, Math.round((bv - BV_MIN) / BV_STEP)));
}

export function dequantizeBv(code) {
  return code === BV_UNKNOWN ? NaN : BV_MIN + code * BV_STEP;
}

/**
 * @param {{x:number,y:number,z:number,absMag:number,vx:number,vy:number,vz:number,bv:number|null,flags:number,nameIndex:number}[]} stars
 * @param {{namesCount?: number, epochYear?: number}} [meta]
 * @returns {Buffer}
 */
export function encodeStars(stars, meta = {}) {
  const n = stars.length;
  const pos = new Float32Array(n * 3);
  const vel = new Array(n * 3);
  const absMag = new Array(n);
  const name = new Uint16Array(n);
  const bv = new Uint8Array(n);
  const flags = new Uint8Array(n);
  stars.forEach((s, i) => {
    pos[i * 3] = s.x;
    pos[i * 3 + 1] = s.y;
    pos[i * 3 + 2] = s.z;
    vel[i * 3] = s.vx;
    vel[i * 3 + 1] = s.vy;
    vel[i * 3 + 2] = s.vz;
    absMag[i] = s.absMag;
    name[i] = s.nameIndex ?? NAME_NONE;
    bv[i] = quantizeBv(s.bv);
    flags[i] = s.flags ?? 0;
  });
  const sections = [pos, packHalfArray(absMag), packHalfArray(vel), name, bv, flags];
  const { buffer } = layoutSections(STARS_HEADER_BYTES, sections, (v, off) => {
    for (let i = 0; i < 4; i++) v.setUint8(i, STARS_MAGIC.charCodeAt(i));
    v.setUint16(4, STARS_VERSION, true);
    v.setUint16(6, STARS_HEADER_BYTES, true);
    v.setUint32(8, n, true);
    v.setFloat32(12, BV_MIN, true);
    v.setFloat32(16, BV_STEP, true);
    off.forEach((o, i) => v.setUint32(20 + i * 4, o, true));
    v.setUint32(44, meta.namesCount ?? 0, true);
    v.setFloat32(48, meta.epochYear ?? 2000, true);
  });
  return buffer;
}

/**
 * Reference decoder. Accepts an ArrayBuffer or a Node Buffer/Uint8Array. Typed-array views share
 * memory with the input where alignment allows (sections are 4-byte aligned).
 */
export function decodeStars(input) {
  const u8 =
    input instanceof Uint8Array ? input : new Uint8Array(input instanceof ArrayBuffer ? input : input.buffer);
  // Copy to a fresh, aligned ArrayBuffer so typed views are always legal.
  const buf = u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength ? u8.buffer : u8.slice().buffer;
  const v = new DataView(buf);
  const magic = String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3));
  if (magic !== STARS_MAGIC) throw new Error(`bad magic '${magic}'`);
  const version = v.getUint16(4, true);
  if (version !== STARS_VERSION) throw new Error(`unsupported stars.bin version ${version}`);
  const headerBytes = v.getUint16(6, true);
  const count = v.getUint32(8, true);
  const bvMin = v.getFloat32(12, true);
  const bvStep = v.getFloat32(16, true);
  const off = [0, 1, 2, 3, 4, 5].map((i) => v.getUint32(20 + i * 4, true));
  const positions = new Float32Array(buf, off[0], count * 3);
  const absMagBits = new Uint16Array(buf, off[1], count);
  const velocityBits = new Uint16Array(buf, off[2], count * 3);
  const nameIndex = new Uint16Array(buf, off[3], count);
  const bvCode = new Uint8Array(buf, off[4], count);
  const flags = new Uint8Array(buf, off[5], count);
  const bv = new Float32Array(count);
  for (let i = 0; i < count; i++) bv[i] = bvCode[i] === BV_UNKNOWN ? NaN : bvMin + bvCode[i] * bvStep;
  return {
    version,
    headerBytes,
    count,
    namesCount: v.getUint32(44, true),
    epochYear: v.getFloat32(48, true),
    bvMin,
    bvStep,
    positions,
    absMag: unpackHalfArray(absMagBits),
    absMagBits,
    velocity: unpackHalfArray(velocityBits),
    velocityBits,
    nameIndex,
    bvCode,
    bv,
    flags,
  };
}
