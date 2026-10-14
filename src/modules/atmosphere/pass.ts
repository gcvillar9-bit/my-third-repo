/**
 * GPU side of the atmosphere: static LUTs per body (transmittance 256x64, multiple scattering
 * 32x32; rebuilt only when the physics parameters change), per-frame sky-view 192x108 and
 * aerial-perspective atlas 1024x32 (camera inside the atmosphere), and the 'atmosphere' stage
 * ScreenPass that composites sky, aerial perspective and background transmittance.
 */
import {
  GLSL3,
  HalfFloatType,
  Matrix3,
  Matrix4,
  NearestFilter,
  RGBAFormat,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type DepthTexture,
  type IUniform,
  type Texture,
  type WebGLRenderer,
} from 'three';
import type { Body, QualityPreset, RegistryReader, ScreenPass, ViewState } from '../../core/contracts';
import { quat, vec3 } from '../../core/math64';
import { SUN_RGB, solarIlluminance } from '../../core/photometry';
import { DEPTH_GLSL, PHASE_GLSL } from '../../render/chunks/index';
import aerialFrag from './glsl/aerial.frag.glsl?raw';
import commonGlsl from './glsl/common.glsl?raw';
import compositeFrag from './glsl/composite.frag.glsl?raw';
import marchFrag from './glsl/march.frag.glsl?raw';
import multiscatterFrag from './glsl/multiscatter.frag.glsl?raw';
import skyviewFrag from './glsl/skyview.frag.glsl?raw';
import scatterGlsl from './glsl/scatter.glsl?raw';
import transmittanceFrag from './glsl/transmittance.frag.glsl?raw';
import viewRayGlsl from './glsl/view-ray.glsl?raw';
import { FULLSCREEN_VERT, FullscreenDraw, lutMaterial, lutTarget, targetBytes } from './gpu/fullscreen';
import { StaticLutCache } from './lut-cache';
import { AP_SIZE, AP_SLICES, MULTISCATTER_SIZE, SKYVIEW_SIZE, TRANSMITTANCE_SIZE } from './model';
import type { AtmosphereParams } from './params';
import { atmosphereFrame, selectAtmosphere, stepCounts, type AtmosphereFrame } from './space';

export const ATMOSPHERE_PASS_ID = 'atmosphere.composite';

/**
 * Resolution of the in-scattering march relative to the frame (P4-P): the expensive per-pixel
 * march (every pixel in the shell when the camera is outside, e.g. earth-dawn-400km) runs at half
 * resolution per axis and is upsampled with path-length-aware weights; ultra marches per pixel.
 */
export const MARCH_SCALE: Readonly<Record<QualityPreset, number>> = {
  potato: 0.5,
  low: 0.5,
  medium: 0.5,
  high: 0.5,
  ultra: 1,
};

/** Size of the reduced-resolution march target for a frame size and scale. */
export const marchSize = (w: number, h: number, scale: number): [number, number] => [
  Math.max(1, Math.ceil(w * scale)),
  Math.max(1, Math.ceil(h * scale)),
];

export interface StaticLuts {
  trans: WebGLRenderTarget;
  ms: WebGLRenderTarget;
}

/** Uniforms a surface shading splices in to use ATMOSPHERE_TRANSMITTANCE_GLSL (shared by reference). */
export interface ShadingAtmosphereUniforms {
  uAtmoTransmittance: IUniform<Texture | null>;
  uAtmoRadii: IUniform<Vector2>;
  uAtmoReady: IUniform<number>;
  [name: string]: IUniform;
}

const PRELUDE = `${PHASE_GLSL}\n${commonGlsl}\n`;

function paramUniforms(): Record<string, IUniform> {
  return {
    uAtmoBottom: { value: 6360 },
    uAtmoTop: { value: 6460 },
    uRayleighS: { value: new Vector3() },
    uRayleighH: { value: 8 },
    uMieS: { value: new Vector3() },
    uMieE: { value: new Vector3() },
    uMieH: { value: 1.2 },
    uMieG: { value: new Vector3() },
    uAbsE: { value: new Vector3() },
    uAbsC: { value: 25 },
    uAbsW: { value: 15 },
    uGroundAlbedo: { value: new Vector3() },
    uTransLut: { value: null },
    uMsLut: { value: null },
  };
}

