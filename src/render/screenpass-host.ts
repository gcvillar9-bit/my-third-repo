/**
 * Runs registered ScreenPasses between the main scene and the EffectPass (DESIGN 3.3 steps
 * 3-5): stages atmosphere → lensing → effects, ascending `order` within a stage. HalfFloat
 * targets ping-pong; inactive passes are skipped without a copy.
 */
import {
  HalfFloatType,
  LinearFilter,
  RGBAFormat,
  WebGLRenderTarget,
  type DepthTexture,
  type WebGLRenderer,
} from 'three';
import type { ScreenPass, ViewState } from '../core/contracts';

export const STAGE_ORDER: Record<ScreenPass['stage'], number> = { atmosphere: 0, lensing: 1, effects: 2 };

export function sortPasses(passes: readonly ScreenPass[]): ScreenPass[] {
  return [...passes].sort((a, b) => STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage] || a.order - b.order);
}

export function hdrTarget(w: number, h: number): WebGLRenderTarget {
  return new WebGLRenderTarget(w, h, {
    type: HalfFloatType,
    format: RGBAFormat,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    depthBuffer: false,
    generateMipmaps: false,
  });
}

export class ScreenPassHost {
  private passes: ScreenPass[] = [];
  private targets: WebGLRenderTarget[] = [];
  private width = 1;
  private height = 1;

  add(p: ScreenPass): void {
    this.passes = sortPasses([...this.passes.filter((x) => x.id !== p.id), p]);
    p.setSize?.(this.width, this.height);
  }

  remove(p: ScreenPass): void {
    this.passes = this.passes.filter((x) => x !== p);
  }

  list(): readonly ScreenPass[] {
    return this.passes;
  }

  setSize(w: number, h: number): void {
    this.width = w;
    this.height = h;
    for (const t of this.targets) t.setSize(w, h);
    for (const p of this.passes) p.setSize?.(w, h);
  }

  private target(i: number): WebGLRenderTarget {
    if (!this.targets[i]) this.targets[i] = hdrTarget(this.width, this.height);
    return this.targets[i];
  }

  /** Returns the target holding the result (the input when no pass is active). */
  run(
    renderer: WebGLRenderer,
    input: WebGLRenderTarget,
    depth: DepthTexture,
    view: ViewState,
  ): WebGLRenderTarget {
    let cur = input;
    let next = 0;
    for (const p of this.passes) {
      if (!p.active(view)) continue;
      const out = this.target(next);
      p.render(renderer, cur, depth, out, view);
      cur = out;
      next = 1 - next;
    }
    return cur;
  }

  memoryBytes(): number {
    let n = this.targets.length * this.width * this.height * 8;
    for (const p of this.passes) n += p.memoryBytes?.() ?? 0;
    return n;
  }

  dispose(): void {
    for (const t of this.targets) t.dispose();
    this.targets = [];
  }
}
