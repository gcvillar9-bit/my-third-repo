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
import { pickPad, readPad, type PadLike } from './gamepad';
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
/** A single pointer move larger than this fraction of the viewport height is not a look drag. */
export const MAX_LOOK_JUMP = 0.5;
const ZERO: Readonly<Vec3d> = Object.freeze(vec3());
const LOOK_RATE = 1.2; // rad/s for arrow keys

export interface CameraDeps {
  frames: FrameTreeImpl;
  registry: RegistryReader;
  jd: () => JD;
  /** Invoked when goto() receives a bookmark (the app applies jd/rate/ev). */
  onBookmark?: (bm: Bookmark) => void;
  /**
   * Whether a body has ground to stand on (default: every solid body that is not a star). The
   * app passes the terrain's rule, which leaves out gas giants, comets and spacecraft.
   */
  walkable?: (b: Body) => boolean;
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
  /** Landing flights end on the ground under `dir` (unit, body-fixed), wherever it turns out to be. */
  land?: { body: Body; dir: Vec3d };
  /** Field of view at the start and end of the flight (eased in between), radians. */
  fov0: number;
  fov1: number;
}

/** Analog movement from on-screen controls or a gamepad, each axis −1..1 (added to the keys). */
export interface VirtualInput {
  forward: number;
  right: number;
  up: number;
  roll: number;
}

