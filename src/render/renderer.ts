/**
 * Renderer facade (DESIGN 3.3): WebGL2 WebGLRenderer with logarithmic depth, a HalfFloat scene
 * target with a float depth texture, background + main + overlay scenes, ScreenPass host,
 * exposure metering and the EffectPass. Renderables arrive through the Registry hooks.
 */
import {
  ClampToEdgeWrapping,
  DataTexture,
  DataUtils,
  DepthTexture,
  FloatType,
  HalfFloatType,
  LinearFilter,
  Mesh,
  PerspectiveCamera,
  RGBAFormat,
  Scene,
  Vector2,
  WebGLRenderTarget,
  WebGLRenderer,
  type Material,
  type Object3D,
} from 'three';
import {
  CAMERA_FAR,
  CAMERA_NEAR,
  type BudgetEntry,
  type QualityState,
  type RenderApi,
  type RenderStats,
  type Renderable,
  type ResourceBudget,
  type ScreenPass,
  type SharedUniforms,
  type ViewState,
} from '../core/contracts';
import { BLACKBODY_LUT_SIZE, buildBlackbodyLut } from '../core/photometry';
import { ExposureController, LuminanceMeter, METER_INTERVAL, targetEv } from './exposure';
import { PostChain } from './post';
import { ScreenPassHost } from './screenpass-host';

export interface EngineRendererOptions {
  canvas: HTMLCanvasElement;
  test: boolean;
  quality: QualityState;
  budget: ResourceBudget;
  onError?: (message: string) => void;
  /** Initial (or fixed, in test mode) EV100. */
  initialEv?: number;
}

