/**
 * The Milky Way atlas: real, named structures of the Galaxy at their measured positions, each
 * with a search entry and a sourced info card. Loaded after startup by a dynamic import.
 *
 * Light and guides. Objects that emit visible light are drawn as light (points.ts). Objects that
 * are invisible to the eye or are concepts are drawn as guides (guide-render.ts, labels.ts),
 * switched by guides.ts. Measured values live in public/data/milkyway/atlas/ (built by
 * tools/build-milkyway.mjs, a source on every value); simulated styling lives in looks.json.
 */
import type { ModuleContext, Renderable } from '../../../core/contracts';
import { hideGalaxies } from '../../galaxies/public';
import type { AtlasState } from '../guides';
import { Atlas, loadAtlas } from './catalog';
import { createLines, createMarkers, createShells } from './guide-render';
import { createAtlasLabels } from './labels';
import {
  addCepheids,
  addClusterStars,
  addPopulation,
  createStarPoints,
  decodeClusterStars,
  PointBuilder,
  POPULATION_SCALE,
  satellitePopulations,
  STARS_PER_CLUSTER,
} from './points';
import { centrePopulations } from './centre';
import { createAtlasInfo, createAtlasSearch } from './providers';
import { satelliteMatcher } from './satellites';

export interface AtlasHandle {
  atlas: Atlas;
  renderables: Renderable[];
}

export async function createAtlas(ctx: ModuleContext, state: AtlasState): Promise<AtlasHandle> {
  const { assets, registry, ui, quality } = ctx;
  const [atlas, starsBuf] = await Promise.all([
    loadAtlas((p) => assets.json(p)),
    assets.binary('data/milkyway/atlas/cluster-stars.bin').catch(() => null),
  ]);
  const renderables: Renderable[] = [];

  // Light.
  const b = new PointBuilder();
  if (starsBuf) addClusterStars(b, atlas, decodeClusterStars(starsBuf), STARS_PER_CLUSTER[quality.preset]);
  addCepheids(b, atlas);
  const scale = POPULATION_SCALE[quality.preset];
  let seed = 100;
  const satellites = satellitePopulations(atlas, scale);
  for (const p of satellites) addPopulation(b, p, seed++);
  // These satellites are now star clouds here: hide their generic impostors in the galaxies module.
  if (satellites.length) hideGalaxies(satelliteMatcher(satellites));
  for (const p of centrePopulations(atlas, scale)) addPopulation(b, p, seed++);
  if (b.count) renderables.push(createStarPoints(b, state));

  // Guides.
  const markers = createMarkers(atlas, state);
  if (markers) renderables.push(markers);
  const lines = createLines(atlas, state);
  if (lines) renderables.push(lines);
  renderables.push(...createShells(atlas, state));

  for (const r of renderables) registry.addRenderable(r);
  ui.addLabelSource(createAtlasLabels(atlas, state));
  registry.addSearch(createAtlasSearch(atlas));
  registry.addInfo(createAtlasInfo(atlas));
  return { atlas, renderables };
}
