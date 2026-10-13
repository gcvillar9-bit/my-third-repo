/**
 * sun (P3-B): replaces the Sun v1 look. Priority-10 photosphere shading (Neckel limb darkening,
 * animated Worley granulation over a supergranular network), a Baumbach corona shell that shows in
 * totality or at low exposure, and the 'sun-closeup' bookmark. The v1 aureole quad registered by
 * solar-system ('solar-system.sun-glow', 2e-4 of the disk) is removed: it would outshine the corona
 * by 100x in totality. See docs/modules/sun.md.
 */
import type { ModuleContext, UniverseModule } from '../../core/contracts';
import { SUN_TEFF } from '../../core/photometry';
import { buildSunCloseup } from './bookmarks';
import { createCorona } from './corona';
import { SUN_MODULE_ID, starSurface } from './public';

/** Renderable id of the Sun v1 glow quad (solar-system). */
export const V1_GLOW_ID = 'solar-system.sun-glow';

const sun: UniverseModule = {
  id: SUN_MODULE_ID,
  dependsOn: ['solar-system'],
  init(ctx: ModuleContext) {
    const body = ctx.registry.body('sun');
    if (!body) return;
    ctx.registry.setSurfaceShading(starSurface(SUN_TEFF, body.radius, { bodyId: 'sun', priority: 10 }));
    if (ctx.registry.renderables().some((r) => r.id === V1_GLOW_ID))
      ctx.registry.removeRenderable(V1_GLOW_ID);
    ctx.registry.addRenderable(createCorona(body, ctx.render.uniforms.uExposure, (f) => ctx.frames.has(f)));
    ctx.registry.addBookmarks([buildSunCloseup(body.radius)]);
  },
};

export default sun;
