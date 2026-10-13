/**
 * rings (P3-A): Saturn's and Uranus's rings at true radii, replacing solar-system's ring v1.
 * Profiles are baked from rings.json (plus the Celestia radial strip for Saturn's fine structure),
 * lit with a single-scattering slab and a Henyey-Greenstein mix, shadowed by the planet; the ring
 * shadow on the globe is exposed to the giants module through public.ts.
 */
import type { ModuleContext, UniverseModule } from '../../core/contracts';
import { SOLAR_SYSTEM_MODULE_ID } from '../solar-system/public';
import { bakeProfile, decodePngStrip } from './model';
import { RING_BODIES, RINGS_MODULE_ID } from './public';
import { createRingRenderable } from './render';
import { disposeRingStates, ringState, updateRingFrame, uploadProfile } from './state';

/** Id of solar-system's ring v1 renderable, removed when this module draws the same rings. */
export const RING_V1_ID = (body: string): string => `solar-system.rings.${body}`;

let unsubscribe: (() => void) | null = null;

const rings: UniverseModule = {
  id: RINGS_MODULE_ID,
  dependsOn: [SOLAR_SYSTEM_MODULE_ID],
  init(ctx: ModuleContext) {
    const { registry, render, assets } = ctx;
    const active: {
      body: NonNullable<ReturnType<typeof registry.body>>;
      state: NonNullable<ReturnType<typeof ringState>>;
    }[] = [];
    for (const id of RING_BODIES) {
      const body = registry.body(id);
      const state = ringState(id);
      if (!body || !state) continue;
      if (registry.renderables().some((r) => r.id === RING_V1_ID(id)))
        registry.removeRenderable(RING_V1_ID(id));
      registry.addRenderable(createRingRenderable(body, state, render.uniforms.uExposure));
      active.push({ body, state });
      const prof = state.spec.profile;
      if (prof && !state.detailed) {
        const work = assets
          .binary(prof.path)
          .then(decodePngStrip)
          .then((img) => {
            uploadProfile(state.texture, bakeProfile(state.spec, undefined, img));
            state.detailed = true;
          })
          .catch((e: unknown) => console.warn(`rings: ${id} profile kept model-only (${String(e)})`));
        void assets.track(work, `rings:${id}`);
      }
    }
    unsubscribe = render.onBeforeFrame((view) => {
      for (const a of active) updateRingFrame(a.state, view, a.body);
    });
  },
  dispose() {
    unsubscribe?.();
    unsubscribe = null;
    disposeRingStates();
  },
};

export default rings;
