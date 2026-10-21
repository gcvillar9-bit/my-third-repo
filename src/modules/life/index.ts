/**
 * life: plants and animals of the clock's era at Earth's ground (docs/modules/life.md). Below 3 km
 * above the ground it fills the scene around the camera from the paleo climate map (biomes), an era
 * table of plants (flora.json) and species ranges (species.json: fossil finds from the Paleobiology
 * Database, hand-entered regions for hominins and living animals). Models are procedural low-poly
 * (kit/), drawn instanced; everything is approximate and labelled so.
 */
import type { ModuleContext, UniverseModule, ValidityRange } from '../../core/contracts';
import { jdFromYearsBP } from '../../core/geotime';
import { JD_J2000 } from '../../core/units';
import { buildLifeBookmarks } from './bookmarks';
import { LIFE_MODULE_ID, LifeSystem } from './system';

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

/** The running system (tests). */
export function lifeSystem(): LifeSystem | null {
  return system;
}

const life: UniverseModule = {
  id: LIFE_MODULE_ID,
  dependsOn: ['earth', 'paleo', 'terrain', 'atmosphere'],
  init(ctx: ModuleContext) {
    const s = new LifeSystem(ctx);
    system = s;
    ctx.registry.addRenderable({
      id: 'life.scene',
      layer: 'opaque',
      object: s.group,
      update: (view) => s.update(view),
      memoryBytes: () => s.memoryBytes(),
      dispose: () => s.dispose(),
    });
    ctx.registry.addValidity(LIFE_VALIDITY);
    // Test hook: what the scene holds (e2e asserts species by era).
    if (ctx.env.test)
      (globalThis as { __life?: unknown }).__life = { shown: () => s.shown(), debug: () => s.debug() };
    offLabels = ctx.ui.addLabelSource({ id: 'life', labels: (_view, out) => s.labels(out) });
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
