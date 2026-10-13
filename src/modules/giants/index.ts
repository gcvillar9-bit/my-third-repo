/**
 * giants (P3-A): gas-giant shading overrides (priority 10) with animated zonal flow, the Great Red
 * Spot vortex, limb darkening and the ring shadow on the globe; moon shadow transits through an
 * OccluderProvider; the 'saturn-backlit-2013-07-19', 'jupiter-io-shadow' and 'uranus-rings'
 * bookmarks.
 */
import type { ModuleContext, UniverseModule } from '../../core/contracts';
import { RINGS_MODULE_ID } from '../rings/public';
import { BODIES_PATH, SOLAR_SYSTEM_MODULE_ID, type BodiesFile } from '../solar-system/public';
import { buildGiantBookmarks } from './bookmarks';
import { GIANTS } from './model';
import { createTransitOccluders } from './occluders';
import { MODULE_ID, createGiantShading } from './shading';

const giants: UniverseModule = {
  id: MODULE_ID,
  dependsOn: [SOLAR_SYSTEM_MODULE_ID, RINGS_MODULE_ID],
  async init(ctx: ModuleContext) {
    const { registry } = ctx;
    const rows = (await ctx.assets.json<BodiesFile>(BODIES_PATH)).bodies;
    for (const spec of GIANTS) {
      const body = registry.body(spec.id);
      const row = rows.find((r) => r.id === spec.id);
      if (!body || !row) continue;
      registry.setSurfaceShading(
        createGiantShading(spec, body, row, { assets: ctx.assets, quality: ctx.quality }),
      );
    }
    registry.addOccluders(createTransitOccluders(registry));
    registry.addBookmarks(buildGiantBookmarks(ctx.frames, (id) => registry.body(id)?.radius ?? 0));
  },
};

export default giants;
