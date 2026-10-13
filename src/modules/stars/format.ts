/**
 * Decoder for data/stars/stars.bin v1 (docs/modules/data-formats.md). Pure: runs in the decode
 * worker, on the main thread as a fallback, and in Node unit tests.
 */

export const STARS_MAGIC = 'STAR';
export const FLAG_NAMED = 1;
export const FLAG_VARIABLE = 2;
export const FLAG_MULTIPLE = 4;
export const FLAG_DIST_UNKNOWN = 8;
export const FLAG_HIPPARCOS = 16;
/** bv code meaning "unknown". */
export const BV_UNKNOWN = 255;
/** nameIndex meaning "no names.json row". */
export const NO_NAME = 0xffff;
/** pc per (km/s · yr): linear proper motion pos(t) = pos + v · (t − epoch) · PM_PC_PER_KMS_YR. */
export const PM_PC_PER_KMS_YR = 1.0227e-6;

/** Decoded catalogue. Every array owns its own ArrayBuffer (transferable). */
export interface StarData {
  count: number;
  bvMin: number;
  bvStep: number;
  namesCount: number;
  epochYear: number;
  /** x, y, z per star, pc, ICRS axes, Sun-centred, J2000. */
  position: Float32Array;
  /** Absolute visual magnitude as IEEE binary16 bits (GPU HalfFloat attribute). */
  absMagHalf: Uint16Array;
  /** Absolute visual magnitude, decoded. */
  absMag: Float32Array;
  /** vx, vy, vz per star as binary16 bits, km/s. */
  velocityHalf: Uint16Array;
  nameIndex: Uint16Array;
  /** B-V code: bvMin + code · bvStep, BV_UNKNOWN = unknown. */
  bv: Uint8Array;
  flags: Uint8Array;
}

/** IEEE 754 binary16 bits → number. */
export function fromHalf(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const m = h & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (m / 1024);
  if (e === 31) return m ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + m / 1024);
}

/** Parses the header and copies every section into its own typed array. Throws on bad data. */
export function decodeStarsBin(buf: ArrayBuffer): StarData {
  if (buf.byteLength < 64) throw new Error('stars.bin: truncated header');
  const v = new DataView(buf);
  const magic = String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3));
  if (magic !== STARS_MAGIC) throw new Error(`stars.bin: bad magic '${magic}'`);
  const version = v.getUint16(4, true);
  if (version !== 1) throw new Error(`stars.bin: unsupported version ${version}`);
  const n = v.getUint32(8, true);
  const off = (k: number) => v.getUint32(20 + 4 * k, true);
  const sizes = [12 * n, 2 * n, 6 * n, 2 * n, n, n];
  for (let k = 0; k < 6; k++) {
    if (off(k) % 4 !== 0 || off(k) + sizes[k] > buf.byteLength)
      throw new Error(`stars.bin: bad section ${k}`);
  }
  const section = (k: number) => buf.slice(off(k), off(k) + sizes[k]);
  const absMagHalf = new Uint16Array(section(1));
  const absMag = new Float32Array(n);
  for (let i = 0; i < n; i++) absMag[i] = fromHalf(absMagHalf[i]);
  return {
    count: n,
    bvMin: v.getFloat32(12, true),
    bvStep: v.getFloat32(16, true),
    namesCount: v.getUint32(44, true),
    epochYear: v.getFloat32(48, true),
    position: new Float32Array(section(0)),
    absMagHalf,
    absMag,
    velocityHalf: new Uint16Array(section(2)),
    nameIndex: new Uint16Array(section(3)),
    bv: new Uint8Array(section(4)),
    flags: new Uint8Array(section(5)),
  };
}

/** Buffers of a StarData, for comlink transfer(). */
export const starDataBuffers = (d: StarData): ArrayBuffer[] =>
  [d.position, d.absMagHalf, d.absMag, d.velocityHalf, d.nameIndex, d.bv, d.flags].map(
    (a) => a.buffer as ArrayBuffer,
  );
