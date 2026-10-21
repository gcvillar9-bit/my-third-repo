/**
 * Shader warm-up (smoothness): a renderable added at runtime (terrain below 3 R, clouds, life, a
 * city) used to compile and link its programs on its first draw, which blocks the main thread for
 * the whole link (0.2 s to over 1 s for the terrain program on a laptop GPU: one visible hitch per
 * new kind of object while flying in). With KHR_parallel_shader_compile the driver links in the
 * background: the renderer creates the programs as soon as the renderable is added and keeps the
 * object hidden until every program reports complete (bounded by `maxFrames`), so no frame waits
 * on a link. Pure bookkeeping; the renderer supplies `ready` (compile and poll) and the frame count.
 */
import type { Renderable } from '../core/contracts';

/** Frames a renderable may stay hidden while its programs link; then it is drawn regardless. */
export const WARM_UP_MAX_FRAMES = 180;

export class ShaderWarmUp {
  private readonly pending = new Map<string, { r: Renderable; since: number }>();

  /**
   * @param ready creates the renderable's programs (if not yet) and returns true once all are linked,
   *   false while one still links, null when the object has no material yet (a pool filled by its
   *   first update): polled again next frame, drawn meanwhile
   * @param maxFrames bound on the frames a renderable is polled or stays hidden
   */
  constructor(
    private readonly ready: (r: Renderable) => boolean | null,
    private readonly maxFrames = WARM_UP_MAX_FRAMES,
  ) {}

  get size(): number {
    return this.pending.size;
  }

  /** Starts warming a renderable added at `frame`. */
  add(r: Renderable, frame: number): void {
    this.pending.set(r.id, { r, since: frame });
  }

  remove(id: string): void {
    this.pending.delete(id);
  }

  /** False while the renderable's programs are still linking (the surface manager keeps the previous one). */
  isReady(id: string): boolean {
    return !this.pending.has(id);
  }

  /**
   * Call before drawing frame `frame`: polls every pending renderable and hides the ones still
   * linking. Returns what it hid so `show` can restore it after the draws (modules set visibility
   * in their own update, so the flag is only taken for the draws).
   */
  hide(frame: number): Renderable[] {
    const hidden: Renderable[] = [];
    for (const [id, w] of this.pending) {
      let state: boolean | null = frame - w.since >= this.maxFrames;
      if (!state) {
        try {
          state = this.ready(w.r);
        } catch {
          state = true; // a material three.js cannot prepare here links on its first draw as before
        }
      }
      if (state === true) this.pending.delete(id);
      else if (state === false && w.r.object.visible) {
        w.r.object.visible = false;
        hidden.push(w.r);
      }
    }
    return hidden;
  }

  /** Restores the visibility `hide` took. */
  show(hidden: readonly Renderable[]): void {
    for (const r of hidden) r.object.visible = true;
  }
}
