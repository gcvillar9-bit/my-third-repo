/**
 * comets: famous comets as real objects (docs/modules/comets.md). Each row of data/comets/comets.json gets
 * a Float64 frame on a two-body orbit, a Body of kind 'comet', a procedural nucleus, a coma, a straight ion
 * tail and a curved dust tail whose brightness and size follow the distance from the Sun, a photometric
 * point when unresolved, an orbit line, a label while active, search entries, an info card and bookmarks.
 */
import {
  SSB_FRAME,
  type FrameId,
  type ModuleContext,
  type UniverseModule,
  type Vec3d,
} from '../../core/contracts';
import { vec3 } from '../../core/math64';
import { AU, G } from '../../core/units';
import { buildBookmarks } from './bookmarks';
import { COMETS_MODULE_ID, COMETS_PATH, type CometRow, type CometsFile } from './data';
import { infoCard, searchEntries } from './facts';
import { CometOrbit } from './orbit';
import { CometScene, type Comet } from './scene';

/** Camera anchoring radius of a comet, m: a few tens of coma radii, so coma-scale views travel with it. */
export const COMET_INFLUENCE_RADIUS = 2e9;
/** Years around the element epochs within which the orbits count as valid. */
export const VALIDITY_MARGIN_YEARS = 15;
export const ENABLED_SETTING = 'comets.enabled';
/** The app-wide orbit-lines switch registered by solar-system (absent on older bases: counts as on). */
export const ORBIT_LINES_SETTING = 'solar-system.orbits';

export function makeComet(row: CometRow, hasSun = true): Comet {
  const center: FrameId = row.elements.center === 'sun' && hasSun ? 'sun' : SSB_FRAME;
  return {
    row,
    orbit: new CometOrbit(row.elements),
    center,
    body: {
      id: row.id,
      name: row.name,
      kind: 'comet',
      frame: row.id,
      parent: 'sun',
      radius: row.physical.radiusKm * 1e3,
      gm: row.physical.massKg ? G * row.physical.massKg : undefined,
      influenceRadius: COMET_INFLUENCE_RADIUS,
      albedo: row.physical.albedo,
      simulated: true,
    },
  };
}

let unsubscribe: (() => void)[] = [];

const comets: UniverseModule = {
  id: COMETS_MODULE_ID,
  dependsOn: ['solar-system'],
  async init(ctx: ModuleContext) {
    const { registry, render, frames, clock } = ctx;
    const file = await ctx.assets.json<CometsFile>(COMETS_PATH);
    const list = file.comets.map((row) => makeComet(row, frames.has('sun')));
    const byId = new Map(list.map((c) => [c.row.id, c]));
    for (const c of list) {
      const orbit = c.orbit;
      registry.addFrame({
        id: c.body.frame,
        parent: c.center,
        influenceRadius: COMET_INFLUENCE_RADIUS,
        positionAt: (jd, out) => orbit.positionAt(jd, out),
      });
      registry.addBody(c.body);
    }

    const scene = new CometScene(list, file.display);
    unsubscribe.push(render.onBeforeFrame((view) => scene.update(view)));

    const epochs = list.map((c) => c.row.elements.epoch);
    registry.addValidity({
      id: 'comets.orbits',
      appliesTo: 'comets',
      model: 'two-body Kepler orbits',
      jdMin: Math.min(...epochs) - VALIDITY_MARGIN_YEARS * 365.25,
      jdMax: Math.max(...epochs) + VALIDITY_MARGIN_YEARS * 365.25,
      beyond: 'approximate',
      source:
        'Osculating elements near each apparition (Celestia comets.ssc / JPL, Stellarium); planetary ' +
        'perturbations and outgassing make comet orbits approximate away from their epoch',
    });

    const relative = (from: FrameId, id: string, jd: number, out: Vec3d): Vec3d | null =>
      frames.has(from) && frames.has(id) ? frames.relative(from, id, jd, out) : null;
    registry.addBookmarks(buildBookmarks(list, (id, jd) => relative('earth', id, jd, vec3())));
    const entries = searchEntries(file.comets);
    registry.addSearch({ id: COMETS_MODULE_ID, entries: () => entries });
    registry.addInfo({
      id: COMETS_MODULE_ID,
      info: (id) => {
        const c = byId.get(id);
        if (!c) return null;
        return infoCard(c.row, c.orbit, {
          jd: clock.jd,
          display: file.display,
          fromSun: (cid, jd, out) => relative('sun', cid, jd, out),
          fromEarth: (cid, jd, out) => relative('earth', cid, jd, out),
        });
      },
    });

    // Bodies of kind 'comet' are labelled automatically only within 3000 radii; an active comet deserves
    // its name from across the inner Solar System and in the sky.
    unsubscribe.push(
      ctx.ui.addLabelSource({
        id: COMETS_MODULE_ID,
        labels(view, out) {
          if (!scene.enabled || scene.frameIndex !== view.frameIndex) return;
          for (const v of scene.views) {
            if (!(v.activity > 0) || !(v.magnitude < 9 || v.dist < 3 * AU)) continue;
            out.push({
              id: v.comet.row.id,
              text: v.comet.row.short,
              frame: v.comet.body.frame,
              local: vec3(),
              priority: 52 + Math.min(20, Math.max(0, 8 - v.magnitude)),
              radius: v.comet.body.radius,
              target: v.comet.row.id,
            });
          }
        },
      }),
    );

    registry.addSetting({
      id: ENABLED_SETTING,
      label: 'Comets',
      group: 'Sky',
      type: 'boolean',
      default: true,
      persist: true,
      description: 'Famous comets with their comas, tails and orbit lines.',
      onChange: (v) => void (scene.enabled = v === true),
    });

    const [{ createCometRenderables }, { createCometOrbits }] = await ctx.assets.track(
      Promise.all([import('./render'), import('./orbits')]),
      'comets.render',
    );
    const { nuclei, glow } = createCometRenderables({
      scene,
      exposure: render.uniforms.uExposure,
      nucleusLevel: () => (ctx.quality.preset === 'potato' || ctx.quality.preset === 'low' ? 3 : 4),
    });
    // Comet orbit lines follow the app's orbit-lines switch (owned by solar-system; unset counts as on).
    const orbits = createCometOrbits({
      scene,
      emphasis: () => ctx.camera.target ?? ctx.ui.selection,
      show: () => ctx.ui.settings.get(ORBIT_LINES_SETTING) !== false,
    });
    registry.addRenderable(nuclei);
    registry.addRenderable(glow);
    registry.addRenderable(orbits);
  },
  dispose() {
    for (const off of unsubscribe) off();
    unsubscribe = [];
  },
};

export default comets;
