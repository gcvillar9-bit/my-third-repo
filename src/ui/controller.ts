/**
 * UI state (Preact signals) and actions shared by the components, the keyboard handler and
 * the UiApi returned by mountUi.
 */
import { batch, signal } from '@preact/signals';
import type { Bookmark, InfoCard, InfoFact, SearchEntry, UiContext, ViewState } from '../core/contracts';
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
  toDatetimeLocal,
} from './format';
import { CONSTELLATIONS_SETTING, LINE_BOOKMARKS } from '../modules/starsystems/public';
import { TOUR_ENTRY_PREFIX, tours } from '../modules/tours/public';
import { bodyEntry, bookmarkEntry, SearchIndex } from './search';
import { SettingsStoreImpl } from './settings';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'warn' | 'error';
}

export interface HudData {
  speed: string;
  targetId: string | null;
  targetName: string | null;
  distance: string | null;
  lightTime: string | null;
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
  dateValue: string;
  badges: ValidityBadge[];
}

const EMPTY_HUD: HudData = {
  speed: '',
  targetId: null,
  targetName: null,
  distance: null,
  lightTime: null,
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
  readonly hudVisible = signal(true);
  readonly selection = signal<string | null>(null);
  readonly infoId = signal<string | null>(null);
  readonly infoCard = signal<InfoCard | null>(null);
  readonly caption = signal<string | null>(null);
  readonly toasts = signal<Toast[]>([]);
  readonly hud = signal<HudData>(EMPTY_HUD);
  readonly time = signal<TimeData>({ text: '', rate: '', paused: false, dateValue: '', badges: [] });
  readonly settingsVersion = signal(0);
  readonly search: SearchIndex;
  private toastSeq = 0;
  private lastHud = -1;
  private lastInfo = -1;
  private infoSeq = 0;

  constructor(
    readonly ctx: UiContext,
    readonly settings: SettingsStoreImpl,
  ) {
    const { registry } = ctx;
    this.search = new SearchIndex(
      () => registry.searchProviders(),
      () => [
        ...registry.bodies().map((b) => bodyEntry(b, b.parent ? registry.body(b.parent)?.name : undefined)),
        ...registry.bookmarks().map(bookmarkEntry),
      ],
    );
    registry.subscribe((kind) => {
      if (kind === 'search' || kind === 'body' || kind === 'bookmark') this.search.invalidate();
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
      dateValue: toDatetimeLocal(date),
      badges: validityBadges(clock.validity()),
    };
  }

  /** Per-frame hook (render.onAfterFrame): HUD at 10 Hz, info card at 1 Hz. */
  frame(view: ViewState): void {
    const t = view.timeReal;
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
    this.hud.value = {
      speed: formatSpeed(camera.speed),
      targetId: targetId ?? null,
      targetName: targetId ? this.nameOf(targetId) : null,
      distance,
      lightTime,
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