function setParamUniforms(u: Record<string, IUniform>, p: AtmosphereParams): void {
  u.uAtmoBottom.value = p.bottomKm;
  u.uAtmoTop.value = p.topKm;
  (u.uRayleighS.value as Vector3).set(...p.rayleighScattering);
  u.uRayleighH.value = p.rayleighScaleKm;
  (u.uMieS.value as Vector3).set(...p.mieScattering);
  (u.uMieE.value as Vector3).set(...p.mieExtinction);
  u.uMieH.value = p.mieScaleKm;
  (u.uMieG.value as Vector3).set(...p.mieG);
  (u.uAbsE.value as Vector3).set(...p.absorptionExtinction);
  u.uAbsC.value = p.absorptionCenterKm;
  u.uAbsW.value = p.absorptionHalfWidthKm;
  (u.uGroundAlbedo.value as Vector3).set(...p.groundAlbedo);
}

export interface AtmosphereGpuDeps {
  gl: WebGLRenderer;
  registry: RegistryReader;
  exposure: IUniform<number>;
  /** Shading uniforms per body (owned by the module service, shared by reference). */
  shading: Map<string, ShadingAtmosphereUniforms>;
  /** Bodies whose static LUTs are kept current every frame. */
  requested: Set<string>;
}

/** Creates the shared shading uniforms for a body (T = 1 until its LUT is ready). */
export function createShadingUniforms(): ShadingAtmosphereUniforms {
  return {
    uAtmoTransmittance: { value: null },
    uAtmoRadii: { value: new Vector2(6378, 6478) },
    uAtmoReady: { value: 0 },
  };
}

export class AtmosphereGpu implements ScreenPass {
  readonly id = ATMOSPHERE_PASS_ID;
  readonly stage = 'atmosphere' as const;
  readonly order = 0;

  readonly params = new Map<string, AtmosphereParams>();
  private readonly requested: Set<string>;
  private readonly shading: Map<string, ShadingAtmosphereUniforms>;
  private readonly U = paramUniforms();
  private readonly view = {
    uInvProj: { value: new Matrix4() },
    uCamToWorld: { value: new Matrix3() },
    uWorldToAtmo: { value: new Matrix3() },
    uCamPos: { value: new Vector3() },
    uCamH: { value: 0 },
    uSunDir: { value: new Vector3(1, 0, 0) },
    uApMax: { value: 128 },
  };
  private readonly draw = new FullscreenDraw();
  private readonly transMat: ShaderMaterial;
  private readonly msMat: ShaderMaterial;
  private readonly skyMat: ShaderMaterial;
  private readonly aerialMat: ShaderMaterial;
  private readonly compositeMat: ShaderMaterial;
  private readonly marchMat: ShaderMaterial;
  private marchTarget: WebGLRenderTarget | null = null;
  private fullSize: [number, number] = [1, 1];
  private readonly pixel = {
    uDepth: { value: null as Texture | null },
    uInside: { value: 0 },
    uSteps: { value: 24 },
  };
  private readonly cache: StaticLutCache<StaticLuts>;
  private skyTarget: WebGLRenderTarget | null = null;
  private apTarget: WebGLRenderTarget | null = null;
  private sel: { p: AtmosphereParams; body: Body; f: AtmosphereFrame; inside: boolean } | null = null;
  private readonly tmp = { rel: vec3(), sun: vec3(), q: quat() };