export function createBlackbodyLutTexture(): DataTexture {
  const rgb = buildBlackbodyLut(BLACKBODY_LUT_SIZE);
  const data = new Uint16Array(BLACKBODY_LUT_SIZE * 4);
  for (let i = 0; i < BLACKBODY_LUT_SIZE; i++) {
    data[i * 4] = DataUtils.toHalfFloat(rgb[i * 3]);
    data[i * 4 + 1] = DataUtils.toHalfFloat(rgb[i * 3 + 1]);
    data[i * 4 + 2] = DataUtils.toHalfFloat(rgb[i * 3 + 2]);
    data[i * 4 + 3] = DataUtils.toHalfFloat(1);
  }
  const tex = new DataTexture(data, BLACKBODY_LUT_SIZE, 1, RGBAFormat, HalfFloatType);
  tex.minFilter = tex.magFilter = LinearFilter;
  tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

const sceneForLayer = (api: EngineRenderer, layer: Renderable['layer']): Scene =>
  layer === 'background' ? api.scenes.background : layer === 'overlay' ? api.scenes.overlay : api.scenes.main;

function forEachMaterial(o: Object3D, fn: (m: Material) => void): void {
  o.traverse((c) => {
    const m = (c as Mesh).material as Material | Material[] | undefined;
    if (Array.isArray(m)) m.forEach(fn);
    else if (m) fn(m);
  });
}

export class EngineRenderer implements RenderApi {
  readonly renderer: WebGLRenderer;
  readonly scenes = { background: new Scene(), main: new Scene(), overlay: new Scene() };
  readonly camera = new PerspectiveCamera(60, 16 / 9, CAMERA_NEAR, CAMERA_FAR);
  readonly exposure: ExposureController;
  readonly uniforms: SharedUniforms;
  readonly size = { width: 1, height: 1, pixelRatio: 1 };
  readonly host = new ScreenPassHost();
  readonly post: PostChain;
  private sceneTarget: WebGLRenderTarget;
  private meter: LuminanceMeter;
  private before = new Set<(v: ViewState) => void>();
  private after = new Set<(v: ViewState) => void>();
  private entries = new Map<string, { r: Renderable; entry: BudgetEntry }>();
  private frames = 0;
  private cssW = 1;
  private cssH = 1;
  private readonly test: boolean;

  constructor(private readonly opts: EngineRendererOptions) {
    this.test = opts.test;
    const gl = opts.canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      depth: true,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: opts.test,
    });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.renderer = new WebGLRenderer({
      canvas: opts.canvas,
      context: gl,
      antialias: false,
      logarithmicDepthBuffer: true,
    });
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = false;
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.debug.onShaderError = (g, _program, vs, fs) => {
      const log = `${g.getShaderInfoLog(vs) ?? ''} ${g.getShaderInfoLog(fs) ?? ''}`.trim();
      const msg = `shader error: ${log || 'link failed'}`;
      opts.onError?.(msg);
      console.warn(msg);
    };
    this.camera.matrixAutoUpdate = true;
    this.uniforms = {
      uExposure: { value: 1 },
      uLogDepthFar: { value: CAMERA_FAR },
      uResolution: { value: new Vector2(1, 1) },
      uTime: { value: 0 },
      uBlackbodyLut: { value: createBlackbodyLutTexture() },
      uBlueNoise: { value: null },
    };
    this.exposure = new ExposureController(opts.initialEv ?? 12);
    if (opts.test) this.exposure.setFixedEV(opts.initialEv ?? 12);
    this.meter = new LuminanceMeter((meanLog2, coverage) =>
      this.exposure.setTarget(targetEv(meanLog2, coverage)),
    );
    this.sceneTarget = this.createSceneTarget(1, 1);
    this.post = new PostChain(this.renderer, this.camera, opts.quality.knobs);
    opts.quality.subscribe((k) => {
      this.post.setKnobs(k);
      this.resize(this.cssW, this.cssH);
    });
  }

  private createSceneTarget(w: number, h: number): WebGLRenderTarget {
    const depthTexture = new DepthTexture(w, h, FloatType);
    return new WebGLRenderTarget(w, h, {
      type: HalfFloatType,
      format: RGBAFormat,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
      depthTexture,
      generateMipmaps: false,
    });
  }

  /** CSS size of the canvas; pixel ratio follows the quality preset (1 in test mode). */
  resize(cssW: number, cssH: number): void {
    this.cssW = Math.max(1, Math.floor(cssW));
    this.cssH = Math.max(1, Math.floor(cssH));
    const q = this.opts.quality;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const pr = this.test ? 1 : Math.min(dpr, q.knobs.maxPixelRatio) * q.knobs.renderScale * q.dynamicScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(this.cssW, this.cssH, false);
    const w = Math.max(1, Math.floor(this.cssW * pr));
    const h = Math.max(1, Math.floor(this.cssH * pr));
    Object.assign(this.size, { width: w, height: h, pixelRatio: pr });
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.sceneTarget.setSize(w, h);
    this.host.setSize(w, h);
    this.post.setSize(w, h);
    this.uniforms.uResolution.value.set(w, h);
  }

  // ----- registry hooks -----
  addRenderable(r: Renderable): void {
    if (r.layer === 'background') {
      forEachMaterial(r.object, (m) => {
        m.depthTest = false;
        m.depthWrite = false;
      });
    }
    sceneForLayer(this, r.layer).add(r.object);
    const owner = r.id.split('.')[0];
    const entry = this.opts.budget.alloc(owner, `renderable:${r.id}`, safeBytes(r));
    this.entries.set(r.id, { r, entry });
  }

  removeRenderable(r: Renderable): void {
    r.object.removeFromParent();
    this.entries.get(r.id)?.entry.free();
    this.entries.delete(r.id);
  }

  addScreenPass(p: ScreenPass): void {
    this.host.add(p);
  }
  removeScreenPass(p: ScreenPass): void {
    this.host.remove(p);
  }

  // ----- hooks -----
  onBeforeFrame(cb: (view: ViewState) => void): () => void {
    this.before.add(cb);
    return () => this.before.delete(cb);
  }
  onAfterFrame(cb: (view: ViewState) => void): () => void {
    this.after.add(cb);
    return () => this.after.delete(cb);
  }
  runBefore(view: ViewState): void {
    for (const cb of this.before) cb(view);
  }
  runAfter(view: ViewState): void {
    for (const cb of this.after) cb(view);
  }

  /** Exposure for this frame (call before renderables update so view.exposure is current). */
  beginFrame(dtReal: number, timeReal: number): number {
    this.exposure.update(dtReal);
    this.uniforms.uExposure.value = this.exposure.value;
    this.uniforms.uTime.value = timeReal;
    this.renderer.info.reset();
    return this.exposure.value;
  }

  /** Steps 1-8 of the frame pipeline. */
  renderPipeline(view: ViewState): void {
    const r = this.renderer;
    r.setRenderTarget(this.sceneTarget);
    r.clear(true, true, false);
    r.render(this.scenes.background, this.camera);
    r.clearDepth();
    r.render(this.scenes.main, this.camera);
    const hdr = this.host.run(r, this.sceneTarget, this.sceneTarget.depthTexture!, view);
    if (!this.exposure.isFixed && view.frameIndex % METER_INTERVAL === 0) {
      this.meter.measure(r, hdr.texture, this.exposure.value);
    }
    this.post.render(hdr, view.dtReal);
    r.setRenderTarget(null);
    if (this.scenes.overlay.children.length) {
      r.clearDepth();
      r.render(this.scenes.overlay, this.camera);
    }
    this.frames++;
    if (this.frames % 30 === 0) this.syncBudget();
  }

  private syncBudget(): void {
    for (const { r, entry } of this.entries.values()) {
      const b = safeBytes(r);
      if (b !== entry.bytes) entry.resize(b);
    }
  }

  async compileAll(): Promise<void> {
    for (const s of [this.scenes.background, this.scenes.main, this.scenes.overlay]) {
      await this.renderer.compileAsync(s, this.camera);
    }
  }

  stats(): RenderStats {
    const { render, memory, programs } = this.renderer.info;
    return {
      calls: render.calls,
      triangles: render.triangles,
      points: render.points,
      lines: render.lines,
      programs: programs?.length ?? 0,
      textures: memory.textures,
      geometries: memory.geometries,
      tiles: 0,
      gpuBytes: this.opts.budget.used(),
      frame: this.frames,
    };
  }

  /** Engine-owned GPU bytes (scene target, ping-pong targets, LUT). */
  engineBytes(): number {
    return this.size.width * this.size.height * (8 + 4) + this.host.memoryBytes() + BLACKBODY_LUT_SIZE * 8;
  }

  dispose(): void {
    for (const { r } of this.entries.values()) r.dispose();
    this.entries.clear();
    this.host.dispose();
    this.meter.dispose();
    this.post.dispose();
    this.sceneTarget.dispose();
    this.renderer.dispose();
  }
}

function safeBytes(r: Renderable): number {
  try {
    const b = r.memoryBytes();
    return Number.isFinite(b) && b > 0 ? b : 0;
  } catch {
    return 0;
  }
}
