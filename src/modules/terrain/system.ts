/**
 * Terrain runtime: per-body managers, the 'terrain' SurfaceGeometryProvider (priority 10), the
 * GroundProvider and the patch generator (comlink worker pool with an in-process fallback).
 */
import type {
  AssetLoader,
  Body,
  GroundProvider,
  HeightSourceSpec,
  HeightWorkerContext,
  Registry,
  Renderable,
  ResourceBudget,
  SurfaceGeometryProvider,
  SurfaceShading,
  Vec3d,
  ViewState,
  WorkerPool,
} from '../../core/contracts';
import type { IUniform } from 'three';
import { v3len, vec3 } from '../../core/math64';
import { DEFAULT_HEIGHT_MODULE, defaultHeightSpec, NO_DEFAULT_RELIEF, terrainEligible } from './defaults';
import { groundNormal } from './ground';
import { loadHeightFunction, peekHeightFunction } from './height-modules';
import { TerrainManager, type Generator } from './manager';
import { buildPatch } from './patch';
import { buildTerrain } from './render';
import type { TerrainWorkerApi } from './terrain.worker';

export const TERRAIN_PROVIDER_ID = 'terrain';
export const TERRAIN_PRIORITY = 10;
/** Terrain replaces the sphere below this altitude, in body radii. */
export const HANDOFF_RADII = 3;
/** Managers observe the camera below this altitude, in radii. */
const OBSERVE_RADII = 3.5;
/** Managers drop all but the roots above this altitude, in radii. */
const TRIM_RADII = 4;

export interface TerrainSystemDeps {
  registry: Registry;
  hasFrame(id: string): boolean;
  assets: AssetLoader;
  workers: WorkerPool | null;
  budget?: ResourceBudget;
  exposure: IUniform<number>;
  baseUrl: string;
  seed: number;
  test: boolean;
  onError?: (msg: string) => void;
}

export interface TerrainStats {
  tiles: number;
  leaves: number;
  inflight: number;
}

export class TerrainSystem {
  readonly managers = new Map<string, TerrainManager>();
  private gen: Generator | null = null;
  private readonly fnCtx: HeightWorkerContext;
  private readonly tmp = vec3();

  constructor(private readonly deps: TerrainSystemDeps) {
    this.fnCtx = { seed: deps.seed, fetchBinary: (p) => deps.assets.binary(p) };
  }

  /** Bodies whose registered spec failed to build; they fall back to the default (or lose terrain). */
  private readonly failedSpecs = new Map<string, HeightSourceSpec>();

  /**
   * Height spec of a body: the registered one, else the default 'fbm-craters-lite', or null for
   * bodies in NO_DEFAULT_RELIEF without a working registered spec.
   */
  specFor(b: Body): HeightSourceSpec | null {
    const reg = this.deps.registry.heightSource(b.id);
    if (reg && this.failedSpecs.get(b.id) !== reg) return reg;
    return NO_DEFAULT_RELIEF.has(b.id) ? null : defaultHeightSpec(b, this.deps.seed);
  }

  /** A spec failed SPEC_FAILURE_LIMIT builds in a row: fall back once, report once. */
  private specFailed(b: Body, spec: HeightSourceSpec): void {
    if (spec.workerModule === DEFAULT_HEIGHT_MODULE && !this.deps.registry.heightSource(b.id)) return;
    this.failedSpecs.set(b.id, this.deps.registry.heightSource(b.id) ?? spec);
    this.deps.onError?.(`terrain ${b.id}: height source '${spec.workerModule}' keeps failing; falling back`);
    this.refreshSpecs();
  }

  /** Loads the CPU height function of a body (collision, bookmarks). */
  loadFunction(b: Body): Promise<void> {
    const mgr = this.manager(b);
    if (!mgr) return Promise.resolve();
    return this.loadFn(mgr);
  }

  private loadFn(mgr: TerrainManager): Promise<void> {
    const spec = mgr.spec;
    const now = peekHeightFunction(spec);
    if (now) {
      mgr.fn = now;
      return Promise.resolve();
    }
    return this.deps.assets.track(
      loadHeightFunction(spec, this.fnCtx).then(
        (fn) => {
          if (mgr.spec === spec) mgr.fn = fn;
        },
        (e: unknown) => this.deps.onError?.(`terrain: height module for ${mgr.opts.bodyId}: ${String(e)}`),
      ),
      'terrain.height',
    );
  }

  /** The manager of an eligible body (created on first use). */
  manager(b: Body): TerrainManager | undefined {
    let m = this.managers.get(b.id);
    if (m) return m;
    if (!terrainEligible(b)) return undefined;
    const spec = this.specFor(b);
    if (!spec) return undefined;
    const a = b.radius;
    m = new TerrainManager({
      bodyId: b.id,
      a,
      c: a * (1 - (b.oblateness ?? 0)),
      spec,
      generator: () => this.generator(),
      base: this.deps.baseUrl,
      seed: this.deps.seed,
      test: this.deps.test,
      budget: this.deps.budget,
      onError: (e) => this.deps.onError?.(`terrain ${b.id}: ${e instanceof Error ? e.message : String(e)}`),
      onSpecFailed: (s) => this.specFailed(b, s),
    });
    this.managers.set(b.id, m);
    void this.loadFn(m);
    return m;
  }

