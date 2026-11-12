/**
 * galaxies (P5-A): the Celestia galaxy catalogue (10,936 galaxies, Milky Way excluded) as photometric
 * RTE points plus oriented morphology impostors (one draw each), the ten named galaxies' search entries,
 * info cards and labels, and bookmarks 'm31-approach', 'local-group' and 'virgo-cluster'. The named
 * galaxies are drawn as 3D portraits (portrait.ts) instead of impostors, with bookmarks 'whirlpool',
 * 'sombrero', 'm87-jet' and 'inside-m31'.
 */
import type { UniverseModule } from '../../core/contracts';
import { decodeGalaxies } from './format';
import { bakeMorphAtlas } from './morph';
import { createNamedInfo, createNamedLabels, createNamedSearch, galaxyBookmarks } from './named';
import { createPortraitLayer, namedPortraitEntries, portraitIndices, type PortraitLayer } from './portrait';
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
    void ctx.assets
      .track(ctx.assets.binary(GALAXIES_BIN), 'galaxies.catalogue')
      .then((buf) => {
        const atlas = bakeMorphAtlas(quality.preset === 'potato' ? 64 : 128);
        const data = decodeGalaxies(buf);
        const entries = namedPortraitEntries();
        layer = createGalaxyLayer(data, atlas, portraitIndices(entries));
        layer.visible = on;
        registry.addRenderable(layer);
        portraits = createPortraitLayer(data, entries, quality);
        portraits.visible = on;
        registry.addRenderable(portraits);
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
        if (portraits) portraits.visible = on;
      },
    });
  },
};

export default galaxiesModule;
