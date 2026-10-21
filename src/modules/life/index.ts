/**
 * life: plants, animals and people of the clock's era at Earth's ground (docs/modules/life.md). Below
 * 3 km above the ground it fills the scene around the camera from the paleo climate map (biomes), an
 * era table of plants (flora.json), species ranges (species.json: fossil finds from the Paleobiology
 * Database, hand-entered regions for hominins and living animals) and the towns of the cities module
 * (era-styled buildings, townsfolk, livestock). Models are procedural low-poly (kit/), drawn instanced;
 * everything is approximate and labelled so. The system (models, data, shaders) loads as its own chunk
 * the first time the camera nears Earth's ground.
 */
import { Group } from 'three';
import type { ModuleContext, UniverseModule, ValidityRange } from '../../core/contracts';
import { jdFromYearsBP, yearsBeforePresent } from '../../core/geotime';
import { JD_J2000 } from '../../core/units';
import { buildLifeBookmarks } from './bookmarks';
import { ACTIVE_ALTITUDE_M, LIFE_MODULE_ID } from './constants';
import type { LifeSystem } from './system';

export const LIFE_VALIDITY: ValidityRange = {
  id: 'life.species',
  appliesTo: 'life',
  model: 'plants and animals by era and fossil range (approximate)',
  jdMin: jdFromYearsBP(470e6),
  jdMax: JD_J2000 + 1e9 * 365.25,
  beyond: 'hidden',
  source:
    'Paleobiology Database occurrences (CC BY 4.0) with PALEOMAP paleo-coordinates; hand-entered ranges for hominins and living animals; stylised procedural models',
};

let system: LifeSystem | null = null;
let offLabels: (() => void) | null = null;

/** The running system (tests), or null before the camera first nears the ground. */
export function lifeSystem(): LifeSystem | null {
  return system;
}

const life: UniverseModule = {
  id: LIFE_MODULE_ID,
  dependsOn: ['earth', 'paleo', 'terrain', 'atmosphere', 'cities'],
  init(ctx: ModuleContext) {
    const group = new Group();
    group.name = 'life.root';
    let loading = false;
    let hinted = ctx.env.test;
    ctx.registry.addRenderable({
      id: 'life.scene',
      layer: 'opaque',
      object: group,
      update: (view) => {
        const near = view.nearestSurface();
        // Once per session: the first trip into the past from up high says where the animals are.
        if (!hinted && yearsBeforePresent(view.jd) > 12_000 && (!near || near.altitude > ACTIVE_ALTITUDE_M)) {
          hinted = true;
          ctx.ui.toast(
            'Life of this era is on the ground: walk on Earth (G when near the surface) or open a "life" bookmark (/)',
            {
              durationMs: 8000,
            },
          );
        }
        if (system) return system.update(view);
        if (loading) return;
        if (!near || near.bodyId !== 'earth' || near.altitude > 1.5 * ACTIVE_ALTITUDE_M) return;
        loading = true;
        ctx.assets.track(
          import('./system').then((m) => {
            system = new m.LifeSystem(ctx);
            group.add(system.group);
          }),
          'life',
        );
      },
      memoryBytes: () => system?.memoryBytes() ?? 0,
      dispose: () => system?.dispose(),
    });
    ctx.registry.addValidity(LIFE_VALIDITY);
    offLabels = ctx.ui.addLabelSource({ id: 'life', labels: (_view, out) => system?.labels(out) });
    // Test hook: what the scene holds (e2e asserts species by era).
    if (ctx.env.test)
      (globalThis as { __life?: unknown }).__life = {
        shown: () => system?.shown() ?? { plants: {}, creatures: {}, buildings: {} },
        debug: () => system?.debug() ?? { loaded: false },
      };
    const earth = ctx.registry.body('earth');
    if (earth)
      ctx.registry.addBookmarks(
        buildLifeBookmarks(
          ctx.frames,
          earth.radius,
          earth.fixedFrame ?? 'earth.fixed',
          earth.oblateness ?? 0,
        ),
      );
  },
  dispose() {
    offLabels?.();
    offLabels = null;
    system = null;
  },
};

export default life;
