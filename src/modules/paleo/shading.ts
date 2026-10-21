/**
 * The paleo wrapper of Earth's surface shading (priority 20; it wraps the earth module's priority-10
 * shading and enables its EARTH_PALEO hooks) and the per-frame controller behind it. Registered once:
 * swapping a winning shading recompiles the material, so everything changes through uniforms.
 *
 * - Modern Earth (younger than ~3.5 ka): uniforms 0, today's look unchanged.
 * - Ice ages (7 ka - 3 Ma): global sea level (index.json) exposes today's shelves (quaternary.png R,
 *   coloured from land_fill_1k.webp) and grows ice sheets (quaternary.png G) over today's imagery.
 * - Deep time (fading in 2.6 - 5 Ma): the synthetic surface baked in a worker from the two PaleoDEM
 *   maps around the date (biome.ts), re-baked when the blend moves by 1/16 of a 5 Myr step.
 *
 * Data loads lazily the first time the clock is in the past; ready() waits for it (assets.track).
 */
import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RGBAFormat,
  RGFormat,
  RedFormat,
  RepeatWrapping,
  SRGBColorSpace,
  UnsignedByteType,
  type IUniform,
  type Texture,
} from 'three';
import { decode } from 'fast-png';
import type {
  BudgetEntry,
  ModuleContext,
  SurfaceShading,
  ViewState,
  WorkerHandle,
} from '../../core/contracts';
import { yearsBeforePresent } from '../../core/geotime';
import type { PaleoBakeApi, PaleoBakeRequest } from './bake.worker';
import {
  QUATERNARY_START_YEARS,
  bracketAges,
  gmstAt,
  regimeAt,
  vegetationAt,
  type PaleoIndex,
} from './climate';
import paleoGlsl from './glsl/paleo-surface.glsl?raw';

export const PALEO_MODULE_ID = 'paleo';
/** Above the earth module's priority-10 shading. */
export const PALEO_PRIORITY = 20;
export const INDEX_PATH = 'data/paleo/index.json';
export const BAKE_W = 1024;
export const BAKE_H = 512;
/** Zonal cloud map (R8); 0.35 deg texels resolve the finest noise octave (about 1.4 deg). */
export const CLOUDS_W = 1024;
export const CLOUDS_H = 512;
/** Blend weights between two maps are baked in these steps. */
const BLEND_STEPS = 16;

/** A 1 x 1 placeholder so samplers are always bound. */
function placeholder(rgba: number[]): DataTexture {
  const t = new DataTexture(new Uint8Array(rgba), 1, 1, RGBAFormat, UnsignedByteType);
  t.needsUpdate = true;
  return t;
}

export function createPaleoShading(base: SurfaceShading, ctl: PaleoController): SurfaceShading {
  return {
    bodyId: base.bodyId,
    priority: PALEO_PRIORITY,
    glsl: `${base.glsl}\n${paleoGlsl}`,
    defines: { ...(base.defines ?? {}), EARTH_PALEO: 1 },
    uniforms: { ...base.uniforms, ...ctl.uniforms },
    update(view: ViewState) {
      base.update?.(view);
      ctl.update(view.jd);
    },
  };
}

type Ctx = Pick<ModuleContext, 'assets' | 'workers' | 'budget'>;

export class PaleoController {
  readonly uniforms: Record<string, IUniform> = {
    uPaleoSurface: { value: placeholder([0, 0, 0, 0]) },
    uPaleoMix: { value: 0 },
    uPaleoQuat: { value: placeholder([255, 255, 0, 0]) },
    uPaleoLandFill: { value: placeholder([128, 128, 128, 255]) },
    uPaleoSeaDrop: { value: 0 },
  };
  private index: PaleoIndex | null = null;
  private indexLoad: Promise<unknown> | null = null;
  private quatLoad: Promise<unknown> | null = null;
  private quatReady = false;
  private worker: WorkerHandle<PaleoBakeApi> | null = null;
  private workerInit: Promise<void> | null = null;
  private surface: DataTexture | null = null;
  private budget: BudgetEntry[] = [];
  private wanted: { key: string; req: PaleoBakeRequest } | null = null;
  private bakedKey = '';
  private clouds: Promise<void> | null = null;
  private cloudTexture: DataTexture | null = null;
  private baking = false;
  private failed = false;

