/**
 * Settings store (UiApi.settings). Definitions come from the registry; values start at the
 * default (or the persisted value when `persist`), and onChange runs at registration and on
 * every change.
 */
import type { SettingDef, SettingsStore, SettingValue } from '../core/contracts';

export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

const KEY = (id: string) => `cosmos.setting.${id}`;

export function safeStorage(): KeyValueStorage | null {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    s.getItem('cosmos.probe');
    return s;
  } catch {
    return null;
  }
}

function coerce(def: SettingDef | undefined, v: SettingValue): SettingValue {
  if (!def) return v;
  switch (def.type) {
    case 'boolean':
      return v === true || v === 'true';
    case 'number': {
      let n = Number(v);
      if (!Number.isFinite(n)) n = Number(def.default);
      if (def.min !== undefined) n = Math.max(def.min, n);
      if (def.max !== undefined) n = Math.min(def.max, n);
      return n;
    }
    case 'select': {
      const s = String(v);
      return def.options && !def.options.some((o) => o.value === s) ? def.default : s;
    }
    default:
      return v;
  }
}

export class SettingsStoreImpl implements SettingsStore {
  private readonly values = new Map<string, SettingValue>();
  private readonly defs = new Map<string, SettingDef>();
  private readonly listeners = new Map<string, Set<(v: SettingValue) => void>>();
  private readonly anyListeners = new Set<() => void>();

  constructor(private readonly storage: KeyValueStorage | null = null) {}

  /** Registers a definition (idempotent per id) and runs its onChange with the initial value. */
  register(def: SettingDef): void {
    if (this.defs.has(def.id)) return;
    this.defs.set(def.id, def);
    if (def.type === 'action') return;
    let v: SettingValue = this.values.has(def.id) ? this.values.get(def.id)! : def.default;
    if (def.persist && this.storage) {
      try {
        const raw = this.storage.getItem(KEY(def.id));
        if (raw !== null) v = JSON.parse(raw) as SettingValue;
      } catch {
        // Corrupt or blocked storage: keep the default.
      }
    }
    v = coerce(def, v);
    this.values.set(def.id, v);
    this.fire(def, v);
  }

  definitions(): SettingDef[] {
    return [...this.defs.values()];
  }

  get<T extends SettingValue = SettingValue>(id: string): T | undefined {
    return this.values.get(id) as T | undefined;
  }

  set(id: string, value: SettingValue): void {
    const def = this.defs.get(id);
    if (def?.type === 'action') {
      this.fire(def, value);
      return;
    }
    const v = coerce(def, value);
    if (this.values.get(id) === v) return;
    this.values.set(id, v);
    if (def?.persist && this.storage) {
      try {
        this.storage.setItem(KEY(id), JSON.stringify(v));
      } catch {
        // Storage full or blocked.
      }
    }
    this.fire(def, v, id);
  }

  subscribe(id: string, listener: (value: SettingValue) => void): () => void {
    let set = this.listeners.get(id);
    if (!set) this.listeners.set(id, (set = new Set()));
    set.add(listener);
    return () => set.delete(listener);
  }

  /** Any value or definition change (settings panel re-render). */
  onAny(listener: () => void): () => void {
    this.anyListeners.add(listener);
    return () => this.anyListeners.delete(listener);
  }

  private fire(def: SettingDef | undefined, v: SettingValue, id = def?.id ?? ''): void {
    try {
      def?.onChange?.(v);
    } catch (e) {
      console.error(`[ui] setting ${id} onChange failed`, e);
    }
    for (const l of this.listeners.get(id) ?? []) l(v);
    for (const l of this.anyListeners) l();
  }
}
