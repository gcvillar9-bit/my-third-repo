/**
 * Per-body terrain state (no three.js): height spec, CPU height function, tile cache (LRU with a
 * per-preset cap), worker requests and the current quadtree selection.
 */
import type {
  BudgetEntry,
  HeightFunction,
  HeightSourceSpec,
  ResourceBudget,
  Vec3d,
  ViewState,
} from '../../core/contracts';
import { qrotate, qrotateInv, quat, vec3 } from '../../core/math64';
import { dirToFace, ellipsoidRadius, MAX_LEVEL, ROOT_KEYS, unpackKey } from './cube';
import { groundRadius } from './ground';
import { PATCH_BYTES, type PatchData } from './patch';
import { leafLevelAt, selectTree, type NodeBounds, type SelectParams } from './select';
import type { TerrainBuildRequest } from './terrain.worker';

/** Requests issued per frame (lifted in test mode). */
export const SPLIT_BUDGET = 8;
export const MAX_INFLIGHT = 16;
/** Cache slots kept free for in-flight requests. */
export const INFLIGHT_RESERVE = 8;
/** Draw-call cap of one body's terrain. */
export const MAX_LEAVES = 300;
/** Bound on remembered node bounds (≈100 B each). */
export const KNOWN_BOUNDS_MAX = 50_000;
/** Retry delay after a failed tile build: doubles per failure of that key, ms. */
export const RETRY_MIN_MS = 1000;
export const RETRY_MAX_MS = 30_000;
/** Consecutive failed builds (no success in between) after which the spec is reported as failed. */
export const SPEC_FAILURE_LIMIT = 24;
/** Ground level used before any tile is resident. */
export const DEFAULT_GROUND_LEVEL = 16;

export interface Generator {
  build(req: TerrainBuildRequest): Promise<PatchData>;
}

export interface Tile extends PatchData {
  bounds: NodeBounds;
  lastUsed: number;
  /** GPU resources created by the renderer (disposed on eviction). */
  gpu: { geometry: unknown; dispose(): void } | null;
  /** Spec generation that built the tile (softReset rebuilds older ones in place). */
  epoch: number;
}

export interface ManagerOptions {
  bodyId: string;
  a: number;
  c: number;
  spec: HeightSourceSpec;
  /** Patch generator (worker pool or in-process). */
  generator: () => Generator;
  base: string;
  seed: number;
  test: boolean;
  budget?: ResourceBudget;
  onError?: (e: unknown) => void;
  /** Called once when SPEC_FAILURE_LIMIT builds in a row have failed for the current spec. */
  onSpecFailed?: (spec: HeightSourceSpec) => void;
  /** Clock for retry back-off, ms (default performance.now). */
  now?: () => number;
}

export interface ObservedView {
  cam: Vec3d;
  planes: Vec3d[];
  pixelAngle: number;
  target: number;
  cap: number;
}

export class TerrainManager {
  readonly tiles = new Map<number, Tile>();
  readonly inflight = new Set<number>();
  /** Exact bounds of every node built so far (kept after eviction; bounded). */
  private readonly known = new Map<number, NodeBounds>();
  fn: HeightFunction | null = null;
  /** True while the terrain geometry is the active surface provider. */
  active = false;
  leaves: Tile[] = [];
  split: ReadonlySet<number> = new Set();
  private used: ReadonlySet<number> = new Set();
  private last: ObservedView | null = null;
  private tick = 0;
  private epoch = 0;
  private failures = 0;
  /** Consecutive failed builds of the current spec. */
  private streak = 0;
  /** Per-key retry back-off after failed builds. */
  private readonly retry = new Map<number, { until: number; delay: number }>();
  private entry: BudgetEntry | null = null;
  private observedFrame = -1;
  /** Set when the tile set changes, so the next observe re-selects even for an unchanged view. */
  private dirty = true;

  constructor(readonly opts: ManagerOptions) {}

  get spec(): HeightSourceSpec {
    return this.opts.spec;
  }

  rootsResident(): boolean {
    return ROOT_KEYS.every((k) => this.tiles.has(k));
  }

  /** Records the camera of this frame and refreshes the selection (once per frame). */
  observe(view: ViewState, fixedFrame: string): void {
    if (view.frameIndex === this.observedFrame) return;
    this.observedFrame = view.frameIndex;
    const o = view.toCamera(fixedFrame, vec3(), vec3());
    const qf = view.frameQuat(fixedFrame, quat());
    const cam = qrotateInv(vec3(), qf, vec3(-o.x, -o.y, -o.z));
    const planes = frustumPlanes(view.fovY, view.viewport[0] / Math.max(1, view.viewport[1])).map((n) =>
      qrotateInv(vec3(), qf, qrotate(vec3(), view.worldQuat, n)),
    );
    this.observeRaw({
      cam,
      planes,
      pixelAngle: view.pixelAngle,
      target: view.knobs.terrainSse,
      cap: view.knobs.terrainTileCap,
    });
  }

