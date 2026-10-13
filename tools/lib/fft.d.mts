export declare function isPowerOfTwo(n: number): boolean;
export declare function fft(re: Float64Array, im: Float64Array, inverse?: boolean): void;
export declare function fft2d(
  re: Float64Array,
  im: Float64Array,
  width: number,
  height: number,
  inverse?: boolean,
): void;
export declare function frankotChellappa(
  p: ArrayLike<number>,
  q: ArrayLike<number>,
  w: number,
  h: number,
  opts?: { mirrorY?: boolean; kernel?: 'central' | 'omega'; lambda?: number },
): Float64Array;
