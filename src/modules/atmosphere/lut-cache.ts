/**
 * Static-LUT cache (three-free): one entry per body, rebuilt only when the physics hash of its
 * parameters changes (a source/notes-only edit keeps the LUTs). The old entry is disposed on rebuild.
 */
import { physicsHash, type AtmosphereParams } from './params';

export class StaticLutCache<T> {
  private entries = new Map<string, { hash: string; value: T }>();
  /** Number of builds performed (tests and stats). */
  builds = 0;

  constructor(
    private readonly build: (p: AtmosphereParams) => T,
    private readonly dispose: (value: T) => void,
  ) {}

  /** Returns the LUTs for `p`, building them on first use or after a physics change. */
  get(p: AtmosphereParams): T {
    const hash = physicsHash(p);
    const cur = this.entries.get(p.id);
    if (cur && cur.hash === hash) return cur.value;
    const value = this.build(p);
    this.builds++;
    if (cur) this.dispose(cur.value);
    this.entries.set(p.id, { hash, value });
    return value;
  }

  /** The entry for `id` if it is current for `p` (no build). */
  peek(p: AtmosphereParams): T | undefined {
    const cur = this.entries.get(p.id);
    return cur && cur.hash === physicsHash(p) ? cur.value : undefined;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  clear(): void {
    for (const e of this.entries.values()) this.dispose(e.value);
    this.entries.clear();
  }

  values(): T[] {
    return [...this.entries.values()].map((e) => e.value);
  }
}