  observeRaw(v: ObservedView): void {
    // Nothing moved and no tile arrived or left: the previous selection still holds.
    if (!this.dirty && !this.retry.size && this.last && sameView(this.last, v)) return;
    this.last = v;
    this.select();
  }

  /** Altitude of the last observed camera above the equatorial radius, m. */
  altitude(): number {
    const c = this.last?.cam;
    return c ? Math.hypot(c.x, c.y, c.z) - this.opts.a : Infinity;
  }

  select(): void {
    const v = this.last;
    if (!v) return;
    this.dirty = false;
    this.tick++;
    const { a, c } = this.opts;
    const maxAbs = this.opts.spec.maxAbsHeight;
    const p: SelectParams = {
      cam: v.cam,
      planes: v.planes,
      pixelAngle: v.pixelAngle,
      target: v.target,
      maxLeaves: Math.min(MAX_LEAVES, Math.floor(0.75 * v.cap)),
      maxTiles: Math.max(6, v.cap - INFLIGHT_RESERVE),
      a,
      c,
      rOcc: Math.min(a, c) - maxAbs,
    };
    const sel = selectTree(
      p,
      (k) => this.known.get(k) ?? this.tiles.get(k)?.bounds,
      this.split,
      (k) => this.tiles.has(k),
    );
    this.split = sel.split;
    this.used = sel.used;
    this.leaves = sel.leaves.map((k) => this.tiles.get(k)!);
    for (const k of sel.used) this.tiles.get(k)!.lastUsed = this.tick;
    this.issue(sel.requests, v.cap);
    this.refresh();
  }

  /** Rebuilds drawn tiles of an older spec generation (after softReset); they stay drawn meanwhile. */
  private refresh(): void {
    const maxInflight = this.opts.test ? 2 * MAX_INFLIGHT : MAX_INFLIGHT;
    let n = 0;
    for (const t of this.leaves) {
      if (t.epoch === this.epoch || this.inflight.has(t.key)) continue;
      if (n >= SPLIT_BUDGET || this.inflight.size >= maxInflight) break;
      this.request(t.key);
      n++;
    }
  }

  private issue(reqs: readonly { key: number }[], cap: number): void {
    const budget = this.opts.test ? Infinity : SPLIT_BUDGET;
    const maxInflight = this.opts.test ? 2 * MAX_INFLIGHT : MAX_INFLIGHT;
    let n = 0;
    const now = this.retry.size ? this.now() : 0;
    for (const r of reqs) {
      if (n >= budget || this.inflight.size >= maxInflight) break;
      if (this.inflight.has(r.key) || this.tiles.has(r.key)) continue;
      const wait = this.retry.get(r.key);
      if (wait && wait.until > now) continue;
      if (!this.makeRoom(cap)) break;
      this.request(r.key);
      n++;
    }
  }

  /** Evicts least-recently-used unpinned tiles until one more fits under `cap`. */
  private makeRoom(cap: number): boolean {
    const isRoot = (k: number) => unpackKey(k).level === 0;
    while (this.tiles.size + this.inflight.size >= cap) {
      let victim: Tile | null = null;
      for (const t of this.tiles.values()) {
        if (this.used.has(t.key) || isRoot(t.key)) continue;
        if (!victim || t.lastUsed < victim.lastUsed) victim = t;
      }
      if (!victim) return false;
      this.drop(victim);
    }
    return true;
  }

  private drop(t: Tile): void {
    t.gpu?.dispose();
    t.gpu = null;
    this.tiles.delete(t.key);
    this.dirty = true;
    this.account();
  }

  private request(key: number): void {
    const id = unpackKey(key);
    const { a, c, spec, base, seed } = this.opts;
    this.inflight.add(key);
    const epoch = this.epoch;
    let gen: Generator;
    try {
      gen = this.opts.generator();
    } catch (e) {
      this.inflight.delete(key);
      this.fail(e);
      return;
    }
    gen
      .build({ ...id, key, a, c, spec: { workerModule: spec.workerModule, params: spec.params }, base, seed })
      .then(
        (data) => {
          this.inflight.delete(key);
          if (epoch !== this.epoch) return;
          this.streak = 0;
          this.retry.delete(key);
          const bounds = tileBounds(data);
          if (this.known.size > KNOWN_BOUNDS_MAX) {
            // Forget evicted nodes only; resident tiles (roots included) keep their bounds.
            this.known.clear();
            for (const t of this.tiles.values()) this.known.set(t.key, t.bounds);
          }
          this.known.set(key, bounds);
          // A rebuilt tile (softReset) replaces the drawn one in place.
          const old = this.tiles.get(key);
          old?.gpu?.dispose();
          this.tiles.set(key, { ...data, bounds, lastUsed: old?.lastUsed ?? this.tick, gpu: null, epoch });
          this.dirty = true;
          this.account();
          if (this.opts.test) this.select();
        },
        (e: unknown) => {
          this.inflight.delete(key);
          if (epoch !== this.epoch) return;
          const prev = this.retry.get(key);
          const delay = prev ? Math.min(RETRY_MAX_MS, prev.delay * 2) : RETRY_MIN_MS;
          this.retry.set(key, { until: this.now() + delay, delay });
          this.fail(e);
          if (++this.streak === SPEC_FAILURE_LIMIT) this.opts.onSpecFailed?.(this.opts.spec);
        },
      );
  }

