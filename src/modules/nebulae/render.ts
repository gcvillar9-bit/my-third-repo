/**
 * Orion Nebula rendering: a background-layer Renderable modelled on milkyway/galaxy.ts. A reduced-resolution
 * ray march over the screen rect of the volume's box writes the radiance of the three components and the
 * background opacity into a HalfFloat target, re-marched only when the view changes (8-frame jittered
 * accumulation while still, never in tests); a quad over the rect composites it at renderOrder -7.5 (after the
 * panorama and the Galaxy, before the star points) with premultiplied blending, so the nebula's dust dims the
 * Galaxy behind it while stars drawn later stay undimmed. Near the Sun the opacity is scaled by 1 - milkyWayFade:
 * there the panorama photo stands for the whole sky glow in front of and around M42 (its own blurred M42 is cut out
 * by the stars module's panorama hole, index.ts), so the nebula adds its light rather than blacking out that glow.
 * Below MIN_PX on screen nothing is drawn. The 8-bit emission and core textures are copied once into linear-light
 * HalfFloat targets with their own mip chains, so coarse levels average light, not encoded values (flux-true at
 * every distance). Nothing is allocated per frame.
 */
import {
  BufferGeometry,
  ConstantAlphaFactor,
  CustomBlending,
  Float32BufferAttribute,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix3,
  Mesh,
  NoBlending,
  OneFactor,
  OneMinusConstantAlphaFactor,
  OneMinusSrcAlphaFactor,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  ZeroFactor,
  type IUniform,
  type Texture,
  type WebGLRenderer,
} from 'three';
import {
  SSB_FRAME,
  type QualityPreset,
  type Renderable,
  type SharedUniforms,
  type Vec3d,
  type ViewState,
} from '../../core/contracts';
import { qrotate, qrotateInv, v3len, vec3 } from '../../core/math64';
import { PC } from '../../core/units';
import { milkyWayFade } from '../stars/public';
import displayGlsl from './display.glsl?raw';
import { ASTRO, ASTRO_BASIS, basisRows, REALISTIC_BASIS, type NebulaStyle } from './display';
import { NEBULA_FRAME, Q_LOCAL_TO_ICRS, toLocal } from './frame';
import lineariseGlsl from './linearise.glsl?raw';
import marchGlsl from './march.glsl?raw';
import modelGlsl from './model.glsl?raw';
import { nebulaGlslDefines, volumeBox, type NebulaMeta } from './model';

type Box = ReturnType<typeof volumeBox>;

/** Steps per preset (design table). */
export const STEPS: Record<QualityPreset, number> = { potato: 24, low: 32, medium: 48, high: 96, ultra: 128 };
/** Per-axis divisor of the march target. */
export const RES_DIVISOR: Record<QualityPreset, number> = { potato: 4, low: 3, medium: 3, high: 2, ultra: 1 };
/**
 * The march target never exceeds the texel count the design budget was set at (1280x720 / divisor²), so the
 * cost does not grow with the drawing buffer (2268x1240 on medium marches ~102k texels, not 312k).
 */
export const MARCH_REF_PIXELS = 1280 * 720;
/** Near the nebula the emitting layer is sheared sideways (march.glsl uWarp): full below WARP_NEAR_PC, 0 beyond FAR. */
export const WARP_NEAR_PC = 5;
export const WARP_FAR_PC = 20;
/** Below this size on screen (px) the nebula is not drawn. */
export const MIN_PX = 4;
/** Frames averaged while the view is still (only with knobs.temporal, never in tests). */
export const ACCUM_FRAMES = 8;
/** March targets store cd/m² times this (HalfFloat-friendly). */
export const STORE_SCALE = 1e3;
/** Distance range (pc) over which the full-resolution detail ratio fades in (distant views only). */
export const DETAIL_NEAR_PC = 30;
export const DETAIL_FAR_PC = 100;

export interface NebulaState {
  enabled: boolean;
  style: NebulaStyle;
  /** Linear brightness gain (debug). */
  gain: number;
}

export interface NebulaTextures {
  emission: Texture;
  maps: Texture;
  core: Texture | null;
}

/** Screen rect of the march: NDC bounds and the target pixels it covers. */
export interface MarchRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** True when the camera is inside the box or a corner is behind it (whole screen). */
  full: boolean;
}

const QUAD_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const ZERO = vec3();

/** Camera position in the local frame (pc). */
export function cameraLocal(view: Pick<ViewState, 'toCamera'>, out: Vec3d): Vec3d {
  view.toCamera(NEBULA_FRAME, ZERO, out); // camera -> origin, world axes, m
  out.x /= -PC;
  out.y /= -PC;
  out.z /= -PC;
  return toLocal(out, out);
}

