/**
 * UI state (Preact signals) and actions shared by the components, the keyboard handler and
 * the UiApi returned by mountUi.
 */
import { batch, signal } from '@preact/signals';
import type {
  Body,
  Bookmark,
  InfoCard,
  InfoFact,
  SearchEntry,
  SettingDef,
  UiContext,
  ViewState,
} from '../core/contracts';
import { v3len, vec3 } from '../core/math64';
import { validityBadges, type ValidityBadge } from '../core/time';
import { copyLink, shareUrl, stateFromCamera } from '../app/url-state';
import {
  formatDistance,
  formatInstant,
  formatLightTime,
  formatRate,
  formatSpeed,
  frameLabel,
  logScaleFraction,
} from './format';
import { ORBITS_SETTING } from '../modules/solar-system/public';
import { CONSTELLATIONS_SETTING, LINE_BOOKMARKS } from '../modules/starsystems/public';
import { terrainEligible } from '../modules/terrain/public';
import { TOUR_ENTRY_PREFIX, tours } from '../modules/tours/public';
import { resolveExplore, type ResolvedGroup } from './explore';
import { bodyPriority, project } from './labels';
import { bodyEntry, bookmarkEntry, SearchIndex } from './search';
import { SettingsStoreImpl } from './settings';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'warn' | 'error';
}

/** UI-owned settings (registered straight into the store; modules own the rest). */
export const LABELS_SETTING = 'ui.labels';
export const TOUCH_SETTING = 'ui.touchControls';
export { ORBITS_SETTING };
/** Titles of bookmarks kept for regression tests ("Terrain jitter A (test)"). */
export const TEST_BOOKMARK = /\(test\)\s*$/;
/** Bookmark the Home key flies to. */
export const HOME_BOOKMARK = 'earth-now';

const UI_SETTINGS: readonly SettingDef[] = [
  {
    id: LABELS_SETTING,
    label: 'Labels (Shift+L)',
    group: 'Labels',
    type: 'boolean',
    default: true,
    persist: true,
    description: 'Names of planets, stars, cities and other objects in the view.',
  },
  {
    id: TOUCH_SETTING,
    label: 'On-screen flight controls',
    group: 'Controls',
    type: 'select',
    default: 'auto',
    options: [
      { value: 'auto', label: 'On touch screens' },
      { value: 'on', label: 'Always' },
      { value: 'off', label: 'Never' },
    ],
    persist: true,
    description: 'A movement stick and up/down buttons for touch screens.',
  },
];

