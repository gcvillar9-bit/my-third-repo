/**
 * GPU memory accounting with LRU eviction (DESIGN 3.3 ResourceBudget). The budget only
 * counts bytes; owners dispose their resources inside `evict`.
 */
import type { BudgetEntry, ResourceBudget } from './contracts';

const MB = 1024 * 1024;

interface Slot {
  owner: string;
  key: string;
  bytes: number;
  lastUse: number;
  evict?: () => void;
  live: boolean;
}

export class ResourceBudgetImpl implements ResourceBudget {
  private slots = new Map<string, Slot>();
  private clock = 0;
  private total = 0;

  /** `cap` in bytes, or a function so the cap follows the quality preset. */
  constructor(private readonly cap: number | (() => number)) {}

  get capBytes(): number {
    return typeof this.cap === 'function' ? this.cap() : this.cap;
  }

  /** Cap helper for QualityKnobs.gpuBudgetMB. */
  static mb(n: number): number {
    return n * MB;
  }

  alloc(owner: string, key: string, bytes: number, evict?: () => void): BudgetEntry {
    const id = `${owner}\u0000${key}`;
    this.slots.get(id)?.live && this.release(id);
    const over = this.total + bytes - this.capBytes;
    if (over > 0) this.makeRoom(bytes);
    const slot: Slot = { owner, key, bytes: Math.max(0, bytes), lastUse: ++this.clock, evict, live: true };
    this.slots.set(id, slot);
    this.total += slot.bytes;
    const self = this;
    return {
      owner,
      key,
      get bytes() {
        return slot.bytes;
      },
      touch() {
        slot.lastUse = ++self.clock;
      },
      resize(n: number) {
        if (!slot.live) return;
        self.total += Math.max(0, n) - slot.bytes;
        slot.bytes = Math.max(0, n);
      },
      free() {
        if (slot.live && self.slots.get(id) === slot) self.release(id);
      },
    };
  }

  private release(id: string): void {
    const s = this.slots.get(id);
    if (!s) return;
    s.live = false;
    this.total -= s.bytes;
    this.slots.delete(id);
  }

  used(owner?: string): number {
    if (owner === undefined) return this.total;
    let n = 0;
    for (const s of this.slots.values()) if (s.owner === owner) n += s.bytes;
    return n;
  }

  report(): Record<string, number> {
    const r: Record<string, number> = {};
    for (const s of this.slots.values()) r[s.owner] = (r[s.owner] ?? 0) + s.bytes;
    return r;
  }

  makeRoom(bytes: number): number {
    const need = this.total + bytes - this.capBytes;
    if (need <= 0) return 0;
    const candidates = [...this.slots.entries()]
      .filter(([, s]) => s.evict)
      .sort((a, b) => a[1].lastUse - b[1].lastUse);
    let freed = 0;
    for (const [id, s] of candidates) {
      if (freed >= need) break;
      try {
        s.evict!();
      } finally {
        freed += s.bytes;
        this.release(id);
      }
    }
    return freed;
  }
}
