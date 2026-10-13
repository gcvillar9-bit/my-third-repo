/**
 * Height module 'surface' (HeightModule, loaded by the terrain workers and the main thread through
 * import.meta.glob). Fetches the body's 16-bit height raster (and Earth's ocean mask) with
 * ctx.fetchBinary, decodes them with fast-png and composes the layers of SurfaceHeightParams.
 */
import type { HeightFunction, HeightModule, HeightWorkerContext } from '../../../core/contracts';
import { createSurfaceHeight, type SurfaceHeightParams } from '../heightfield';
import { rasterFromPng, type Raster } from '../raster';

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
  const [height, ocean] = await Promise.all([
    p.raster ? load(p.raster.path, p.raster.offsetM, p.raster.stepM) : undefined,
    p.ocean ? load(p.ocean.path, 0, 1 / 255) : undefined,
  ]);
  return createSurfaceHeight(seeded, { height, ocean });
}

const heightModule: HeightModule = { create };
export default heightModule;