/** Time constant of the movement easing in free flight, s (keys start and stop softly). */
export const MOVE_TAU = 0.12;
/** Free-flight dolly per unit of pinch (ln of the finger-spread ratio), in altitudes. */
export const PINCH_GAIN = 1.5;

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
  /** Analog input per source (on-screen controls, gamepad); `virtual` is their clamped sum. */
  private virtualBy = new Map<string, VirtualInput>();
  private virtual: VirtualInput = { forward: 0, right: 0, up: 0, roll: 0 };
  /** Gamepad polling (set by attach in a real session) and the buttons held at the last poll. */
  private pads: (() => readonly (PadLike | null)[]) | null = null;
  private padHeld = { faster: false, slower: false, land: false };
  /** Eased movement input (camera axes), so flight starts and stops without a jolt. */
  private move = vec3();
  /** Pending pinch dolly, ln of the finger-spread ratio (positive = forward). */
  private dolly = 0;

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
    if (!n || !this.walkable(b) || n.altitude > WALK_RANGE) return false;
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

  /** A body with ground to stand on. */
  private walkable(b: Body | undefined): b is Body {
    return !!b && SOLID.has(b.kind) && b.kind !== 'star' && (this.deps.walkable?.(b) ?? true);
  }

  /** Whether walk mode can start right now (walkable ground within WALK_RANGE below the camera). */
  canWalk(): boolean {
    const n = this.nearest;
    const b = n ? this.deps.registry.body(n.bodyId) : undefined;
    return !!n && this.walkable(b) && n.altitude <= WALK_RANGE && !this.active;
  }

  /**
   * Flies straight down to the ground under the camera on `bodyId` (default: the nearest body)
   * and starts walking there. The end point follows the ground as its relief loads, so the
   * flight never ends inside a mountain or hanging above a basin. Resolves false when the body
   * has no surface to stand on (stars, unknown ids) or the flight is cancelled.
   */
  land(bodyId?: string): Promise<boolean> {
    const { frames, registry } = this.deps;
    const id = bodyId ?? this.computeNearest()?.bodyId;
    const b = id ? registry.body(id) : undefined;
    if (!this.walkable(b) || !frames.has(b.frame)) return Promise.resolve(false);
    const fixed = b.fixedFrame && frames.has(b.fixedFrame) ? b.fixedFrame : b.frame;
    const jd = this.deps.jd();
    const p = frames.convertPoint(this.st.frame, this.st.local, fixed, jd, vec3());
    if (!(v3len(p) > 0)) return Promise.resolve(false);
    const dir = v3normalize(vec3(), p);
    const pos = v3scale(vec3(), dir, b.radius + this.ground.heightAt(b.id, dir) + EYE_HEIGHT);
    // Face the way the view pointed, levelled; looking straight down, face "screen up" instead.
    const q = this.quatIn(fixed, jd);
    let heading = qrotate(vec3(), q, vec3(0, 0, -1));
    heading = v3sub(heading, heading, v3scale(vec3(), dir, v3dot(heading, dir)));
    if (v3len(heading) < 0.2) {
      heading = qrotate(vec3(), q, vec3(0, 1, 0));
      heading = v3sub(heading, heading, v3scale(vec3(), dir, v3dot(heading, dir)));
    }
    if (v3len(heading) < 1e-6) heading = Math.abs(dir.z) < 0.9 ? vec3(0, 0, 1) : vec3(1, 0, 0);
    const quatEnd = qlookRotation(quat(), v3normalize(heading, heading), dir);
    const done = this.goto({
      id: `land:${b.id}`,
      title: `Surface of ${b.name}`,
      frame: fixed,
      pos,
      quat: quatEnd,
      lookAt: b.id,
      mode: 'walk',
    });
    if (this.active) {
      this.active.land = { body: b, dir };
      // The HUD shows where the descent is heading from its first frame.
      this._target = b.id;
      this.emit();
    }
    return done;
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
        run:
          k.has('ShiftLeft') ||
          k.has('ShiftRight') ||
          Math.hypot(this.virtual.forward, this.virtual.right) > 0.95,
        jump: k.has('Space') || this.virtual.up > 0.5,
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
  /**
   * Sets analog movement from one source, on-screen controls by default (axes left out keep
   * their value). Sources add up, so a gamepad at rest does not cancel the on-screen stick.
   */
  setVirtualInput(v: Partial<VirtualInput>, source = 'screen'): void {
    const prev = this.virtualBy.get(source) ?? { forward: 0, right: 0, up: 0, roll: 0 };
    const c = (x: number | undefined, old: number) =>
      x === undefined ? old : Math.min(1, Math.max(-1, Number.isFinite(x) ? x : 0));
    this.virtualBy.set(source, {
      forward: c(v.forward, prev.forward),
      right: c(v.right, prev.right),
      up: c(v.up, prev.up),
      roll: c(v.roll, prev.roll),
    });
    const sum = { forward: 0, right: 0, up: 0, roll: 0 };
    for (const s of this.virtualBy.values()) {
      sum.forward += s.forward;
      sum.right += s.right;
      sum.up += s.up;
      sum.roll += s.roll;
    }
    const k = (x: number) => Math.min(1, Math.max(-1, x));
    this.virtual = { forward: k(sum.forward), right: k(sum.right), up: k(sum.up), roll: k(sum.roll) };
    if (this.active && (this.virtual.forward || this.virtual.right || this.virtual.up)) this.cancelGoto();
  }
  /** Adds a look rotation, radians (touch and gamepad sticks; the mouse drag uses the same path). */
  addLook(yaw: number, pitch: number): void {
    this.look.yaw += yaw;
    this.look.pitch += pitch;
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
    // A view that names no field of view gets the normal one back (a bookmark's telescope view
    // used to stay on for every flight after it).
    const fov0 = this.st.fovY;
    const fov1 = bm?.fovY ?? DEFAULT_FOV;
    const finish = () => {
      this.st.fovY = fov1;
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
      this.active = { flight, frame, t: 0, resolve, finish, fov0, fov1 };
      this.emit();
    });
  }

  // ----- per-frame update -----
  /** Polls the gamepad (when one is connected) into the analog input, look and one-shot actions. */
  pollGamepad(dt: number, pads: readonly (PadLike | null)[]): void {
    const pad = pickPad(pads);
    if (!pad) {
      if (this.virtualBy.has('pad')) this.setVirtualInput({ forward: 0, right: 0, up: 0, roll: 0 }, 'pad');
      return;
    }
    const c = readPad(pad);
    this.setVirtualInput({ forward: c.forward, right: c.right, up: c.up, roll: c.roll }, 'pad');
    // Look rate follows the field of view, like the mouse drag.
    const k = (this.st.fovY / DEFAULT_FOV) * dt;
    if (c.yaw || c.pitch) this.addLook(c.yaw * k, c.pitch * k);
    const h = this.padHeld;
    if (c.faster && !h.faster) this.speedFactor = this._k * 1.25;
    if (c.slower && !h.slower) this.speedFactor = this._k / 1.25;
    if (c.land && !h.land) {
      if (this._mode === 'walk') this.setMode('free');
      else if (this.canWalk()) this.setMode('walk');
      else void this.land();
    }
    h.faster = c.faster;
    h.slower = c.slower;
    h.land = c.land;
  }

  /** Advances the camera by dt real seconds. */
  update(dt: number): void {
    if (this.pads) {
      try {
        this.pollGamepad(dt, this.pads());
      } catch {
        // A browser that refuses gamepad access (permissions policy): keyboard and mouse still work.
        this.pads = null;
      }
    }
    if (this.active) {
      const a = this.active;
      a.t += dt;
      if (a.land) {
        // The ground may only become known (or finer) during the descent: follow it.
        const { body, dir } = a.land;
        v3scale(a.flight.spec.p1, dir, body.radius + this.ground.heightAt(body.id, dir) + EYE_HEIGHT);
      }
      const pose = { local: vec3(), quat: quat() };
      const done = a.flight.sample(a.t, pose);
      this.st.frame = a.frame;
      this.st.local = pose.local;
      this.st.quat = pose.quat;
      // Zoom eases with the flight (in log space, like the distance).
      const z = Math.min(1, a.t / Math.max(a.flight.duration, 1e-6));
      this.st.fovY = a.fov0 * (a.fov1 / a.fov0) ** (z * z * (3 - 2 * z));
      // Look input during a flight is dropped, not saved up for one jolt on arrival.
      this.look.yaw = this.look.pitch = 0;
      this.move.x = this.move.y = this.move.z = 0;
      this.dolly = 0;
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
        // Ease the movement axes so pressing and releasing a key ramps the speed (MOVE_TAU).
        const k = 1 - Math.exp(-dt / MOVE_TAU);
        const m = this.move;
        m.x += (input.right - m.x) * k;
        m.y += (input.up - m.y) * k;
        m.z += (input.forward - m.z) * k;
        if (Math.hypot(m.x, m.y, m.z) < 1e-3 && !input.right && !input.up && !input.forward)
          m.x = m.y = m.z = 0;
        input.right = m.x;
        input.up = m.y;
        input.forward = m.z;
        applyFree(this.st, input, v, dt);
        if (this.dolly) {
          // Pinch: move along the view by a fraction of the altitude (exact in log space).
          const f = qrotate(vec3(), this.st.quat, vec3(0, 0, -1));
          const step = this.nearestDistance() * (1 - Math.exp(-PINCH_GAIN * this.dolly));
          this.st.local = v3add(vec3(), this.st.local, v3scale(f, f, step));
          this.dolly = 0;
        }
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
    const c = (x: number) => Math.min(1, Math.max(-1, x));
    const vi = this.virtual;
    input.forward = c(has('KeyW') - has('KeyS') + vi.forward);
    input.right = c(has('KeyD') - has('KeyA') + vi.right);
    input.up = c(has('KeyR', 'Space') - has('KeyF', 'KeyC') + vi.up);
    input.roll = c(has('KeyE') - has('KeyQ') + vi.roll);
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
        // Shift+F (full screen) and Shift+C (constellation lines) are shortcuts, not "fly down".
        if (e.shiftKey && (e.code === 'KeyF' || e.code === 'KeyC')) return;
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
    // Mouse/trackpad look. P4-P hardening: a drag ends on pointerup, pointercancel, lost pointer
    // capture or the first move that arrives with the primary button released (a release outside
    // the window used to leave the view turning with every hover move); a single move event that
    // jumps by more than MAX_LOOK_JUMP of the viewport height (pointer re-entry, capture glitches)
    // only re-bases the drag instead of throwing the view.
    let drag: { id: number; x: number; y: number } | null = null;
    // Touch: one finger looks around; two fingers pinch to move along the view (zoom in orbit).
    const touches = new Map<number, { x: number; y: number }>();
    let spread = 0;
    const fingerSpread = (): number => {
      const [a, b] = [...touches.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    const endDrag = (e: PointerEvent) => {
      if (touches.delete(e.pointerId)) {
        spread = 0;
        // The finger that stays down takes over the look drag from where it is.
        const rest = [...touches.entries()][0];
        drag = touches.size === 1 && rest ? { id: rest[0], x: rest[1].x, y: rest[1].y } : null;
        if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture?.(e.pointerId);
        return;
      }
      if (!drag || e.pointerId !== drag.id) return;
      drag = null;
      if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture?.(e.pointerId);
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (e.pointerType === 'touch') {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size >= 2) {
          spread = fingerSpread();
          drag = null;
        } else drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      } else drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      try {
        el.setPointerCapture?.(e.pointerId);
      } catch {
        // Pointer already gone (released between dispatch and capture): the drag ends on its next move.
      }
    };
    const onMove = (e: PointerEvent) => {
      const touch = touches.get(e.pointerId);
      if (touch) {
        touch.x = e.clientX;
        touch.y = e.clientY;
        if (touches.size >= 2) {
          const d = fingerSpread();
          if (spread > 0 && d > 0) {
            const r = Math.log(d / spread);
            if (this._mode === 'orbit') this.look.zoom *= Math.exp(-r);
            else if (this._mode === 'free') {
              this.dolly += r;
              if (this.active) this.cancelGoto();
            }
          }
          spread = d;
          return;
        }
      }
      if (!drag || e.pointerId !== drag.id) return;
      if (e.pointerType !== 'touch' && (e.buttons & 1) === 0) {
        endDrag(e);
        return;
      }
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      if (Math.hypot(dx, dy) > MAX_LOOK_JUMP * this.viewportHeight) return;
      const rad = this.st.fovY / this.viewportHeight;
      this.look.yaw += dx * rad;
      this.look.pitch += dy * rad;
    };
    const onUp = (e: PointerEvent) => endDrag(e);
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (this._mode === 'orbit') this.look.zoom *= Math.exp(e.deltaY * 0.001);
      else this.speedFactor = this._k * Math.exp(-e.deltaY * 0.0015);
    };
    // Gamepads are polled each frame once one has announced itself (browsers hide them until a
    // button is pressed).
    const onPad = () => {
      if (typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function')
        this.pads = () => navigator.getGamepads();
    };
    window.addEventListener('gamepadconnected', onPad);
    window.addEventListener('keydown', onWalkKey, true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('lostpointercapture', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      window.removeEventListener('gamepadconnected', onPad);
      this.pads = null;
      window.removeEventListener('keydown', onWalkKey, true);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('lostpointercapture', onUp);
      el.removeEventListener('wheel', onWheel);
    };
  }
}
