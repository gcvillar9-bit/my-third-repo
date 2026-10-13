/**
 * terrain (P2-A): cube-sphere quadtree terrain (SurfaceGeometryProvider 'terrain', priority 10,
 * below 3 R), worker patch generation from HeightSource modules (default 'fbm-craters-lite'), the
 * mesh-identical GroundProvider used by collision and walk mode, and the Moon surface bookmarks.
 */
import type { ModuleContext, UniverseModule } from '../../core/contracts';
import { terrainBookmarks } from './bookmarks';
import { MAX_LEVEL } from './cube';
import { groundRadius } from './ground';
import { setActiveSystem } from './public';
import { TerrainSystem } from './system';

let cleanup: (() => void)[] = [];

const terrain: UniverseModule = {
  id: 'terrain',
  dependsOn: ['solar-system'],
  async init(ctx: ModuleContext) {
    const { registry, camera } = ctx;
    const sys = new TerrainSystem({
      registry,
      hasFrame: (id) => ctx.frames.has(id),
      assets: ctx.assets,
      workers: ctx.workers,
      budget: ctx.budget,
      exposure: ctx.render.uniforms.uExposure,
      baseUrl: ctx.env.baseUrl,
      seed: ctx.env.seed,
      test: ctx.env.test,
      onError: (msg) => console.warn(`[terrain] ${msg}`),
    });
    setActiveSystem(sys);
    registry.setSurfaceGeometry(sys.provider());
    cleanup.push(camera.addGroundProvider(sys.ground()));
    cleanup.push(registry.subscribe((kind) => kind === 'height' && sys.refreshSpecs()));

    const moon = registry.body('moon');
    if (moon) {
      await sys.loadFunction(moon);
      const fn = sys.manager(moon)?.fn;
      if (fn) {
        const a = moon.radius;
        const c = a * (1 - (moon.oblateness ?? 0));
        const ground = (d: { x: number; y: number; z: number }) => groundRadius(fn, a, c, d, MAX_LEVEL);
        registry.addBookmarks(terrainBookmarks(ctx.frames, moon, ground, ctx.env.test));
      }
    }

    let last = camera.mode;
    cleanup.push(
      camera.subscribe(() => {
        const m = camera.mode;
        if (m === last) return;
        if (m === 'walk') ctx.ui.toast('Walking: W A S D to move, Shift to run, Space to jump, G to fly again');
        else if (last === 'walk') ctx.ui.toast('Flying');
        last = m;
      }),
    );
    cleanup.push(() => sys.dispose());
  },
  dispose() {
    for (const f of cleanup) f();
    cleanup = [];
    setActiveSystem(null);
  },
};

export default terrain;
