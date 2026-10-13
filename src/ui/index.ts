/**
 * UI shell entry. SCAFFOLD STUB: P1-D replaces this with the Preact shell
 * (palette, info card, time bar, HUD, labels, settings). Signature: MountUi in core/contracts.
 */
import type { SettingValue, UiApi, UiContext } from '../core/contracts';

export function mountUi(_root: HTMLElement, _ctx?: UiContext): UiApi {
  const values = new Map<string, SettingValue>();
  let selection: string | null = null;
  return {
    toast: (message) => console.info('[toast]', message),
    showInfo: () => {},
    get selection() {
      return selection;
    },
    select: (id) => {
      selection = id;
    },
    addLabelSource: () => () => {},
    settings: {
      get: <T extends SettingValue = SettingValue>(id: string) => values.get(id) as T | undefined,
      set: (id, value) => void values.set(id, value),
      subscribe: () => () => {},
    },
    setHudVisible: () => {},
    setCaption: () => {},
  };
}
