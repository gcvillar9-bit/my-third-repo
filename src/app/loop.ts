/**
 * Frame loop (CONTRACTS lifecycle 5): clock.tick, camera update + re-anchor, ViewState, before
 * hooks, surface selection, Renderable/SurfaceShading updates, render pipeline, after hooks.
 * rAF drives it outside test mode; tests call frame() through __universe.renderFrames(n).
 */
import {
  SSB_FRAME,
  type Body,
  type FrameId,
  type Quatd,
  type QualityState,
  type Renderable,
  type SimClock,
  type SurfaceGeometryProvider,
  type SurfaceShading,
  type Vec3d,
  type ViewState,
} from '../core/contracts';
import type { FrameTreeImpl } from '../core/frames';
import type { RegistryImpl } from '../core/registry';
import { qmul, quat, vec3 } from '../core/math64';
import type { CameraController } from '../camera/controller';
import type { EngineRenderer } from '../render/renderer';

const ZERO: Readonly<Vec3d> = Object.freeze(vec3());
/** Fixed real-time step in test mode, s. */
export const TEST_DT = 1 / 60;

interface SurfaceSlot {
  provider: SurfaceGeometryProvider;
  shading: SurfaceShading;
  renderable: Renderable;
}

/**
 * Per body with a SurfaceShading: activates the highest-priority geometry provider that wants
 * it. Renderables are built lazily, registered through the registry and hidden while inactive.
 * While a newly active provider's renderable is still warming up (its shaders link in the
 * background, `ready`), the provider shown before keeps drawing so the body never blinks out;
 * both are updated meanwhile.
 */
export class SurfaceManager {
  private slots = new Map<string, SurfaceSlot>();
  /** Provider drawn last frame per body. */
  private shown = new Map<string, string>();
  readonly inactive = new Set<string>();

  constructor(
    private readonly registry: RegistryImpl,
    private readonly ready: (renderableId: string) => boolean = () => true,
  ) {}

  update(view: ViewState): SurfaceShading[] {
    const shadings: SurfaceShading[] = [];
    const providers = [...this.registry.surfaceGeometries()].sort((a, b) => b.priority - a.priority);
    if (!providers.length) return shadings;
    for (const body of this.registry.bodies()) {
      const shading = this.registry.surfaceShading(body.id);
      if (!shading) continue;
      shadings.push(shading);
      const mine = providers.filter((p) => p.bodyId === '*' || p.bodyId === body.id);
      const active = mine.find((p) => safeWants(p, view, body));
      if (active) {
        const key = `${active.id}:${body.id}`;
        const slot = this.slots.get(key);
        if (!slot || slot.shading !== shading) {
          if (slot) this.registry.removeRenderable(slot.renderable.id);
          const next = { provider: active, shading, renderable: active.build(body, shading) };
          this.slots.set(key, next);
          this.registry.addRenderable(next.renderable);
        }
      }
      let drawn = active;
      const prev = this.shown.get(body.id);
      if (active && prev !== undefined && prev !== active.id && this.slots.has(`${prev}:${body.id}`)) {
        const warming = !this.ready(this.slots.get(`${active.id}:${body.id}`)!.renderable.id);
        if (warming) drawn = mine.find((p) => p.id === prev) ?? active;
      }
      if (drawn) this.shown.set(body.id, drawn.id);
      else this.shown.delete(body.id);
      for (const p of mine) {
        const slot = this.slots.get(`${p.id}:${body.id}`);
        if (!slot) continue;
        slot.renderable.object.visible = p === drawn;
        if (p === drawn || p === active) this.inactive.delete(slot.renderable.id);
        else this.inactive.add(slot.renderable.id);
      }
    }
    return shadings;
  }
}

function safeWants(p: SurfaceGeometryProvider, view: ViewState, body: Body): boolean {
  try {
    return p.wants(view, body);
  } catch {
    return false;
  }
}

export interface LoopDeps {
  frames: FrameTreeImpl;
  clock: SimClock;
  registry: RegistryImpl;
  camera: CameraController;
  render: EngineRenderer;
  quality: QualityState;
  test: boolean;
  onError: (msg: string) => void;
  /** Called after each frame (URL sync, perf overlay). */
  afterFrame?: (nowMs: number) => void;
}