  private cloudZonal: IUniform | undefined;
  private cloudMap: IUniform | undefined;

  /**
   * `earth` holds the earth module's uniforms shared by its shading and cloud shell: uEarthCloudZonal (the
   * fade to zonal clouds) and uEarthCloudZonalMap (filled before the first bake).
   */
  constructor(
    private ctx: Ctx,
    earth: Record<string, IUniform> = {},
  ) {
    this.cloudZonal = earth.uEarthCloudZonal;
    this.cloudMap = earth.uEarthCloudZonalMap;
  }

  /** Look for the instant (JD TT); called every frame by the wrapper. */
  update(jd: number): void {
    const u = this.uniforms;
    const bp = yearsBeforePresent(jd);
    if (this.failed || !(bp >= QUATERNARY_START_YEARS / 2)) return this.idle();
    if (!this.index) {
      this.loadIndex();
      return this.idle();
    }
    const r = regimeAt(this.index, bp);
    if (r.quaternary > 0 && r.seaDropM > 0) this.loadIceAges();
    u.uPaleoSeaDrop.value = this.quatReady ? r.seaDropM * r.quaternary : 0;
    if (r.synthetic > 0) this.request(bp);
    u.uPaleoMix.value = this.bakedKey ? r.synthetic : 0;
    if (this.cloudZonal) this.cloudZonal.value = u.uPaleoMix.value;
  }

  private idle(): void {
    this.uniforms.uPaleoMix.value = 0;
    this.uniforms.uPaleoSeaDrop.value = 0;
    if (this.cloudZonal) this.cloudZonal.value = 0;
  }

  private fail(what: string, e: unknown): void {
    console.warn(`[paleo] ${what} failed; showing today's Earth`, e);
    this.failed = true;
  }

  private loadIndex(): void {
    if (this.indexLoad) return;
    this.indexLoad = this.ctx.assets.track(
      this.ctx.assets
        .json<PaleoIndex>(INDEX_PATH)
        .then((ix) => {
          this.index = ix;
        })
        .catch((e) => this.fail('index.json', e)),
      'paleo index',
    );
  }

