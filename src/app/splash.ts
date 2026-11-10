/**
 * Boot splash and fatal-error screen. The markup and styles live in index.html (`#boot`) so the
 * splash is on screen before any script runs; this file only drives it: progress while modules
 * and their assets load, a fade-out once the first frames are drawn, and a readable message with
 * a Reload button when boot fails or the WebGL context is lost. Every method is a no-op when the
 * element is missing (unit tests, embedded pages).
 */
export interface Splash {
  /** Asset progress; the bar never moves backwards while more work is being queued. */
  progress(loaded: number, total: number): void;
  message(text: string): void;
  /** Fades the splash out and removes it. */
  done(): void;
  /** Replaces the splash by an error message with a Reload button (re-creating it if it was removed). */
  fail(text: string): void;
  /** Removes the splash at once (test mode). */
  remove(): void;
}

/** Fraction shown for `loaded` of `total` tracked loads: 4% .. 96%, monotonic through `prev`. */
export function splashFraction(loaded: number, total: number, prev = 0): number {
  if (!(total > 0)) return Math.max(prev, 0.04);
  const f = 0.04 + 0.92 * Math.min(1, Math.max(0, loaded / total));
  return Math.max(prev, f);
}

const MARKUP =
  '<div class="boot-box"><div class="boot-title">COSMOS</div><div class="boot-sub"></div>' +
  '<div class="boot-bar"><i></i></div><button type="button">Reload</button></div>';

export function createSplash(doc: Document | undefined = globalThis.document): Splash {
  let el = doc?.getElementById('boot') ?? null;
  let shown = 0;
  const sub = () => el?.querySelector<HTMLElement>('.boot-sub') ?? null;
  return {
    progress(loaded, total) {
      shown = splashFraction(loaded, total, shown);
      const bar = el?.querySelector<HTMLElement>('.boot-bar i');
      if (bar) bar.style.width = `${(shown * 100).toFixed(1)}%`;
    },
    message(text) {
      const s = sub();
      if (s) s.textContent = text;
    },
    done() {
      const node = el;
      if (!node) return;
      el = null;
      node.classList.add('done');
      setTimeout(() => node.remove(), 700);
    },
    fail(text) {
      if (!doc) return;
      if (!el) {
        el = doc.createElement('div');
        el.id = 'boot';
        el.innerHTML = MARKUP;
        el.querySelector('button')?.addEventListener('click', () => globalThis.location?.reload());
        doc.body.appendChild(el);
      }
      el.classList.remove('done');
      el.classList.add('failed');
      el.setAttribute('role', 'alert');
      const s = sub();
      if (s) s.textContent = text;
    },
    remove() {
      el?.remove();
      el = null;
    },
  };
}
