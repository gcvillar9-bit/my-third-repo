/**
 * Orion Nebula rendering: a background-layer Renderable modelled on milkyway/galaxy.ts. A reduced-resolution
 * ray march over the screen rect of the volume's box writes the radiance of the three components and the
 * background opacity into a HalfFloat target, re-marched only when the view changes (8-frame jittered
 * accumulation while still, never in tests); a quad over the rect composites it at renderOrder -7.5 (after the
 * panorama and the Galaxy, before the star points) with premultiplied blending, so the nebula's dust dims the
 * Galaxy behind it while stars drawn later stay undimmed. The opacity is scaled by 1 - milkyWayFade because near
 * the Sun the panorama photo already contains M42. Below MIN_PX on screen nothing is drawn.
 */
import {
  BufferGeometry,
  ConstantAlphaFactor,
  CustomBlending,
  Float32BufferAttribute,
  HalfFloatType,
  LinearFilter,
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
import marchGlsl from './march.glsl?raw';
import modelGlsl from './model.glsl?raw';
import { nebulaGlslDefines, volumeBox, type NebulaMeta } from './model';

/** Steps per preset (design table). */
export const STEPS: Record<QualityPreset, number> = { potato: 24, low: 32, medium: 48, high: 96, ultra: 128 };
/** Per-axis divisor of the march target. */
export const RES_DIVISOR: Record<QualityPreset, number> = { potato: 4, low: 3, medium: 3, high: 2, ultra: 1 };
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

/**
 * NDC rect of the box seen from `cam` (local pc) with view orientation `q` (world), or null when it is off screen.
 * Returns the whole screen when the camera is inside the box or the box straddles the camera plane.
 */
export function screenRect(
  cam: Vec3d,
  worldQuat: ViewState['worldQuat'],
  fovY: number,
  aspect: number,
  xiMax: number,
): MarchRect | null {
  const box = volumeBox(xiMax);
  const inside =
    Math.abs(cam.x) <= box.half && Math.abs(cam.y) <= box.half && cam.z >= box.zMin && cam.z <= box.zMax;
  if (inside) return { x0: -1, y0: -1, x1: 1, y1: 1, full: true };
  const ty = Math.tan(fovY / 2);
  const tx = ty * aspect;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const c = vec3();
  const w = vec3();
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
  if (behind > 0) return { x0: -1, y0: -1, x1: 1, y1: 1, full: true };
  if (x1 < -1 || y1 < -1 || x0 > 1 || y0 > 1) return null;
  return {
    x0: Math.max(-1, x0),
    y0: Math.max(-1, y0),
    x1: Math.min(1, x1),
    y1: Math.min(1, y1),
    full: false,
  };
}

/** Apparent size (px) of the field from `cam` (local pc). */
export function apparentPx(cam: Vec3d, pixelAngle: number, xiMax: number): number {
  const half = volumeBox(xiMax).half;
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
  // --- march (offscreen) ---
  const marchScene = new Scene();
  const marchCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const marchGeometry = fullscreenTriangle();
  // cosmos:no-depth (offscreen full-screen march: no geometry, no depth)
  const marchMat = new ShaderMaterial({
    vertexShader: QUAD_VERTEX,
    fragmentShader: defines + modelGlsl + marchGlsl,
    uniforms: {
      uEmission: { value: tex.emission },
      uMaps: { value: tex.maps },
      uCore: { value: tex.core ?? tex.maps },
      uHasCore: { value: tex.core && meta.core ? 1 : 0 },
      uBlueNoise: shared.uBlueNoise,
      uOrigin: { value: new Vector3() },
      uRayBasis: { value: new Matrix3() },
      uRect: { value: new Vector4(-1, -1, 1, 1) },
      uSteps: { value: STEPS.medium },
      uStore: { value: STORE_SCALE },
      uJitterOffset: { value: 0 },
      uPixelAngle: { value: 1e-3 },
    },
    depthTest: false,
    depthWrite: false,
    blending: NoBlending,
  });
  marchMat.blendSrc = ConstantAlphaFactor;
  marchMat.blendDst = OneMinusConstantAlphaFactor;
  marchMat.blendSrcAlpha = ConstantAlphaFactor;
  marchMat.blendDstAlpha = OneMinusConstantAlphaFactor;
  const marchMesh = new Mesh(marchGeometry, marchMat);
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
    uSoft: { value: ASTRO.soft },
    uSaturation: { value: ASTRO.saturation },
    uEmission: { value: tex.emission },
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
  const last = { x: NaN, y: NaN, z: NaN, qx: 0, qy: 0, qz: 0, qw: 0, fov: 0, w: 0, h: 0, rw: 0, rh: 0 };
  const lastRect = { x0: 0, y0: 0, x1: 0, y1: 0, steps: 0 };
  let accumulated = 0;
  let dirty = true;
  let lastSteps = 0;
  const realistic = basisRows(REALISTIC_BASIS);
  const astro = basisRows(ASTRO_BASIS);

  const dirLocal = (q: ViewState['worldQuat'], x: number, y: number, z: number): Vec3d =>
    toLocal(qrotate(axis, q, vec3(x, y, z)), axis);

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
    gl.render(marchScene, marchCamera);
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
      if (apparentPx(cam, view.pixelAngle, meta.field.xiMax) < MIN_PX) return;
      const aspect = view.viewport[0] / Math.max(1, view.viewport[1]);
      const q = view.worldQuat;
      const rect = screenRect(cam, q, view.fovY, aspect, meta.field.xiMax);
      if (!rect) return;
      const div = RES_DIVISOR[view.quality];
      const W = Math.max(16, Math.ceil(view.viewport[0] / div));
      const H = Math.max(16, Math.ceil(view.viewport[1] / div));
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
        Object.assign(last, { x: cam.x, y: cam.y, z: cam.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w });
        Object.assign(last, { fov: view.fovY, w: W, h: H, rw, rh });
        Object.assign(lastRect, { x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y1, steps });
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
      (marchMat.uniforms.uRect.value as Vector4).set(rect.x0, rect.y0, rect.x1, rect.y1);
      marchMat.uniforms.uPixelAngle.value = view.pixelAngle * div;
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
      (displayUniforms.uBasis.value as Matrix3).fromArray(
        astroOn ? toColumnMajor(astro) : toColumnMajor(realistic),
      );
      displayUniforms.uAstro.value = astroOn ? 1 : 0;
      const d = v3len(cam);
      const t = Math.min(1, Math.max(0, (d - DETAIL_NEAR_PC) / (DETAIL_FAR_PC - DETAIL_NEAR_PC)));
      displayUniforms.uDetail.value = t * t * (3 - 2 * t);
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
      return (
        (target ? target.width * target.height * 8 : 0) +
        texBytes(tex.emission) +
        texBytes(tex.maps) +
        texBytes(tex.core)
      );
    },
    dispose() {
      target?.dispose();
      target = null;
      marchGeometry.dispose();
      marchMat.dispose();
      quad.dispose();
      displayMat.dispose();
      tex.emission.dispose();
      tex.maps.dispose();
      tex.core?.dispose();
    },
  };
}

/** Row-major 3x3 (Matrix3.set order) -> column-major array (Matrix3.fromArray order). */
function toColumnMajor(rows: readonly number[]): number[] {
  return [rows[0], rows[3], rows[6], rows[1], rows[4], rows[7], rows[2], rows[5], rows[8]];
}
