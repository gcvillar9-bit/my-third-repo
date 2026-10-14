/**
 * photo (P5-B): photo mode. P (or the UI's Photo button) hides the UI, labels and overlays and
 * shows a small panel with FOV (5-120°) and exposure ± controls and "Save PNG". Saving waits for
 * the next frame and copies the WebGL canvas into a 2D canvas inside render.onAfterFrame (the same
 * task as the render, so preserveDrawingBuffer is not needed), draws the credits line in the
 * bottom-right corner and downloads the PNG. Esc exits.
 */
import type { UniverseModule } from '../../core/contracts';
import { creditsLine, EV_STEP, FOV_MAX_DEG, FOV_MIN_DEG, PhotoState, photoFileName } from './photo';
import { PHOTO_ATTR, PHOTO_MODULE_ID, providePhoto } from './public';

const CSS = `
.cz-photo-panel { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); z-index: 6; display: none;
  align-items: center; gap: 8px; padding: 6px 10px; border-radius: 8px; pointer-events: auto; opacity: 0.5;
  background: rgba(14, 18, 28, 0.62); border: 1px solid rgba(255, 255, 255, 0.1); backdrop-filter: blur(8px);
  font: 12px/1.3 system-ui, -apple-system, 'Segoe UI', sans-serif; color: #cdd6e4; transition: opacity 0.2s; }
.cz-photo-panel:hover { opacity: 1; }
html[${PHOTO_ATTR}] .cz-photo-panel { display: flex; }
.cz-photo-panel button { font: inherit; color: inherit; background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 5px; padding: 2px 8px; cursor: pointer; }
.cz-photo-panel input { width: 90px; }
.cz-photo-panel output { min-width: 34px; display: inline-block; text-align: right; font-variant-numeric: tabular-nums; }
`;

const typing = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

const photoModule: UniverseModule = {
  id: PHOTO_MODULE_ID,
  init(ctx) {
    const { ui, camera, render, clock, env } = ctx;
    if (typeof document === 'undefined') return;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const panel = document.createElement('div');
    panel.className = 'cz-photo-panel';
    panel.setAttribute('role', 'toolbar');
    panel.setAttribute('aria-label', 'Photo mode');
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', title = '') => {
      const e = document.createElement(tag);
      e.textContent = text;
      if (title) e.title = title;
      return e;
    };
    const fov = el('input');
    fov.type = 'range';
    fov.min = String(FOV_MIN_DEG);
    fov.max = String(FOV_MAX_DEG);
    fov.step = '1';
    fov.title = 'Field of view';
    const fovOut = el('output');
    const evOut = el('output');
    const darker = el('button', '−', 'Darker (exposure −0.5 stop)');
    const brighter = el('button', '+', 'Brighter (exposure +0.5 stop)');
    const save = el('button', 'Save PNG', 'Save the current frame as a PNG');
    const exit = el('button', 'Exit', 'Leave photo mode (Esc or P)');
    panel.append(
      el('b', 'Photo'),
      el('span', 'FOV'),
      fov,
      fovOut,
      el('span', 'Exposure'),
      darker,
      evOut,
      brighter,
      save,
      exit,
    );
    (document.getElementById('ui') ?? document.body).appendChild(panel);

    const state = new PhotoState({
      setHudVisible: (v) => ui.setHudVisible(v),
      setFlag: (on) => document.documentElement.toggleAttribute(PHOTO_ATTR, on),
      getFovY: () => camera.getState().fovY,
      setFovY: (r) => camera.setState({ fovY: r }),
      exposure: render.exposure,
      changed: () => refresh(),
    });
    const refresh = () => {
      const deg = Math.round(state.fovDeg);
      fov.value = String(deg);
      fovOut.textContent = `${deg}°`;
      const c = -state.compensation;
      evOut.textContent = `${c > 0 ? '+' : ''}${c.toFixed(1)}`;
    };
    fov.addEventListener('input', () => state.setFovDeg(Number(fov.value)));
    darker.addEventListener('click', () => state.nudgeExposure(-EV_STEP));
    brighter.addEventListener('click', () => state.nudgeExposure(EV_STEP));
    exit.addEventListener('click', () => state.exit());

    let pending: ((b: Blob | null) => void)[] = [];
    const capture = (): Promise<Blob | null> => new Promise((resolve) => pending.push(resolve));
    render.onAfterFrame(() => {
      if (pending.length === 0) return;
      const waiting = pending;
      pending = [];
      const finish = (b: Blob | null) => waiting.forEach((r) => r(b));
      try {
        const src = render.renderer.domElement;
        const c = document.createElement('canvas');
        c.width = src.width;
        c.height = src.height;
        const g = c.getContext('2d');
        if (!g) return finish(null);
        g.drawImage(src, 0, 0);
        const text = creditsLine(clock.toDate());
        const fs = Math.max(9, Math.round(c.height * 0.016));
        const pad = Math.round(fs * 0.6);
        g.font = `${fs}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
        const w = g.measureText(text).width;
        g.fillStyle = 'rgba(0, 0, 0, 0.45)';
        g.fillRect(c.width - w - 3 * pad, c.height - fs - 3 * pad, w + 2 * pad, fs + 2 * pad);
        g.fillStyle = 'rgba(255, 255, 255, 0.85)';
        g.textAlign = 'right';
        g.textBaseline = 'bottom';
        g.fillText(text, c.width - 2 * pad, c.height - 2 * pad);
        c.toBlob(finish, 'image/png');
      } catch (e) {
        console.warn('[photo] capture failed', e);
        finish(null);
      }
    });
    const savePng = async (): Promise<Blob | null> => {
      const blob = await capture();
      panel.dataset.lastSize = String(blob?.size ?? 0);
      if (!blob) {
        ui.toast('Could not capture the frame', { kind: 'warn' });
        return null;
      }
      if (!env.test) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = photoFileName(new Date());
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      }
      return blob;
    };
    save.addEventListener('click', () => void savePng());

    providePhoto({
      get active() {
        return state.active;
      },
      toggle: () => state.toggle(),
      enter: () => state.enter(),
      exit: () => state.exit(),
      save: savePng,
    });

    window.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyP' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      state.toggle();
    });
    // Capture phase: Esc leaves photo mode only (not the tour, palette or info card underneath).
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Escape' || !state.active || typing(e.target)) return;
        e.stopImmediatePropagation();
        e.stopPropagation();
        state.exit();
      },
      true,
    );
    refresh();
  },
};

export default photoModule;
