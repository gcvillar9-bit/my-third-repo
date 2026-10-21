/** Terrain patch generation off the main thread (comlink). */
import { expose, transfer } from 'comlink';
import { loadHeightFunction, type HeightOwner, type HeightSpecLike } from './height-modules';
import { buildPatch, patchBuffers, type PatchData, type PatchRequest } from './patch';

export interface TerrainBuildRequest extends PatchRequest {
  key: number;
  spec: HeightSpecLike;
  /** Body and spec stamp: a newer spec of the same body evicts the older one's cached function. */
  owner: HeightOwner;
  /** import.meta.env.BASE_URL of the page (fetchBinary prefix). */
  base: string;
  seed: number;
}

export interface TerrainWorkerApi {
  build(req: TerrainBuildRequest): Promise<PatchData>;
}

const api: TerrainWorkerApi = {
  async build(req) {
    const fn = await loadHeightFunction(
      req.spec,
      {
        seed: req.seed,
        fetchBinary: async (path: string) => {
          const res = await fetch(new URL(req.base + path, self.location.href).href);
          if (!res.ok) throw new Error(`terrain worker: ${res.status} for ${path}`);
          return res.arrayBuffer();
        },
      },
      req.owner,
    );
    const p = buildPatch(fn, req, req.key);
    return transfer(p, patchBuffers(p));
  },
};

expose(api);
