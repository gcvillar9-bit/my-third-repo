import type { Sharp } from 'sharp';

export interface RawImage {
  data: Buffer;
  info: { width: number; height: number; channels: number };
}
export interface WebpOptions {
  width?: number;
  height?: number;
  quality?: number | Record<string, number>;
  lossless?: boolean;
  nearLossless?: number;
  /** Keep the alpha channel (default: dropped before resizing). */
  alpha?: boolean;
  kernel?: string;
}
export function img(input: string | Buffer | RawImage): Sharp;
export function writeWebp(
  input: string | Buffer | RawImage,
  outPath: string,
  opts?: WebpOptions,
): Promise<string>;
export const TIER_WIDTH: Record<string, number>;
export function writeTiers(
  input: string | Buffer | RawImage,
  dir: string,
  name: string,
  tiers: string[],
  opts?: WebpOptions,
): Promise<Record<string, string>>;
export function readRaw(input: string | Buffer | RawImage, opts?: { channels?: number }): Promise<RawImage>;
