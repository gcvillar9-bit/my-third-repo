/**
 * Minimal tour overlay: title, stop counter, progress bar, Pause / Next / Exit. The caption
 * itself goes through UiApi.setCaption. Data attributes (data-tour, data-stop, data-target,
 * data-caption, data-paused) are read by e2e. Hidden in photo mode via the PHOTO_ATTR rule.
 */
import { PHOTO_ATTR } from '../photo/public';
import type { TourStatus } from './player';

const CSS = `
.cz-tour { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); z-index: 5; pointer-events: auto;
  display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 8px;
  background: rgba(14, 18, 28, 0.62); border: 1px solid rgba(255, 255, 255, 0.1); backdrop-filter: blur(8px);
  font: 12px/1.3 system-ui, -apple-system, 'Segoe UI', sans-serif; color: #cdd6e4; }
.cz-tour b { font-weight: 600; white-space: nowrap; }
.cz-tour-bar { width: 120px; height: 4px; border-radius: 2px; background: rgba(255, 255, 255, 0.12); overflow: hidden; }
.cz-tour-bar i { display: block; height: 100%; background: #8fb4ff; }
.cz-tour button { font: inherit; color: inherit; background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 5px; padding: 2px 8px; cursor: pointer; }
.cz-tour button:hover { background: rgba(255, 255, 255, 0.16); }
html[${PHOTO_ATTR}] .cz-tour { display: none; }
@media (max-width: 640px) { .cz-tour-bar { width: 60px; } }
`;

export interface OverlayHandlers {
  pause(): void;
  next(): void;
  exit(): void;
}

export class TourOverlay {
  private readonly el: HTMLDivElement;
  private readonly title: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly pauseBtn: HTMLButtonElement;
  private last = '';

  constructor(parent: HTMLElement, h: OverlayHandlers) {
    if (!document.getElementById('cz-tour-css')) {
      const style = document.createElement('style');
      style.id = 'cz-tour-css';
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    this.el = document.createElement('div');
    this.el.className = 'cz-tour';
    this.el.setAttribute('role', 'region');
    this.el.setAttribute('aria-label', 'Tour');
    this.title = document.createElement('b');
    const barWrap = document.createElement('div');
    barWrap.className = 'cz-tour-bar';
    this.bar = document.createElement('i');
    barWrap.appendChild(this.bar);
    const btn = (text: string, title: string, fn: () => void) => {
      const b = document.createElement('button');
      b.textContent = text;
      b.title = title;
      b.addEventListener('click', fn);
      return b;
    };
    this.pauseBtn = btn('Pause', 'Pause the tour (K)', h.pause);
    this.el.append(
      this.title,
      barWrap,
      this.pauseBtn,
      btn('Next', 'Skip to the next stop', h.next),
      btn('Exit', 'Leave the tour (Esc)', h.exit),
    );
    parent.appendChild(this.el);
  }

  update(s: TourStatus): void {
    const pct = s.total > 0 ? Math.min(100, (100 * s.time) / s.total) : 100;
    const key = `${s.stop}|${s.target}|${s.caption}|${s.paused}|${pct.toFixed(1)}`;
    if (key === this.last) return;
    this.last = key;
    this.title.textContent = `${s.title} · ${Math.max(1, s.stop)}/${s.stops}`;
    this.bar.style.width = `${pct.toFixed(1)}%`;
    this.pauseBtn.textContent = s.paused ? 'Resume' : 'Pause';
    const d = this.el.dataset;
    d.tour = s.id;
    d.stop = String(s.stop);
    d.target = s.target ?? '';
    d.caption = s.caption ?? '';
    d.paused = s.paused ? '1' : '0';
  }

  dispose(): void {
    this.el.remove();
  }
}
