/**
 * First-visit hint card (P5-B). Shown once per browser (localStorage flag, every access wrapped in
 * try/catch), never in test mode and never when the UI is hidden (?ui=0). The card lists the main
 * controls, links to the '?' help overlay and starts the Cosmic Zoom tour.
 */
import type { AppEnv, UiApi } from '../core/contracts';
import { COSMIC_ZOOM_ID, tours } from '../modules/tours/public';
import { uiActions } from '../ui/actions';

export const ONBOARDING_KEY = 'cosmos.onboarded';

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

/** localStorage, or null when blocked (private mode, sandboxed iframe, file://). */
export function onboardingStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Whether to show the card: not in test mode, not with ?ui=0, and not seen before. */
export function shouldOnboard(env: Pick<AppEnv, 'test' | 'params'>, storage: Storage | null): boolean {
  if (env.test || env.params.get('ui') === '0') return false;
  if (!storage) return true;
  try {
    return storage.getItem(ONBOARDING_KEY) === null;
  } catch {
    return true;
  }
}

/** Remembers that the card was shown (best effort). */
export function markOnboarded(storage: Storage | null): void {
  try {
    storage?.setItem(ONBOARDING_KEY, '1');
  } catch {
    // Storage full or blocked: the card shows again next visit.
  }
}

export const HINTS: readonly [string, string][] = [
  ['/', 'search anything: planets, stars, galaxies, bookmarks'],
  ['WASD + drag', 'fly and look around'],
  ['wheel', 'change speed'],
  [', .', 'slow down or speed up time'],
  ['G', 'walk when near a surface'],
  ['P', 'photo mode'],
];

const CSS = `
.cz-onboard { position: absolute; left: 12px; bottom: 60px; z-index: 7; width: min(330px, calc(100vw - 24px)); pointer-events: auto;
  padding: 12px 14px; border-radius: 10px; background: rgba(14, 18, 28, 0.72); border: 1px solid rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px); font: 12px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif; color: #cdd6e4; }
.cz-onboard h2 { margin: 0 0 6px; font-size: 14px; font-weight: 600; color: #fff; }
.cz-onboard ul { margin: 0 0 10px; padding: 0; list-style: none; }
.cz-onboard li { display: flex; gap: 8px; margin: 2px 0; }
.cz-onboard kbd { min-width: 78px; font: 11px ui-monospace, monospace; color: #9cc3ff; }
.cz-onboard .row { display: flex; gap: 6px; flex-wrap: wrap; }
.cz-onboard button { font: inherit; color: inherit; background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 6px; padding: 3px 10px; cursor: pointer; }
.cz-onboard button.primary { background: rgba(120, 160, 255, 0.28); }
html[data-photo] .cz-onboard { display: none; }
`;

export function startOnboarding(_ui: UiApi, env: AppEnv): void {
  const storage = onboardingStorage();
  if (!shouldOnboard(env, storage) || typeof document === 'undefined') return;
  markOnboarded(storage);

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const card = document.createElement('div');
  card.className = 'cz-onboard';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Welcome');
  const h = document.createElement('h2');
  h.textContent = 'Welcome to Cosmos';
  const list = document.createElement('ul');
  for (const [key, text] of HINTS) {
    const li = document.createElement('li');
    const k = document.createElement('kbd');
    k.textContent = key;
    li.append(k, document.createTextNode(text));
    list.appendChild(li);
  }
  const row = document.createElement('div');
  row.className = 'row';
  const close = () => card.remove();
  const button = (text: string, fn: () => void, cls = '') => {
    const b = document.createElement('button');
    b.textContent = text;
    b.className = cls;
    b.addEventListener('click', () => {
      close();
      fn();
    });
    row.appendChild(b);
  };
  button('▶ Take the tour', () => tours.start(COSMIC_ZOOM_ID), 'primary');
  button('All keys (?)', () => uiActions.openHelp());
  button('Got it', () => {});
  card.append(h, list, row);
  (document.getElementById('ui') ?? document.body).appendChild(card);
  window.addEventListener('keydown', (e) => e.key === 'Escape' && close(), { once: true });
}