  /** Re-reads registered height specs (registry 'height' notifications). */
  refreshSpecs(): void {
    for (const m of this.managers.values()) {
      const b = this.deps.registry.body(m.opts.bodyId);
      if (!b) continue;
      const spec = this.specFor(b);
      if (!spec) {
        m.dispose();
        this.managers.delete(m.opts.bodyId);
        continue;
      }
      if (
        spec === m.spec ||
        (spec.workerModule === m.spec.workerModule &&
          JSON.stringify(spec.params) === JSON.stringify(m.spec.params))
      )
        continue;
      m.reset(spec);
      void this.loadFn(m);
    }
  }

  private generator(): Generator {
    if (this.gen) return this.gen;
    const local: Generator = {
      build: (req) =>
        this.deps.assets.track(
          loadHeightFunction(req.spec, this.fnCtx).then((fn) => buildPatch(fn, req, req.key)),
        ),
    };
    const pool = this.deps.workers;
    if (!pool || typeof Worker === 'undefined') {
      this.gen = local;
      return local;
    }
    try {
      const h = pool.pool<TerrainWorkerApi>(
        'terrain.gen',
        () => new Worker(new URL('./terrain.worker.ts', import.meta.url), { type: 'module' }),
        Math.max(1, Math.min(2, pool.maxWorkers)),
      );
      let broken = false;
      this.gen = {
        build: (req) =>
          broken
            ? local.build(req)
            : h.call('build', req).catch((e: unknown) => {
                if (!broken)
                  this.deps.onError?.(`terrain: worker failed, generating on the main thread (${String(e)})`);
                broken = true;
                return local.build(req);
              }),
      };
    } catch {
      this.gen = local;
    }
    return this.gen;
  }

  provider(): SurfaceGeometryProvider {
    return {
      id: TERRAIN_PROVIDER_ID,
      bodyId: '*',
      priority: TERRAIN_PRIORITY,
      wants: (view, body) => this.wants(view, body),
      build: (body, shading) => this.build(body, shading),
    };
  }

  wants(view: ViewState, body: Body): boolean {
    if (!terrainEligible(body) || !body.fixedFrame || !this.deps.hasFrame(body.fixedFrame)) return false;
    const R = body.radius;
    const alt = v3len(view.toCamera(body.frame, vec3(), this.tmp)) - R;
    let mgr = this.managers.get(body.id);
    if (alt > OBSERVE_RADII * R) {
      if (mgr) {
        mgr.active = false;
        if (alt > TRIM_RADII * R && mgr.tiles.size > 6) mgr.trim();
      }
      return false;
    }
    mgr ??= this.manager(body);
    if (!mgr) return false;
    mgr.observe(view, body.fixedFrame);
    const limit = (mgr.active ? HANDOFF_RADII + 0.05 : HANDOFF_RADII) * R;
    mgr.active = alt < limit && mgr.rootsResident();
    return mgr.active;
  }

  build(body: Body, shading: SurfaceShading): Renderable {
    return buildTerrain(body, shading, {
      registry: this.deps.registry,
      exposure: this.deps.exposure,
      manager: () => this.managers.get(body.id),
      fixedFrame: body.fixedFrame ?? body.frame,
    });
  }

  ground(): GroundProvider {
    const body = (id: string) => {
      const b = this.deps.registry.body(id);
      return b ? this.manager(b) : undefined;
    };
    return {
      id: TERRAIN_PROVIDER_ID,
      bodyId: '*',
      priority: TERRAIN_PRIORITY,
      heightAt: (bodyId: string, dir: Vec3d) => body(bodyId)?.heightAt(dir) ?? null,
      normalAt: (bodyId: string, dir: Vec3d, out: Vec3d) => {
        const m = body(bodyId);
        if (!m?.fn) {
          out.x = dir.x;
          out.y = dir.y;
          out.z = dir.z;
          return out;
        }
        return groundNormal(m.fn, m.opts.a, m.opts.c, dir, m.levelAt(dir), out);
      },
    };
  }

  /** See terrainHeightAt (public.ts); never creates a manager. */
  heightAt(bodyId: string, dir: Vec3d): number | null {
    return this.managers.get(bodyId)?.heightAt(dir) ?? null;
  }

  stats(): TerrainStats {
    let tiles = 0;
    let leaves = 0;
    let inflight = 0;
    for (const m of this.managers.values()) {
      tiles += m.tiles.size;
      leaves += m.active ? m.leaves.length : 0;
      inflight += m.inflight.size;
    }
    return { tiles, leaves, inflight };
  }

  dispose(): void {
    for (const m of this.managers.values()) m.dispose();
    this.managers.clear();
  }
}
