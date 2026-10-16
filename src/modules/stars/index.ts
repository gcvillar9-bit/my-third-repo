/**
 * stars (P1-D): the HYG sky. stars.bin decoded in a worker → background point sprites with
 * per-frame photometry; the Milky Way diffuse panorama in galactic orientation; named-star
 * search, info cards and labels; bookmarks 'orion-from-earth' and 'sun-from-alpha-cen'.
 */
import { transfer } from 'comlink';
import type { ModuleContext, UniverseModule, Vec3d } from '../../core/contracts';
import { vec3 } from '../../core/math64';
import { StarCatalog, type StarNames } from './catalog';
import type { StarsDecodeApi } from './decode.worker';
import { decodeStarsBin, type StarData } from './format';
import { createMilkyWay, type MilkyWayLayer } from './milkyway';
import { applyVelocityOverrides } from './overrides';
import { createStarPoints, yearsSinceJ2000 } from './points';
import {
  cameraPc,
  createInfoProvider,
  createLabelSource,
  createSearchProvider,
  starBookmarks,
} from './providers';
import { bindHideStars, bindPanoramaHole, hiddenStars, resolveCatalog } from './public';

const STARS_BIN = 'data/stars/stars.bin';
const NAMES_JSON = 'data/stars/names.json';

/** Fetches stars.bin and decodes it in a worker (main-thread fallback if workers fail). */
async function loadStarData(ctx: ModuleContext): Promise<StarData> {
  const buf = await ctx.assets.binary(STARS_BIN);
  try {
    const h = ctx.workers.pool<StarsDecodeApi>(
      'stars.decode',
      () => new Worker(new URL('./decode.worker.ts', import.meta.url), { type: 'module' }),
    );
    const copy = buf.slice(0);
    const data = await h.call('decode', transfer(copy, [copy]));
    h.terminate();
    return data;
  } catch (e) {
    console.warn('[stars] worker decode failed, decoding on the main thread', e);
    return decodeStarsBin(buf);
  }
}

const starsModule: UniverseModule = {
  id: 'stars',
  async init(ctx) {
    const { registry, render, quality, ui } = ctx;
    const namesP = ctx.assets.json<StarNames>(NAMES_JSON);
    const [data, names] = await Promise.all([ctx.assets.track(loadStarData(ctx), 'stars.decode'), namesP]);
    applyVelocityOverrides(data, names);
    const cat = new StarCatalog(data, names);

    const points = createStarPoints(data, render.uniforms, quality.knobs.pointBudget);
    registry.addRenderable(points);
    quality.subscribe((k) => points.setCount(k.pointBudget));

    let milkyWay: MilkyWayLayer | null = null;
    let milkyWayOn = true;
    let milkyWayGain = 1;
    const tier = quality.knobs.maxTextureSize >= 4096 ? '4k' : '2k';
    void ctx.assets
      .track(
        ctx.assets.texture(`textures/stars/milkyway_diffuse_${tier}.webp`, {
          colorSpace: 'srgb',
          mipmaps: true,
        }),
        'stars.milkyway',
      )
      .then((tex) => {
        milkyWay = createMilkyWay(tex, render.uniforms.uExposure);
        milkyWay.visible = milkyWayOn;
        milkyWay.gain = milkyWayGain;
        registry.addRenderable(milkyWay);
        const layer = milkyWay;
        bindPanoramaHole((h) => layer.setHole(h));
      })
      .catch((e: unknown) => console.error('[stars] Milky Way panorama failed to load', e));

    let labelsOn = true;
    registry.addSetting({
      id: 'stars.points',
      label: 'Stars',
      group: 'Sky',
      type: 'boolean',
      default: true,
      onChange: (v) => void (points.object.visible = v === true),
    });
    registry.addSetting({
      id: 'stars.milkyWay',
      label: 'Milky Way panorama',
      group: 'Sky',
      type: 'boolean',
      default: true,
      onChange: (v) => {
        milkyWayOn = v === true;
        if (milkyWay) milkyWay.visible = milkyWayOn;
      },
    });
    registry.addSetting({
      id: 'stars.labels',
      label: 'Star names',
      group: 'Sky',
      type: 'boolean',
      default: true,
      persist: true,
      onChange: (v) => void (labelsOn = v === true),
    });
    registry.addSetting({
      id: 'stars.gain',
      label: 'Star brightness (stops)',
      group: 'Stars',
      type: 'number',
      default: 0,
      min: -4,
      max: 6,
      step: 0.25,
      debug: true,
      onChange: (v) => void (points.gain = 2 ** Number(v)),
    });
    registry.addSetting({
      id: 'stars.milkyWayGain',
      label: 'Milky Way brightness (stops)',
      group: 'Stars',
      type: 'number',
      default: 0,
      min: -4,
      max: 6,
      step: 0.25,
      debug: true,
      onChange: (v) => {
        milkyWayGain = 2 ** Number(v);
        if (milkyWay) milkyWay.gain = milkyWayGain;
      },
    });

    // Latest camera position (pc from the Sun) for info cards, refreshed every frame.
    let viewer: Vec3d | null = null;
    let years = 0;
    render.onAfterFrame((view) => {
      viewer = cameraPc(view, viewer ?? vec3());
      years = yearsSinceJ2000(view.jd);
    });

    registry.addSearch(createSearchProvider(cat));
    registry.addInfo(createInfoProvider(cat, { viewerPc: () => viewer, years: () => years }));
    ui.addLabelSource(createLabelSource(cat, () => labelsOn, hiddenStars));
    bindHideStars((idx) => points.setHidden(idx));
    registry.addBookmarks(starBookmarks(cat));
    resolveCatalog(cat);
  },
};

export default starsModule;
