/**
 * largescale: the Great Attractor, the Norma Cluster, the Shapley Supercluster and the Laniakea
 * supercluster. A stylised Laniakea outline and ~600-1500 streamlines of a toy velocity field converging
 * on the Great Attractor (overlay diagram, 2 draws, fades in 20-40 Mpc from the Milky Way), labels,
 * search entries and info cards, bookmarks 'great-attractor' and 'laniakea', setting 'Laniakea flows'.
 */
import type { UniverseModule } from '../../core/contracts';
import { IDS, largescaleBookmarks, largescaleInfo, largescaleLabels, largescaleSearch } from './places';
import { createLargescaleLayer } from './render';

const largescaleModule: UniverseModule = {
  id: 'largescale',
  init(ctx) {
    const { registry, ui, quality } = ctx;
    let on = true;
    const bookmarks = largescaleBookmarks();
    registry.addBookmarks(bookmarks);
    registry.addSearch({ id: 'largescale', entries: () => largescaleSearch(bookmarks) });
    registry.addInfo({
      id: 'largescale',
      info: (id) =>
        id.startsWith('ls:') && Object.values(IDS).includes(id as never) ? largescaleInfo(id) : null,
    });
    ui.addLabelSource(largescaleLabels(() => on));
    registry.addRenderable(createLargescaleLayer(quality.preset, () => on));
    registry.addSetting({
      id: 'largescale.enabled',
      label: 'Laniakea flows',
      group: 'Sky',
      type: 'boolean',
      default: true,
      onChange: (v) => void (on = v === true),
    });
  },
};

export default largescaleModule;
