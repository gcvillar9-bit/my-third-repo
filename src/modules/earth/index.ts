/**
 * earth (P2-B): hero Earth. Overrides Earth's SurfaceShading (priority 10: GGX ocean glint with
 * procedural water normals, terminator-gated city lights, Sun transmittance and cloud shadows),
 * adds a cloud shell and the 400 km / night-lights bookmarks. See docs/modules/earth.md.
 */
import type { ModuleContext, UniverseModule } from '../../core/contracts';
import { parseInstant } from '../../core/time';
import { atmosphereShadingUniforms, requestAtmosphereLuts } from '../atmosphere/public';
import { buildEarthBookmarks, buildEarthSunrise } from './bookmarks';
import { createCloudShell } from './clouds';
import { createEarthShading, createEarthUniforms } from './shading';
import { EARTH_MODULE_ID, EarthTextures } from './textures';
import { createWaterNormalTexture } from './waves';
import { HdImagery, createHdUniforms } from './hd-imagery';

/** Fixed instant of the night-lights view (Europe around 01:00 local time). */
export const NIGHT_JD = parseInstant('2026-01-01T00:00:00Z')!;
/** The sunrise demo searches from this instant (near the March equinox, so the Sun rises due east). */
export const SUNRISE_FROM_JD = parseInstant('2026-03-20T00:00:00Z')!;

let release: (() => void) | null = null;
let hd: HdImagery | null = null;

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
    // HD imagery near the ground: on from low quality up; in test mode only with ?hdimagery=1.
    const flag = ctx.env.params.get('hdimagery');
    const hdUniforms = createHdUniforms();
    hd = new HdImagery(
      {
        assets: ctx.assets,
        budget: ctx.budget,
        enabled: (view) => (ctx.env.test ? flag === '1' : flag !== '0' && view.quality !== 'potato'),
        onUnavailable: () =>
          ctx.ui.toast('HD Earth imagery unavailable; showing the base map', { kind: 'warn' }),
      },
      hdUniforms,
    );
    const hdLayer = hd;
    ctx.registry.setSurfaceShading(
      createEarthShading({
        body,
        textures,
        shared,
        atmosphere,
        waves,
        hd: { uniforms: hdUniforms, update: (view, frame) => hdLayer.update(view, frame) },
      }),
    );
    ctx.registry.addRenderable(
      createCloudShell({
        body,
        shared,
        textures: textures.uniforms,
        atmosphere,
        exposure: ctx.render.uniforms.uExposure,
        // 64 on every preset: at 32 the chord sag (~1.9 km) is a visible fraction of the 6 km layer.
        segments: 64,
      }),
    );
    ctx.registry.addBookmarks(buildEarthBookmarks(body.radius, NIGHT_JD));
    const sunrise = buildEarthSunrise(ctx.frames, body.radius, SUNRISE_FROM_JD);
    if (sunrise) ctx.registry.addBookmarks([sunrise]);
    release = () => {
      textures.dispose();
      waves.dispose();
      hd?.dispose();
      hd = null;
    };
  },
  dispose() {
    release?.();
    release = null;
  },
};

export default earth;
