/**
 * galaxies (P5-A): the Celestia galaxy catalogue (10,936 galaxies, Milky Way excluded) as photometric
 * RTE points plus oriented morphology impostors (one draw each), the ten named galaxies' search entries,
 * info cards and labels, and bookmarks 'm31-approach', 'local-group' and 'virgo-cluster'.
 */
import type { UniverseModule } from '../../core/contracts';
import { decodeGalaxies } from './format';
import { bakeMorphAtlas } from './morph';
import { createNamedInfo, createNamedLabels, createNamedSearch, galaxyBookmarks } from './named';
import { createGalaxyLayer, type GalaxyLayer } from './renderables';

export const GALAXIES_BIN = 'data/galaxies/galaxies.bin';

const galaxiesModule: UniverseModule = {
  id: 'galaxies',
  init(ctx) {
    const { registry, ui, quality } = ctx;
    let on = true;
    let layer: GalaxyLayer | null = null;
    registry.addBookmarks(galaxyBookmarks());
    registry.addSearch(createNamedSearch());
    registry.addInfo(createNamedInfo());
    ui.addLabelSource(createNamedLabels(() => on));
    void ctx.assets
      .track(ctx.assets.binary(GALAXIES_BIN), 'galaxies.catalogue')
      .then((buf) => {
        const atlas = bakeMorphAtlas(quality.preset === 'potato' ? 64 : 128);
        layer = createGalaxyLayer(decodeGalaxies(buf), atlas);
        layer.visible = on;
        registry.addRenderable(layer);
      })
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
      },
    });
  },
};

export default galaxiesModule;
