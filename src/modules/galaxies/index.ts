/**
 * galaxies (P5-A): the Celestia galaxy catalogue (10,936 galaxies, Milky Way excluded) as photometric
 * RTE points plus oriented morphology impostors (one draw each), the 54 gallery galaxies' search
 * entries, info cards and labels, and bookmarks. The gallery galaxies are drawn as 3D portraits
 * (portrait.ts, loaded lazily after the catalogue) instead of impostors when large on screen.
 */
import type { UniverseModule } from '../../core/contracts';
import { decodeGalaxies } from './format';
import { bakeMorphAtlas } from './morph';
import { createNamedInfo, createNamedLabels, createNamedSearch, galaxyBookmarks } from './named';
import type { PortraitLayer } from './portrait';
import { portraitBookmarks } from './portrait-bookmarks';
import { createGalaxyLayer, type GalaxyLayer } from './renderables';

export const GALAXIES_BIN = 'data/galaxies/galaxies.bin';

const galaxiesModule: UniverseModule = {
  id: 'galaxies',
  init(ctx) {
    const { registry, ui, quality } = ctx;
    let on = true;
    let layer: GalaxyLayer | null = null;
    let portraits: PortraitLayer | null = null;
    registry.addBookmarks(galaxyBookmarks());
    registry.addBookmarks(portraitBookmarks());
    registry.addSearch(createNamedSearch());
    registry.addInfo(createNamedInfo());
    ui.addLabelSource(createNamedLabels(() => on));
    // Tracked as one unit so ready() also waits for the lazily loaded portrait engine.
    void ctx.assets
      .track(
        ctx.assets.binary(GALAXIES_BIN).then(async (buf) => {
          const atlas = bakeMorphAtlas(quality.preset === 'potato' ? 64 : 128);
          const data = decodeGalaxies(buf);
          const galaxyLayer = createGalaxyLayer(data, atlas);
          layer = galaxyLayer;
          galaxyLayer.visible = on;
          registry.addRenderable(galaxyLayer);
          // Portrait engine, looks.json and gallery-facts.json: off the startup path.
          const { createPortraitLayer, galleryPortraitEntries } = await import('./portrait');
          const p = createPortraitLayer(data, galleryPortraitEntries(), quality);
          portraits = p;
          p.visible = on;
          galaxyLayer.skip = (view) => p.select(view);
          registry.addRenderable(p);
        }),
        'galaxies.catalogue',
      )
      .catch((e: unknown) => console.error('[galaxies] catalogue failed to load', e));
    registry.addSetting({
      id: 'galaxies.enabled',
      label: 'Galaxies',
      group: 'Sky',
      type: 'boolean',
      default: true,
      onChange: (v) => {
        on = v === true;
        if (layer) layer.visible = on;
        if (portraits) portraits.visible = on;
      },
    });
  },
};

export default galaxiesModule;
