/**
 * Final EffectPass (DESIGN 3.3 step 7): mip bloom, AgX tone mapping, SMAA (off on potato) and a
 * vignette in photo mode. Reads the HDR (pre-exposed) target and writes the canvas.
 */
import {
  BloomEffect,
  EffectPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
  type Effect,
} from 'postprocessing';
import { HalfFloatType, type PerspectiveCamera, type WebGLRenderTarget, type WebGLRenderer } from 'three';
import type { QualityKnobs } from '../core/contracts';

export class PostChain {
  private pass: EffectPass | null = null;
  private effects: Effect[] = [];
  private bloom = false;
  private smaa = false;
  private vignette = false;
  private width = 1;
  private height = 1;

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly camera: PerspectiveCamera,
    knobs: Readonly<QualityKnobs>,
  ) {
    this.bloom = knobs.bloom;
    this.smaa = knobs.smaa;
    this.build();
  }

  private build(): void {
    this.pass?.dispose();
    const effects: Effect[] = [];
    if (this.smaa) effects.push(new SMAAEffect({ preset: SMAAPreset.MEDIUM }));
    if (this.bloom) {
      effects.push(
        new BloomEffect({
          mipmapBlur: true,
          luminanceThreshold: 1.0,
          luminanceSmoothing: 0.3,
          intensity: 0.6,
          radius: 0.7,
          levels: 6,
        }),
      );
    }
    effects.push(new ToneMappingEffect({ mode: ToneMappingMode.AGX }));
    if (this.vignette) effects.push(new VignetteEffect({ offset: 0.3, darkness: 0.6 }));
    this.effects = effects;
    this.pass = new EffectPass(this.camera, ...effects);
    this.pass.renderToScreen = true;
    this.pass.initialize(this.renderer, false, HalfFloatType);
    this.pass.setSize(this.width, this.height);
  }

  setKnobs(knobs: Readonly<QualityKnobs>): void {
    if (knobs.bloom === this.bloom && knobs.smaa === this.smaa) return;
    this.bloom = knobs.bloom;
    this.smaa = knobs.smaa;
    this.build();
  }

  /** Photo-mode vignette. */
  setVignette(on: boolean): void {
    if (on === this.vignette) return;
    this.vignette = on;
    this.build();
  }

  setSize(w: number, h: number): void {
    this.width = w;
    this.height = h;
    this.pass?.setSize(w, h);
  }

  get effectNames(): string[] {
    return this.effects.map((e) => e.name);
  }

  render(input: WebGLRenderTarget, dt: number): void {
    this.pass!.render(this.renderer, input, null as unknown as WebGLRenderTarget, dt, false);
  }

  dispose(): void {
    this.pass?.dispose();
    this.pass = null;
  }
}