  private now(): number {
    return this.opts.now ? this.opts.now() : performance.now();
  }

  private fail(e: unknown): void {
    if (this.failures++ < 3) this.opts.onError?.(e);
  }

  private account(): void {
    const b = this.opts.budget;
    if (!b) return;
    const bytes = this.tiles.size * PATCH_BYTES;
    if (!this.entry) this.entry = b.alloc('terrain', this.opts.bodyId, bytes);
    else this.entry.resize(bytes);
  }

  /** Drops every tile except the roots (camera far away). */
  trim(): void {
    this.active = false;
    for (const t of [...this.tiles.values()]) if (unpackKey(t.key).level > 0) this.drop(t);
    this.split = new Set();
    this.used = new Set();
    this.leaves = [];
    this.dirty = true;
  }

  /**
   * Parameter-only spec change (the HD terrain block moved, or HD turned on or off): keeps drawing the
   * resident tiles and keeps the current CPU height function while the drawn tiles are rebuilt for the
   * new spec and swapped in one by one (select -> refresh); the system replaces the function when the
   * new one loads. Before this, every move of the HD block dropped all of Earth's tiles at once.
   */
  softReset(spec: HeightSourceSpec): void {
    this.epoch++;
    this.retry.clear();
    this.streak = 0;
    this.opts.spec = spec;
    this.dirty = true;
  }

  /** Drops everything (spec change, shutdown). In-flight results are discarded. */
  reset(spec?: HeightSourceSpec): void {
    this.epoch++;
    this.known.clear();
    this.retry.clear();
    this.streak = 0;
    for (const t of [...this.tiles.values()]) this.drop(t);
    this.split = new Set();
    this.used = new Set();
    this.leaves = [];
    this.dirty = true;
    if (spec) {
      this.opts.spec = spec;
      this.fn = null;
    }
  }

  dispose(): void {
    this.reset();
    this.entry?.free();
    this.entry = null;
  }

  /** Mesh level under a body-fixed direction (the level the GPU draws there). */
  levelAt(dir: Vec3d): number {
    if (!this.tiles.size) return DEFAULT_GROUND_LEVEL;
    const { face, s, t } = dirToFace(dir);
    return leafLevelAt(this.split, face, s, t);
  }

  /**
   * Ground height above the equatorial radius under unit body-fixed `dir`, m (null before the CPU
   * function loads), on the finest grid (MAX_LEVEL), not the level currently drawn there.
   *
   * P4-P fix (owner report: walking on the Moon, turning the view "throws me back"): the query used
   * to follow the drawn LOD, which changes when the view turns (frustum culling, tile cap, tiles
   * still loading). A coarse leaf under the feet sits metres to hundreds of metres below the
   * surface (chord sag), so the walker fell, then was snapped back up when the leaf refined. The
   * finest grid is what bookmarks use and what the mesh near the camera converges to (leaves
   * within NEAR_KEEP are never culled), so walking and collision are now independent of the LOD.
   */
  heightAt(dir: Vec3d): number | null {
    if (!this.fn) return null;
    return groundRadius(this.fn, this.opts.a, this.opts.c, dir, MAX_LEVEL) - this.opts.a;
  }

  /** Reference-ellipsoid radius along a unit direction, m. */
  ellipsoidRadius(dir: Vec3d): number {
    return ellipsoidRadius(this.opts.a, this.opts.c, dir.x, dir.y, dir.z);
  }
}

function sameView(a: ObservedView, b: ObservedView): boolean {
  if (
    a.cam.x !== b.cam.x ||
    a.cam.y !== b.cam.y ||
    a.cam.z !== b.cam.z ||
    a.pixelAngle !== b.pixelAngle ||
    a.target !== b.target ||
    a.cap !== b.cap ||
    a.planes.length !== b.planes.length
  )
    return false;
  for (let i = 0; i < a.planes.length; i++) {
    const p = a.planes[i];
    const q = b.planes[i];
    if (p.x !== q.x || p.y !== q.y || p.z !== q.z) return false;
  }
  return true;
}

export function tileBounds(d: PatchData): NodeBounds {
  return {
    centre: { x: d.centre[0], y: d.centre[1], z: d.centre[2] },
    radius: d.radius,
    rMax: d.rMax,
    hMin: d.hMin,
    hMax: d.hMax,
  };
}

/** Inward unit normals of the 4 side planes of a camera frustum, camera axes (looking down −Z). */
export function frustumPlanes(fovY: number, aspect: number): Vec3d[] {
  const ty = Math.tan(fovY / 2) * 1.05;
  const tx = ty * aspect;
  const n = (x: number, y: number, z: number) => {
    const l = Math.hypot(x, y, z);
    return vec3(x / l, y / l, z / l);
  };
  return [n(1, 0, -tx), n(-1, 0, -tx), n(0, 1, -ty), n(0, -1, -ty)];
}