/** Planetocentric latitude and east longitude of a body-fixed point, e.g. '0.67°N 23.47°E'. */
export function formatLatLon(p: { x: number; y: number; z: number }): string {
  const r = Math.hypot(p.x, p.y, p.z);
  if (!(r > 0)) return '';
  const lat = (Math.asin(Math.max(-1, Math.min(1, p.z / r))) * 180) / Math.PI;
  const lon = (Math.atan2(p.y, p.x) * 180) / Math.PI;
  const f = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? pos : neg}`;
  return `${f(lat, 'N', 'S')} ${f(lon, 'E', 'W')}`;
}

/** A body the camera could set down on: rocky or icy, not a star or a gas giant. */
export const landable = (b: Body | undefined): b is Body => !!b && terrainEligible(b);

export interface PickCandidate {
  id: string;
  /** Projected centre (CSS px) and disc radius (px). */
  x: number;
  y: number;
  r: number;
  /** Distance from the camera, m. */
  depth: number;
  priority: number;
}

/** Slack around small bodies and points when picking, px. */
export const PICK_SLOP_PX = 12;

/**
 * Body under a click: the nearest disc that contains the point, else the closest centre within
 * PICK_SLOP_PX (higher label priority wins ties). Discs that fill the view (the world the camera
 * stands on) are left out by the caller.
 */
export function pickCandidate(cands: readonly PickCandidate[], x: number, y: number): string | null {
  let inside: PickCandidate | null = null;
  let near: PickCandidate | null = null;
  let nearD = Infinity;
  for (const c of cands) {
    const d = Math.hypot(c.x - x, c.y - y);
    if (d <= c.r) {
      if (!inside || c.depth < inside.depth) inside = c;
    } else if (d <= Math.max(c.r, 0) + PICK_SLOP_PX) {
      const better =
        d < nearD - 1 || (Math.abs(d - nearD) <= 1 && near !== null && c.priority > near.priority);
      if (!near || better) {
        near = c;
        nearD = d;
      }
    }
  }
  return (inside ?? near)?.id ?? null;
}

export interface HudData {
  speed: string;
  targetId: string | null;
  targetName: string | null;
  distance: string | null;
  lightTime: string | null;
  /** Latitude, longitude and altitude over the nearest world when close to one. */
  position: string | null;
  /** Body the Land button would set down on (null: nothing to land on from here). */
  landOn: string | null;
  /** Walk mode can start from here (within reach of a surface). */
  canWalk: boolean;
  mode: string;
  scaleFrac: number;
  scaleText: string;
  crumbs: { id: string; label: string }[];
  traveling: boolean;
  frame: string;
}

export interface TimeData {
  text: string;
  rate: string;
  paused: boolean;
  badges: ValidityBadge[];
}

const EMPTY_HUD: HudData = {
  speed: '',
  targetId: null,
  targetName: null,
  distance: null,
  lightTime: null,
  position: null,
  landOn: null,
  canWalk: false,
  mode: 'free',
  scaleFrac: 0,
  scaleText: '',
  crumbs: [],
  traveling: false,
  frame: '',
};

/** Constellation bookmarks switch the lines on however they are reached (P5-B). */
export function wantsLines(target: string | Bookmark): boolean {
  return LINE_BOOKMARKS.includes(typeof target === 'string' ? target : target.id);
}

export class UiController {
  readonly paletteOpen = signal(false);
  readonly settingsOpen = signal(false);
  readonly helpOpen = signal(false);
  readonly exploreOpen = signal(false);
  readonly toursOpen = signal(false);
  readonly accuracyOpen = signal(false);
  readonly fullscreen = signal(false);
  /** A touch has been seen this session (hybrid laptops report a fine pointer). */
  readonly touchSeen = signal(false);
  readonly hudVisible = signal(true);
  readonly selection = signal<string | null>(null);
  readonly infoId = signal<string | null>(null);
  readonly infoCard = signal<InfoCard | null>(null);
  readonly caption = signal<string | null>(null);
  readonly toasts = signal<Toast[]>([]);
  readonly hud = signal<HudData>(EMPTY_HUD);
  readonly time = signal<TimeData>({ text: '', rate: '', paused: false, badges: [] });
  readonly settingsVersion = signal(0);
  readonly search: SearchIndex;
  private toastSeq = 0;
  private lastHud = -1;
  private lastInfo = -1;
  private infoSeq = 0;
  private lastView: ViewState | null = null;
  private exploreCache: ResolvedGroup[] | null = null;

  constructor(
    readonly ctx: UiContext,
    readonly settings: SettingsStoreImpl,
  ) {
    const { registry } = ctx;
    this.search = new SearchIndex(
      () => registry.searchProviders(),
      () => [
        ...registry.bodies().map((b) => bodyEntry(b, b.parent ? registry.body(b.parent)?.name : undefined)),
        // Bookmarks that exist only for regression tests stay out of a real session's search.
        ...registry
          .bookmarks()
          .filter((b) => ctx.env.test || !TEST_BOOKMARK.test(b.title))
          .map(bookmarkEntry),
      ],
    );
    for (const d of UI_SETTINGS) settings.register(d);
    registry.subscribe((kind) => {
      if (kind === 'search' || kind === 'body' || kind === 'bookmark' || kind === 'tour') {
        this.search.invalidate();
        this.exploreCache = null;
      }
      if (kind === 'setting') {
        for (const d of registry.settings()) settings.register(d);
      }
    });
    for (const d of registry.settings()) settings.register(d);
    settings.onAny(() => (this.settingsVersion.value += 1));
    ctx.camera.subscribe(() => this.refreshTime());
    ctx.clock.subscribe(() => this.refreshTime());
  }

  toast(text: string, kind: Toast['kind'] = 'info', durationMs = 3500): void {
    const t: Toast = { id: ++this.toastSeq, text, kind };
    this.toasts.value = [...this.toasts.value.slice(-3), t];
    setTimeout(() => (this.toasts.value = this.toasts.value.filter((x) => x !== t)), durationMs);
  }

  select(id: string | null): void {
    batch(() => {
      this.selection.value = id;
      this.showInfo(id);
    });
  }

  showInfo(id: string | null): void {
    this.infoId.value = id;
    void this.resolveInfo();
  }

  /** Resolves the info card: first provider returning non-null, else a card built from the Body. */
  async resolveInfo(): Promise<void> {
    const id = this.infoId.value;
    const seq = ++this.infoSeq;
    if (!id) {
      this.infoCard.value = null;
      return;
    }
    let card: InfoCard | null = null;
    for (const p of this.ctx.registry.infoProviders()) {
      try {
        card = await p.info(id);
      } catch (e) {
        console.error(`[ui] info provider ${p.id} failed`, e);
      }
      if (card) break;
    }
    card ??= this.bodyCard(id);
    if (seq === this.infoSeq) this.infoCard.value = card;
  }

  private bodyCard(id: string): InfoCard | null {
    const b = this.ctx.registry.body(id);
    if (!b) {
      const e = this.search.byId(id);
      return e ? { title: e.name, subtitle: e.subtitle, facts: [] } : null;
    }
    const facts: InfoFact[] = [{ label: 'Radius', value: formatDistance(b.radius) }];
    if (b.gm)
      facts.push({ label: 'Surface gravity', value: (b.gm / b.radius ** 2).toFixed(2), unit: 'm/s²' });
    if (b.albedo !== undefined) facts.push({ label: 'Albedo', value: b.albedo });
    if (b.teff !== undefined) facts.push({ label: 'Temperature', value: Math.round(b.teff), unit: 'K' });
    return { title: b.name, subtitle: bodyEntry(b).subtitle, facts, simulated: b.simulated };
  }

  /** The Explore panel's groups, resolved against what is registered (cached until that changes). */
  explore(): ResolvedGroup[] {
    if (this.exploreCache) return this.exploreCache;
    const bookmarks = this.ctx.registry.bookmarks();
    this.exploreCache = resolveExplore({
      byId: (id) => this.search.byId(id),
      byName: (name) => this.search.byName(name),
      bookmarks: () =>
        bookmarks.map((b) => this.search.byId(`bookmark:${b.id}`)).filter((e): e is SearchEntry => !!e),
    });
    return this.exploreCache;
  }

  /** Closes the topmost open panel; false when nothing was open. */
  closeTop(): boolean {
    for (const s of [
      this.paletteOpen,
      this.helpOpen,
      this.toursOpen,
      this.accuracyOpen,
      this.exploreOpen,
      this.settingsOpen,
    ]) {
      if (s.value) {
        s.value = false;
        return true;
      }
    }
    if (this.infoId.value) {
      this.showInfo(null);
      return true;
    }
    return false;
  }

  /** Opens one of the side panels and closes the others that would overlap it. */
  openPanel(which: 'explore' | 'settings' | 'tours' | 'help' | 'accuracy', open = true): void {
    batch(() => {
      if (open && which !== 'accuracy') {
        this.toursOpen.value = false;
        this.helpOpen.value = false;
        if (which === 'settings') this.showInfo(null);
        if (which !== 'explore' && which !== 'tours') this.settingsOpen.value = false;
      }
      if (which === 'explore') this.exploreOpen.value = open;
      else if (which === 'settings') this.settingsOpen.value = open;
      else if (which === 'tours') this.toursOpen.value = open;
      else if (which === 'help') this.helpOpen.value = open;
      else this.accuracyOpen.value = open;
    });
  }

  /** Sets down on a body's surface (default: the target, else the nearest world) and walks. */
  land(id?: string | null): void {
    const { camera, registry } = this.ctx;
    const bodyId = id ?? this.hud.value.landOn;
    const b = bodyId ? registry.body(bodyId) : undefined;
    if (!landable(b) || !camera.land) {
      this.toast(b ? `${b.name} has no surface to land on` : 'Nothing to land on from here', 'warn');
      return;
    }
    this.select(b.id);
    // From far away, first arrive at the world; the descent then starts over its sunlit side.
    const near = camera.nearestSurface();
    if (near?.bodyId === b.id && near.altitude < 20 * b.radius) {
      void camera.land(b.id);
      return;
    }
    void camera.goto(b.id).then((ok) => {
      if (ok) void camera.land?.(b.id);
    });
  }

  /** G: walk when a surface is within reach, leave walk mode when walking. */
  toggleWalk(): void {
    const { camera } = this.ctx;
    if (camera.mode === 'walk') camera.setMode('free');
    else if (camera.canWalk?.()) camera.setMode('walk');
    else this.land();
  }

  toggleFullscreen(): void {
    const doc = document as Document & {
      webkitExitFullscreen?: () => void;
      webkitFullscreenElement?: Element;
    };
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    try {
      if (doc.fullscreenElement ?? doc.webkitFullscreenElement)
        void (doc.exitFullscreen ?? doc.webkitExitFullscreen)?.call(doc);
      else void (el.requestFullscreen ?? el.webkitRequestFullscreen)?.call(el);
    } catch {
      this.toast('Full screen is not available here', 'warn');
    }
  }

  /** Body under a point of the view (CSS px), or null. */
  pick(x: number, y: number, cssW: number, cssH: number): string | null {
    const view = this.lastView;
    if (!view || !(cssH > 0)) return null;
    const pxAngle = view.fovY / cssH;
    const rel = vec3();
    const proj = { x: 0, y: 0, depth: 0 };
    const cands: PickCandidate[] = [];
    for (const b of this.ctx.registry.bodies()) {
      try {
        view.toCamera(b.frame, vec3(), rel);
      } catch {
        continue;
      }
      const d = v3len(rel);
      const r = d > b.radius ? Math.asin(Math.min(1, b.radius / d)) / pxAngle : Infinity;
      // The world under the camera fills the view: clicking the ground is not a selection.
      if (r > 0.75 * cssH) continue;
      if (!project(rel, view.worldQuat, view.fovY, cssW, cssH, proj)) continue;
      cands.push({ id: b.id, x: proj.x, y: proj.y, r, depth: d, priority: bodyPriority(b) });
    }
    return pickCandidate(cands, x, y);
  }

  /** Display name for an id (body, search entry or the id itself). */
  nameOf(id: string): string {
    return this.ctx.registry.body(id)?.name ?? this.search.byId(id)?.name ?? id;
  }

  /** Flies to a search entry / body id / bookmark and selects it. */
  fly(target: string | Bookmark, selectId?: string | null): void {
    if (selectId !== undefined) this.select(selectId);
    const name = typeof target === 'string' ? this.nameOf(target) : target.title;
    if (wantsLines(target)) this.settings.set(CONSTELLATIONS_SETTING, true);
    void this.ctx.camera.goto(target).then((ok) => {
      if (!ok && this.ctx.camera.traveling === false && this.flightFailed(target)) {
        this.toast(`Cannot fly to ${name}`, 'warn');
      }
    });
  }

  private flightFailed(target: string | Bookmark): boolean {
    const { registry, frames } = this.ctx;
    if (typeof target !== 'string') return !frames.has(target.frame);
    const bm = registry.bookmark(target);
    const b = registry.body(target);
    return !(bm && frames.has(bm.frame)) && !(b && frames.has(b.frame));
  }

  choose(entry: SearchEntry): void {
    this.paletteOpen.value = false;
    if (entry.kind === 'tour') {
      const id = entry.id.startsWith(TOUR_ENTRY_PREFIX) ? entry.id.slice(TOUR_ENTRY_PREFIX.length) : entry.id;
      if (!tours.start(id)) this.toast(`Tour ${entry.name} is not available`, 'warn');
      return;
    }
    const bm = typeof entry.target === 'string' ? undefined : entry.target;
    this.fly(entry.target, entry.kind === 'bookmark' ? (bm?.lookAt ?? null) : entry.id);
  }

  /** Target for an id from labels or the info card: body, bookmark or search entry. */
  targetOf(id: string): string | Bookmark | null {
    const { registry } = this.ctx;
    if (registry.body(id) || registry.bookmark(id)) return id;
    return this.search.byId(id)?.target ?? null;
  }

  async copyLink(): Promise<void> {
    const { camera, clock } = this.ctx;
    const url = shareUrl(window.location, stateFromCamera(camera.getState(), clock.jd));
    const ok = await copyLink(url);
    this.toast(ok ? 'Link copied to the clipboard' : url, ok ? 'info' : 'warn', ok ? 2500 : 8000);
  }

  refreshTime(): void {
    const { clock } = this.ctx;
    const date = clock.toDate();
    this.time.value = {
      text: formatInstant(date, clock.jd),
      rate: formatRate(clock.rate),
      paused: clock.paused || clock.rate === 0,
      badges: validityBadges(clock.validity()),
    };
  }

  /** Per-frame hook (render.onAfterFrame): HUD at 10 Hz, info card at 1 Hz. */
  frame(view: ViewState): void {
    const t = view.timeReal;
    this.lastView = view;
    if (!view.test && t - this.lastHud < 0.1 && this.lastHud >= 0) return;
    this.lastHud = t;
    const { camera, registry, frames } = this.ctx;
    const targetId = camera.target ?? this.selection.value;
    const body = targetId ? registry.body(targetId) : undefined;
    let distance: string | null = null;
    let lightTime: string | null = null;
    let scaleD = camera.nearestSurface()?.altitude ?? 0;
    if (body && frames.has(body.frame)) {
      const d = v3len(view.toCamera(body.frame, vec3(), vec3()));
      distance = formatDistance(Math.max(0, d - body.radius));
      lightTime = formatLightTime(d);
      scaleD = Math.max(1, d - body.radius);
    }
    if (!(scaleD > 0)) scaleD = v3len(view.cameraLocal);
    const crumbs = frames.path(view.frame).map((id) => ({
      id,
      label: frameLabel(id, (x) => registry.body(x)?.name),
    }));
    // Close to a world: where the camera is over it, and whether it can set down.
    const near = camera.nearestSurface();
    const nearBody = near ? registry.body(near.bodyId) : undefined;
    let position: string | null = null;
    if (near && nearBody && landable(nearBody) && near.altitude < 2 * nearBody.radius) {
      const fixed = nearBody.fixedFrame && frames.has(nearBody.fixedFrame) ? nearBody.fixedFrame : null;
      if (fixed) {
        const p = frames.convertPoint(view.frame, view.cameraLocal, fixed, view.jd, vec3());
        position = `${formatLatLon(p)} · ${formatDistance(Math.max(0, near.altitude))} up`;
      }
    }
    const landBody = landable(body)
      ? body
      : landable(nearBody) && near!.altitude < 20 * nearBody.radius
        ? nearBody
        : null;
    this.hud.value = {
      speed: formatSpeed(camera.speed),
      targetId: targetId ?? null,
      targetName: targetId ? this.nameOf(targetId) : null,
      distance,
      lightTime,
      position,
      landOn: camera.mode === 'walk' || camera.traveling ? null : (landBody?.id ?? null),
      canWalk: camera.mode !== 'walk' && (camera.canWalk?.() ?? false),
      mode: camera.mode,
      scaleFrac: logScaleFraction(scaleD),
      scaleText: formatDistance(scaleD),
      crumbs,
      traveling: camera.traveling,
      frame: view.frame,
    };
    this.refreshTime();
    if (this.infoId.value && t - this.lastInfo >= 1) {
      this.lastInfo = t;
      void this.resolveInfo();
    }
  }
}
