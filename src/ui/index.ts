/**
 * UI shell entry (P1-D). Boot calls mountUi(root, ctx) before module init and hands the returned
 * UiApi to every module. The visible shell (Preact + signals) is skipped in test mode unless
 * `?ui=1`, and `?ui=0` hides it anywhere; the UiApi (settings, labels, selection) always works.
 */
import { render } from 'preact';
import { createElement } from 'preact';
import type { MountUi, UiApi, UiContext } from '../core/contracts';
import { AUDIO_ENABLED_SETTING } from '../modules/audio/public';
import { photo } from '../modules/photo/public';
import { tours } from '../modules/tours/public';
import { uiActions } from './actions';
import { App } from './app';
import { HOME_BOOKMARK, LABELS_SETTING, ORBITS_SETTING, UiController } from './controller';
import { LabelOverlay } from './labels';
import { safeStorage, SettingsStoreImpl } from './settings';
import { UI_CSS } from './styles';

const isEditable = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName ?? ''));
};

/** Whether the visible shell is shown: ?ui=1 forces it, ?ui=0 hides it, test mode hides by default. */
export const uiVisible = (params: URLSearchParams, test: boolean): boolean => {
  const p = params.get('ui');
  return p === '1' || (p !== '0' && !test);
};

export const mountUi: MountUi = (root: HTMLElement, ctx: UiContext): UiApi => {
  const settings = new SettingsStoreImpl(ctx.env.test ? null : safeStorage());
  const ui = new UiController(ctx, settings);
  const visible = uiVisible(ctx.env.params, ctx.env.test);
  let labels: LabelOverlay | null = null;
  const pendingSources = new Set<Parameters<UiApi['addLabelSource']>[0]>();

  if (visible) {
    const style = document.createElement('style');
    style.textContent = UI_CSS;
    document.head.appendChild(style);
    labels = new LabelOverlay(root, {
      registry: ctx.registry,
      emphasis: () => ({ target: ctx.camera.target, selection: ui.selection.value }),
      daylight: (view) => ui.daylight(view),
      onClick: (it) => ui.select(it.id),
      onDoubleClick: (it) => {
        const t = ui.targetOf(it.target ?? it.id);
        if (t) ui.fly(t, it.id);
      },
    });
    const shell = document.createElement('div');
    shell.className = 'cz-shell';
    root.appendChild(shell);
    render(createElement(App, { ui }), shell);
    ctx.render.onAfterFrame((view) => {
      labels!.visible = ui.hudVisible.value && settings.get(LABELS_SETTING) !== false;
      labels!.update(view);
      ui.frame(view);
    });
    installKeys(ui, ctx);
    installPointer(ui, root);
    uiActions.openHelp = () => ui.openPanel('help');
    uiActions.openExplore = () => ui.openPanel('explore');
    ui.refreshTime();
    if (ctx.env.debug && !ctx.env.test) {
      void import('./debug-gui')
        .then((m) => m.startDebugGui(ctx, settings))
        .catch((e: unknown) => console.warn('[ui] debug panel failed', e));
    }
  }

  return {
    toast: (message, opts) =>
      visible ? ui.toast(message, opts?.kind, opts?.durationMs) : console.info('[toast]', message),
    showInfo: (id) => ui.showInfo(id),
    get selection() {
      return ui.selection.value;
    },
    select: (id) => ui.select(id),
    addLabelSource: (src) => {
      if (labels) return labels.addSource(src);
      pendingSources.add(src);
      return () => pendingSources.delete(src);
    },
    settings,
    setHudVisible: (v) => (ui.hudVisible.value = v),
    setCaption: (text) => (ui.caption.value = text),
  };
};

/** Largest pointer travel (CSS px) and press time (ms) that still count as a click on the view. */
const CLICK_SLOP_PX = 5;
const CLICK_MAX_MS = 400;
/** Two taps this close in time and place are a double-tap (touch has no dblclick on a canvas). */
const DOUBLE_TAP_MS = 350;

/**
 * Selection in the 3D view: a click (or tap) on a world selects it and a double-click flies
 * there. The canvas keeps its own handlers for looking around; a press that travels is a drag,
 * never a selection. Also notes the first touch, which brings up the on-screen flight controls.
 */
