/**
 * UI shell entry (P1-D). Boot calls mountUi(root, ctx) before module init and hands the returned
 * UiApi to every module. The visible shell (Preact + signals) is skipped in test mode unless
 * `?ui=1`, and `?ui=0` hides it anywhere; the UiApi (settings, labels, selection) always works.
 */
import { render } from 'preact';
import { createElement } from 'preact';
import type { MountUi, UiApi, UiContext } from '../core/contracts';
import { photo } from '../modules/photo/public';
import { tours } from '../modules/tours/public';
import { uiActions } from './actions';
import { App } from './app';
import { UiController } from './controller';
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
      labels!.visible = ui.hudVisible.value;
      labels!.update(view);
      ui.frame(view);
    });
    installKeys(ui, ctx);
    uiActions.openHelp = () => (ui.helpOpen.value = true);
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

function installKeys(ui: UiController, ctx: UiContext): void {
  const { clock, camera } = ctx;
  window.addEventListener('keydown', (e) => {
    if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      ui.paletteOpen.value = !ui.paletteOpen.value;
      return;
    }
    if (e.key === 'Escape') {
      if (ui.paletteOpen.value) ui.paletteOpen.value = false;
      else if (ui.settingsOpen.value) ui.settingsOpen.value = false;
      else ui.showInfo(null);
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
        ui.helpOpen.value = !ui.helpOpen.value;
        return;
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
        camera.setMode(camera.mode === 'orbit' ? 'free' : 'orbit');
        ui.toast(`Camera: ${camera.mode}`, 'info', 1200);
        break;
      case 'KeyH':
        ui.hudVisible.value = !ui.hudVisible.value;
        break;
      case 'KeyL':
        void ui.copyLink();
        break;
      default:
        return;
    }
    ui.refreshTime();
  });
}
