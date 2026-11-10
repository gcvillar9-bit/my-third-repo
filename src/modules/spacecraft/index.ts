/**
 * spacecraft: real craft you can search for and fly to (docs/modules/spacecraft.md). The ISS and
 * Hubble in low Earth orbit, Webb on its halo around the Sun-Earth L2 point, and the five probes
 * leaving the Solar System (Pioneer 10 and 11, Voyager 1 and 2, New Horizons). Each has a frame,
 * a Body of kind 'spacecraft', a procedural model to scale, a finder marker and label, a
 * trajectory line, an info card of sourced facts and search aliases. Positions are approximate in
 * stated ways and labelled so; a craft does not exist before its launch.
 *
 * This file stays small: the models, shaders and renderables load as their own chunk.
 */
import type { LabelItem, ModuleContext, UniverseModule, ViewState } from '../../core/contracts';
import { vec3 } from '../../core/math64';
import { buildBookmarks } from './bookmarks';
import { CRAFT_PATH, displayName, type CraftFile } from './data';
import { infoCard, searchEntries } from './facts';
import {
  buildFleet,
  contextBody,
  craftView,
  existsAt,
  fleetValidity,
  framesEphemeris,
  markerFade,
  MODULE_ID,
  type Craft,
  type CraftView,
} from './fleet';

/** Labels use the marker's colour. */
const LABEL_COLOR = '#8fe3d6';
/** The UI labels bodies of kind 'spacecraft' by itself within this many radii. */
const AUTO_LABEL_RADII = 3000;

let fleet: Craft[] = [];
let cleanup: (() => void)[] = [];

const spacecraft: UniverseModule = {
  id: MODULE_ID,
  dependsOn: ['solar-system'],
  async init(ctx: ModuleContext) {
    const { registry, render, clock, frames, ui } = ctx;
    const file = await ctx.assets.json<CraftFile>(CRAFT_PATH);
    const eph = framesEphemeris(frames);
    // A craft whose parent frame is missing (a build without Earth) is left out.
    fleet = buildFleet(file.craft, eph).filter((c) => c.frame.parent !== null && frames.has(c.frame.parent));
    for (const c of fleet) {
      registry.addFrame(c.frame);
      registry.addFrame(c.fixedFrame);
    }
    registry.addValidity(fleetValidity(fleet));

    let enabled = true;
    /** Registers the craft that exist at `jd` and withdraws the others (bodies and anchoring). */
    const sync = (jd: number) => {
      for (const c of fleet) {
        const want = enabled && existsAt(c, jd);
        if (want === c.active) continue;
        c.active = want;
        c.frame.influenceRadius = want ? c.row.influenceRadiusM : 0;
        if (want) registry.addBody(c.body);
        else registry.removeBody(c.body.id);
      }
    };
    registry.addSetting({
      id: 'spacecraft.enabled',
      label: 'Spacecraft',
      group: 'Sky',
      type: 'boolean',
      default: true,
      persist: true,
      description:
        'The ISS, Hubble, Webb, the Voyagers, the Pioneers and New Horizons, with markers and paths',
      onChange: (v) => {
        enabled = v !== false;
        sync(clock.jd);
      },
    });
    sync(clock.jd);
    // A jump in time (bookmark, time bar) must add or withdraw craft before the camera lands.
    cleanup.push(clock.subscribe(() => sync(clock.jd)));
    cleanup.push(render.onBeforeFrame((view) => sync(view.jd)));

    registry.addBookmarks(buildBookmarks(fleet, eph));
    const entries = searchEntries(fleet);
    registry.addSearch({ id: MODULE_ID, entries: () => entries });
    const byId = new Map(fleet.map((c) => [c.row.id, c]));
    registry.addInfo({
      id: MODULE_ID,
      info: (id) => {
        const c = byId.get(id);
        return c ? infoCard(c, clock.jd, eph) : null;
      },
    });

    // Labels where the UI's own (within 3000 radii) stop: with the marker, from far away.
    const zero = vec3();
    const sunRel = vec3();
    const earthRel = vec3();
    const cv: CraftView = { rel: vec3(), dist: 0, pxDiam: 0, weight: 0 };
    cleanup.push(
      ui.addLabelSource({
        id: MODULE_ID,
        labels(view: ViewState, out: LabelItem[]) {
          if (!enabled) return;
          view.sunToCamera(sunRel);
          const earth = frames.has('earth');
          if (earth) view.toCamera('earth', zero, earthRel);
          for (const c of fleet) {
            if (!c.active) continue;
            craftView(c, view, contextBody(c.row) === 'earth' && earth ? earthRel : sunRel, cv);
            if (cv.dist <= AUTO_LABEL_RADII * c.row.radiusM) continue;
            if (cv.weight * markerFade(cv.pxDiam) < 0.5) continue;
            out.push({
              id: c.row.id,
              text: displayName(c.row),
              frame: c.frame.id,
              local: zero,
              priority: c.row.kind === 'probe' ? 38 : 34,
              color: LABEL_COLOR,
              target: c.row.id,
            });
          }
        },
      }),
    );

    // Orbit rings and probe paths follow the Solar System's orbit-lines setting when it exists.
    const trajectories = () => ui.settings.get('solar-system.orbits') !== false;
    ctx.assets.track(
      import('./render').then((m) => {
        const deps = {
          fleet,
          exposure: render.uniforms.uExposure,
          earthRadius: registry.body('earth')?.radius ?? 6_378_137,
          hasFrame: (id: string) => frames.has(id),
          enabled: () => enabled,
          trajectories,
        };
        registry.addRenderable(m.createModels(deps));
        registry.addRenderable(m.createOverlay(deps));
      }),
      'spacecraft.render',
    );
  },
  dispose() {
    for (const off of cleanup) off();
    cleanup = [];
    fleet = [];
  },
};

export default spacecraft;