function installPointer(ui: UiController, root: HTMLElement): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#app canvas');
  if (!canvas) return;
  let down: { x: number; y: number; t: number; id: number } | null = null;
  let lastTap: { x: number; y: number; t: number; id: string } | null = null;
  const size = () => ({
    w: root.clientWidth || window.innerWidth,
    h: root.clientHeight || window.innerHeight,
  });
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType === 'touch') ui.touchSeen.value = true;
    },
    { capture: true, passive: true },
  );
  canvas.addEventListener('pointerdown', (e) => {
    down =
      e.button === 0 && e.isPrimary ? { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId } : null;
  });
  canvas.addEventListener('pointerup', (e) => {
    const d = down;
    down = null;
    if (!d || d.id !== e.pointerId || photo.active || !ui.hudVisible.value) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_SLOP_PX || e.timeStamp - d.t > CLICK_MAX_MS)
      return;
    const { w, h } = size();
    const id = ui.pick(e.clientX, e.clientY, w, h);
    if (!id) {
      lastTap = null;
      return;
    }
    const again =
      lastTap !== null &&
      lastTap.id === id &&
      e.timeStamp - lastTap.t < DOUBLE_TAP_MS &&
      Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 4 * CLICK_SLOP_PX;
    lastTap = again ? null : { x: e.clientX, y: e.clientY, t: e.timeStamp, id };
    if (again) {
      const t = ui.targetOf(id);
      if (t) ui.fly(t, id);
    } else ui.select(id);
  });
  canvas.addEventListener('pointercancel', () => (down = null));
  const onFullscreen = () =>
    (ui.fullscreen.value = !!(
      document.fullscreenElement ??
      (document as { webkitFullscreenElement?: Element }).webkitFullscreenElement
    ));
  document.addEventListener('fullscreenchange', onFullscreen);
  document.addEventListener('webkitfullscreenchange', onFullscreen);
}

function installKeys(ui: UiController, ctx: UiContext): void {
  const { clock, camera } = ctx;
  const toggleSetting = (id: string, on: string, off: string) => {
    if (!ui.settings.definitions().some((d) => d.id === id)) return;
    const v = ui.settings.get(id) !== true;
    ui.settings.set(id, v);
    ui.toast(v ? on : off, 'info', 1200);
  };
  // Shift+G lands; capture phase, ahead of the camera's own G (walk toggle).
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.code !== 'KeyG' || !e.shiftKey || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isEditable(e.target) || ui.paletteOpen.value || photo.active) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      ui.land(ui.selection.value);
    },
    true,
  );
  window.addEventListener('keydown', (e) => {
    if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      ui.paletteOpen.value = !ui.paletteOpen.value;
      return;
    }
    if (e.key === 'Escape') {
      // One Escape closes one thing: with a panel or card open, the tour underneath keeps running
      // (this listener is registered before the tours module's).
      if (ui.closeTop()) e.stopImmediatePropagation();
      return;
    }
    if (isEditable(e.target) || e.ctrlKey || e.metaKey || e.altKey || ui.paletteOpen.value || photo.active)
      return;
    switch (e.key) {
      case '/':
        e.preventDefault();
        ui.paletteOpen.value = true;
        return;
      case '?':
        ui.openPanel('help', !ui.helpOpen.value);
        return;
    }
    if (e.shiftKey) {
      switch (e.code) {
        case 'KeyO':
          toggleSetting(ORBITS_SETTING, 'Orbit lines on', 'Orbit lines off');
          return;
        case 'KeyL':
          toggleSetting(LABELS_SETTING, 'Labels on', 'Labels off');
          return;
        case 'KeyF':
          ui.toggleFullscreen();
          return;
      }
    }
    switch (e.code) {
      case 'Comma':
        clock.warpStep(-1);
        break;
      case 'Period':
        clock.warpStep(1);
        break;
      case 'KeyK':
        // P is photo mode (photo module); K pauses the tour when one runs, else the clock.
        if (tours.status()) {
          tours.togglePause();
          return;
        }
        if (clock.paused || clock.rate === 0) {
          if (clock.rate === 0) clock.setRate(1);
          else clock.resume();
        } else clock.pause();
        break;
      case 'KeyN':
        clock.setNow();
        break;
      case 'KeyI':
        ui.showInfo(ui.infoId.value ? null : (ui.selection.value ?? camera.target));
        break;
      case 'KeyG': {
        const id = ui.selection.value ?? camera.target;
        const t = id ? ui.targetOf(id) : null;
        if (t) ui.fly(t);
        break;
      }
      case 'KeyO':
        if (e.shiftKey) return;
        camera.setMode(camera.mode === 'orbit' ? 'free' : 'orbit');
        ui.toast(`Camera: ${camera.mode}`, 'info', 1200);
        break;
      case 'KeyH':
        ui.hudVisible.value = !ui.hudVisible.value;
        break;
      case 'KeyL':
        if (e.shiftKey) return;
        void ui.copyLink();
        break;
      case 'KeyX':
        ui.openPanel('explore', !ui.exploreOpen.value);
        return;
      case 'KeyT':
        if (tours.status()) return;
        ui.openPanel('tours', !ui.toursOpen.value);
        return;
      case 'Home': {
        const home = ctx.registry.bookmark(HOME_BOOKMARK);
        if (home) ui.fly(home, home.lookAt ?? null);
        return;
      }
      case 'KeyM': {
        // Mute/unmute (audio module); a no-op without it.
        if (!ui.settings.definitions().some((d) => d.id === AUDIO_ENABLED_SETTING)) return;
        const on = ui.settings.get(AUDIO_ENABLED_SETTING) !== true;
        ui.settings.set(AUDIO_ENABLED_SETTING, on);
        ui.toast(on ? 'Sound on' : 'Sound muted', 'info', 1200);
        return;
      }
      default:
        return;
    }
    ui.refreshTime();
  });
}
