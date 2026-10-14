/**
 * galaxies.bin (GALX v1) reference decoder and encoder; pure TypeScript (no DOM), shared by the app and
 * the Node unit tests. Layout (little-endian, structure of arrays, see docs/modules/galaxies.md):
 *
 *   header  u32 magic 'GALX', u32 version 1, u32 count N, u32 reserved 0       16 bytes
 *   pos     f32[3N]  x, y, z in Mpc, `universe` frame (supergalactic axes, origin Milky Way centre)
 *   radius  f32[N]   kpc (Celestia Radius)
 *   absMag  f32[N]   absolute magnitude (Celestia AbsMag, B band)
 *   quat    i8[4N]   x, y, z, w × 127: galaxy-local → universe rotation, disc in local xy, normal +z
 *   nameIdx u16[N]   row of names.json `names` (0xFFFF = unnamed)
 *   type    u8[N]    Hubble type code, index into GALAXY_TYPES
 */

export const GALX_MAGIC = 0x584c4147;
export const GALX_VERSION = 1;
export const GALX_HEADER_BYTES = 16;
export const NO_NAME = 0xffff;
export const GALAXY_TYPES = [
  'E0',
  'E1',
  'E2',
  'E3',
  'E4',
  'E5',
  'E6',
  'E7',
  'S0',
  'Sa',
  'Sb',
  'Sc',
  'SBa',
  'SBb',
  'SBc',
  'Irr',
] as const;
export type GalaxyType = (typeof GALAXY_TYPES)[number];

export interface GalaxyData {
  count: number;
  pos: Float32Array;
  radiusKpc: Float32Array;
  absMag: Float32Array;
  quat: Int8Array;
  nameIdx: Uint16Array;
  type: Uint8Array;
}

/** Byte length of a GALX v1 file holding n galaxies. */
export const galxBytes = (n: number): number => GALX_HEADER_BYTES + 27 * n;

/** Decodes a GALX v1 buffer (views into `buf`, no copies). */
export function decodeGalaxies(buf: ArrayBuffer): GalaxyData {
  const h = new DataView(buf);
  if (h.getUint32(0, true) !== GALX_MAGIC) throw new Error('galaxies.bin: bad magic');
  if (h.getUint32(4, true) !== GALX_VERSION) throw new Error('galaxies.bin: unsupported version');
  const n = h.getUint32(8, true);
  if (buf.byteLength < galxBytes(n)) throw new Error('galaxies.bin: truncated');
  let o = GALX_HEADER_BYTES;
  const take = <T>(make: (o: number) => T, bytes: number): T => {
    const v = make(o);
    o += bytes;
    return v;
  };
  return {
    count: n,
    pos: take((p) => new Float32Array(buf, p, 3 * n), 12 * n),
    radiusKpc: take((p) => new Float32Array(buf, p, n), 4 * n),
    absMag: take((p) => new Float32Array(buf, p, n), 4 * n),
    quat: take((p) => new Int8Array(buf, p, 4 * n), 4 * n),
    nameIdx: take((p) => new Uint16Array(buf, p, n), 2 * n),
    type: take((p) => new Uint8Array(buf, p, n), n),
  };
}

/** Encodes decoded data back into a GALX v1 buffer (round-trip reference). */
export function encodeGalaxies(d: GalaxyData): ArrayBuffer {
  const n = d.count;
  const buf = new ArrayBuffer(galxBytes(n));
  new Uint32Array(buf, 0, 4).set([GALX_MAGIC, GALX_VERSION, n, 0]);
  const out = decodeGalaxies(buf);
  out.pos.set(d.pos);
  out.radiusKpc.set(d.radiusKpc);
  out.absMag.set(d.absMag);
  out.quat.set(d.quat);
  out.nameIdx.set(d.nameIdx);
  out.type.set(d.type);
  return buf;
}

/** Unit quaternion [x, y, z, w] of galaxy i (int8 / 127, renormalised). */
export function galaxyQuat(d: GalaxyData, i: number, out: number[] = [0, 0, 0, 1]): number[] {
  const q = d.quat;
  const x = q[4 * i] / 127;
  const y = q[4 * i + 1] / 127;
  const z = q[4 * i + 2] / 127;
  const w = q[4 * i + 3] / 127;
  const s = 1 / (Math.hypot(x, y, z, w) || 1);
  out[0] = x * s;
  out[1] = y * s;
  out[2] = z * s;
  out[3] = w * s;
  return out;
}

/** Morphology sprite of a Hubble type: 0 E, 1 S0, 2 Sa(b), 3 Sc, 4 SB, 5 Irr. */
export function morphSprite(type: number): number {
  const t = GALAXY_TYPES[type] ?? 'Irr';
  if (t.startsWith('E')) return 0;
  if (t === 'S0') return 1;
  if (t === 'Sa' || t === 'Sb') return 2;
  if (t === 'Sc') return 3;
  if (t.startsWith('SB')) return 4;
  return 5;
}

/** Axis ratio b/a of the sprite: En ellipticals 1 - n/10, everything else 1 (a thin disc). */
export const ellipticalAxisRatio = (type: number): number => {
  const t = GALAXY_TYPES[type] ?? 'Irr';
  return t.startsWith('E') ? 1 - Number(t.slice(1)) / 10 : 1;
};

/** Distance from the universe-frame origin (Milky Way centre) to galaxy i, Mpc. */
export const galaxyDistMpc = (d: GalaxyData, i: number): number =>
  Math.hypot(d.pos[3 * i], d.pos[3 * i + 1], d.pos[3 * i + 2]);