  private loadIceAges(): void {
    if (this.quatLoad) return;
    const ix = this.index!;
    const { assets, budget } = this.ctx;
    const quat = assets.binary(ix.quaternary.path).then((buf) => {
      const png = decode(new Uint8Array(buf));
      const { width: w, height: h } = png;
      const src = png.data as Uint8Array;
      const ch = src.length / (w * h);
      // RG8, rows flipped to start in the south (v = 0) like Earth's equirect uv.
      const rg = new Uint8Array(w * h * 2);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const s = ((h - 1 - y) * w + x) * ch;
          rg[(y * w + x) * 2] = src[s];
          rg[(y * w + x) * 2 + 1] = src[s + 1];
        }
      const t = new DataTexture(rg, w, h, RGFormat, UnsignedByteType);
      t.colorSpace = NoColorSpace;
      t.minFilter = LinearFilter;
      t.magFilter = LinearFilter;
      t.generateMipmaps = false;
      t.wrapS = RepeatWrapping;
      t.wrapT = ClampToEdgeWrapping;
      t.needsUpdate = true;
      this.uniforms.uPaleoQuat.value = t;
      this.budget.push(budget.alloc(PALEO_MODULE_ID, 'quaternary', w * h * 2));
    });
    const fill = assets
      .texture(ix.quaternary.landFill, { colorSpace: 'srgb', wrap: 'repeat', owner: PALEO_MODULE_ID })
      .then((t: Texture) => {
        this.uniforms.uPaleoLandFill.value = t;
      });
    this.quatLoad = assets.track(
      Promise.all([quat, fill])
        .then(() => {
          this.quatReady = true;
        })
        .catch((e) => this.fail('ice-age data', e)),
      'paleo ice ages',
    );
  }

  private request(bp: number): void {
    const ix = this.index!;
    const ageMa = bp / 1e6;
    const br = bracketAges(ix.dem.ages, ageMa);
    const w = Math.round(br.w * BLEND_STEPS) / BLEND_STEPS;
    // Bake for the snapped age, so the era's climate and vegetation match the blended maps.
    const snapped = br.a + (br.b - br.a) * w;
    const gmstC = Math.round(gmstAt(ix, snapped) * 4) / 4;
    const veg = vegetationAt(ix, snapped);
    const q = (v: number) => Math.round(v * 20) / 20;
    const req: PaleoBakeRequest = {
      a: br.a,
      b: br.b,
      w,
      gmstC,
      veg: { plants: q(veg.plants), forests: q(veg.forests), grass: q(veg.grass) },
    };
    const key = JSON.stringify(req);
    if (this.wanted?.key !== key) this.wanted = { key, req };
    if (!this.baking && key !== this.bakedKey) this.bake();
  }

  private ensureWorker(): Promise<void> {
    if (!this.workerInit) {
      const ix = this.index!;
      const { assets, workers } = this.ctx;
      this.worker = workers.pool<PaleoBakeApi>(
        'paleo.bake',
        () => new Worker(new URL('./bake.worker.ts', import.meta.url), { type: 'module' }),
      );
      this.workerInit = this.worker.call('init', {
        demUrl: assets.url(ix.dem.path),
        moistureUrl: assets.url(ix.moisture.path),
        elevationScaleM: ix.dem.elevationScaleM,
        biomes: ix.biomes,
        todayGmstC: gmstAt(ix, 0),
        width: BAKE_W,
        height: BAKE_H,
      });
    }
    return this.workerInit;
  }

  private bake(): void {
    const job = this.wanted!;
    this.baking = true;
    const done = this.ensureWorker()
      .then(() => this.ensureClouds())
      .then(() => this.worker!.call('bake', job.req))
      .then((rgba) => {
        this.upload(rgba);
        this.bakedKey = job.key;
      })
      .catch((e) => this.fail('bake', e))
      .finally(() => {
        this.baking = false;
        if (!this.failed && this.wanted && this.wanted.key !== this.bakedKey) this.bake();
      });
    this.ctx.assets.track(done, 'paleo bake');
  }

  private ensureClouds(): Promise<void> {
    if (!this.clouds) {
      this.clouds = this.cloudMap
        ? this.worker!.call('clouds', CLOUDS_W, CLOUDS_H).then((r8) => {
            const t = new DataTexture(r8, CLOUDS_W, CLOUDS_H, RedFormat, UnsignedByteType);
            t.colorSpace = NoColorSpace;
            t.minFilter = LinearMipmapLinearFilter;
            t.magFilter = LinearFilter;
            t.generateMipmaps = true;
            t.wrapS = RepeatWrapping;
            t.wrapT = ClampToEdgeWrapping;
            t.needsUpdate = true;
            this.cloudTexture = t;
            this.cloudMap!.value = t;
            this.budget.push(
              this.ctx.budget.alloc(PALEO_MODULE_ID, 'zonal clouds', (CLOUDS_W * CLOUDS_H * 4) / 3),
            );
          })
        : Promise.resolve();
    }
    return this.clouds;
  }

  private upload(rgba: Uint8Array): void {
    if (!this.surface) {
      const t = new DataTexture(
        new Uint8Array(BAKE_W * BAKE_H * 4),
        BAKE_W,
        BAKE_H,
        RGBAFormat,
        UnsignedByteType,
      );
      t.colorSpace = SRGBColorSpace;
      t.minFilter = LinearMipmapLinearFilter;
      t.magFilter = LinearFilter;
      t.generateMipmaps = true;
      t.wrapS = RepeatWrapping;
      t.wrapT = ClampToEdgeWrapping;
      t.anisotropy = 4;
      this.surface = t;
      this.uniforms.uPaleoSurface.value = t;
      this.budget.push(this.ctx.budget.alloc(PALEO_MODULE_ID, 'surface', (BAKE_W * BAKE_H * 4 * 4) / 3));
    }
    (this.surface.image.data as Uint8Array).set(rgba);
    this.surface.needsUpdate = true;
  }

  dispose(): void {
    this.worker?.terminate();
    this.surface?.dispose();
    this.cloudTexture?.dispose();
    (this.uniforms.uPaleoQuat.value as Texture).dispose();
    for (const b of this.budget) b.free();
  }
}
