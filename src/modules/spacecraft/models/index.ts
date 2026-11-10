/**
 * Model catalogue: one builder per craft.json `model` id. Loaded with the render chunk only.
 */
import type { ModelId } from '../data';
import { buildIss } from './iss';
import type { CraftModel } from './kit';
import { buildNewHorizons, buildPioneer, buildVoyager } from './probes';
import { buildHubble, buildJwst } from './telescopes';

export const MODEL_BUILDERS: Record<ModelId, () => CraftModel> = {
  iss: buildIss,
  hubble: buildHubble,
  jwst: buildJwst,
  voyager: buildVoyager,
  newhorizons: buildNewHorizons,
  pioneer: buildPioneer,
};

export type { CraftModel, MeshData, ModelPart } from './kit';
