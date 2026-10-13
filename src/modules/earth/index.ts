/**
 * earth (P2-B): hero Earth. Overrides Earth's SurfaceShading (priority 10: GGX ocean glint with
 * procedural water normals, terminator-gated city lights, Sun transmittance and cloud shadows),
 * adds a cloud shell and the 400 km / night-lights bookmarks. See docs/modules/earth.md.
 */
import type { ModuleContext, UniverseModule } from '../../core/contracts';
import { parseInstant } from '../../core/time';
import { atmosphereShadingUniforms, requestAtmosphereLuts } from '../atmosphere/public';
import { buildEarthBookmarks } from './bookmarks';
import { createCloudShell } from './clouds';
import { createEarthShading, createEarthUniforms } from './shading';
import { EARTH_MODULE_ID, EarthTextures } from './textures';
import { createWaterNormalTexture } from './waves';

/** Fixed instant of the night-lights view (Europe around 01:00 local time). */
export const NIGHT_JD = parseInstant('2026-01-01T00:00:00Z')!;

let release: (() => void) | null = null;

const earth: UniverseModule = {
  id: EARTH_MODULE_ID,
  dependsOn: ['solar-system', 'atmosphere'],
  init(ctx: ModuleContext) {
    const body = ctx.registry.body('earth');
    if (!body) return;
    const textures = new EarthTextures(ctx.assets, ctx.quality);
    const shared = createEarthUniforms(body);
    const atmosphere = atmosphereShadingUniforms('earth');
    requestAtmosphereLuts('earth');
    const waves = createWaterNormalTexture();
    ctx.registry.setSurfaceShading(createEarthShading({ body, textures, shared, atmosphere, waves }));
    const low = ctx.quality.preset === 'potato' || ctx.quality.preset === 'low';
    ctx.registry.addRenderable(
      createCloudShell({
        body,
        shared,
        textures: textures.uniforms,
        atmosphere,
        exposure: ctx.render.uniforms.uExposure,
        segments: low ? 32 : 64,
      }),
    );
    ctx.registry.addBookmarks(buildEarthBookmarks(body.radius, NIGHT_JD));
    release = () => {
      textures.dispose();
      waves.dispose();
    };
  },
  dispose() {
    release?.();
    release = null;
  },
};

export default earth;
