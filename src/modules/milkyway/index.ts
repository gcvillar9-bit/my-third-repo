/**
 * milkyway (P4-A): the Galaxy as a ray-marched GalaxyModel (outside view and re-baked sky cube,
 * crossfaded with the stars panorama near the Sun), globular clusters as King-profile point clouds,
 * a "You are here" marker and bookmarks 'mw-outside-100kpc', 'mw-edge-on', 'mw-band-from-earth'.
 */
import type { ModuleContext, UniverseModule } from '../../core/contracts';
import { atlasBookmarks, GUIDE_BOOKMARKS } from './atlas-bookmarks';
import { milkyWayBookmarks } from './bookmarks';
import { createOutsideView, createSkyView, GalaxyGpu, type GalaxyState } from './galaxy';
import {
  createGlobularInfo,
  createGlobulars,
  createGlobularSearch,
  POINTS_PER_CLUSTER,
  type GlobularFile,
  type GlobularLayer,
} from './globulars';
import { createAtlasState, type GuideMode } from './guides';
import { createMarkerLabels, createYouAreHere } from './marker';

const GLOBULARS_JSON = 'data/milkyway/globulars.json';
const GUIDES_SETTING = 'milkyway.guides';
/** Settings groups of the atlas guides (ids match looks.json `groups`). */
const GUIDE_GROUPS: readonly [string, string][] = [
  ['structure', 'Arms, bar, bulge and bubbles'],
  ['halo', 'Streams and satellite galaxies'],
  ['clusters', 'Star clusters and associations'],
  ['gas', 'Gas clouds, nebulae and remnants'],
  ['compact', 'Pulsars'],
  ['stars', 'Cepheid stars'],
];

const isEditable = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/** Initial bookmark id from ?b= or #b=. */
function initialBookmark(ctx: ModuleContext): string | null {
  const q = ctx.env.params.get('b');
  if (q) return q;
  const hash = typeof location !== 'undefined' ? /[#&]b=([^&]+)/.exec(location.hash) : null;
  return hash ? decodeURIComponent(hash[1]) : null;
}

const milkywayModule: UniverseModule = {
  id: 'milkyway',
  init(ctx) {
    const { registry, render, quality, ui } = ctx;
    const state: GalaxyState = { enabled: true, gain: 1 };
    const gpu = new GalaxyGpu(render.renderer, render.uniforms);
    registry.addRenderable(createOutsideView(gpu, render.uniforms, state));
    registry.addRenderable(createSkyView(gpu, render.uniforms, state));
    registry.addRenderable(createYouAreHere(state));
    ui.addLabelSource(createMarkerLabels(state));
    registry.addBookmarks(milkyWayBookmarks());
    registry.addBookmarks(atlasBookmarks());

    // The atlas (real named structures) loads after startup; its switches exist from the start.
    const atlasState = createAtlasState();
    registry.addSetting({
      id: GUIDES_SETTING,
      label: 'Guides: names, outlines and markers (Shift+B)',
      group: 'Milky Way atlas',
      type: 'select',
      default: 'auto',
      options: [
        { value: 'auto', label: 'Beyond 2 kpc from the Sun' },
        { value: 'on', label: 'Always' },
        { value: 'off', label: 'Never' },
      ],
      description:
        'Guides mark structures that are invisible to the eye or are names: arms, bubbles, stellar streams, gas clouds, supernova remnants and pulsars.',
      persist: true,
      onChange: (v) => void (atlasState.mode = v === 'on' || v === 'off' ? v : 'auto'),
    });
    for (const [id, label] of GUIDE_GROUPS)
      registry.addSetting({
        id: `milkyway.guides.${id}`,
        label,
        group: 'Milky Way atlas',
        type: 'boolean',
        default: true,
        persist: true,
        onChange: (v) => void (atlasState.groups[id] = v === true),
      });
    // URL overrides for deep links and tests: ?milkyway.guides.<group>=0|1.
    for (const [id] of GUIDE_GROUPS) {
      const v = ctx.env.params.get(`milkyway.guides.${id}`);
      if (v !== null) ui.settings.set(`milkyway.guides.${id}`, v !== '0' && v !== 'false');
    }
    registry.addSetting({
      id: 'milkyway.atlasLight',
      label: 'Stars of clusters, Cepheids and satellite galaxies',
      group: 'Milky Way atlas',
      type: 'boolean',
      default: true,
      persist: true,
      onChange: (v) => void (atlasState.light = v === true),
    });
    const light = ctx.env.params.get('milkyway.atlasLight');
    if (light !== null) ui.settings.set('milkyway.atlasLight', light !== '0' && light !== 'false');
    const override = ctx.env.params.get(GUIDES_SETTING);
    if (override === 'on' || override === 'off' || override === 'auto')
      ui.settings.set(GUIDES_SETTING, override);
    else if (GUIDE_BOOKMARKS.includes(initialBookmark(ctx) ?? '')) ui.settings.set(GUIDES_SETTING, 'on');
    if (typeof window !== 'undefined')
      window.addEventListener('keydown', (e) => {
        if (
          e.code !== 'KeyB' ||
          !e.shiftKey ||
          e.repeat ||
          e.ctrlKey ||
          e.metaKey ||
          e.altKey ||
          isEditable(e.target)
        )
          return;
        const next: GuideMode = atlasState.mode === 'on' ? 'off' : 'on';
        ui.settings.set(GUIDES_SETTING, next);
      });
    void ctx.assets
      .track(
        import('./atlas/index').then((m) => m.createAtlas(ctx, atlasState)),
        'milkyway.atlas',
      )
      .catch((e: unknown) => console.error('[milkyway] the atlas failed to load', e));

    let globulars: GlobularLayer | null = null;
    let globularsOn = true;
    void ctx.assets
      .track(ctx.assets.json<GlobularFile>(GLOBULARS_JSON), 'milkyway.globulars')
      .then((file) => {
        globulars = createGlobulars(file.rows, POINTS_PER_CLUSTER[quality.preset]);
        globulars.visible = globularsOn;
        registry.addRenderable(globulars);
        registry.addSearch(createGlobularSearch(file.rows));
        registry.addInfo(createGlobularInfo(file.rows));
      })
      .catch((e: unknown) => console.error('[milkyway] globular clusters failed to load', e));

    registry.addSetting({
      id: 'milkyway.galaxy',
      label: 'Galaxy model (outside view)',
      group: 'Sky',
      type: 'boolean',
      default: true,
      onChange: (v) => void (state.enabled = v === true),
    });
    registry.addSetting({
      id: 'milkyway.globulars',
      label: 'Globular clusters',
      group: 'Sky',
      type: 'boolean',
      default: true,
      onChange: (v) => {
        globularsOn = v === true;
        if (globulars) globulars.visible = globularsOn;
      },
    });
    registry.addSetting({
      id: 'milkyway.gain',
      label: 'Galaxy model brightness (stops)',
      group: 'Milky Way',
      type: 'number',
      default: 0,
      min: -4,
      max: 6,
      step: 0.25,
      debug: true,
      onChange: (v) => void (state.gain = 2 ** Number(v)),
    });
  },
};

export default milkywayModule;
