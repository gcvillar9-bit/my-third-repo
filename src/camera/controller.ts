/**
 * Camera controller (CameraApi): Float64 state {frame, local, quat, fovY}, free/orbit modes,
 * van Wijk-Nuij goto, distance-scaled speed, ground providers, collision and re-anchoring with
 * 10% hysteresis (DESIGN 3.2 Camera). Walk mode (P2, ./walk.ts) anchors to the nearest body's
 * `.fixed` frame and walks on the GroundProvider surface; G toggles it within WALK_RANGE.
 */
import {
  FIXED_SUFFIX,
  SSB_FRAME,
  type Body,
  type Bookmark,
  type CameraApi,
  type CameraMode,
  type CameraState,
  type FrameId,
  type GotoOptions,
  type GroundProvider,
  type JD,
  type Quatd,
  type RegistryReader,
  type Vec3d,
} from '../core/contracts';
import type { FrameTreeImpl } from '../core/frames';
import {
  qclone,
  qconj,
  qlookRotation,
  qmul,
  qnormalize,
  qrotate,
  quat,
  v3add,
  v3clone,
  v3dot,
  v3len,
  v3normalize,
  v3scale,
  v3sub,
  vec3,
} from '../core/math64';
import { Flight } from './autopilot';
import { clampAboveGround, EYE_HEIGHT, GroundProviders, MIN_ALTITUDE } from './collision-hook';
import { applyFree, emptyInput, type FlightInput } from './free';
import { applyOrbit } from './orbit';
import { surfaceGravity, Walker, WALK_RANGE, type WalkPose } from './walk';
import { clampK, K_DEFAULT, SpeedController, targetSpeed } from './speed';

export const DEFAULT_FOV = (60 * Math.PI) / 180;
/** Kinds whose surface stops the camera (not galaxies, clusters or black holes). */
const SOLID: ReadonlySet<Body['kind']> = new Set([
  'star',
  'planet',
  'dwarf',
  'moon',
  'minor',
  'comet',
  'spacecraft',
]);
const ZERO: Readonly<Vec3d> = Object.freeze(vec3());
const LOOK_RATE = 1.2; // rad/s for arrow keys

export interface CameraDeps {
  frames: FrameTreeImpl;
  registry: RegistryReader;
  jd: () => JD;
  /** Invoked when goto() receives a bookmark (the app applies jd/rate/ev). */
  onBookmark?: (bm: Bookmark) => void;
}

export interface NearestInfo {
  bodyId: string;
  altitude: number;
  radius: number;
}

interface ActiveFlight {
  flight: Flight;
  frame: FrameId;
  t: number;
  resolve: (ok: boolean) => void;
  finish: () => void;
}

export class CameraController implements CameraApi {
  private st: CameraState = { frame: SSB_FRAME, local: vec3(0, 0, 1e12), quat: quat(), fovY: DEFAULT_FOV };
  private _mode: CameraMode = 'free';
  private _target: string | null = null;
  private _k = K_DEFAULT;
  private active: ActiveFlight | null = null;
  private speedCtl = new SpeedController();
  private ground = new GroundProviders();
  private nearest: NearestInfo | null = null;
  private listeners = new Set<() => void>();
  private keys = new Set<string>();
  private look = { yaw: 0, pitch: 0, zoom: 1 };
  private viewportHeight = 270;
  private walker: Walker | null = null;
  private walkBody: Body | null = null;

  constructor(private readonly deps: CameraDeps) {
    if (!deps.frames.has(this.st.frame)) this.st.frame = deps.frames.rootId;
  }

  // ----- CameraApi -----
  get mode(): CameraMode {
    return this._mode;
  }
  setMode(mode: CameraMode): void {
    if (mode === this._mode) return;
    if (mode === 'walk' && !this.enterWalk()) return;
    if (mode !== 'walk') this.leaveWalk();
    this._mode = mode;
    this.reanchor();
    this.emit();
  }

  /** Starts walking on the nearest solid body within WALK_RANGE (false when none qualifies). */
  private enterWalk(): boolean {
    const { frames, registry } = this.deps;
    const n = this.computeNearest();
    const b = n ? registry.body(n.bodyId) : undefined;
    if (!n || !b || !SOLID.has(b.kind) || b.kind === 'star' || n.altitude > WALK_RANGE) return false;
    const fixed = b.fixedFrame && frames.has(b.fixedFrame) ? b.fixedFrame : b.frame;
    const jd = this.deps.jd();
    const pose: WalkPose = {
      local: frames.convertPoint(this.st.frame, this.st.local, fixed, jd, vec3()),
      quat: this.quatIn(fixed, jd),
    };
    this.walker = new Walker(surfaceGravity(b));
    this.walkBody = b;
    this.walker.enter(pose, (dir) => b.radius + this.ground.heightAt(b.id, dir));
    this.st.frame = fixed;
    this.st.local = pose.local;
    this.st.quat = pose.quat;
    this._mode = 'walk';
    this.computeNearest();
    return true;
  }

