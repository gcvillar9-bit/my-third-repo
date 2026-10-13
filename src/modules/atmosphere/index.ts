/**
 * atmosphere (P2-B): Hillaire 2020 sky and aerial perspective for Earth, Mars, Venus and Titan as
 * an 'atmosphere' stage ScreenPass over the main scene (depth-texture based, so it works with any
 * geometry provider), plus the 'mars-gale-sunset' bookmark. See docs/modules/atmosphere.md.
 */
import type { ModuleContext, UniverseModule } from '../../core/contracts';
import { parseInstant } from '../../core/time';
import { buildMarsGaleSunset } from './bookmarks';
import { AtmosphereGpu } from './pass';
import { ATMOSPHERE_ROWS, paramsFromRow } from './params';
import { ATMOSPHERE_MODULE_ID } from './public';
import { attach, requested, shading } from './service';

/** Reference instant for date-dependent bookmarks (the test default time). */
export const REFERENCE_JD = parseInstant('2026-01-01T00:00:00Z')!;

let gpu: AtmosphereGpu | null = null;
let unsubscribe: (() => void) | null = null;

const atmosphere: UniverseModule = {
  id: ATMOSPHERE_MODULE_ID,
  dependsOn: ['solar-system'],
  init(ctx: ModuleContext) {
    const { registry, render } = ctx;
    gpu = new AtmosphereGpu({
      gl: render.renderer,
      registry,
      exposure: render.uniforms.uExposure,
      shading,
      requested,
    });
    for (const row of ATMOSPHERE_ROWS) {
      const body = registry.body(row.id);
      if (body) gpu.setParams(paramsFromRow(row, body.radius));
    }
    attach(gpu);
    registry.addScreenPass(gpu);
    const g = gpu;
    unsubscribe = render.onBeforeFrame(() => g.beforeFrame());
    const mars = registry.body('mars');
    const bm = mars ? buildMarsGaleSunset(ctx.frames, mars, REFERENCE_JD) : null;
    if (bm) registry.addBookmarks([bm]);
  },
  dispose() {
    unsubscribe?.();
    unsubscribe = null;
    gpu?.dispose();
    gpu = null;
    attach(null);
  },
};

export default atmosphere;
