/**
 * Registry implementation (contracts: Registry / RegistryReader). The engine passes hooks so
 * renderables and screen passes reach the renderer as they are added or removed.
 */
import type {
  Body,
  Bookmark,
  FrameDef,
  FrameTree,
  HeightSourceSpec,
  InfoProvider,
  OccluderProvider,
  Registry,
  RegistryKind,
  Renderable,
  ScreenPass,
  SearchProvider,
  SettingDef,
  SurfaceGeometryProvider,
  SurfaceShading,
  TourDef,
  ValidityRange,
} from './contracts';

export interface RegistryHooks {
  renderableAdded?(r: Renderable): void;
  renderableRemoved?(r: Renderable): void;
  screenPassAdded?(p: ScreenPass): void;
  screenPassRemoved?(p: ScreenPass): void;
}

function byPriority<T extends { priority?: number }>(list: T[]): T | undefined {
  let best: T | undefined;
  for (const x of list) if (!best || (x.priority ?? 0) >= (best.priority ?? 0)) best = x;
  return best;
}

export class RegistryImpl implements Registry {
  private _bodies = new Map<string, Body>();
  private _bookmarks = new Map<string, Bookmark>();
  private _renderables = new Map<string, Renderable>();
  private _passes = new Map<string, ScreenPass>();
  private _shading = new Map<string, SurfaceShading[]>();
  private _geometries: SurfaceGeometryProvider[] = [];
  private _heights = new Map<string, HeightSourceSpec[]>();
  private _occluders: OccluderProvider[] = [];
  private _search: SearchProvider[] = [];
  private _info: InfoProvider[] = [];
  private _tours = new Map<string, TourDef>();
  private _settings = new Map<string, SettingDef>();
  private _validity = new Map<string, ValidityRange>();
  private listeners = new Set<(k: RegistryKind) => void>();

  constructor(
    private readonly frames: FrameTree,
    private readonly hooks: RegistryHooks = {},
  ) {}

  private emit(kind: RegistryKind): void {
    for (const l of this.listeners) {
      try {
        l(kind);
      } catch (e) {
        console.error('[registry] listener failed', e);
      }
    }
  }

  subscribe(listener: (kind: RegistryKind) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ----- read side -----
  body(id: string) {
    return this._bodies.get(id);
  }
  bodies() {
    return [...this._bodies.values()];
  }
  bookmark(id: string) {
    return this._bookmarks.get(id);
  }
  bookmarks() {
    return [...this._bookmarks.values()];
  }
  renderables() {
    return [...this._renderables.values()];
  }
  screenPasses() {
    return [...this._passes.values()];
  }
  surfaceShading(bodyId: string) {
    return byPriority(this._shading.get(bodyId) ?? []);
  }
  surfaceGeometries() {
    return this._geometries.slice();
  }
  heightSource(bodyId: string) {
    return byPriority(this._heights.get(bodyId) ?? []);
  }
  occluderProviders() {
    return this._occluders.slice();
  }
  searchProviders() {
    return this._search.slice();
  }
  infoProviders() {
    return this._info.slice();
  }
  tours() {
    return [...this._tours.values()];
  }
  settings() {
    return [...this._settings.values()];
  }
  validityRanges() {
    return [...this._validity.values()];
  }

  // ----- write side -----
  addFrame(f: FrameDef): void {
    this.frames.addFrame(f);
    this.emit('frame');
  }
  addBody(b: Body): void {
    this._bodies.set(b.id, b);
    this.emit('body');
  }
  removeBody(id: string): void {
    if (this._bodies.delete(id)) this.emit('body');
  }
  addRenderable(r: Renderable): void {
    if (this._renderables.has(r.id)) this.removeRenderable(r.id);
    this._renderables.set(r.id, r);
    this.hooks.renderableAdded?.(r);
    this.emit('renderable');
  }
  removeRenderable(id: string): void {
    const r = this._renderables.get(id);
    if (!r) return;
    this._renderables.delete(id);
    this.hooks.renderableRemoved?.(r);
    r.dispose();
    this.emit('renderable');
  }
  addScreenPass(p: ScreenPass): void {
    if (this._passes.has(p.id)) this.removeScreenPass(p.id);
    this._passes.set(p.id, p);
    this.hooks.screenPassAdded?.(p);
    this.emit('screenPass');
  }
  removeScreenPass(id: string): void {
    const p = this._passes.get(id);
    if (!p) return;
    this._passes.delete(id);
    this.hooks.screenPassRemoved?.(p);
    p.dispose?.();
    this.emit('screenPass');
  }
  setSurfaceShading(s: SurfaceShading): void {
    const list = (this._shading.get(s.bodyId) ?? []).filter((x) => x.priority !== s.priority);
    list.push(s);
    this._shading.set(s.bodyId, list);
    this.emit('surface');
  }
  setSurfaceGeometry(g: SurfaceGeometryProvider): void {
    this._geometries = this._geometries.filter((x) => !(x.id === g.id && x.bodyId === g.bodyId));
    this._geometries.push(g);
    this.emit('surface');
  }
  addHeightSource(h: HeightSourceSpec): void {
    const list = this._heights.get(h.bodyId) ?? [];
    list.push(h);
    this._heights.set(h.bodyId, list);
    this.emit('height');
  }
  addOccluders(p: OccluderProvider): void {
    this._occluders.push(p);
    this.emit('occluder');
  }
  addSearch(p: SearchProvider): void {
    this._search = this._search.filter((x) => x.id !== p.id);
    this._search.push(p);
    this.emit('search');
  }
  addInfo(p: InfoProvider): void {
    this._info = this._info.filter((x) => x.id !== p.id);
    this._info.push(p);
    this.emit('info');
  }
  addBookmarks(b: Bookmark[]): void {
    for (const bm of b) this._bookmarks.set(bm.id, bm);
    this.emit('bookmark');
  }
  addTour(t: TourDef): void {
    this._tours.set(t.id, t);
    this.emit('tour');
  }
  addSetting(s: SettingDef): void {
    this._settings.set(s.id, s);
    this.emit('setting');
  }
  addValidity(v: ValidityRange): void {
    this._validity.set(v.id, v);
    this.emit('validity');
  }
}
