/**
 * Performance overlay (setting `render.perfStats`, forced on by ?perf=1): the stats-gl panels
 * (FPS, CPU ms and, where EXT_disjoint_timer_query_webgl2 exists, GPU ms) plus one info line
 * (dynamic-resolution scale, buffer size, draw calls). It is created and destroyed at runtime:
 * stats-gl wraps `renderer.render`, so destroying restores the original method and the overlay
 * costs nothing while off. Browsers without GPU timer queries (Safari, SwiftShader) get no GPU
 * panel and a "GPU n/a" note instead.
 */
import type { WebGLRenderer } from 'three';

type StatsGl = InstanceType<typeof import('stats-gl').default>;

export interface PerfOverlayDeps {
  renderer: WebGLRenderer;
  /** Text of the info line (refreshed every 15 frames). */
  info: () => string;
  report: (message: string) => void;
}

/** True when the WebGL2 context exposes GPU timer queries. */
export function gpuTimerSupported(gl: Pick<WebGL2RenderingContext, 'getExtension'> | null): boolean {
  try {
    return !!gl?.getExtension('EXT_disjoint_timer_query_webgl2');
  } catch {
    return false;
  }
}

export class PerfOverlay {
  private want = false;
  private loading = false;
  private stats: StatsGl | null = null;
  private infoEl: HTMLDivElement | null = null;
  private origRender: WebGLRenderer['render'] | null = null;
  private gpu = false;
  private n = 0;

  constructor(private readonly deps: PerfOverlayDeps) {}

  get enabled(): boolean {
    return this.want;
  }

  setEnabled(on: boolean): void {
    this.want = on;
    if (on) void this.create();
    else this.destroy();
  }

  /** Call once per rendered frame (cheap no-op while off). */
  update(): void {
    const s = this.stats;
    if (!s) return;
    s.update();
    if (this.n++ % 15 || !this.infoEl) return;
    this.infoEl.textContent = this.deps.info() + (this.gpu ? '' : ' · GPU n/a');
  }

  private async create(): Promise<void> {
    if (this.stats || this.loading || typeof document === 'undefined') return;
    this.loading = true;
    try {
      const { default: Stats } = await import('stats-gl');
      if (!this.want || this.stats) return;
      const r = this.deps.renderer;
      this.gpu = gpuTimerSupported(r.getContext());
      this.origRender = r.render;
      const s = new Stats({ trackGPU: this.gpu, logsPerSecond: 4 });
      this.stats = s;
      await Promise.resolve(s.init(r));
      s.dom.classList.add('cz-perf-stats');
      s.dom.style.pointerEvents = 'none'; // never swallow clicks meant for the top bar
      document.body.appendChild(s.dom);
      const info = document.createElement('div');
      info.className = 'cz-perf-res';
      info.style.cssText =
        'position:fixed;left:0;top:48px;z-index:10000;font:11px/1.3 monospace;color:#9fe;' +
        'background:rgba(0,0,0,0.6);padding:2px 5px;pointer-events:none';
      info.textContent = this.gpu ? '' : 'GPU n/a';
      document.body.appendChild(info);
      this.infoEl = info;
      this.n = 0;
    } catch (e) {
      this.deps.report(`perf overlay: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.loading = false;
    }
    if (!this.want) this.destroy();
  }

  private destroy(): void {
    if (this.loading) return; // create() checks `want` when the import settles.
    const s = this.stats;
    if (s) {
      if (this.origRender) this.deps.renderer.render = this.origRender;
      try {
        s.dispose();
      } catch {
        // Best effort: the DOM is removed below either way.
      }
      s.dom.remove();
    }
    this.infoEl?.remove();
    this.stats = null;
    this.infoEl = null;
    this.origRender = null;
  }
}