  private leaveWalk(): void {
    this.walker = null;
    this.walkBody = null;
  }

  private walkStep(dt: number): void {
    const b = this.walkBody!;
    const { frames } = this.deps;
    const fixed = b.fixedFrame && frames.has(b.fixedFrame) ? b.fixedFrame : b.frame;
    const jd = this.deps.jd();
    if (this.st.frame !== fixed) {
      this.st.local = frames.convertPoint(this.st.frame, this.st.local, fixed, jd, vec3());
      this.st.quat = this.quatIn(fixed, jd);
      this.st.frame = fixed;
    }
    const input = this.readInput(dt);
    const k = this.keys;
    this.walker!.step(
      this.st,
      {
        forward: input.forward,
        right: input.right,
        yaw: input.yaw,
        pitch: input.pitch,
        run: k.has('ShiftLeft') || k.has('ShiftRight'),
        jump: k.has('Space'),
      },
      dt,
      (dir) => b.radius + this.ground.heightAt(b.id, dir),
    );
  }
  get target(): string | null {
    return this._target;
  }
  setTarget(bodyId: string | null): void {
    this._target = bodyId;
    this.emit();
  }
  get speedFactor(): number {
    return this._k;
  }
  set speedFactor(k: number) {
    this._k = clampK(k);
  }
  get speed(): number {
    return this.speedCtl.speed;
  }
  get traveling(): boolean {
    return this.active !== null;
  }

  getState(out?: CameraState): CameraState {
    const s = out ?? { frame: '', local: vec3(), quat: quat(), fovY: 0 };
    s.frame = this.st.frame;
    s.local = v3clone(this.st.local);
    s.quat = qclone(this.st.quat);
    s.fovY = this.st.fovY;
    return s;
  }

  setState(s: Partial<CameraState>): void {
    if (s.frame !== undefined) {
      if (!this.deps.frames.has(s.frame)) throw new Error(`camera: unknown frame '${s.frame}'`);
      this.st.frame = s.frame;
    }
    if (s.local) this.st.local = v3clone(s.local);
    if (s.quat) this.st.quat = qnormalize(quat(), s.quat);
    if (s.fovY !== undefined) this.st.fovY = s.fovY;
    this.reanchor();
    this.computeNearest();
    this.speedCtl.reset(targetSpeed(this._k, this.nearestDistance()));
  }

  addGroundProvider(p: GroundProvider): () => void {
    return this.ground.add(p);
  }

