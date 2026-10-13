/**
 * solar-system (P1-C): frames, bodies, sphere surfaces, default shading, Sun v1, photometric
 * points, orbit lines, Saturn's rings v1, bookmarks, search and info for the Sun, planets,
 * dwarf planets and 26 moons from data/solar-system/bodies.json.
 */
import type { ModuleContext, UniverseModule } from '../../core/contracts';
import { buildBookmarks, SUNVIEW_BODIES } from './bookmarks';
import { BODIES_PATH, texturePath, type BodiesFile, type BodyRow } from './data';
import { SolarEphemeris } from './ephemeris';
import { infoCard, searchEntries } from './facts';
import { bodyFromRow, buildFrameDefs } from './frames';
import { createRings, createSunGlow } from './render/extras';
import { createOrbits } from './render/orbits';
import { createPoints } from './render/points';
import { SceneState } from './render/scene-state';
import { MODULE_ID, createShading } from './render/shading';
import { createSphereProvider } from './render/sphere';

/** Candidate shadow casters for each body: its parent (unless the Sun), siblings and moons. */
export function occluderCandidates(rows: readonly BodyRow[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of rows) {
    if (r.id === 'sun') {
      out.set(r.id, []);
      continue;
    }
    const list: string[] = [];
    if (r.parent && r.parent !== 'sun') {
      list.push(r.parent);
      for (const s of rows) if (s.parent === r.parent && s.id !== r.id) list.push(s.id);
    }
    for (const c of rows) if (c.parent === r.id) list.push(c.id);
    out.set(r.id, list);
  }
  return out;
}

let unsubscribe: (() => void) | null = null;

const solarSystem: UniverseModule = {
  id: MODULE_ID,
  async init(ctx: ModuleContext) {
    const file = await ctx.assets.json<BodiesFile>(BODIES_PATH);
    const rows = file.bodies;
    const rowsById = new Map(rows.map((r) => [r.id, r]));
    const eph = new SolarEphemeris(rows);
    const { registry, render } = ctx;

    for (const f of buildFrameDefs(eph, SUNVIEW_BODIES)) registry.addFrame(f);
    const bodies = rows.map((r) => bodyFromRow(r, eph, rowsById));
    for (const b of bodies) registry.addBody(b);

    const scene = new SceneState(bodies);
    unsubscribe = render.onBeforeFrame((view) => scene.update(view));

    const tints = new Map<string, [number, number, number]>();
    for (const row of rows) {
      registry.setSurfaceShading(
        createShading(row, {
          assets: ctx.assets,
          quality: ctx.quality,
          scene,
          onTint: (id, rgb) => tints.set(id, rgb),
        }),
      );
    }
    const occ = occluderCandidates(rows);
    registry.setSurfaceGeometry(
      createSphereProvider({
        scene,
        registry,
        exposure: render.uniforms.uExposure,
        occluderCandidates: (id) => occ.get(id) ?? [],
        segments: () => (ctx.quality.preset === 'potato' || ctx.quality.preset === 'low' ? 32 : 48),
      }),
    );

    registry.addRenderable(createPoints(scene, render.uniforms.uExposure, tints));
    registry.addRenderable(createOrbits(eph, scene));
    registry.addRenderable(createSunGlow(scene, render.uniforms.uExposure));
    const saturn = rowsById.get('saturn');
    const saturnBody = bodies.find((b) => b.id === 'saturn');
    if (saturn?.rings && saturnBody) {
      const ringTex = texturePath(saturn.textures?.ring, ctx.quality.knobs.maxTextureSize);
      registry.addRenderable(
        createRings(saturnBody, saturn.rings, ringTex, scene, render.uniforms.uExposure, ctx.assets),
      );
    }

    registry.addBookmarks(buildBookmarks(eph, ctx.clock.jd));
    const entries = searchEntries(rows);
    registry.addSearch({ id: MODULE_ID, entries: () => entries });
    registry.addInfo({
      id: MODULE_ID,
      info: (id) => {
        const row = rowsById.get(id);
        return row ? infoCard(row, eph, rowsById, ctx.clock.jd) : null;
      },
    });
  },
  dispose() {
    unsubscribe?.();
    unsubscribe = null;
  },
};

export default solarSystem;
