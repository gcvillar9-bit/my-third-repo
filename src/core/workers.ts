/**
 * Comlink worker pools (ES module workers). Usage in a module:
 *
 *   const h = ctx.workers.pool<DecoderApi>('stars.decode',
 *     () => new Worker(new URL('./decode.worker.ts', import.meta.url), { type: 'module' }));
 *   const out = await h.call('decode', transfer(buf, [buf]));
 *
 * The worker file calls comlink `expose(api)`.
 */
import { wrap, type Remote } from 'comlink';
import type { MethodKeys, WorkerHandle, WorkerPool } from './contracts';

interface Slot {
  worker: Worker;
  remote: Remote<Record<string, (...a: unknown[]) => unknown>>;
  inflight: number;
}

/** Turns a Worker into a callable remote (comlink `wrap` by default; injectable for tests). */
export type WrapFn = (w: Worker) => Remote<Record<string, (...a: unknown[]) => unknown>>;

class Handle<T extends object> implements WorkerHandle<T> {
  constructor(
    private readonly slots: Slot[],
    private readonly onChange: (delta: number) => void,
  ) {}

  get size(): number {
    return this.slots.length;
  }

  pending(): number {
    return this.slots.reduce((n, s) => n + s.inflight, 0);
  }

  private async invoke(slot: Slot, method: string, args: unknown[]): Promise<unknown> {
    slot.inflight++;
    this.onChange(1);
    try {
      const fn = slot.remote[method];
      if (typeof fn !== 'function') throw new Error(`worker: no method '${method}'`);
      return await fn(...args);
    } finally {
      slot.inflight--;
      this.onChange(-1);
    }
  }

  call<K extends MethodKeys<T>>(
    method: K,
    ...args: T[K] extends (...a: infer A) => unknown ? A : never
  ): Promise<T[K] extends (...a: never[]) => infer R ? Awaited<R> : never> {
    let best = this.slots[0];
    for (const s of this.slots) if (s.inflight < best.inflight) best = s;
    return this.invoke(best, String(method), args) as Promise<
      T[K] extends (...a: never[]) => infer R ? Awaited<R> : never
    >;
  }

  async broadcast<K extends MethodKeys<T>>(
    method: K,
    ...args: T[K] extends (...a: infer A) => unknown ? A : never
  ): Promise<void> {
    await Promise.all(this.slots.map((s) => this.invoke(s, String(method), args)));
  }

  terminate(): void {
    for (const s of this.slots) s.worker.terminate();
    this.slots.length = 0;
  }
}

export class WorkerPoolImpl implements WorkerPool {
  readonly maxWorkers: number;
  private pools = new Map<string, Handle<object>>();
  private inflight = 0;

  constructor(
    hardwareConcurrency = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 4,
    private readonly wrapFn: WrapFn = (w) => wrap(w) as ReturnType<WrapFn>,
  ) {
    this.maxWorkers = Math.min(4, Math.max(1, hardwareConcurrency || 1));
  }

  pool<T extends object>(key: string, create: () => Worker, count = 1): WorkerHandle<T> {
    const existing = this.pools.get(key);
    if (existing) return existing as unknown as WorkerHandle<T>;
    const n = Math.min(this.maxWorkers, Math.max(1, Math.floor(count)));
    const slots: Slot[] = [];
    for (let i = 0; i < n; i++) {
      const worker = create();
      slots.push({ worker, remote: this.wrapFn(worker), inflight: 0 });
    }
    const h = new Handle<T>(slots, (d) => (this.inflight += d));
    this.pools.set(key, h as unknown as Handle<object>);
    return h;
  }

  pending(): number {
    return this.inflight;
  }

  terminateAll(): void {
    for (const h of this.pools.values()) h.terminate();
    this.pools.clear();
  }
}
