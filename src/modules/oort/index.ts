/**
 * oort: the Oort Cloud (docs/modules/oort.md). Two parts share one per-frame state (shared.ts):
 * - cloud/: the simulated comet cloud as a GPU-propagated point cloud (detached disc, twisted inner cloud,
 *   isotropic outer cloud), its info card, labels and bookmarks;
 * - bodies/: real objects on its scale (sednoids, the giant Oort comet, interstellar visitors), the tracks
 *   of passing stars and the labelled scale shells.
 */
import type { ModuleContext, UniverseModule } from '../../core/contracts';
import { initBodies } from './bodies';
import { initCloud } from './cloud';
import {
  createOortShared,
  OORT_MODULE_ID,
  SETTING_BRIGHTNESS,
  SETTING_ENABLED,
  SETTING_MARKERS,
} from './shared';

let disposers: (() => void)[] = [];

const oort: UniverseModule = {
  id: OORT_MODULE_ID,
  dependsOn: ['solar-system', 'comets'],
  async init(ctx: ModuleContext) {
    const { registry } = ctx;
    const shared = createOortShared(ctx);
    disposers.push(ctx.render.onBeforeFrame((view) => shared.update(view)));
    registry.addSetting({
      id: SETTING_ENABLED,
      label: 'Oort Cloud',
      group: 'Sky',
      type: 'boolean',
      default: true,
      persist: true,
      description:
        'The simulated comet cloud around the Solar System. It appears once you fly out past 200 AU; its ' +
        'brightness is artificial, because the real cloud is far too faint to see.',
    });
    registry.addSetting({
      id: SETTING_BRIGHTNESS,
      label: 'Oort Cloud brightness',
      group: 'Sky',
      type: 'number',
      default: 1,
      min: 0,
      max: 3,
      step: 0.1,
      description: 'Visibility of the simulated cloud (1 = default, 0 = as in reality: invisible).',
    });
    registry.addSetting({
      id: SETTING_MARKERS,
      label: 'Oort Cloud scale shells',
      group: 'Sky',
      type: 'boolean',
      default: true,
      persist: true,
      description: 'Labelled distance shells from the heliopause (120 AU) out to 100,000 AU.',
    });
    disposers.push(await initCloud(ctx, shared));
    disposers.push(await initBodies(ctx, shared));
  },
  dispose() {
    for (const off of disposers) off();
    disposers = [];
  },
};

export default oort;
