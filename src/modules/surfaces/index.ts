/**
 * surfaces (P2-C): real height data and materials. Registers 'surface' HeightSourceSpecs (priority 5)
 * for the Moon, Mars and Earth (baked rasters plus procedural detail), Mercury, Callisto, Ceres,
 * Europa, Io and the icy moons and dwarfs (procedural); SurfaceShading overrides (priority 5) with
 * Lommel-Seeliger + opposition surge for airless bodies and Oren-Nayar for Mars, plus triplanar
 * detail; and the 'earth-himalaya' bookmark. See docs/modules/surfaces.md.
 */
import type { ModuleContext, UniverseModule } from '../../core/contracts';
import { requestAtmosphereLuts } from '../atmosphere/public';
import { ATMOSPHERE_BODIES } from '../solar-system/public';
import { buildHimalayaBookmark } from './bookmarks';
import { createDetailTexture } from './detail';
import { HD_SETTING_ID, HD_URL_PARAM, HdEarthTerrain } from './hd';
import { SURFACES_MODULE_ID } from './public';
import { createSurfaceShading } from './shading';
import { SURFACE_BODIES, surfaceHeightSpec } from './specs';

const SOLID_KINDS = new Set(['planet', 'dwarf', 'moon', 'minor']);

let release: (() => void) | null = null;

const surfaces: UniverseModule = {
  id: SURFACES_MODULE_ID,
  dependsOn: ['solar-system', 'atmosphere', 'terrain'],
  init(ctx: ModuleContext) {
    const { registry } = ctx;
    for (const id of SURFACE_BODIES) {
      const b = registry.body(id);
      const spec = b && surfaceHeightSpec(b);
      if (spec) registry.addHeightSource(spec);
    }

    // Optional HD Earth terrain (Terrarium tiles), off by default.
    const earthBody = registry.body('earth');
    const earthSpec = earthBody && surfaceHeightSpec(earthBody);
    let offFrame: (() => void) | null = null;
    if (earthBody && earthSpec) {
      const hd = new HdEarthTerrain({
        registry,
        assets: ctx.assets,
        ui: ctx.ui,
        body: earthBody,
        base: earthSpec,
      });
      const forced = ctx.env.params.get(HD_URL_PARAM) === '1';
      registry.addSetting({
        id: HD_SETTING_ID,
        label: 'HD Earth terrain (streamed)',
        group: 'Graphics',
        type: 'boolean',
        default: false,
        persist: true,
        description:
          'Streams AWS Terrarium elevation tiles near the camera below 300 km (falls back to the built-in relief).',
        onChange: (v) => hd.setEnabled(forced || v === true),
      });
      hd.setEnabled(forced || ctx.ui.settings.get<boolean>(HD_SETTING_ID) === true);
      offFrame = ctx.render.onBeforeFrame((view) => hd.onFrame(view));
    }

    const detail = createDetailTexture();
    for (const b of registry.bodies()) {
      if (!SOLID_KINDS.has(b.kind) || b.id === 'earth') continue;
      const mars = b.id === 'mars';
      if (!mars && ATMOSPHERE_BODIES.has(b.id)) continue;
      const base = registry.surfaceShading(b.id);
      if (!base || base.priority >= 5) continue; // only wrap the default shading
      if (mars) requestAtmosphereLuts('mars');
      registry.setSurfaceShading(
        createSurfaceShading({ bodyId: b.id, base, detail, radius: b.radius, mars }),
      );
    }

    const earth = registry.body('earth');
    if (earth)
      registry.addBookmarks([
        buildHimalayaBookmark(earth.radius, earth.radius * (1 - (earth.oblateness ?? 0))),
      ]);
    release = () => {
      detail.dispose();
      offFrame?.();
    };
  },
  dispose() {
    release?.();
    release = null;
  },
};

export default surfaces;
