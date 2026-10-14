/**
 * milkyway (P4-A): the Galaxy as a ray-marched GalaxyModel (outside view and re-baked sky cube,
 * crossfaded with the stars panorama near the Sun), globular clusters as King-profile point clouds,
 * a "You are here" marker and bookmarks 'mw-outside-100kpc', 'mw-edge-on', 'mw-band-from-earth'.
 */
import type { UniverseModule } from '../../core/contracts';
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
import { createMarkerLabels, createYouAreHere } from './marker';

const GLOBULARS_JSON = 'data/milkyway/globulars.json';

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