/** March target size for a viewport and preset: the preset divisor, raised so W·H ≤ MARCH_REF_PIXELS / div². */
export function marchSize(
  width: number,
  height: number,
  quality: QualityPreset,
  out: { w: number; h: number; div: number } = { w: 0, h: 0, div: 1 },
): { w: number; h: number; div: number } {
  const base = RES_DIVISOR[quality];
  const cap = MARCH_REF_PIXELS / (base * base);
  const div = Math.max(base, Math.sqrt((width * height) / cap));
  out.div = div;
  out.w = Math.max(16, Math.ceil(width / div));
  out.h = Math.max(16, Math.ceil(height / div));
  return out;
}

const RECT_C = vec3();
const RECT_W = vec3();
const FULL = (out: MarchRect): MarchRect => {
  out.x0 = -1;
  out.y0 = -1;
  out.x1 = 1;
  out.y1 = 1;
  out.full = true;
  return out;
};

/**
 * NDC rect of the box seen from `cam` (local pc) with view orientation `q` (world), or null when it is off screen.
 * Returns the whole screen when the camera is inside the box or the box straddles the camera plane. `out` and
 * `box` (volumeBox(xiMax)) can be passed to avoid allocations.
 */
export function screenRect(
  cam: Vec3d,
  worldQuat: ViewState['worldQuat'],
  fovY: number,
  aspect: number,
  xiMax: number,
  out: MarchRect = { x0: 0, y0: 0, x1: 0, y1: 0, full: false },
  box: Box = volumeBox(xiMax),
): MarchRect | null {
  const inside =
    Math.abs(cam.x) <= box.half && Math.abs(cam.y) <= box.half && cam.z >= box.zMin && cam.z <= box.zMax;
  if (inside) return FULL(out);
  const ty = Math.tan(fovY / 2);
  const tx = ty * aspect;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const c = RECT_C;
  const w = RECT_W;
  let behind = 0;
  for (let k = 0; k < 8; k++) {
    c.x = (k & 1 ? box.half : -box.half) - cam.x;
    c.y = (k & 2 ? box.half : -box.half) - cam.y;
    c.z = (k & 4 ? box.zMax : box.zMin) - cam.z;
    qrotate(w, Q_LOCAL_TO_ICRS, c); // local -> world
    qrotateInv(w, worldQuat, w); // world -> camera
    if (w.z > -1e-6 * v3len(w)) {
      behind++;
      continue;
    }
    const nx = w.x / -w.z / tx;
    const ny = w.y / -w.z / ty;
    x0 = Math.min(x0, nx);
    y0 = Math.min(y0, ny);
    x1 = Math.max(x1, nx);
    y1 = Math.max(y1, ny);
  }
  if (behind === 8) return null; // the (convex) box is entirely behind the camera
  if (behind > 0) return FULL(out);
  if (x1 < -1 || y1 < -1 || x0 > 1 || y0 > 1) return null;
  out.x0 = Math.max(-1, x0);
  out.y0 = Math.max(-1, y0);
  out.x1 = Math.min(1, x1);
  out.y1 = Math.min(1, y1);
  out.full = false;
  return out;
}

/** Apparent size (px) of the field from `cam` (local pc). */
export function apparentPx(
  cam: Vec3d,
  pixelAngle: number,
  xiMax: number,
  box: Box = volumeBox(xiMax),
): number {
  const half = box.half;
  const d = v3len(cam);
  if (d <= half) return Infinity;
  return (2 * Math.asin(half / d)) / pixelAngle;
}

function fullscreenTriangle(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  g.setAttribute('uv', new Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  return g;
}

function rectQuad(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(new Float32Array(12), 3));
  g.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
  g.setIndex([0, 1, 2, 2, 1, 3]);
  return g;
}

export interface NebulaRenderable extends Renderable {
  /** Steps of the last march (0 when nothing was marched). */
  readonly lastSteps: number;
  /** Re-march on the next frame (settings that change the volume). */
  invalidate(): void;
}

