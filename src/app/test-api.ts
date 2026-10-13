/**
 * window.__universe (contracts: UniverseTestApi), installed with ?test=1 or in dev. In test
 * mode rAF is off: frames advance only through renderFrames(n).
 */
import type { WebGLRenderer } from 'three';
import type { RenderStats, UniverseTestApi } from '../core/contracts';

export interface TestApiHost {
  renderer: WebGLRenderer;
  /** Renders one frame. */
  renderFrame(): void;
  /** Resolves when boot finished and assets, tracked work and workers are idle. */
  ready(): Promise<void>;
  goto(bookmarkId: string): Promise<void>;
  setTime(iso: string): void;
  stats(): RenderStats;
}

const errors: string[] = [];
let capturing = false;

/** Starts recording uncaught errors, rejections and console.error calls. Idempotent. */
export function captureErrors(): void {
  if (capturing) return;
  capturing = true;
  window.addEventListener('error', (e) => errors.push(`error: ${e.message}`));
  window.addEventListener('unhandledrejection', (e) =>
    errors.push(`unhandledrejection: ${String(e.reason)}`),
  );
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    errors.push(`console.error: ${args.map(String).join(' ')}`);
    original(...args);
  };
}

/** Records a shader compile/link failure or module error. */
export function recordError(message: string): void {
  errors.push(message);
}

export const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

export function installTestApi(host: TestApiHost): UniverseTestApi {
  const { renderer } = host;
  const api: UniverseTestApi = {
    ready: () => host.ready(),
    async renderFrames(n: number) {
      for (let i = 0; i < n; i++) {
        host.renderFrame();
        await new Promise<void>((r) => setTimeout(r, 0));
      }
    },
    goto: (id) => host.goto(id),
    setTime: (iso) => host.setTime(iso),
    stats: () => host.stats(),
    async probe(x, y, w, h) {
      const gl = renderer.getContext();
      renderer.setRenderTarget(null);
      const pr = renderer.getPixelRatio();
      const px = Math.max(0, Math.round(x * pr));
      const pw = Math.max(1, Math.round(w * pr));
      const ph = Math.max(1, Math.round(h * pr));
      const py = Math.max(0, gl.drawingBufferHeight - Math.round(y * pr) - ph);
      const buf = new Uint8Array(pw * ph * 4);
      gl.readPixels(px, py, pw, ph, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      const sum: [number, number, number] = [0, 0, 0];
      for (let i = 0; i < buf.length; i += 4) {
        for (let c = 0; c < 3; c++) sum[c] += srgbToLinear(buf[i + c] / 255);
      }
      const n = pw * ph;
      return [sum[0] / n, sum[1] / n, sum[2] / n];
    },
    errors: () => errors.slice(),
  };
  window.__universe = api;
  return api;
}
