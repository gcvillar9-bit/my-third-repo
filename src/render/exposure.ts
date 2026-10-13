/**
 * Pre-exposure (DESIGN 3.2): shaders output L[cd/m²] · uExposure with
 * exposure = 1 / (1.2 · 2^EV100). The meter averages log luminance of the HDR frame on a 32×32
 * grid (16 taps per cell), reads it back asynchronously every 4 frames, and eye adaptation
 * eases EV with τ = 0.5 s towards brighter and 2 s towards darker scenes. Test mode uses a fixed EV.
 */
import {
  FloatType,
  NearestFilter,
  RGBAFormat,
  WebGLRenderTarget,
  type Texture,
  type WebGLRenderer,
} from 'three';
import type { ExposureControl } from '../core/contracts';
import { FullscreenPass, fullscreenMaterial } from './passes';

export const EV_MIN = -6;
export const EV_MAX = 24;
/** EV used when (almost) nothing on screen is brighter than LIT_FLOOR (deep space, stars only). */
export const EV_NIGHT = -5; // dark-adapted night sky (R1: was -2, which hid most naked-eye stars)
/** Default fixed EV in test mode when neither the bookmark nor ?ev= sets one. */
export const DEFAULT_TEST_EV = 12;
/** Pixels dimmer than this (cd/m²) are ignored by the meter (sky background, faint nebulae). */
export const LIT_FLOOR = 0.05;
export const TAU_BRIGHTER = 0.5;
export const TAU_DARKER = 2;
export const METER_INTERVAL = 4;

export const exposureFromEv = (ev: number): number => 1 / (1.2 * 2 ** ev);
/** EV100 that maps average luminance L to middle grey (S = 100, K = 12.5). */
export const evFromLuminance = (l: number): number => Math.log2((Math.max(l, 1e-9) * 100) / 12.5);

/** Eye adaptation step: exponential approach with direction-dependent τ. */
export function adaptEv(current: number, target: number, dt: number): number {
  const tau = target > current ? TAU_BRIGHTER : TAU_DARKER;
  return current + (target - current) * (1 - Math.exp(-Math.max(0, dt) / tau));
}

/**
 * Target EV from meter output: mean log2 luminance of lit pixels and their screen coverage.
 * Coverage below ~0.2% falls back to EV_NIGHT; above ~3% the lit average wins.
 */
export function targetEv(meanLog2Lit: number, coverage: number): number {
  const lit = evFromLuminance(2 ** meanLog2Lit);
  const t = Math.min(1, Math.max(0, (coverage - 0.002) / 0.028));
  const s = t * t * (3 - 2 * t);
  return Math.min(EV_MAX, Math.max(EV_MIN, EV_NIGHT + (lit - EV_NIGHT) * s));
}

export class ExposureController implements ExposureControl {
  compensation = 0;
  private _ev: number;
  private fixed: number | null = null;
  private target: number;

  constructor(initialEv = 12) {
    this._ev = this.target = initialEv;
  }

  get ev(): number {
    return this.fixed ?? this._ev;
  }
  get value(): number {
    return exposureFromEv(this.ev + this.compensation);
  }
  get isFixed(): boolean {
    return this.fixed !== null;
  }

  setFixedEV(ev: number | null): void {
    this.fixed = ev;
    if (ev !== null) this._ev = this.target = ev;
  }

  /** New metered target EV. */
  setTarget(ev: number): void {
    this.target = ev;
  }

  update(dt: number): void {
    if (this.fixed === null) this._ev = adaptEv(this._ev, this.target, dt);
  }
}

const METER_SIZE = 32;

/** GPU log-luminance meter with async readback. */
export class LuminanceMeter {
  private target = new WebGLRenderTarget(METER_SIZE, METER_SIZE, {
    type: FloatType,
    format: RGBAFormat,
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    depthBuffer: false,
  });
  private pass: FullscreenPass;
  private buffer = new Float32Array(METER_SIZE * METER_SIZE * 4);
  private busy = false;
  private failed = false;

  constructor(private readonly onResult: (meanLog2Lit: number, coverage: number) => void) {
    this.pass = new FullscreenPass(
      fullscreenMaterial({
        uniforms: { tInput: { value: null }, uFloorPre: { value: 0 }, uExposure: { value: 1 } },
        fragmentShader: /* glsl */ `
          // cosmos:no-depth (luminance meter)
          uniform sampler2D tInput;
          uniform float uFloorPre;
          uniform float uExposure;
          varying vec2 vUv;
          void main() {
            vec2 cell = vec2(1.0 / ${METER_SIZE}.0);
            vec2 base = floor(vUv * ${METER_SIZE}.0) * cell;
            float sumLog = 0.0;
            float n = 0.0;
            for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {
              vec3 c = texture2D(tInput, base + (vec2(i, j) + 0.5) * cell * 0.25).rgb;
              float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
              if (l > uFloorPre) { sumLog += log2(l / uExposure); n += 1.0; }
            }
            gl_FragColor = vec4(sumLog, n, 0.0, 1.0);
          }`,
      }),
    );
  }

  /** Measures `input` (pre-exposed by `exposure`). Skips while a readback is in flight. */
  measure(renderer: WebGLRenderer, input: Texture, exposure: number): void {
    if (this.busy || this.failed) return;
    const u = this.pass.material.uniforms;
    u.tInput.value = input;
    u.uExposure.value = exposure;
    u.uFloorPre.value = LIT_FLOOR * exposure;
    this.pass.render(renderer, this.target);
    this.busy = true;
    const finish = () => {
      this.busy = false;
      let sum = 0;
      let n = 0;
      for (let i = 0; i < this.buffer.length; i += 4) {
        sum += this.buffer[i];
        n += this.buffer[i + 1];
      }
      const total = METER_SIZE * METER_SIZE * 16;
      this.onResult(n > 0 ? sum / n : -30, n / total);
    };
    const fail = (e: unknown) => {
      this.busy = false;
      this.failed = true;
      console.warn('[exposure] meter readback failed; eye adaptation disabled', e);
    };
    try {
      if (typeof renderer.readRenderTargetPixelsAsync === 'function') {
        renderer
          .readRenderTargetPixelsAsync(this.target, 0, 0, METER_SIZE, METER_SIZE, this.buffer)
          .then(finish, () => {
            // Fallback: synchronous read.
            try {
              renderer.readRenderTargetPixels(this.target, 0, 0, METER_SIZE, METER_SIZE, this.buffer);
              finish();
            } catch (e) {
              fail(e);
            }
          });
      } else {
        renderer.readRenderTargetPixels(this.target, 0, 0, METER_SIZE, METER_SIZE, this.buffer);
        finish();
      }
    } catch (e) {
      fail(e);
    }
  }

  dispose(): void {
    this.target.dispose();
    this.pass.dispose();
  }
}
