/**
 * starsystems (P4-C): constellation figures in true 3D, star promotion (Float64 frame + Body + photosphere
 * for named stars within 0.5 pc of the camera) and the alpha Cen / Proxima / Sirius systems with orbits.
 * Proper motion lives in the stars vertex shader (stars module).
 */
import type { ModuleContext, UniverseModule } from '../../core/contracts';
import { starCatalog } from '../stars/public';
import { constellationBookmarks, LINE_BOOKMARKS } from './bookmarks';
import {
  CONSTELLATIONS_PATH,
  constellationInfo,
  constellationSearch,
  createConstellationLabels,
  createConstellationLines,
  type ConstellationsFile,
} from './constellations';
import { Promoter } from './promotion';
import { CONSTELLATIONS_SETTING, resolveStarSystems, STARSYSTEMS_MODULE_ID } from './public';

const isEditable = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/** Initial bookmark id from ?b= or #b= (lines switch on for the constellation bookmarks). */
function initialBookmark(ctx: ModuleContext): string | null {
  const params = ctx.env.params as URLSearchParams;
  const q = params.get('b');
  if (q) return q;
  const hash = typeof location !== 'undefined' ? /[#&]b=([^&]+)/.exec(location.hash) : null;
  return hash ? decodeURIComponent(hash[1]) : null;
}

const starsystems: UniverseModule = {
  id: STARSYSTEMS_MODULE_ID,
  dependsOn: ['stars', 'sun'],
  async init(ctx) {
    const { registry, render, ui } = ctx;
    const cat = await starCatalog();
    const file = await ctx.assets.json<ConstellationsFile>(CONSTELLATIONS_PATH);

    const lines = createConstellationLines(cat, file);
    registry.addRenderable(lines);
    let on = false;
    registry.addSetting({
      id: CONSTELLATIONS_SETTING,
      label: 'Constellation lines (Shift+C)',
      group: 'Sky',
      type: 'boolean',
      default: false,
      persist: true,
      onChange: (v) => {
        on = v === true;
        lines.visible = on;
      },
    });
    const override = (ctx.env.params as URLSearchParams).get(CONSTELLATIONS_SETTING);
    if (override !== null) ui.settings.set(CONSTELLATIONS_SETTING, override !== '0' && override !== 'false');
    else if (LINE_BOOKMARKS.includes(initialBookmark(ctx) ?? ''))
      ui.settings.set(CONSTELLATIONS_SETTING, true);
    // 'C' alone moves the camera down in free flight, so the toggle is Shift+C.
    if (typeof window !== 'undefined')
      window.addEventListener('keydown', (e) => {
        if (e.code !== 'KeyC' || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target))
          return;
        ui.settings.set(CONSTELLATIONS_SETTING, !on);
      });
    ui.addLabelSource(createConstellationLabels(cat, file, () => on));
    const search = constellationSearch(cat, file);
    registry.addSearch({ id: 'starsystems.constellations', entries: () => search });

    const promoter = new Promoter(cat, ctx.frames, registry, render.uniforms);
    registry.addRenderable(promoter.sprites);
    render.onBeforeFrame((view) => promoter.update(view));
    registry.addInfo({ id: 'starsystems', info: (id) => constellationInfo(file, id) ?? promoter.info(id) });
    registry.addBookmarks(constellationBookmarks(cat, file));

    resolveStarSystems({
      promoteStar: (index, owner) => promoter.promoteIndex(index, owner),
      promoteCustom: (star, owner) => promoter.promoteCustom(star, owner),
      release: (owner) => promoter.release(owner),
      starPositionPc: (index, years, out) => {
        const g = promoter.groupForIndex(index);
        return g ? g.centerPc(years, out) : cat.positionPc(index, years, out);
      },
    });
  },
};

export default starsystems;
