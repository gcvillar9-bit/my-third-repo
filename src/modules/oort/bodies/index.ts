/**
 * Bodies part of the oort module (docs/modules/oort.md): real objects on the Oort Cloud's scale
 * (four sednoids, comet Bernardinelli-Bernstein, three interstellar visitors) as frames and bodies on
 * two-body orbits with photometric points, a resolved sphere and orbit lines; the straight-line tracks of
 * two passing stars; labelled scale shells; info cards, search entries, labels and bookmarks. Shells,
 * tracks, their labels and unselected orbit lines fade with shared.lineFade, so none of it shows within
 * 200 AU of the Sun.
 */
import {
  SSB_FRAME,
  type FrameId,
  type LabelItem,
  type ModuleContext,
  type Vec3d,
} from '../../../core/contracts';
import { v3len, vec3 } from '../../../core/math64';
import { AU } from '../../../core/units';
import type { OortShared } from '../shared';
import { FLYBYS, MARKERS, OBJECTS } from './data';
import { buildBookmarks, FLYBY_BOOKMARKS } from './bookmarks';
import { flybySearchEntries, objectCard, objectSearchEntries } from './facts';
import { flybyCard, flybyFrame, flybyLabel, starMotion, type StarMotion } from './flybys';
import {
  labelPoint,
  shellAlpha,
  shellCard,
  shellInfoId,
  SHELL_LABEL_MIN_ALPHA,
  voyagerLabel,
} from './markers';
import { makeObject, objectState, ObjectScene, type OortObject } from './objects';

export const OORT_BODIES_ID = 'oort.bodies';
/** Years around the element epochs within which the two-body orbits count as valid. */
export const OBJECTS_VALIDITY_YEARS = 200;
const VOYAGERS: readonly [string, string][] = [
  ['voyager1', 'Voyager 1'],
  ['voyager2', 'Voyager 2'],
];

const css = ([r, g, b]: readonly number[]): string =>
  `rgb(${[r, g, b].map((c) => Math.round(255 * Math.min(1, Math.max(0, c)) ** (1 / 2.2))).join(', ')})`;

