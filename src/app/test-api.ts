/**
 * window.__universe test API. SCAFFOLD STUB: P1-A replaces it with the full engine-backed
 * implementation (goto, setTime, budgets). Contract: UniverseTestApi in core/contracts.
 */
import type { WebGLRenderer } from 'three';
import type { RenderStats, UniverseTestApi } from '../core/contracts';

export interface TestApiHost {
  renderer: WebGLRenderer;
  /** Renders one frame. */
  renderFrame(): void;
  /** Resolves when boot has finished. */
  booted: Promise<void>;
  frameCount(): number;
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

/** Records a shader compile/link failure. */
export function recordError(message: string): void {
  errors.push(message);
}

const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

export function installTestApi(host: TestApiHost): UniverseTestApi {
  const { renderer } = host;
  const notReady = (what: string) =>
    Promise.reject(new Error(`__universe.${what} is not available in the scaffold`));
  const api: UniverseTestApi = {
    ready: () => host.booted,
    async renderFrames(n: number) {
      for (let i = 0; i < n; i++) {
        host.renderFrame();
        await new Promise<void>((r) => setTimeout(r, 0));
      }
    },
    goto: () => notReady('goto'),
    setTime: () => {
      throw new Error('__universe.setTime is not available in the scaffold');
    },
    stats(): RenderStats {
      const { render, memory, programs } = renderer.info;
      return {
        calls: render.calls,
        triangles: render.triangles,
        points: render.points,
        lines: render.lines,
        programs: programs?.length ?? 0,
        textures: memory.textures,
        geometries: memory.geometries,
        tiles: 0,
        gpuBytes: 0,
        frame: host.frameCount(),
      };
    },
    async probe(x, y, w, h) {
      const gl = renderer.getContext();
      const pr = renderer.getPixelRatio();
      const px = Math.round(x * pr);
      const pw = Math.max(1, Math.round(w * pr));
      const ph = Math.max(1, Math.round(h * pr));
      const py = gl.drawingBufferHeight - Math.round(y * pr) - ph;
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
