/**
 * Galaxy rendering (P4-A). Two background-layer Renderables share one GPU helper:
 * - `milkyway.outside`: camera > 2 kpc from the Sun. Reduced-resolution per-pixel ray march into a
 *   HalfFloat target, re-marched only when the view changes (cached otherwise; optional temporal
 *   accumulation while still), composited by a full-screen triangle.
 * - `milkyway.sky`: camera between ~200 pc and 2 kpc from the Sun. A low-res sky cube (model axes)
 *   re-baked one face per frame into a back buffer when the camera moved > 1% of its galactocentric
 *   distance, crossfaded against the stars panorama (which fades out 200-400 pc from the Sun).
 * Near the Sun neither draws anything, so the home sky stays the photographic panorama at zero cost.
 */
import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  CustomBlending,
  Float32BufferAttribute,
  HalfFloatType,
  LinearFilter,
  Matrix3,
  Mesh,
  NoBlending,
  OneMinusSrcAlphaFactor,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SrcAlphaFactor,
  Vector3,
  WebGLCubeRenderTarget,
  WebGLRenderTarget,
  type IUniform,
  type WebGLRenderer,
} from 'three';
import {
  MW_FRAME,
  SSB_FRAME,
  type QualityKnobs,
  type QualityPreset,
  type Renderable,
  type SharedUniforms,
  type Vec3d,
  type ViewState,
} from '../../core/contracts';
import { qrotate, v3len, vec3 } from '../../core/math64';
import { KPC, PC } from '../../core/units';
import armfieldGlsl from './armfield.glsl?raw';
import displayGlsl from './display.glsl?raw';
import galaxyGlsl from './galaxy.glsl?raw';
import marchGlsl from './march.glsl?raw';
import { apply3, LUMINANCE_PER_UNIT, modelGlslDefines, WORLD_TO_MODEL } from './model';

/** March targets store cd/m² times this (HalfFloat-friendly, exposure-independent). */
export const STORE_SCALE = 1e4;
/** Camera-Sun distance where the per-pixel outside view replaces the sky cube, m. */
export const OUTSIDE_SWITCH = 2 * KPC;
/**
 * Panorama fade distances (copy of FADE_START/FADE_END in src/modules/stars/milkyway.ts, not
 * exported by stars/public.ts; see docs/requests/p4-milkyway.md).
 */
export const PANORAMA_FADE_START = 200 * PC;
export const PANORAMA_FADE_END = 400 * PC;
/** Sky-cube re-bake threshold: fraction of the galactocentric distance moved. */
export const REBAKE_FRACTION = 0.01;
/** Frames averaged while the outside view is still (only with knobs.temporal, never in tests). */
export const ACCUM_FRAMES = 8;

export const STEPS: Record<QualityPreset, number> = { potato: 16, low: 24, medium: 48, high: 96, ultra: 160 };
/** Per-axis divisor of the outside march target (4 = 1/16 of the pixels). */
export const RES_DIVISOR: Record<QualityPreset, number> = { potato: 4, low: 4, medium: 4, high: 2, ultra: 2 };
export const CUBE_SIZE: Record<QualityPreset, number> = {
  potato: 128,
  low: 128,
  medium: 128,
  high: 256,
  ultra: 256,
};
export const FIELD_SIZE: Record<QualityPreset, number> = {
  potato: 512,
  low: 512,
  medium: 1024,
  high: 1024,
  ultra: 1024,
};

/** Steps for a preset: the table above, capped by knobs.volumeSteps. */
export const marchSteps = (k: Readonly<QualityKnobs>): number =>
  Math.max(8, Math.min(STEPS[k.preset], k.volumeSteps));

/** Weight of the galaxy sky cube against the panorama (0 near the Sun, 1 beyond 400 pc). */
export function skyWeight(distFromSun: number): number {
  const t = Math.min(
    1,
    Math.max(0, (distFromSun - PANORAMA_FADE_START) / (PANORAMA_FADE_END - PANORAMA_FADE_START)),
  );
  return t * t * (3 - 2 * t);
}

/** Shared switches (settings). */
export interface GalaxyState {
  enabled: boolean;
  gain: number;
}

const QUAD_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