  nearestSurface(): { bodyId: string; altitude: number } | null {
    return this.nearest ? { bodyId: this.nearest.bodyId, altitude: this.nearest.altitude } : null;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  cancelGoto(): void {
    const a = this.active;
    if (!a) return;
    this.active = null;
    a.resolve(false);
    this.emit();
  }

  goto(target: string | Bookmark, opts: GotoOptions = {}): Promise<boolean> {
    const { frames, registry } = this.deps;
    const bm = typeof target === 'string' ? registry.bookmark(target) : target;
    const body = !bm && typeof target === 'string' ? registry.body(target) : undefined;
    if ((!bm && !body) || (bm && !frames.has(bm.frame)) || (body && !frames.has(body.frame))) {
      return Promise.resolve(false);
    }
    this.cancelGoto();
    if (this._mode === 'walk') {
      this.leaveWalk();
      this._mode = 'free';
    }
    if (bm) this.deps.onBookmark?.(bm);
    const jdNow = this.deps.jd();
    const frame = bm ? bm.frame : body!.frame;
    const p0 = frames.convertPoint(this.st.frame, this.st.local, frame, jdNow, vec3());
    const q0 = this.quatIn(frame, jdNow);
    const up0 = qrotate(vec3(), q0, vec3(0, 1, 0));
    let p1: Vec3d;
    let q1: Quatd;
    let look: Vec3d;
    let w1: number;
    let newTarget: string | null;
    if (bm) {
      p1 = v3clone(bm.pos);
      const lb = bm.lookAt ? registry.body(bm.lookAt) : undefined;
      look = lb && frames.has(lb.frame) ? frames.convertPoint(lb.frame, ZERO, frame, jdNow, vec3()) : vec3();
      if (bm.quat) q1 = qnormalize(quat(), bm.quat);
      else q1 = qlookRotation(quat(), v3sub(vec3(), look, p1), up0);
      if (bm.quat && !lb) look = v3add(vec3(), p1, qrotate(vec3(), q1, vec3(0, 0, -1)));
      w1 = Math.max(1, v3len(v3sub(vec3(), look, p1)) - (lb?.radius ?? 0));
      newTarget = bm.lookAt ?? null;
    } else {
      const b = body!;
      const r = b.radius > 0 ? b.radius : 1e3;
      const alt = opts.distance ?? 3 * r;
      const n = v3len(p0) > 0 ? v3normalize(vec3(), p0) : vec3(0, 0, 1);
      const dist = r + alt;
      // Approach slightly from the Sun-lit side when that keeps the distance monotonic.
      if (b.id !== 'sun' && frames.has('sun')) {
        const s = frames.convertPoint('sun', ZERO, frame, jdNow, vec3());
        if (v3len(s) > 0) {
          v3normalize(s, s);
          const cand = v3normalize(vec3(), v3add(vec3(), n, v3scale(vec3(), s, 0.8)));
          if (dist < 0.5 * v3len(p0) * v3dot(cand, n)) Object.assign(n, cand);
        }
      }
      p1 = v3scale(vec3(), n, dist);
      look = vec3();
      q1 = qlookRotation(quat(), v3scale(vec3(), n, -1), up0);
      w1 = alt;
      newTarget = b.id;
    }
    const w0 = Math.max(1, this.nearest?.altitude ?? v3len(v3sub(vec3(), look, p0)));
    const finish = () => {
      if (bm?.fovY) this.st.fovY = bm.fovY;
      this._target = newTarget;
      if (bm?.mode === 'walk') this.enterWalk();
      else if (bm?.mode) this._mode = bm.mode;
      this.computeNearest();
      this.speedCtl.reset(targetSpeed(this._k, this.nearestDistance()));
    };
    if (opts.instant) {
      this.st.frame = frame;
      this.st.local = p1;
      this.st.quat = q1;
      finish();
      this.reanchor();
      this.computeNearest();
      this.emit();
      return Promise.resolve(true);
    }
    const flight = new Flight({ p0, p1, q0, q1, look, w0, w1, duration: opts.duration });
    return new Promise<boolean>((resolve) => {
      this.active = { flight, frame, t: 0, resolve, finish };
      this.emit();
    });
  }

  // ----- per-frame update -----
  /** Advances the camera by dt real seconds. */
  update(dt: number): void {
    if (this.active) {
      const a = this.active;
      a.t += dt;
      const pose = { local: vec3(), quat: quat() };
      const done = a.flight.sample(a.t, pose);
      this.st.frame = a.frame;
      this.st.local = pose.local;
      this.st.quat = pose.quat;
      if (done) {
        this.active = null;
        a.finish();
        a.resolve(true);
        this.emit();
      }
    } else if (this._mode === 'walk' && this.walker) {
      this.walkStep(dt);
    } else {
      const input = this.readInput(dt);
      const tgt = this._target ? this.deps.registry.body(this._target) : undefined;
      if (this._mode === 'orbit' && tgt && this.deps.frames.has(tgt.frame)) {
        this.orbitStep(tgt, input, dt);
      } else {
        const v = this.speedCtl.update(targetSpeed(this._k, this.nearestDistance()), dt);
        applyFree(this.st, input, v, dt);
        this.collide();
      }
    }
    this.reanchor();
    this.computeNearest();
  }

  private orbitStep(b: Body, input: FlightInput, dt: number): void {
    const { frames } = this.deps;
    const jd = this.deps.jd();
    const pose = {
      local: frames.convertPoint(this.st.frame, this.st.local, b.frame, jd, vec3()),
      quat: this.quatIn(b.frame, jd),
    };
    const zoom = this.look.zoom * Math.exp(-input.forward * dt * 1.5);
    this.look.zoom = 1;
    applyOrbit(pose, input.yaw + input.right * dt, input.pitch + input.up * dt, zoom, b.radius);
    this.st.frame = b.frame;
    this.st.local = pose.local;
    this.st.quat = pose.quat;
  }

  private collide(): void {
    const n = this.nearest;
    if (!n) return;
    const b = this.deps.registry.body(n.bodyId);
    if (!b || !SOLID.has(b.kind)) return;
    const minAlt = this._mode === 'walk' ? EYE_HEIGHT : MIN_ALTITUDE;
    const { frames } = this.deps;
    const jd = this.deps.jd();
    const rel = frames.convertPoint(this.st.frame, this.st.local, b.frame, jd, vec3());
    if (clampAboveGround(rel, b.radius, this.groundAt(b, jd), minAlt)) {
      this.st.local = frames.convertPoint(b.frame, rel, this.st.frame, jd, vec3());
    }
  }

  private groundAt(b: Body, jd: JD): number {
    if (!this.ground.size) return 0;
    const f = b.fixedFrame && this.deps.frames.has(b.fixedFrame) ? b.fixedFrame : b.frame;
    const dir = this.deps.frames.convertPoint(this.st.frame, this.st.local, f, jd, vec3());
    return this.ground.heightAt(b.id, v3normalize(dir, dir));
  }

  /** Camera orientation re-expressed relative to `frame` axes. */
  private quatIn(frame: FrameId, jd: JD): Quatd {
    const { frames } = this.deps;
    const qOld = frames.orientation(this.st.frame, jd, quat());
    const qNew = frames.orientation(frame, jd, quat());
    const q = qmul(quat(), qconj(qNew, qNew), qOld);
    return qnormalize(q, qmul(q, q, this.st.quat));
  }

  private reanchor(): void {
    const { frames } = this.deps;
    const jd = this.deps.jd();
    const filter = this._mode === 'walk' ? undefined : (id: FrameId) => !id.endsWith(FIXED_SUFFIX);
    const nf = frames.findAnchor(this.st.frame, this.st.local, jd, this.st.frame, 0.1, filter);
    if (nf === this.st.frame) return;
    const q = this.quatIn(nf, jd);
    this.st.local = frames.convertPoint(this.st.frame, this.st.local, nf, jd, vec3());
    this.st.quat = q;
    this.st.frame = nf;
  }

  /** Nearest body surface (radius + ground) from the registry's bodies. */
  computeNearest(): NearestInfo | null {
    const { frames, registry } = this.deps;
    const jd = this.deps.jd();
    const d = vec3();
    let best: Body | null = null;
    let bestAlt = Infinity;
    for (const b of registry.bodies()) {
      if (!frames.has(b.frame)) continue;
      const alt = v3len(frames.delta(this.st.frame, this.st.local, b.frame, ZERO, jd, d)) - b.radius;
      if (alt < bestAlt) {
        bestAlt = alt;
        best = b;
      }
    }
    this.nearest = best
      ? { bodyId: best.id, altitude: bestAlt - this.groundAt(best, jd), radius: best.radius }
      : null;
    return this.nearest;
  }

  /** d_nearest for the speed law (distance to the anchor origin when no body is known). */
  nearestDistance(): number {
    if (this.nearest) return Math.max(0, this.nearest.altitude);
    return this.st.frame === this.deps.frames.rootId ? 1e20 : v3len(this.st.local);
  }

  // ----- input -----
  private readInput(dt: number): FlightInput {
    const k = this.keys;
    const has = (...codes: string[]) => (codes.some((c) => k.has(c)) ? 1 : 0);
    const input = emptyInput();
    input.forward = has('KeyW') - has('KeyS');
    input.right = has('KeyD') - has('KeyA');
    input.up = has('KeyR', 'Space') - has('KeyF', 'KeyC');
    input.roll = has('KeyE') - has('KeyQ');
    input.yaw = this.look.yaw + (has('ArrowLeft') - has('ArrowRight')) * LOOK_RATE * dt;
    input.pitch = this.look.pitch + (has('ArrowUp') - has('ArrowDown')) * LOOK_RATE * dt;
    this.look.yaw = this.look.pitch = 0;
    return input;
  }

  /** Viewport height in CSS px (mouse look sensitivity). */
  setViewportHeight(h: number): void {
    this.viewportHeight = Math.max(1, h);
  }

  /** Keyboard/mouse bindings. Returns a detach function. */
  attach(el: HTMLElement): () => void {
    const typing = (e: Event) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'BracketLeft') this.speedFactor = this._k / 1.25;
      else if (e.code === 'BracketRight') this.speedFactor = this._k * 1.25;
      else {
        this.keys.add(e.code);
        if (this.active && /^Key[WASDRFCQE]$|^Space$/.test(e.code)) this.cancelGoto();
      }
    };
    // G toggles walk mode near a surface; capture phase so it wins over the UI's G (fly to selection).
    const onWalkKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyG' || e.repeat || typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (this._mode === 'walk') this.setMode('free');
      else {
        const n = this.computeNearest();
        if (!n || n.altitude > WALK_RANGE || this.active) return;
        this.setMode('walk');
        if (!this.walker) return;
      }
      e.stopPropagation();
      e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
    const onBlur = () => this.keys.clear();
    let drag: { id: number; x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      el.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const rad = this.st.fovY / this.viewportHeight;
      this.look.yaw += (e.clientX - drag.x) * rad;
      this.look.pitch += (e.clientY - drag.y) * rad;
      drag.x = e.clientX;
      drag.y = e.clientY;
    };
    const onUp = (e: PointerEvent) => {
      if (drag && e.pointerId === drag.id) drag = null;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (this._mode === 'orbit') this.look.zoom *= Math.exp(e.deltaY * 0.001);
      else this.speedFactor = this._k * Math.exp(-e.deltaY * 0.0015);
    };
    window.addEventListener('keydown', onWalkKey, true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      window.removeEventListener('keydown', onWalkKey, true);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
    };
  }
}
