/**
 * nebulae: the Orion Nebula (M42, M43 and the Trapezium) as a ray-marched 2.5D blister volume built from a
 * registered, de-starred and photometrically calibrated photograph (tools/build-nebulae.mjs), placed in the
 * `nebula:m42` frame at 400 pc. Realistic colours by default and a display-only "Astrophoto" style; the Trapezium,
 * θ² Ori A and NU Ori promoted at the nebula's distance (HYG has them at wrong distances); bookmarks, search,
 * info cards and labels. Extensible: another nebula would add its own JSON rows, build outputs and frame.
 * See docs/modules/nebulae.md.
 */
import type { Bookmark, ModuleContext, UniverseModule } from '../../core/contracts';
import { v3len, vec3 } from '../../core/math64';
import { setPanoramaHole, starCatalog } from '../stars/public';
import { starSystems } from '../starsystems/public';
import {
  ASTROPHOTO_ID,
  FROM_20LY_ID,
  INSIDE_ID,
  M43_VIEW_ID,
  nebulaBookmarks,
  STYLE_BOOKMARKS,
} from './bookmarks';
import { NEBULA_STYLES, type NebulaStyle } from './display';
import { nebulaFrame } from './frame';
import { CENTER as orionCentre, META_PATH, type NebulaMeta } from './model';
import { NEBULAE_MODULE_ID } from './public';
import { cameraLocal, createNebula, type NebulaRenderable, type NebulaState } from './render';
import { ENABLED_SETTING, STYLE_SETTING, StyleAuto } from './style';
import { customStar, findHygIndex, NEBULA_STARS, unitIcrs } from './trapezium';
import { createLabels, createSearch, info } from './ui';

