/**
 * Application boot (P1-A): environment, renderer, frame tree, clock, registry, services, UI,
 * module discovery and init, initial view from the URL, then the rAF loop (or, under ?test=1,
 * window.__universe with manual frame stepping).
 */
import { NearestFilter } from 'three';
import { SSB_FRAME, type Bookmark, type ModuleContext, type UiContext } from '../core/contracts';
import { AssetLoaderImpl } from '../core/assets';
import { ResourceBudgetImpl } from '../core/budget';
import { addStandardFrames, FrameTreeImpl } from '../core/frames';
import { qlookRotation, quat, vec3 } from '../core/math64';
import { DYNAMIC_SCALE_BOUNDS, parseQuality, QualityStateImpl } from '../core/quality';
import { RegistryImpl } from '../core/registry';
import { SimClockImpl, STANDARD_VALIDITY } from '../core/time';
import { AU } from '../core/units';
import { WorkerPoolImpl } from '../core/workers';
import { CameraController } from '../camera/controller';
import { DynamicResolution } from '../render/dynamic-res';
import { DEFAULT_TEST_EV } from '../render/exposure';
import { EngineRenderer } from '../render/renderer';
import { mountUi } from '../ui/index';
import { discoverModules, initModules } from './discover';
import { parseEnv } from './env';
import { Loop, TEST_DT } from './loop';
import { startOnboarding } from './onboarding';
import { captureErrors, installTestApi, recordError } from './test-api';
import { instantOf, parseHash, stateFromCamera, UrlSync, type UrlState } from './url-state';
import { terrainStats } from '../modules/terrain/public';

/** Sim instant used in test mode when no ?t= is given (deterministic screenshots). */
export const TEST_DEFAULT_TIME = '2026-01-01T00:00:00Z';
/** Bookmark shown at boot when the URL names no view (registered by solar-system). */
export const DEFAULT_BOOKMARK = 'earth-dawn-400km';
/** Used when the default bookmark is missing (e.g. a build without the earth module). */
export const FALLBACK_BOOKMARK = 'earth-now';

export interface Engine {
  ctx: ModuleContext;
  loop: Loop;
  render: EngineRenderer;
  camera: CameraController;
  frames: FrameTreeImpl;
  registry: RegistryImpl;
}

