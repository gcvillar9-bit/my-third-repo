/**
 * First-visit hints. STUB for P1 (a short toast once per browser); P5 may replace it with a
 * guided intro.
 */
import type { AppEnv, UiApi } from '../core/contracts';

const KEY = 'cosmos.onboarded';

export function startOnboarding(ui: UiApi, env: AppEnv): void {
  if (env.test) return;
  try {
    if (localStorage.getItem(KEY)) return;
    localStorage.setItem(KEY, '1');
  } catch {
    // Storage blocked: show the hint every time.
  }
  ui.toast('Drag to look, WASD to fly, wheel or [ ] for speed, / to search.', { durationMs: 8000 });
}
