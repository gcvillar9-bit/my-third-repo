export declare const STARS_MAGIC: string;
export declare const STARS_VERSION: number;
export declare const STARS_HEADER_BYTES: number;
export declare const BV_MIN: number;
export declare const BV_STEP: number;
export declare const BV_UNKNOWN: number;
export declare const NAME_NONE: number;
export declare const FLAG_NAMED: number;
export declare const FLAG_VARIABLE: number;
export declare const FLAG_MULTIPLE: number;
export declare const FLAG_DIST_UNKNOWN: number;
export declare const FLAG_HIPPARCOS: number;

export interface StarInput {
  x: number;
  y: number;
  z: number;
  absMag: number;
  vx: number;
  vy: number;
  vz: number;
  bv: number | null;
  flags?: number;
  nameIndex?: number;
}

export interface DecodedStars {
  version: number;
  headerBytes: number;
  count: number;
  namesCount: number;
  epochYear: number;
  bvMin: number;
  bvStep: number;
  /** x,y,z per star, parsecs, ICRS, Sun-centred. */
  positions: Float32Array;
  absMag: Float32Array;
  absMagBits: Uint16Array;
  /** vx,vy,vz per star, km/s. */
  velocity: Float32Array;
  velocityBits: Uint16Array;
  nameIndex: Uint16Array;
  bvCode: Uint8Array;
  /** NaN when unknown. */
  bv: Float32Array;
  flags: Uint8Array;
}

export declare function quantizeBv(bv: number | null | undefined): number;
export declare function dequantizeBv(code: number): number;
export declare function encodeStars(
  stars: StarInput[],
  meta?: { namesCount?: number; epochYear?: number },
): Uint8Array;
export declare function decodeStars(input: ArrayBuffer | Uint8Array): DecodedStars;