export async function initBodies(ctx: ModuleContext, shared: OortShared): Promise<() => void> {
  const { registry, frames, render, clock } = ctx;
  const off: (() => void)[] = [];
  const hasSun = frames.has('sun');

  // ---- objects: frames and bodies ------------------------------------------------------------------
  const objects: OortObject[] = [];
  for (const row of OBJECTS.objects) {
    if (frames.has(row.id)) continue;
    const o = makeObject(row, hasSun);
    registry.addFrame({
      id: o.body.frame,
      parent: o.center,
      influenceRadius: o.body.influenceRadius,
      positionAt: (jd, out) => objectState(o, jd, out),
    });
    registry.addBody(o.body);
    objects.push(o);
  }
  const byId = new Map(objects.map((o) => [o.row.id, o]));
  const scene = new ObjectScene(objects);
  off.push(render.onBeforeFrame((view) => scene.update(view)));

  const epochs = objects.map((o) => o.row.elements.epoch);
  if (epochs.length)
    registry.addValidity({
      id: 'oort.objects',
      appliesTo: 'oort',
      model: 'two-body orbits',
      jdMin: Math.min(...epochs) - OBJECTS_VALIDITY_YEARS * 365.25,
      jdMax: Math.max(...epochs) + OBJECTS_VALIDITY_YEARS * 365.25,
      beyond: 'approximate',
      source:
        'Hand-entered osculating elements (JPL SBDB and the papers cited on each value); planets, the ' +
        'Galactic tide and passing stars are not modelled',
    });

  // ---- passing stars: frames (no bodies: the star catalogue has them) -----------------------------
  const flybys = FLYBYS.stars
    .filter((row) => !frames.has(`flyby:${row.id}`))
    .map((row) => ({ row, motion: starMotion(row.astrometry) }));
  for (const f of flybys) registry.addFrame(flybyFrame(f.row, f.motion));
  const motions = new Map<string, StarMotion>(flybys.map((f) => [f.row.id, f.motion]));

  // ---- bookmarks, search, info ----------------------------------------------------------------------
  registry.addBookmarks(buildBookmarks(byId, motions));
  const entries = [
    ...objectSearchEntries(objects.map((o) => o.row)),
    ...flybySearchEntries(
      flybys
        .filter((f) => FLYBY_BOOKMARKS[f.row.id])
        .map((f) => ({ row: f.row, bookmark: FLYBY_BOOKMARKS[f.row.id] })),
    ),
  ];
  registry.addSearch({ id: OORT_BODIES_ID, entries: () => entries });
  const relative = (from: FrameId, id: string, jd: number, out: Vec3d): Vec3d | null =>
    frames.has(from) && frames.has(id) ? frames.relative(from, id, jd, out) : null;
  const shellsById = new Map(MARKERS.shells.map((s) => [shellInfoId(s.id), s]));
  const flybyById = new Map(flybys.map((f) => [f.row.id, f]));
  registry.addInfo({
    id: OORT_BODIES_ID,
    info: (id) => {
      const o = byId.get(id);
      if (o)
        return objectCard(o, {
          jd: clock.jd,
          fromSun: (cid, jd, out) => relative(hasSun ? 'sun' : SSB_FRAME, cid, jd, out),
          fromEarth: (cid, jd, out) => relative('earth', cid, jd, out),
        });
      const f = flybyById.get(id);
      if (f) return flybyCard(f.row, f.motion, clock.jd);
      const s = shellsById.get(id);
      return s ? shellCard(s) : null;
    },
  });

  // ---- labels -------------------------------------------------------------------------------------
  const shellColors = MARKERS.shells.map((s) => css(s.color));
  const shellPoints = MARKERS.shells.map((s, i) => labelPoint(i, s.radiusAu, vec3()));
  const tmp = vec3();
  off.push(
    ctx.ui.addLabelSource({
      id: OORT_BODIES_ID,
      labels(view, out: LabelItem[]) {
        if (shared.frameIndex !== view.frameIndex) return;
        const lf = shared.lineFade;
        if (!(lf > 0)) return;
        // Objects the registry does not label at this distance (only dwarfs are labelled from anywhere).
        if (scene.frameIndex === view.frameIndex)
          for (const v of scene.views) {
            const { body, row } = v.obj;
            if (body.kind === 'dwarf' || v.dist <= 3000 * body.radius) continue;
            out.push({
              id: row.id,
              text: row.short,
              frame: body.frame,
              local: vec3(),
              priority: 56,
              radius: body.radius,
              target: row.id,
            });
          }
        // Shells.
        MARKERS.shells.forEach((s, i) => {
          if (shellAlpha(s.radiusAu, shared.sunDistAu, lf, shared.markers) <= SHELL_LABEL_MIN_ALPHA) return;
          out.push({
            id: shellInfoId(s.id),
            text: s.label,
            frame: hasSun ? 'sun' : SSB_FRAME,
            local: shellPoints[i],
            priority: 58,
            color: shellColors[i],
          });
        });
        // Voyagers, with the shells.
        if (shared.markers)
          for (const [id, name] of VOYAGERS) {
            if (!frames.has(id) || !hasSun) continue;
            const d = v3len(frames.relative('sun', id, view.jd, tmp)) / AU;
            out.push({ id, text: voyagerLabel(name, d), frame: id, local: vec3(), priority: 57, target: id });
          }
        // Passing stars, at their closest approach.
        if (shared.orbitLines)
          for (const f of flybys)
            out.push({
              id: f.row.id,
              text: flybyLabel(f.row, f.motion, view.jd),
              frame: SSB_FRAME,
              local: f.motion.closestPoint,
              priority: 58,
              color: 'rgb(255, 214, 170)',
              target: FLYBY_BOOKMARKS[f.row.id],
            });
      },
    }),
  );

  // ---- rendering (lazy) ---------------------------------------------------------------------------
  const [{ createBodiesRenderables }, { createOrbitLines }] = await ctx.assets.track(
    Promise.all([import('./render'), import('./orbits')]),
    'oort.bodies.render',
  );
  const { points, sphere, markers } = createBodiesRenderables({
    scene,
    shared,
    shells: MARKERS.shells,
    flybys,
    trackHalfLengthAu: FLYBYS.trackHalfLengthAu,
    exposure: render.uniforms.uExposure,
  });
  const orbits = createOrbitLines({
    scene,
    shared,
    emphasis: () => ctx.camera.target ?? ctx.ui.selection,
  });
  registry.addRenderable(sphere);
  registry.addRenderable(points);
  registry.addRenderable(orbits);
  registry.addRenderable(markers);

  return () => {
    for (const f of off) f();
    off.length = 0;
  };
}
