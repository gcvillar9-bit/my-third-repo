export declare const F16_MAX: number;
export declare function toHalf(value: number): number;
export declare function fromHalf(bits: number): number;
export declare function packHalfArray(values: ArrayLike<number>): Uint16Array;
export declare function unpackHalfArray(bits: Uint16Array): Float32Array;
export declare function alignUp(n: number, a: number): number;
export declare function layoutSections(
  headerBytes: number,
  sections: ArrayBufferView[],
  writeHeader: (view: DataView, offsets: number[]) => void,
  align?: number,
): { buffer: Uint8Array; offsets: number[] };
