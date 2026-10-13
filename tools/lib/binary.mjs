/**
 * Little-endian binary helpers shared by build scripts and reference decoders.
 * IEEE 754 binary16 conversion uses round-to-nearest-even; overflow saturates to +-Infinity like
 * a hardware conversion, so callers clamp to F16_MAX first when Infinity is not wanted.
 */

export const F16_MAX = 65504;

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** Float -> binary16 bits (number 0..65535). */
export function toHalf(value) {
  f32[0] = value;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  const exp = (x >>> 23) & 0xff;
  let mant = x & 0x7fffff;
  if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0); // Inf / NaN
  let e = exp - 127 + 15;
  if (e >= 0x1f) return sign | 0x7c00; // overflow -> Inf
  if (e <= 0) {
    // Subnormal half (or zero).
    if (e < -10) return sign;
    mant |= 0x800000;
    const shift = 14 - e;
    let h = mant >>> shift;
    const rem = mant & ((1 << shift) - 1);
    const half = 1 << (shift - 1);
    if (rem > half || (rem === half && h & 1)) h++;
    return sign | h;
  }
  let h = (e << 10) | (mant >>> 13);
  const rem = mant & 0x1fff;
  if (rem > 0x1000 || (rem === 0x1000 && h & 1)) h++; // may carry into exponent (correct)
  return sign | h;
}

/** binary16 bits -> float. */
export function fromHalf(h) {
  const sign = h & 0x8000 ? -1 : 1;
  const exp = (h >>> 10) & 0x1f;
  const mant = h & 0x3ff;
  if (exp === 0) return sign * mant * 2 ** -24;
  if (exp === 0x1f) return mant ? NaN : sign * Infinity;
  return sign * (1 + mant / 1024) * 2 ** (exp - 15);
}

/** Packs an array of numbers into a Uint16Array of binary16 values. */
export function packHalfArray(values) {
  const out = new Uint16Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = toHalf(values[i]);
  return out;
}

/** Decodes a Uint16Array of binary16 values into a Float32Array. */
export function unpackHalfArray(bits) {
  const out = new Float32Array(bits.length);
  for (let i = 0; i < bits.length; i++) out[i] = fromHalf(bits[i]);
  return out;
}

export const alignUp = (n, a) => Math.ceil(n / a) * a;

/**
 * Lays out typed-array sections after a header, each aligned to `align` bytes, and returns
 * { buffer: Buffer, offsets: number[] }. The header bytes are written by the caller via `writeHeader(view, offsets)`.
 * Typed arrays are copied byte-for-byte, so this assumes a little-endian host (checked).
 */
export function layoutSections(headerBytes, sections, writeHeader, align = 4) {
  if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) throw new Error('big-endian host unsupported');
  const offsets = [];
  let off = alignUp(headerBytes, align);
  for (const s of sections) {
    offsets.push(off);
    off = alignUp(off + s.byteLength, align);
  }
  const buffer = Buffer.alloc(off);
  sections.forEach((s, i) => buffer.set(new Uint8Array(s.buffer, s.byteOffset, s.byteLength), offsets[i]));
  writeHeader(new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength), offsets);
  return { buffer, offsets };
}