/** Initial bookmark id from ?b= or #b=. */
function initialBookmark(ctx: ModuleContext): string | null {
  const q = (ctx.env.params as URLSearchParams).get('b');
  if (q) return q;
  const hash = typeof location !== 'undefined' ? /[#&]b=([^&]+)/.exec(location.hash) : null;
  return hash ? decodeURIComponent(hash[1]) : null;
}

/**
 * The Milky Way panorama holds its own blurred M42 (and its dust). While the volume is drawn, the stars module
 * replaces the panorama within PANORAMA_HOLE.innerDeg of θ¹ Ori C by a smooth membrane through a ring of taps at
 * ringDeg, fading back by outerDeg, so the calibrated nebula is not added on top of that copy (the volume's field is
 * ±0.9°).
 */
export const PANORAMA_HOLE = { innerDeg: 1.0, outerDeg: 1.4, ringDeg: 1.6 } as const;
const DEG = Math.PI / 180;

const nebulae: UniverseModule = {
  id: NEBULAE_MODULE_ID,
  dependsOn: ['stars', 'starsystems'],
  init(ctx: ModuleContext) {
    const { registry, frames, ui, render, assets } = ctx;
    registry.addFrame(nebulaFrame(frames));
    const bookmarks = nebulaBookmarks();
    registry.addBookmarks(bookmarks);
    const byId = (id: string) => bookmarks.find((b) => b.id === id)!;

    const state: NebulaState = { enabled: true, style: 'realistic', gain: 1 };
    let nebula: NebulaRenderable | null = null;
    let loaded = false;
    const centre = unitIcrs(orionCentre.raDeg, orionCentre.decDeg);
    const updateHole = () =>
      setPanoramaHole(
        state.enabled && loaded
          ? {
              dir: centre,
              inner: PANORAMA_HOLE.innerDeg * DEG,
              outer: PANORAMA_HOLE.outerDeg * DEG,
              ring: PANORAMA_HOLE.ringDeg * DEG,
              strength: 1,
            }
          : null,
      );

    registry.addSetting({
      id: ENABLED_SETTING,
      label: 'Nebulae',
      group: 'Sky',
      type: 'boolean',
      default: true,
      description: 'The Orion Nebula (M42, M43) as a 3D volume.',
      onChange: (v) => {
        state.enabled = v === true;
        updateHole();
      },
    });
    registry.addSetting({
      id: STYLE_SETTING,
      label: 'Nebula style',
      group: 'Sky',
      type: 'select',
      default: 'realistic',
      options: [
        { value: 'realistic', label: 'Realistic (true colour and brightness)' },
        { value: 'astrophoto', label: 'Astrophoto (stretched, saturated)' },
      ],
      description:
        'Realistic shows the nebula as the eye would through a perfect instrument: true emission-line colours at ' +
        'calibrated brightness. Astrophoto stretches faint light and boosts colour like a processed astro image ' +
        '(display only, not physical).',
      onChange: (v) => {
        state.style = NEBULA_STYLES.includes(v as NebulaStyle) ? (v as NebulaStyle) : 'realistic';
      },
    });
    registry.addSetting({
      id: 'nebulae.gain',
      label: 'Nebula brightness (stops)',
      group: 'Nebulae',
      type: 'number',
      default: 0,
      min: -4,
      max: 6,
      step: 0.25,
      debug: true,
      onChange: (v) => void (state.gain = 2 ** Number(v)),
    });

    registry.addSearch(
      createSearch({ m42: byId(FROM_20LY_ID), m43: byId(M43_VIEW_ID), trapezium: byId(INSIDE_ID) }),
    );
    registry.addInfo({ id: NEBULAE_MODULE_ID, info });
    ui.addLabelSource(createLabels(() => state.enabled));

    // The volume: meta first (shader constants), then the three textures.
    const load = async () => {
      const meta = await assets.json<NebulaMeta>(META_PATH);
      const linear = { colorSpace: 'linear' as const, mipmaps: true, owner: NEBULAE_MODULE_ID };
      const [emission, maps, core] = await Promise.all([
        assets.texture(meta.emission.file, linear),
        assets.texture(meta.maps.file, linear),
        meta.core ? assets.texture(meta.core.file, linear) : Promise.resolve(null),
      ]);
      nebula = createNebula(render.renderer, render.uniforms, meta, { emission, maps, core }, state);
      registry.addRenderable(nebula);
      loaded = true;
      updateHole();
    };
    void assets
      .track(load(), 'nebulae.orion')
      .catch((e: unknown) => console.error('[nebulae] volume failed to load', e));

    // The Trapezium, θ² Ori A and NU Ori at the nebula's distance (held for the whole session).
    const promote = async () => {
      const [api, cat] = await Promise.all([starSystems(), starCatalog()]);
      for (const row of NEBULA_STARS)
        api.promoteCustom(customStar(row, findHygIndex(cat, row, 3)), NEBULAE_MODULE_ID);
    };
    void assets
      .track(promote(), 'nebulae.stars')
      .catch((e: unknown) => console.error('[nebulae] star promotion failed', e));

    // Astrophoto on arrival at its bookmark, back off when leaving (style.ts).
    const auto = new StyleAuto(
      (v) => ui.settings.set(STYLE_SETTING, v),
      () => ui.settings.get<NebulaStyle>(STYLE_SETTING),
    );
    ui.settings.subscribe(STYLE_SETTING, () => auto.changed());
    const params = ctx.env.params as URLSearchParams;
    const enabled = params.get(ENABLED_SETTING);
    if (enabled !== null) ui.settings.set(ENABLED_SETTING, enabled !== '0' && enabled !== 'false');
    auto.start(params.get(STYLE_SETTING), STYLE_BOOKMARKS.includes(initialBookmark(ctx) ?? ''));
    const p = vec3();
    const atBookmark = (bm: Bookmark, frame: string, local: { x: number; y: number; z: number }): boolean => {
      if (!frames.has(bm.frame)) return false;
      frames.convertPoint(frame, local, bm.frame, ctx.clock.jd, p);
      const tol = Math.max(1e3, 1e-7 * Math.hypot(bm.pos.x, bm.pos.y, bm.pos.z));
      return Math.hypot(p.x - bm.pos.x, p.y - bm.pos.y, p.z - bm.pos.z) < tol;
    };
    ctx.camera.subscribe(() => {
      if (ctx.camera.traveling) return;
      const st = ctx.camera.getState();
      if (!frames.has(st.frame)) return;
      const atStyle = STYLE_BOOKMARKS.some((id) => {
        const bm = registry.bookmark(id);
        return !!bm && atBookmark(bm, st.frame, st.local);
      });
      const other =
        !atStyle &&
        auto.autoOn &&
        registry.bookmarks().some((bm) => bm.id !== ASTROPHOTO_ID && atBookmark(bm, st.frame, st.local));
      auto.arrived(atStyle, other);
    });
    const cam = vec3();
    render.onBeforeFrame((v) => {
      if (auto.autoOn) auto.distance(v3len(cameraLocal(v, cam)));
    });
  },
};

export default nebulae;