  constructor(private readonly deps: AtmosphereGpuDeps) {
    this.shading = deps.shading;
    this.requested = deps.requested;
    const U = this.U;
    this.transMat = lutMaterial(PRELUDE + transmittanceFrag, { ...U, uMsOn: { value: 0 } });
    this.msMat = lutMaterial(PRELUDE + multiscatterFrag, { ...U, uMsOn: { value: 0 } });
    this.skyMat = lutMaterial(PRELUDE + skyviewFrag, {
      ...U,
      uMsOn: { value: 1 },
      uCamR: { value: 6360 },
      uCamH: { value: 0 },
      uSunMu: { value: 1 },
      uSteps: { value: 24 },
    });
    this.aerialMat = lutMaterial(PRELUDE + viewRayGlsl + aerialFrag, {
      ...U,
      ...this.view,
      uMsOn: { value: 1 },
      uSteps: { value: 16 },
    });
    this.compositeMat = new ShaderMaterial({
      vertexShader: `${DEPTH_GLSL}\n${FULLSCREEN_VERT}`,
      fragmentShader: `${DEPTH_GLSL}\n${PRELUDE}${viewRayGlsl}\n${scatterGlsl}\n${compositeFrag}`,
      uniforms: {
        ...U,
        ...this.view,
        ...this.pixel,
        uMsOn: { value: 1 },
        uInput: { value: null },
        uSkyView: { value: null },
        uAerial: { value: null },
        uHalfL: { value: null },
        uHalfT: { value: null },
        uHalfSize: { value: new Vector2(1, 1) },
        uHalf: { value: 0 },
        uSunE: { value: new Vector3() },
        uExposure: deps.exposure,
        uSunTPost: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    // Reduced-resolution march (two outputs: L + path length, transmittance).
    this.marchMat = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: `${DEPTH_GLSL}\n${PRELUDE}${viewRayGlsl}\n${scatterGlsl}\n${marchFrag}`,
      uniforms: { ...U, ...this.view, ...this.pixel, uMsOn: { value: 1 } },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.cache = new StaticLutCache<StaticLuts>(
      (p) => this.buildStatic(p),
      (l) => {
        l.trans.dispose();
        l.ms.dispose();
      },
    );
  }

  setSize(width: number, height: number): void {
    this.fullSize = [width, height];
  }

  /** The march target for this frame's preset (null: march per pixel in the composite). */
  private marchTargetFor(preset: QualityPreset): WebGLRenderTarget | null {
    const scale = MARCH_SCALE[preset] ?? 0.5;
    if (scale >= 1) {
      this.marchTarget?.dispose();
      this.marchTarget = null;
      return null;
    }
    const [w, h] = marchSize(this.fullSize[0], this.fullSize[1], scale);
    if (!this.marchTarget) {
      this.marchTarget = new WebGLRenderTarget(w, h, {
        count: 2,
        type: HalfFloatType,
        format: RGBAFormat,
        minFilter: NearestFilter,
        magFilter: NearestFilter,
        depthBuffer: false,
        generateMipmaps: false,
      });
    } else if (this.marchTarget.width !== w || this.marchTarget.height !== h) this.marchTarget.setSize(w, h);
    return this.marchTarget;
  }

  /** Number of static LUT builds so far (tests/debug). */
  get staticBuilds(): number {
    return this.cache.builds;
  }

  setParams(p: AtmosphereParams): void {
    this.params.set(p.id, p);
  }

  /** onBeforeFrame: (re)build requested static LUTs before the main scene renders. */
  beforeFrame(): void {
    for (const id of this.requested) {
      const p = this.params.get(id);
      if (p) this.staticFor(p);
    }
  }

  private buildStatic(p: AtmosphereParams): StaticLuts {
    const gl = this.deps.gl;
    const trans = lutTarget(TRANSMITTANCE_SIZE[0], TRANSMITTANCE_SIZE[1]);
    const ms = lutTarget(MULTISCATTER_SIZE, MULTISCATTER_SIZE);
    setParamUniforms(this.U, p);
    this.draw.render(gl, this.transMat, trans);
    this.U.uTransLut.value = trans.texture;
    this.draw.render(gl, this.msMat, ms);
    return { trans, ms };
  }

  private staticFor(p: AtmosphereParams): StaticLuts {
    const luts = this.cache.get(p);
    const s = this.shading.get(p.id);
    if (s) {
      s.uAtmoTransmittance.value = luts.trans.texture;
      s.uAtmoRadii.value.set(p.bottomKm, p.topKm);
      s.uAtmoReady.value = 1;
    }
    return luts;
  }

  active(view: ViewState): boolean {
    this.sel = null;
    const { rel, sun, q } = this.tmp;
    const cands = [];
    for (const p of this.params.values()) {
      const body = this.deps.registry.body(p.id);
      if (!body) continue;
      view.toCamera(body.frame, { x: 0, y: 0, z: 0 }, rel);
      cands.push({ id: p.id, dist: Math.hypot(rel.x, rel.y, rel.z), topM: p.topKm * 1000 });
    }
    const id = selectAtmosphere(cands, view.pixelAngle);
    if (!id) return false;
    const p = this.params.get(id)!;
    const body = this.deps.registry.body(id)!;
    view.toCamera(body.frame, { x: 0, y: 0, z: 0 }, rel);
    view.sunToCamera(sun);
    view.frameQuat(body.fixedFrame ?? body.frame, q);
    const f = atmosphereFrame(rel, q, body.oblateness ?? 0, sun);
    this.sel = { p, body, f, inside: f.camR < p.topKm };
    return true;
  }

  render(
    gl: WebGLRenderer,
    input: WebGLRenderTarget,
    depth: DepthTexture,
    output: WebGLRenderTarget,
    view: ViewState,
  ): void {
    const sel = this.sel;
    if (!sel) return;
    const { p, f, inside } = sel;
    const luts = this.staticFor(p);
    const U = this.U;
    setParamUniforms(U, p);
    U.uTransLut.value = luts.trans.texture;
    U.uMsLut.value = luts.ms.texture;
    const v = this.view;
    const cam = view.camera;
    v.uInvProj.value.copy(cam.projectionMatrixInverse);
    v.uCamToWorld.value.setFromMatrix4(cam.matrixWorld);
    const m = f.w2a;
    v.uWorldToAtmo.value.set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]);
    // A camera below the bottom sphere (Gale floor, Hellas) is lifted radially just above it, as
    // Hillaire's PLANET_RADIUS_OFFSET does: the LUT parameterisations assume r >= bottom.
    const camR = Math.max(f.camR, p.bottomKm + 0.001);
    const lift = camR / f.camR;
    v.uCamPos.value.set(f.cam[0] * lift, f.cam[1] * lift, f.cam[2] * lift);
    v.uCamH.value = camR - p.bottomKm;
    v.uSunDir.value.set(...f.sun);
    v.uApMax.value = p.apMaxKm;
    const steps = stepCounts(view.knobs.atmosphereSteps);
    const cu = this.compositeMat.uniforms;
    if (inside) {
      this.skyTarget ??= lutTarget(SKYVIEW_SIZE[0], SKYVIEW_SIZE[1]);
      this.apTarget ??= lutTarget(AP_SIZE * AP_SLICES, AP_SIZE);
      const su = this.skyMat.uniforms;
      su.uCamR.value = camR;
      su.uCamH.value = camR - p.bottomKm;
      su.uSunMu.value = (f.cam[0] * f.sun[0] + f.cam[1] * f.sun[1] + f.cam[2] * f.sun[2]) / f.camR;
      su.uSteps.value = steps.sky;
      this.draw.render(gl, this.skyMat, this.skyTarget);
      this.aerialMat.uniforms.uSteps.value = steps.aerial;
      this.draw.render(gl, this.aerialMat, this.apTarget);
      cu.uSkyView.value = this.skyTarget.texture;
      cu.uAerial.value = this.apTarget.texture;
    } else {
      cu.uSkyView.value = luts.trans.texture; // unused; keep a valid binding
      cu.uAerial.value = luts.trans.texture;
    }
    const E = solarIlluminance(f.sunDist);
    (cu.uSunE.value as Vector3).set(E * SUN_RGB[0], E * SUN_RGB[1], E * SUN_RGB[2]);
    const px = this.pixel;
    px.uInside.value = inside ? 1 : 0;
    px.uSteps.value = steps.march;
    px.uDepth.value = depth;
    cu.uSunTPost.value = p.sunTransmittanceInPost ? 1 : 0;
    cu.uInput.value = input.texture;
    const mt = this.marchTargetFor(view.quality);
    if (mt) {
      this.draw.render(gl, this.marchMat, mt);
      cu.uHalfL.value = mt.textures[0];
      cu.uHalfT.value = mt.textures[1];
      (cu.uHalfSize.value as Vector2).set(mt.width, mt.height);
      cu.uHalf.value = 1;
      // Work hint for the renderer's march counter: the composite mostly upsamples.
      this.compositeMat.userData.marchSteps = 1;
    } else {
      this.compositeMat.userData.marchSteps = steps.march;
      cu.uHalfL.value = cu.uHalfT.value = luts.trans.texture; // unused; keep a valid binding
      cu.uHalf.value = 0;
    }
    this.draw.render(gl, this.compositeMat, output);
  }

  memoryBytes(): number {
    let n = 0;
    for (const l of this.cache.values()) n += targetBytes(l.trans) + targetBytes(l.ms);
    if (this.skyTarget) n += targetBytes(this.skyTarget);
    if (this.apTarget) n += targetBytes(this.apTarget);
    if (this.marchTarget) n += 2 * targetBytes(this.marchTarget);
    return n;
  }

  dispose(): void {
    this.cache.clear();
    this.skyTarget?.dispose();
    this.apTarget?.dispose();
    this.skyTarget = this.apTarget = null;
    this.marchTarget?.dispose();
    this.marchTarget = null;
    for (const mat of [
      this.transMat,
      this.msMat,
      this.skyMat,
      this.aerialMat,
      this.compositeMat,
      this.marchMat,
    ])
      mat.dispose();
    this.draw.dispose();
    for (const s of this.shading.values()) {
      s.uAtmoTransmittance.value = null;
      s.uAtmoReady.value = 0;
    }
  }
}