export class Loop {
  private frameIndex = 0;
  private timeReal = 0;
  private raf = 0;
  private lastMs = 0;
  private failed = new Set<string>();
  readonly surfaces: SurfaceManager;

  constructor(private readonly d: LoopDeps) {
    this.surfaces = new SurfaceManager(d.registry, (id) => d.render.isReady(id));
  }

  private fail(id: string, e: unknown): void {
    if (this.failed.has(id)) return;
    this.failed.add(id);
    this.d.onError(`${id}: ${e instanceof Error ? e.message : String(e)}`);
  }

  buildView(dtReal: number, dtSim: number): ViewState {
    const { frames, clock, camera, render, quality } = this.d;
    const st = camera.getState();
    const jd = clock.jd;
    const worldQuat = qmul(quat(), frames.orientation(st.frame, jd, quat()), st.quat);
    const sunFrame: FrameId = frames.has('sun') ? 'sun' : frames.has(SSB_FRAME) ? SSB_FRAME : frames.rootId;
    const vp: [number, number] = [render.size.width, render.size.height];
    return {
      jd,
      dtReal,
      dtSim,
      timeReal: this.timeReal,
      frameIndex: this.frameIndex,
      frame: st.frame,
      cameraLocal: st.local,
      cameraQuat: st.quat,
      worldQuat,
      camera: render.camera,
      fovY: st.fovY,
      viewport: vp,
      pixelAngle: st.fovY / vp[1],
      exposure: render.exposure.value,
      quality: quality.preset,
      knobs: quality.knobs,
      test: this.d.test,
      toCamera: (frame: FrameId, local: Vec3d, out: Vec3d) =>
        frames.delta(st.frame, st.local, frame, local, jd, out),
      sunToCamera: (out: Vec3d) => frames.delta(st.frame, st.local, sunFrame, ZERO, jd, out),
      frameQuat: (frame: FrameId, out: Quatd) => frames.orientation(frame, jd, out),
      nearestSurface: () => camera.nearestSurface(),
    };
  }

  /** Renders one frame advancing real time by dtReal seconds. */
  frame(dtReal: number): void {
    const { clock, camera, render, registry } = this.d;
    dtReal = Math.min(0.1, Math.max(0, dtReal));
    this.timeReal += dtReal;
    const dtSim = clock.tick(dtReal);
    camera.update(dtReal);
    const exposure = render.beginFrame(dtReal, this.timeReal);
    const view = this.buildView(dtReal, dtSim);
    view.exposure = exposure;
    const cam = render.camera;
    cam.quaternion.set(view.worldQuat.x, view.worldQuat.y, view.worldQuat.z, view.worldQuat.w);
    cam.position.set(0, 0, 0);
    const fovDeg = (view.fovY * 180) / Math.PI;
    if (cam.fov !== fovDeg) {
      cam.fov = fovDeg;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld(true);
    try {
      render.runBefore(view);
    } catch (e) {
      this.fail('onBeforeFrame', e);
    }
    let shadings: SurfaceShading[] = [];
    try {
      shadings = this.surfaces.update(view);
    } catch (e) {
      this.fail('surfaces', e);
    }
    for (const r of registry.renderables()) {
      if (this.surfaces.inactive.has(r.id)) continue;
      try {
        r.update(view);
      } catch (e) {
        this.fail(r.id, e);
      }
    }
    for (const s of shadings) {
      try {
        s.update?.(view);
      } catch (e) {
        this.fail(`shading:${s.bodyId}`, e);
      }
    }
    render.renderPipeline(view);
    try {
      render.runAfter(view);
    } catch (e) {
      this.fail('onAfterFrame', e);
    }
    this.frameIndex++;
  }

  start(): void {
    const step = (ms: number) => {
      const dt = this.lastMs ? (ms - this.lastMs) / 1000 : 1 / 60;
      this.lastMs = ms;
      this.frame(dt);
      this.d.afterFrame?.(ms);
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.lastMs = 0;
  }
}