export async function boot(): Promise<Engine | undefined> {
  const env = parseEnv(window.location.search, import.meta.env.BASE_URL, import.meta.env.DEV);
  const test = env.test;
  // ?test=1&live=1: the test API plus a normal session (rAF loop, mouse/keyboard input, URL sync,
  // initial view from the hash). Used by the input regression spec.
  const live = test && env.params.get('live') === '1';
  const interactive = !test || live;
  if (test || import.meta.env.DEV) captureErrors();
  const report = (msg: string) => {
    recordError(msg);
    if (!test) console.warn('[cosmos]', msg);
  };

  const container = document.getElementById('app') ?? document.body;
  const canvas = document.createElement('canvas');
  container.appendChild(canvas);

  const quality = new QualityStateImpl(parseQuality(env.params.get('q')), test);
  const budget = new ResourceBudgetImpl(() => ResourceBudgetImpl.mb(quality.knobs.gpuBudgetMB));
  const frames = new FrameTreeImpl();
  addStandardFrames(frames);

  // ?ev=<EV100> fixes the exposure in tests; ?ev=auto keeps eye adaptation on under ?test=1.
  const autoEv = env.params.get('ev') === 'auto';
  const evRaw = env.params.has('ev') && !autoEv ? Number(env.params.get('ev')) : NaN;
  const evParam = Number.isFinite(evRaw) ? evRaw : null;
  const fixedEv = test && !autoEv;
  let render: EngineRenderer;
  try {
    render = new EngineRenderer({
      tileCount: () => terrainStats().tiles,
      canvas,
      test,
      quality,
      budget,
      onError: report,
      fixedExposure: fixedEv,
      initialEv: evParam ?? DEFAULT_TEST_EV,
    });
  } catch (e) {
    container.textContent = 'Cosmos needs WebGL2, which this browser does not provide.';
    throw e;
  }

  const registry = new RegistryImpl(frames, {
    renderableAdded: (r) => render.addRenderable(r),
    renderableRemoved: (r) => render.removeRenderable(r),
    screenPassAdded: (p) => render.addScreenPass(p),
    screenPassRemoved: (p) => render.removeScreenPass(p),
  });
  for (const v of STANDARD_VALIDITY) registry.addValidity(v);

  const hash = parseHash(window.location.hash);
  const explicitTime = test && !live ? instantOf(env.params.get('t') ?? undefined) : instantOf(hash.t);
  const clock = new SimClockImpl({
    jd: explicitTime ?? (test ? instantOf(TEST_DEFAULT_TIME)! : undefined),
    ranges: () => registry.validityRanges(),
  });
  let lockTime = explicitTime !== null;
  const onBookmark = (bm: Bookmark) => {
    if (bm.jd !== undefined && !lockTime) {
      if (bm.jd === 'now') {
        if (!test) clock.setNow();
      } else clock.setTime(bm.jd);
    }
    if (bm.rate !== undefined) clock.setRate(bm.rate);
    if (fixedEv) render.exposure.setFixedEV(evParam ?? bm.ev ?? DEFAULT_TEST_EV);
  };

  const assets = new AssetLoaderImpl(env.baseUrl, budget);
  const workers = new WorkerPoolImpl();
  const camera = new CameraController({ frames, registry, jd: () => clock.jd, onBookmark });
  const uiCtx: UiContext = { frames, clock, registry, render, assets, workers, quality, camera, budget, env };
  const ui = mountUi(document.getElementById('ui') ?? document.body, uiCtx);
  const ctx: ModuleContext = { ...uiCtx, registry, ui };

  // Engine-owned GPU memory.
  const engineEntry = budget.alloc('engine', 'targets', 0);
  const resize = () => {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    render.resize(w, h);
    camera.setViewportHeight(h);
    engineEntry.resize(render.engineBytes());
  };
  resize();
  window.addEventListener('resize', resize);

  assets
    .texture('data/render/bluenoise64.png', {
      colorSpace: 'linear',
      wrap: 'repeat',
      mipmaps: false,
      owner: 'engine',
    })
    .then((tex) => {
      tex.minFilter = tex.magFilter = NearestFilter;
      tex.needsUpdate = true;
      render.uniforms.uBlueNoise.value = tex;
    })
    .catch((e: unknown) => report(`blue noise: ${e instanceof Error ? e.message : String(e)}`));

  try {
    const mods = discoverModules();
    await initModules(mods, ctx, (id, e) =>
      report(`module ${id}: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`),
    );
  } catch (e) {
    report(`discovery: ${e instanceof Error ? e.message : String(e)}`);
  }

  const applyUrlState = async (s: UrlState): Promise<boolean> => {
    if (s.t && interactive) {
      const jd = instantOf(s.t);
      if (jd !== null) clock.setTime(jd);
    }
    const bm = s.b ? registry.bookmark(s.b) : undefined;
    if (bm) return camera.goto(bm, { instant: true });
    if (s.f && s.p && frames.has(s.f)) {
      camera.setState({ frame: s.f, local: s.p, quat: s.q ?? quat() });
      return true;
    }
    return false;
  };

  // Initial view: ?b= (tests) > #b= / #f=&p=&q= > default bookmark > overview of the ssb.
  const initial: UrlState =
    test && !(live && !env.params.get('b')) ? { b: env.params.get('b') ?? undefined } : hash;
  if (!(await applyUrlState(initial))) {
    const def = registry.bookmark(DEFAULT_BOOKMARK) ?? registry.bookmark(FALLBACK_BOOKMARK);
    if (def) await camera.goto(def, { instant: true });
    else {
      const p = vec3(0, -3 * AU, 1 * AU);
      camera.setState({
        frame: SSB_FRAME,
        local: p,
        quat: qlookRotation(quat(), vec3(0, 3, -1), vec3(0, 0, 1)),
      });
    }
  }
  lockTime = false;
  if (fixedEv) render.exposure.setFixedEV(render.exposure.ev);

  const urlSync = interactive
    ? new UrlSync(
        () => stateFromCamera(camera.getState(), clock.jd),
        (s) => void applyUrlState(s),
      )
    : null;
  // The applied #b= (or #f=) hash is replaced by the live view at once, so a later hashchange,
  // reload or history step never re-applies the stale bookmark (owner bug: view snapped back).
  urlSync?.commit();

  // Dynamic resolution (real sessions only; QualityState pins the scale to 1 under ?test=1).
  const dyn = new DynamicResolution({}, 1);
  let dynOn = !test;
  let dynPreset = quality.preset;
  const dynBounds = () => {
    const [lo, hi] = DYNAMIC_SCALE_BOUNDS[quality.preset];
    dyn.setBounds(lo, hi);
  };
  dynBounds();
  quality.subscribe(() => {
    if (quality.preset === dynPreset) return;
    dynPreset = quality.preset;
    dynBounds();
    dyn.reset(1);
    quality.setDynamicScale(1);
  });
  registry.addSetting({
    id: 'render.dynamicResolution',
    label: 'Dynamic resolution',
    group: 'Performance',
    type: 'boolean',
    default: true,
    persist: true,
    description: 'Lowers the render resolution (down to half) when the frame rate drops below ~55 fps.',
    onChange: (v) => {
      dynOn = v === true && !test;
      dyn.reset(1);
      quality.setDynamicScale(1);
    },
  });
  let lastFrameMs = 0;
  const tickDynamic = (ms: number) => {
    const dt = lastFrameMs ? ms - lastFrameMs : 0;
    lastFrameMs = ms;
    if (!dynOn) return;
    const s = dyn.sample(dt);
    if (s !== null) quality.setDynamicScale(s);
  };
  let perfUpdate: (() => void) | null = null;
  const loop = new Loop({
    frames,
    clock,
    registry,
    camera,
    render,
    quality,
    test,
    onError: report,
    afterFrame: (ms) => {
      urlSync?.tick(ms);
      tickDynamic(ms);
      perfUpdate?.();
    },
  });

  if (test || import.meta.env.DEV) {
    installTestApi({
      renderer: render.renderer,
      renderFrame: () => loop.frame(TEST_DT),
      ready: async () => {
        await assets.whenIdle();
        for (let i = 0; i < 600 && workers.pending() > 0; i++) await new Promise((r) => setTimeout(r, 50));
        await assets.whenIdle();
      },
      goto: async (id) => {
        const bm = registry.bookmark(id);
        if (!bm) throw new Error(`unknown bookmark '${id}'`);
        await camera.goto(bm, { instant: true });
      },
      setTime: (iso) => clock.setTime(iso),
      stats: () => render.stats(),
      work: () => render.workStats(),
      camera: () => ({
        ...camera.getState(),
        mode: camera.mode,
        traveling: camera.traveling,
        altitude: camera.nearestSurface()?.altitude ?? null,
      }),
      resolution: () => ({ ...render.size, dynamicScale: quality.dynamicScale }),
      compileAll: async () => {
        await render.compileAll();
        return render.stats().programs;
      },
    });
  }

  if (!interactive) {
    loop.frame(TEST_DT);
  } else {
    camera.attach(canvas);
    loop.start();
    startOnboarding(ui, env);
    if (env.perf) {
      import('stats-gl')
        .then(({ default: Stats }) => {
          const s = new Stats({ trackGPU: false });
          s.init(render.renderer);
          document.body.appendChild(s.dom);
          // Dynamic-resolution readout under the graphs (scale, buffer size, mean frame time).
          const info = document.createElement('div');
          info.className = 'cz-perf-res';
          info.style.cssText =
            'position:fixed;left:0;top:48px;z-index:10000;font:11px/1.3 monospace;color:#9fe;' +
            'background:rgba(0,0,0,0.6);padding:2px 5px;pointer-events:none';
          document.body.appendChild(info);
          let n = 0;
          perfUpdate = () => {
            s.update();
            if (n++ % 15) return;
            const ms = dyn.meanMs;
            info.textContent =
              `res ${quality.dynamicScale.toFixed(2)}x ${dynOn ? 'auto' : 'fixed'} ` +
              `${render.size.width}x${render.size.height}` +
              (ms ? ` ${(1000 / ms).toFixed(0)} fps` : '');
          };
        })
        .catch((e: unknown) => report(`perf overlay: ${String(e)}`));
    }
  }
  return { ctx, loop, render, camera, frames, registry };
}