function fullscreenTriangle(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  g.setAttribute('uv', new Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  return g;
}

const ZERO = vec3();

/** Camera position in model coordinates (kpc) from a view. */
export function cameraModel(view: ViewState, out: Vec3d): Vec3d {
  const t = view.toCamera(MW_FRAME, ZERO, out); // camera → centre, world axes, m
  out.x = -t.x / KPC;
  out.y = -t.y / KPC;
  out.z = -t.z / KPC;
  return apply3(WORLD_TO_MODEL, out, out);
}

/** Offscreen march machinery: arm-field bake, screen march, cube-face march. */
export class GalaxyGpu {
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly geometry = fullscreenTriangle();
  private readonly mesh: Mesh;
  private field: WebGLRenderTarget | null = null;
  private readonly fieldMat: ShaderMaterial;
  readonly screenMat: ShaderMaterial;
  readonly cubeMat: ShaderMaterial;
  private readonly fieldUniform: IUniform = { value: null };

  constructor(
    private readonly gl: WebGLRenderer,
    uniforms: SharedUniforms,
  ) {
    const defines = modelGlslDefines();
    // cosmos:no-depth (offscreen full-screen passes: no geometry, no depth)
    this.fieldMat = new ShaderMaterial({
      vertexShader: QUAD_VERTEX,
      fragmentShader: defines + armfieldGlsl,
      depthTest: false,
      depthWrite: false,
      blending: NoBlending,
    });
    const marchUniforms = () => ({
      uArmField: this.fieldUniform,
      uBlueNoise: uniforms.uBlueNoise,
      uOrigin: { value: new Vector3() },
      uRayBasis: { value: new Matrix3() },
      uSteps: { value: 16 },
      uFace: { value: 0 },
      uLumScale: { value: LUMINANCE_PER_UNIT * STORE_SCALE },
      uAlpha: { value: 1 },
      uJitterOffset: { value: 0 },
    });
    const march = (cube: boolean) =>
      new ShaderMaterial({
        vertexShader: QUAD_VERTEX,
        fragmentShader: (cube ? '#define MW_CUBE\n' : '') + defines + galaxyGlsl + marchGlsl,
        uniforms: marchUniforms(),
        depthTest: false,
        depthWrite: false,
        blending: NoBlending,
        blendSrc: SrcAlphaFactor,
        blendDst: OneMinusSrcAlphaFactor,
        blendSrcAlpha: SrcAlphaFactor,
        blendDstAlpha: OneMinusSrcAlphaFactor,
      });
    this.screenMat = march(false);
    this.cubeMat = march(true);
    this.mesh = new Mesh(this.geometry, this.fieldMat);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  private draw(material: ShaderMaterial, target: WebGLRenderTarget, face = 0): void {
    const gl = this.gl;
    const prev = gl.getRenderTarget();
    const prevFace = gl.getActiveCubeFace();
    const prevMip = gl.getActiveMipmapLevel();
    const prevClear = gl.autoClear;
    gl.autoClear = false;
    this.mesh.material = material;
    gl.setRenderTarget(target, face);
    gl.render(this.scene, this.camera);
    gl.setRenderTarget(prev, prevFace, prevMip);
    gl.autoClear = prevClear;
  }

  /** Bakes the planar arm field once (or again when the size changes). */
  ensureField(size: number): void {
    if (this.field?.width === size) return;
    this.field?.dispose();
    this.field = new WebGLRenderTarget(size, size, {
      type: HalfFloatType,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: false,
      generateMipmaps: false,
    });
    this.draw(this.fieldMat, this.field);
    this.fieldUniform.value = this.field.texture;
  }

  /** One screen march into `target`; alpha < 1 blends it into the running average. */
  marchScreen(
    target: WebGLRenderTarget,
    origin: Vec3d,
    basis: Matrix3,
    steps: number,
    alpha: number,
    jitter: number,
  ): void {
    const u = this.screenMat.uniforms;
    (u.uOrigin.value as Vector3).set(origin.x, origin.y, origin.z);
    (u.uRayBasis.value as Matrix3).copy(basis);
    u.uSteps.value = steps;
    u.uAlpha.value = alpha;
    u.uJitterOffset.value = jitter;
    this.screenMat.blending = alpha < 1 ? CustomBlending : NoBlending;
    this.draw(this.screenMat, target);
  }

  marchCubeFace(target: WebGLCubeRenderTarget, face: number, origin: Vec3d, steps: number): void {
    const u = this.cubeMat.uniforms;
    (u.uOrigin.value as Vector3).set(origin.x, origin.y, origin.z);
    u.uSteps.value = steps;
    u.uFace.value = face;
    this.draw(this.cubeMat, target, face);
  }

  memoryBytes(): number {
    return this.field ? this.field.width * this.field.height * 8 : 0;
  }

  dispose(): void {
    this.field?.dispose();
    this.field = null;
    this.geometry.dispose();
    this.fieldMat.dispose();
    this.screenMat.dispose();
    this.cubeMat.dispose();
  }
}

function displayMaterial(
  cube: boolean,
  exposure: IUniform<number>,
  extra: Record<string, IUniform>,
): ShaderMaterial {
  const head = cube ? '#define MW_CUBE\n' : '';
  const a = WORLD_TO_MODEL;
  // cosmos:no-depth (background layer: the galaxy is drawn at infinity without depth)
  return new ShaderMaterial({
    vertexShader: `${head}#define COSMOS_VERTEX\n${displayGlsl}`,
    fragmentShader: head + displayGlsl,
    uniforms: {
      uTex: { value: null },
      uCube: { value: null },
      uWorldToModel: { value: new Matrix3().set(a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[8]) },
      uScale: { value: 0 },
      uExposure: exposure,
      ...extra,
    },
    side: cube ? BackSide : undefined,
    blending: AdditiveBlending,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
}

/** Per-pixel outside view (camera > OUTSIDE_SWITCH from the Sun). */
export function createOutsideView(gpu: GalaxyGpu, uniforms: SharedUniforms, state: GalaxyState): Renderable {
  const geometry = fullscreenTriangle();
  const material = displayMaterial(false, uniforms.uExposure, {});
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -9;
  mesh.visible = false;
  let target: WebGLRenderTarget | null = null;
  const cam = vec3();
  const tmp = vec3();
  const axis = vec3();
  const basis = new Matrix3();
  const last = { x: NaN, y: NaN, z: NaN, qx: 0, qy: 0, qz: 0, qw: 0, fov: 0, w: 0, h: 0, steps: 0 };
  let accumulated = 0;

  const dirModel = (q: ViewState['worldQuat'], x: number, y: number, z: number): Vec3d =>
    apply3(WORLD_TO_MODEL, qrotate(axis, q, vec3(x, y, z)), axis);

  return {
    id: 'milkyway.outside',
    layer: 'background',
    object: mesh,
    update(view) {
      const dSun = v3len(view.toCamera(SSB_FRAME, ZERO, tmp));
      const active = state.enabled && dSun >= OUTSIDE_SWITCH;
      mesh.visible = active;
      if (!active) return;
      gpu.ensureField(FIELD_SIZE[view.quality]);
      const div = RES_DIVISOR[view.quality];
      const w = Math.max(16, Math.ceil(view.viewport[0] / div));
      const h = Math.max(16, Math.ceil(view.viewport[1] / div));
      if (!target) {
        target = new WebGLRenderTarget(w, h, {
          type: HalfFloatType,
          minFilter: LinearFilter,
          magFilter: LinearFilter,
          depthBuffer: false,
          generateMipmaps: false,
        });
        material.uniforms.uTex.value = target.texture;
      } else if (target.width !== w || target.height !== h) target.setSize(w, h);
      cameraModel(view, cam);
      const q = view.worldQuat;
      const steps = marchSteps(view.knobs);
      const eps = 1e-6 * Math.max(1, Math.hypot(cam.x, cam.y, cam.z));
      const changed =
        !(
          Math.abs(cam.x - last.x) < eps &&
          Math.abs(cam.y - last.y) < eps &&
          Math.abs(cam.z - last.z) < eps
        ) ||
        Math.abs(q.x - last.qx) +
          Math.abs(q.y - last.qy) +
          Math.abs(q.z - last.qz) +
          Math.abs(q.w - last.qw) >
          1e-7 ||
        view.fovY !== last.fov ||
        w !== last.w ||
        h !== last.h ||
        steps !== last.steps;
      if (changed) {
        Object.assign(last, { x: cam.x, y: cam.y, z: cam.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w });
        Object.assign(last, { fov: view.fovY, w, h, steps });
        accumulated = 0;
      }
      const accumulate = !view.test && view.knobs.temporal && accumulated < ACCUM_FRAMES;
      if (changed || accumulate) {
        const ty = Math.tan(view.fovY / 2);
        const tx = ty * (view.viewport[0] / Math.max(1, view.viewport[1]));
        const r = dirModel(q, 1, 0, 0);
        const rx = r.x * tx;
        const ry = r.y * tx;
        const rz = r.z * tx;
        const u = dirModel(q, 0, 1, 0);
        const ux = u.x * ty;
        const uy = u.y * ty;
        const uz = u.z * ty;
        const f = dirModel(q, 0, 0, -1);
        basis.set(rx, ux, f.x, ry, uy, f.y, rz, uz, f.z);
        gpu.marchScreen(target, cam, basis, steps, 1 / (accumulated + 1), (accumulated * 0.6180339887) % 1);
        accumulated++;
      }
      material.uniforms.uScale.value = state.gain / STORE_SCALE;
    },
    memoryBytes: () => (target ? target.width * target.height * 8 : 0) + gpu.memoryBytes(),
    dispose() {
      target?.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}

/** Sky cube for the inside view, crossfaded against the panorama. */
export function createSkyView(gpu: GalaxyGpu, uniforms: SharedUniforms, state: GalaxyState): Renderable {
  const geometry = new SphereGeometry(1, 32, 16);
  const material = displayMaterial(true, uniforms.uExposure, {});
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -9;
  mesh.visible = false;
  let front: WebGLCubeRenderTarget | null = null;
  let back: WebGLCubeRenderTarget | null = null;
  let face = -1;
  let baked = false;
  let bakedSteps = 0;
  const cam = vec3();
  const tmp = vec3();
  const bakeOrigin = vec3();
  const lastOrigin = vec3();

  const cubeTarget = (size: number) =>
    new WebGLCubeRenderTarget(size, {
      type: HalfFloatType,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: false,
      generateMipmaps: false,
    });

  return {
    id: 'milkyway.sky',
    layer: 'background',
    object: mesh,
    update(view) {
      const dSun = v3len(view.toCamera(SSB_FRAME, ZERO, tmp));
      const weight = state.enabled && dSun < OUTSIDE_SWITCH ? skyWeight(dSun) : 0;
      mesh.visible = weight > 0;
      if (weight <= 0) return;
      gpu.ensureField(FIELD_SIZE[view.quality]);
      const size = CUBE_SIZE[view.quality];
      if (!front || !back || front.width !== size) {
        front?.dispose();
        back?.dispose();
        front = cubeTarget(size);
        back = cubeTarget(size);
        baked = false;
        face = -1;
      }
      cameraModel(view, cam);
      const steps = marchSteps(view.knobs);
      const rGc = Math.hypot(cam.x, cam.y, cam.z);
      const moved = Math.hypot(cam.x - lastOrigin.x, cam.y - lastOrigin.y, cam.z - lastOrigin.z);
      if (face < 0 && (!baked || steps !== bakedSteps || moved > REBAKE_FRACTION * rGc)) {
        face = 0;
        bakeOrigin.x = cam.x;
        bakeOrigin.y = cam.y;
        bakeOrigin.z = cam.z;
        bakedSteps = steps;
      }
      if (face >= 0) {
        // One face per frame; the first bake (nothing to show yet) and tests do all six at once.
        const all = !baked || view.test;
        do gpu.marchCubeFace(back, face++, bakeOrigin, steps);
        while (all && face < 6);
        if (face >= 6) {
          [front, back] = [back, front];
          lastOrigin.x = bakeOrigin.x;
          lastOrigin.y = bakeOrigin.y;
          lastOrigin.z = bakeOrigin.z;
          baked = true;
          face = -1;
        }
      }
      material.uniforms.uCube.value = front.texture;
      material.uniforms.uScale.value = (weight * state.gain) / STORE_SCALE;
    },
    memoryBytes: () => (front ? 2 * 6 * front.width * front.width * 8 : 0),
    dispose() {
      front?.dispose();
      back?.dispose();
      geometry.dispose();
      material.dispose();
      gpu.dispose();
    },
  };
}
