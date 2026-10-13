/**
 * Height module 'surface' (HeightModule, loaded by the terrain workers and the main thread through
 * import.meta.glob). Fetches the body's 16-bit height raster (and Earth's ocean mask) with
 * ctx.fetchBinary, decodes them with fast-png and composes the layers of SurfaceHeightParams.
 */
import type { HeightFunction, HeightModule, HeightWorkerContext } from '../../../core/contracts';
import { createSurfaceHeight, type SurfaceHeightParams } from '../heightfield';
import { rasterFromPng } from '../png';
import type { Raster } from '../raster';
import { decodeTerrarium } from '../terrarium';
import { decode } from 'fast-png';

/** Fetches and decodes one Terrarium tile (blob: URLs prepared by the main thread); null on failure. */
async function loadTerrarium(url: string | null): Promise<Float32Array | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const img = decode(new Uint8Array(await res.arrayBuffer()));
    return decodeTerrarium(img.data as ArrayLike<number>, img.width * img.height, img.channels);
  } catch {
    return null;
  }
}

export async function create(params: unknown, ctx: HeightWorkerContext): Promise<HeightFunction> {
  const p = params as SurfaceHeightParams;
  const mix = Math.imul(ctx.seed | 0, 0x9e3779b1);
  const seeded: SurfaceHeightParams = {
    ...p,
    seed: (p.seed ^ mix) | 0,
    craters: p.craters && { ...p.craters, seed: (p.craters.seed ^ mix) | 0 },
  };
  const load = (path: string, offset: number, step: number): Promise<Raster> =>
    ctx.fetchBinary(path).then((b) => rasterFromPng(b, offset, step));
  const [height, ocean, hd] = await Promise.all([
    p.raster ? load(p.raster.path, p.raster.offsetM, p.raster.stepM) : undefined,
    p.ocean ? load(p.ocean.path, 0, 1 / 255) : undefined,
    p.hd ? Promise.all(p.hd.urls.map(loadTerrarium)) : undefined,
  ]);
  return createSurfaceHeight(seeded, { height, ocean, hd });
}

const heightModule: HeightModule = { create };
export default heightModule;
