/** Types of the pure helpers of tools/build-nebulae.mjs that the unit tests import. */
export declare const ENCODE_EXP: number;
export declare const RATIO_LOG2_SPAN: number;
export declare const CAMERA: number[][];
/** Gnomonic projection about (ra0, dec0), degrees -> [xi east, eta north]. */
export declare function gnomonic(ra0: number, dec0: number, ra: number, dec: number): [number, number];
export declare function inverseGnomonic(ra0: number, dec0: number, xi: number, eta: number): [number, number];
/** 8-parameter homography taking src[i] -> dst[i] (4 points). */
export declare function homography(
  src: readonly (readonly [number, number])[],
  dst: readonly (readonly [number, number])[],
): (x: number, y: number) => [number, number];
/** Sky (ra, dec in degrees) -> source pixel of a Stellarium image entry (texture (0, 0) = bottom-left). */
export declare function stellariumMapping(
  entry: {
    worldCoords: readonly (readonly [number, number])[];
    textureCoords: readonly (readonly [number, number])[];
  },
  width: number,
  height: number,
): (ra: number, dec: number) => [number, number];
/** The decoded core ratio averaged over each emission pixel (1 outside the core field). */
export declare function coreGainOnGrid(
  bytes: Uint8Array,
  C: number,
  channels: number,
  core: { xiMax: number; ratioLog2Span: number },
  N: number,
  xiMax: number,
  sub?: number,
): Float32Array;
/** Feathered (smoothstep) weight of a binary N x N region across its edge. */
export declare function plateauWeight(mask: ArrayLike<number>, N: number, blendPx: number): Float32Array;