export function createNebula(
  gl: WebGLRenderer,
  shared: SharedUniforms,
  meta: NebulaMeta,
  tex: NebulaTextures,
  state: NebulaState,
): NebulaRenderable {
  const defines = nebulaGlslDefines(meta);
  const box = volumeBox(meta.field.xiMax);
  const quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const triangle = fullscreenTriangle();

  // --- linear-light copies of the 8-bit textures (once, on the first visible frame) ---
  const linearTarget = (t: Texture) => {
    const img = t.image as { width?: number; height?: number } | undefined;
    return new WebGLRenderTarget(img?.width ?? 1024, img?.height ?? 1024, {
      type: HalfFloatType,
      minFilter: LinearMipmapLinearFilter,
      magFilter: LinearFilter,
      depthBuffer: false,
      generateMipmaps: true,
    });
  };
  const emissionLin = linearTarget(tex.emission);
  const coreLin = tex.core && meta.core ? linearTarget(tex.core) : null;
  let linearised = false;
  const linearise = () => {
    // cosmos:no-depth (offscreen one-time copy into a linear-light target: no geometry, no depth)
    const mat = new ShaderMaterial({
      vertexShader: QUAD_VERTEX,
      fragmentShader: defines + lineariseGlsl,
      uniforms: { uSrc: { value: tex.emission }, uMode: { value: 0 } },
      depthTest: false,
      depthWrite: false,
      blending: NoBlending,
    });
    const scene = new Scene();
    const mesh = new Mesh(triangle, mat);
    mesh.frustumCulled = false;
    scene.add(mesh);
    const prev = gl.getRenderTarget();
    gl.setRenderTarget(emissionLin);
    gl.render(scene, quadCamera); // three.js regenerates the target's mip chain after the render
    if (coreLin && tex.core) {
      mat.uniforms.uSrc.value = tex.core;
      mat.uniforms.uMode.value = 1;
      gl.setRenderTarget(coreLin);
      gl.render(scene, quadCamera);
    }
    gl.setRenderTarget(prev);
    mat.dispose();
    // The 8-bit sources are no longer needed on the GPU.
    tex.emission.dispose();
    tex.core?.dispose();
    linearised = true;
  };

  // --- march (offscreen) ---
  const marchScene = new Scene();
  // cosmos:no-depth (offscreen full-screen march: no geometry, no depth)
  const marchMat = new ShaderMaterial({
    vertexShader: QUAD_VERTEX,
    fragmentShader: defines + modelGlsl + marchGlsl,
    uniforms: {
      uEmission: { value: emissionLin.texture },
      uMaps: { value: tex.maps },
      uCore: { value: coreLin ? coreLin.texture : emissionLin.texture },
      uHasCore: { value: coreLin ? 1 : 0 },
      uBlueNoise: shared.uBlueNoise,
      uOrigin: { value: new Vector3() },
      uRayBasis: { value: new Matrix3() },
      uRect: { value: new Vector4(-1, -1, 1, 1) },
      uSteps: { value: STEPS.medium },
      uStore: { value: STORE_SCALE },
      uJitterOffset: { value: 0 },
      uPixelAngle: { value: 1e-3 },
      uWarp: { value: 0 },
    },
    depthTest: false,
    depthWrite: false,
    blending: NoBlending,
  });
  marchMat.blendSrc = ConstantAlphaFactor;
  marchMat.blendDst = OneMinusConstantAlphaFactor;
  marchMat.blendSrcAlpha = ConstantAlphaFactor;
  marchMat.blendDstAlpha = OneMinusConstantAlphaFactor;
  const marchMesh = new Mesh(triangle, marchMat);
  marchMesh.frustumCulled = false;
  marchScene.add(marchMesh);

  // --- display (background layer) ---
  const quad = rectQuad();
  const displayUniforms: Record<string, IUniform> = {
    uTex: { value: null },
    uTexScale: { value: new Vector2(1, 1) },
    uTexMax: { value: new Vector2(1, 1) },
    uInvStore: { value: 1 / STORE_SCALE },
    uGain: { value: 1 },
    uExposure: shared.uExposure,
    uAlphaScale: { value: 0 },
    uBasis: { value: new Matrix3() },
    uAstro: { value: 0 },
    uAstroRef: { value: ASTRO.ref },
    uAstroPeak: { value: ASTRO.peak },
    uSoft: { value: ASTRO.soft },
    uSaturation: { value: ASTRO.saturation },
    uEmission: { value: emissionLin.texture },
    uCore: { value: coreLin ? coreLin.texture : emissionLin.texture },
    uHasCore: { value: coreLin ? 1 : 0 },
    uDetail: { value: 0 },
    uLodBias: { value: 0 },
    uOrigin: { value: new Vector3() },
    uRayBasis: { value: new Matrix3() },
    uRect: { value: new Vector4(-1, -1, 1, 1) },
  };
  // cosmos:no-depth (background layer: the nebula composite is drawn at infinity without depth)
  const displayMat = new ShaderMaterial({
    vertexShader: `#define COSMOS_VERTEX\n${displayGlsl}`,
    fragmentShader: defines + displayGlsl,
    uniforms: displayUniforms,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendSrcAlpha: ZeroFactor,
    blendDstAlpha: OneFactor,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new Mesh(quad, displayMat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -7.5;
  mesh.visible = false;

  let target: WebGLRenderTarget | null = null;
  const cam = vec3();
  const tmp = vec3();
  const axis = vec3();
  const basis = new Matrix3();
  const rect: MarchRect = { x0: 0, y0: 0, x1: 0, y1: 0, full: false };
  const size = { w: 0, h: 0, div: 1 };
  const last = { x: NaN, y: NaN, z: NaN, qx: 0, qy: 0, qz: 0, qw: 0, fov: 0, w: 0, h: 0, rw: 0, rh: 0 };
  const lastRect = { x0: 0, y0: 0, x1: 0, y1: 0, steps: 0 };
  let accumulated = 0;
  let dirty = true;
  let lastSteps = 0;
  const realistic = toColumnMajor(basisRows(REALISTIC_BASIS));
  const astro = toColumnMajor(basisRows(ASTRO_BASIS));

  /** Local direction of camera axis (x, y, z) into `axis`. */
  const dirLocal = (q: ViewState['worldQuat'], x: number, y: number, z: number): Vec3d => {
    axis.x = x;
    axis.y = y;
    axis.z = z;
    return toLocal(qrotate(axis, q, axis), axis);
  };

  const march = (rw: number, rh: number, steps: number, alpha: number, jitter: number) => {
    const t = target!;
    const u = marchMat.uniforms;
    (u.uOrigin.value as Vector3).set(cam.x, cam.y, cam.z);
    (u.uRayBasis.value as Matrix3).copy(basis);
    u.uSteps.value = steps;
    u.uJitterOffset.value = jitter;
    // The work counter (EngineRenderer.workStats) multiplies the whole target by this; only rw x rh is marched.
    marchMat.userData.marchSteps = (steps * rw * rh) / (t.width * t.height);
    marchMat.blending = alpha < 1 ? CustomBlending : NoBlending;
    marchMat.blendAlpha = alpha;
    const prev = gl.getRenderTarget();
    const prevClear = gl.autoClear;
    gl.autoClear = false;
    t.viewport.set(0, 0, rw, rh);
    gl.setRenderTarget(t);
    gl.render(marchScene, quadCamera);
    gl.setRenderTarget(prev);
    gl.autoClear = prevClear;
  };

  const setQuad = (r: MarchRect) => {
    const p = quad.getAttribute('position') as Float32BufferAttribute;
    p.setXYZ(0, r.x0, r.y0, 0);
    p.setXYZ(1, r.x1, r.y0, 0);
    p.setXYZ(2, r.x0, r.y1, 0);
    p.setXYZ(3, r.x1, r.y1, 0);
    p.needsUpdate = true;
  };

  return {
    id: 'nebulae.orion',
    layer: 'background',
    object: mesh,
    get lastSteps() {
      return lastSteps;
    },
    invalidate() {
      dirty = true;
    },
    update(view) {
      lastSteps = 0;
      mesh.visible = false;
      if (!state.enabled) return;
      cameraLocal(view, cam);
      if (apparentPx(cam, view.pixelAngle, meta.field.xiMax, box) < MIN_PX) return;
      const aspect = view.viewport[0] / Math.max(1, view.viewport[1]);
      const q = view.worldQuat;
      if (!screenRect(cam, q, view.fovY, aspect, meta.field.xiMax, rect, box)) return;
      if (!linearised) linearise();
      marchSize(view.viewport[0], view.viewport[1], view.quality, size);
      const { w: W, h: H, div } = size;
      const rw = Math.max(1, Math.min(W, Math.ceil(((rect.x1 - rect.x0) / 2) * W)));
      const rh = Math.max(1, Math.min(H, Math.ceil(((rect.y1 - rect.y0) / 2) * H)));
      if (!target) {
        target = new WebGLRenderTarget(W, H, {
          type: HalfFloatType,
          minFilter: LinearFilter,
          magFilter: LinearFilter,
          depthBuffer: false,
          generateMipmaps: false,
        });
        displayUniforms.uTex.value = target.texture;
      } else if (target.width !== W || target.height !== H) target.setSize(W, H);
      const steps = STEPS[view.quality];
      const eps = 1e-7 * Math.max(1, v3len(cam));
      const changed =
        dirty ||
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
        W !== last.w ||
        H !== last.h ||
        rw !== last.rw ||
        rh !== last.rh ||
        rect.x0 !== lastRect.x0 ||
        rect.y0 !== lastRect.y0 ||
        rect.x1 !== lastRect.x1 ||
        rect.y1 !== lastRect.y1 ||
        steps !== lastRect.steps;
      if (changed) {
        last.x = cam.x;
        last.y = cam.y;
        last.z = cam.z;
        last.qx = q.x;
        last.qy = q.y;
        last.qz = q.z;
        last.qw = q.w;
        last.fov = view.fovY;
        last.w = W;
        last.h = H;
        last.rw = rw;
        last.rh = rh;
        lastRect.x0 = rect.x0;
        lastRect.y0 = rect.y0;
        lastRect.x1 = rect.x1;
        lastRect.y1 = rect.y1;
        lastRect.steps = steps;
        accumulated = 0;
        dirty = false;
      }
      const ty = Math.tan(view.fovY / 2);
      const tx = ty * aspect;
      const r = dirLocal(q, 1, 0, 0);
      const rx = r.x * tx;
      const ry = r.y * tx;
      const rz = r.z * tx;
      const up = dirLocal(q, 0, 1, 0);
      const ux = up.x * ty;
      const uy = up.y * ty;
      const uz = up.z * ty;
      const fw = dirLocal(q, 0, 0, -1);
      basis.set(rx, ux, fw.x, ry, uy, fw.y, rz, uz, fw.z);
      const d = v3len(cam);
      (marchMat.uniforms.uRect.value as Vector4).set(rect.x0, rect.y0, rect.x1, rect.y1);
      marchMat.uniforms.uPixelAngle.value = view.pixelAngle * div;
      marchMat.uniforms.uWarp.value = 1 - smooth(WARP_NEAR_PC, WARP_FAR_PC, d);
      const accumulate = !view.test && view.knobs.temporal && accumulated < ACCUM_FRAMES;
      if (changed || accumulate) {
        march(rw, rh, steps, 1 / (accumulated + 1), (accumulated * 0.6180339887) % 1);
        accumulated++;
        lastSteps = steps;
      }
      setQuad(rect);
      (displayUniforms.uTexScale.value as Vector2).set(rw / W, rh / H);
      (displayUniforms.uTexMax.value as Vector2).set((rw - 0.5) / W, (rh - 0.5) / H);
      displayUniforms.uGain.value = state.gain;
      const dSun = v3len(view.toCamera(SSB_FRAME, ZERO, tmp));
      displayUniforms.uAlphaScale.value = 1 - milkyWayFade(dSun);
      const astroOn = state.style === 'astrophoto';
      (displayUniforms.uBasis.value as Matrix3).fromArray(astroOn ? astro : realistic);
      displayUniforms.uAstro.value = astroOn ? 1 : 0;
      displayUniforms.uDetail.value = smooth(DETAIL_NEAR_PC, DETAIL_FAR_PC, d);
      displayUniforms.uLodBias.value = Math.log2(div);
      (displayUniforms.uOrigin.value as Vector3).set(cam.x, cam.y, cam.z);
      (displayUniforms.uRayBasis.value as Matrix3).copy(basis);
      (displayUniforms.uRect.value as Vector4).set(rect.x0, rect.y0, rect.x1, rect.y1);
      mesh.visible = true;
    },
    memoryBytes: () => {
      const texBytes = (t: Texture | null) => {
        const img = t?.image as { width?: number; height?: number } | undefined;
        return img?.width && img.height ? Math.round(img.width * img.height * 4 * (4 / 3)) : 0;
      };
      const linBytes = (t: WebGLRenderTarget | null) =>
        t ? Math.round(t.width * t.height * 8 * (4 / 3)) : 0;
      return (
        (target ? target.width * target.height * 8 : 0) +
        linBytes(emissionLin) +
        linBytes(coreLin) +
        (linearised ? 0 : texBytes(tex.emission) + texBytes(tex.core)) +
        texBytes(tex.maps)
      );
    },
    dispose() {
      target?.dispose();
      target = null;
      emissionLin.dispose();
      coreLin?.dispose();
      triangle.dispose();
      marchMat.dispose();
      quad.dispose();
      displayMat.dispose();
      tex.emission.dispose();
      tex.maps.dispose();
      tex.core?.dispose();
    },
  };
}

/** Smoothstep of x between a and b. */
function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Row-major 3x3 (Matrix3.set order) -> column-major array (Matrix3.fromArray order). */
function toColumnMajor(rows: readonly number[]): number[] {
  return [rows[0], rows[3], rows[6], rows[1], rows[4], rows[7], rows[2], rows[5], rows[8]];
}
