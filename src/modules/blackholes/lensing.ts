/**
 * The 'lensing' ScreenPass: picks the black hole with the largest apparent lensing footprint,
 * ray-marches the strong field at reduced resolution inside a scissor box around it, and composites
 * at full resolution with weak-field LUT lensing further out. Escaped rays sample the on-screen
 * scene (when it lies behind the hole) or a 256² background cube captured here every 30 frames
 * (RenderApi.captureCube is not implemented by the engine).
 */
import {
  BufferGeometry,
  CubeCamera,
  DataTexture,
  Float32BufferAttribute,
  HalfFloatType,
  LinearFilter,
  Matrix3,
  Matrix4,
  Mesh,
  OrthographicCamera,
  RedFormat,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLCubeRenderTarget,
  WebGLRenderTarget,
  ClampToEdgeWrapping,
  DataUtils,
  type DepthTexture,
  type Texture,
  type WebGLRenderer,
} from 'three';
import type { QualityPreset, RenderApi, ScreenPass, Vec3d, ViewState } from '../../core/contracts';
import { vec3 } from '../../core/math64';
import { BLACKBODY_GLSL, DEPTH_GLSL, NOISE_GLSL } from '../../render/chunks/index';
import type { Hole } from './catalog';
import { NT_PEAK_FLUX } from './disk';
import { B_CRIT, deflectionLut, shadowAngle } from './geodesic';
import commonGlsl from './glsl/lens-common.glsl?raw';
import diskGlsl from './glsl/disk.glsl?raw';
import marchGlsl from './glsl/march.frag.glsl?raw';
import compositeGlsl from './glsl/composite.frag.glsl?raw';
import type { BlackholeState } from './state';

/** Resolution scale and RK4 step budget per preset (brief: cheap on medium). */
export const LENSING_PRESETS: Record<QualityPreset, { scale: number; steps: number }> = {
  potato: { scale: 0.25, steps: 32 },
  low: { scale: 0.25, steps: 48 },
  medium: { scale: 0.5, steps: 64 },
  high: { scale: 0.5, steps: 128 },
  ultra: { scale: 1, steps: 256 },
};
/** Step factor k (dt = k r) for a step budget: coarser steps when the budget is small. */
export const stepFactor = (steps: number): number => Math.min(0.3, Math.max(0.035, 10 / steps));
/** Minimum apparent footprint, px, for the pass to run. */
export const MIN_PX = 3;
/** Refresh period of the background cube, frames. */
export const CUBE_INTERVAL = 30;
const LUT_SIZE = 128;
const LUT_BMIN = 2.6;
const LUT_BMAX = 1e4;

const FULLSCREEN_VERT = /* glsl */ `
${DEPTH_GLSL}
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/** Radius of the marched sphere for a hole (r_s): contains the disk with margin. */
export const boundRadius = (h: Hole, diskOn: boolean): number =>
  diskOn && h.diskMode !== 'none' ? Math.max(12, 1.25 * h.disk.rOut) : 12;

export interface LensTarget {
  hole: Hole;
  /** Camera → hole, world axes, m. */
  rel: Vec3d;
  dist: number;
  /** Footprint, px. */
  px: number;
}

export function createLensingPass(
  render: RenderApi,
  holes: readonly Hole[],
  state: BlackholeState,
): ScreenPass & { target(): LensTarget | null } {
  const u = render.uniforms;
  // Half-float so linear filtering needs no float-linear extension (f ≈ 1..1.6, 1e-3 precision).
  const lutData = new Uint16Array(LUT_SIZE);
  deflectionLut(LUT_SIZE, LUT_BMIN, LUT_BMAX).forEach((v, i) => (lutData[i] = DataUtils.toHalfFloat(v)));
  const lut = new DataTexture(lutData, LUT_SIZE, 1, RedFormat, HalfFloatType);
  lut.minFilter = lut.magFilter = LinearFilter;
  lut.wrapS = lut.wrapT = ClampToEdgeWrapping;
  lut.needsUpdate = true;

  const cubeTarget = new WebGLCubeRenderTarget(256, { type: HalfFloatType, generateMipmaps: false });
  const cubeCam = new CubeCamera(0.05, 1e27, cubeTarget);
  let cubeFrame = -1e9;
  let cubeExposure = 1;
  let cubeHole: Hole | null = null;

  const common = {
    uInput: { value: null as Texture | null },
    uDepth: { value: null as Texture | null },
    uSkyCube: { value: cubeTarget.texture },
    uCubeReady: { value: 0 },
    uCubeScale: { value: 1 },
    uCamToWorld: { value: new Matrix3() },
    uViewProj: { value: new Matrix4() },
    uTanHalf: { value: new Vector2(1, 1) },
    uHoleDir: { value: new Vector3(0, 0, -1) },
    uCamDir: { value: new Vector3(0, 0, 1) },
    uHoleDist: { value: 1 },
    uDistRs: { value: 1e3 },
    uRBound: { value: 12 },
    uBoundM: { value: 1 },
    uDeflLut: { value: lut },
    uDeflRange: { value: new Vector3(Math.log(LUT_BMIN), Math.log(LUT_BMAX), LUT_SIZE) },
    uBend: { value: 1 },
  };
  const diskUniforms = {
    uDiskN: { value: new Vector3(0, 0, 1) },
    uDiskA: { value: new Vector3(1, 0, 0) },
    uDiskB: { value: new Vector3(0, 1, 0) },
    uDiskIn: { value: 3 },
    uDiskOut: { value: 14 },
    uDiskTmax: { value: 7000 },
    uDiskLum: { value: 1 },
    uFluxPeak: { value: NT_PEAK_FLUX },
    uPhase: { value: new Vector3(0, 0, 1) },
    uDoppler: { value: 1 },
    uGravity: { value: 1 },
    uObsShift: { value: 1 },
    uExposure: u.uExposure,
    uBlackbodyLut: u.uBlackbodyLut,
    uRiafT: { value: 3000 },
    uRiafLum: { value: 1 },
    uSteps: { value: 64 },
    uStepK: { value: 0.15 },
    uDiskMode: { value: 1 },
    uFullMarch: { value: 0 },
  };
  const header = `${DEPTH_GLSL}\n${BLACKBODY_GLSL}\n${NOISE_GLSL}\n${commonGlsl}\n`;
  // Full-screen materials: depth test/write off; DEPTH_GLSL is included to decode the depth texture.
  const marchMat = new ShaderMaterial({
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: `${header}${diskGlsl}\n${marchGlsl}`,
    uniforms: { ...common, ...diskUniforms },
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const compMat = new ShaderMaterial({
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: `${header}${compositeGlsl}`,
    uniforms: {
      ...common,
      uMarch: { value: null as Texture | null },
      uMarchOn: { value: 0 },
      uFullMarch: diskUniforms.uFullMarch,
      uWeakCos: { value: 2 },
    },
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  geo.setAttribute('uv', new Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const quad = new Mesh(geo, marchMat);
  quad.frustumCulled = false;
  const scene = new Scene();
  scene.add(quad);
  const ortho = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  let fullW = 1;
  let fullH = 1;
  let scale = 0.5;
  const march = new WebGLRenderTarget(1, 1, {
    type: HalfFloatType,
    depthBuffer: false,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
  });
  const resizeMarch = () =>
    march.setSize(Math.max(1, Math.round(fullW * scale)), Math.max(1, Math.round(fullH * scale)));

  // Per-frame scratch (no allocations in the frame loop).
  const rel = vec3();
  const zero = vec3();
  const fwd = new Vector3();
  const tmp = new Vector3();
  const box = new Vector2();
  const boxMax = new Vector2();
  let best: LensTarget | null = null;
  const bestRel = vec3();
  const slot: LensTarget = { hole: holes[0], rel: bestRel, dist: 0, px: 0 };
  let tauVis = 0;
  let lastJd = NaN;

  /** Apparent footprint (px) of a hole and whether its lensing region meets the view. */
  function footprint(h: Hole, dist: number, view: ViewState): number {
    const D = dist / h.rs;
    if (D <= 1.02) return 1e9;
    const rb = boundRadius(h, state.disk);
    const shadow = shadowAngle(D);
    const einstein = state.lensing ? Math.sqrt(2 / D) : 0;
    const bound = Math.asin(Math.min(1, rb / D));
    const ang = Math.max(shadow, einstein, h.diskMode !== 'none' && state.disk ? bound : 0);
    // Frustum test: angle between the view axis and the hole against the half diagonal.
    fwd.set(0, 0, -1).applyQuaternion(view.camera.quaternion);
    const cosA = (fwd.x * rel.x + fwd.y * rel.y + fwd.z * rel.z) / dist;
    const a = Math.acos(Math.max(-1, Math.min(1, cosA)));
    const halfDiag = Math.atan(
      Math.hypot(Math.tan(view.fovY / 2) * (view.viewport[0] / view.viewport[1]), Math.tan(view.fovY / 2)),
    );
    if (a > halfDiag + Math.min(Math.PI, 2 * ang) && D > 3 * rb) return 0;
    return ang / view.pixelAngle;
  }

  function pick(view: ViewState): LensTarget | null {
    best = null;
    let bestPx = MIN_PX;
    for (const h of holes) {
      view.toCamera(h.frame, zero, rel);
      const dist = Math.hypot(rel.x, rel.y, rel.z);
      if (!(dist > 0)) continue;
      const px = footprint(h, dist, view);
      if (px >= bestPx) {
        bestPx = px;
        bestRel.x = rel.x;
        bestRel.y = rel.y;
        bestRel.z = rel.z;
        slot.hole = h;
        slot.dist = dist;
        slot.px = px;
        best = slot;
      }
    }
    return best;
  }

  /** Screen box (uv) of the cone of half-angle `rho` around unit direction `dir` (world). */
  function coneBox(view: ViewState, dir: Vector3, rho: number): boolean {
    const cam = view.camera;
    box.set(1, 1);
    boxMax.set(0, 0);
    const c = Math.cos(rho);
    const s = Math.sin(rho);
    // Orthonormal basis around dir.
    const ux = Math.abs(dir.y) < 0.9 ? 0 : 1;
    const e1 = tmp
      .set(ux, 1 - ux, 0)
      .cross(dir)
      .normalize();
    const e1x = e1.x,
      e1y = e1.y,
      e1z = e1.z;
    const e2x = dir.y * e1z - dir.z * e1y,
      e2y = dir.z * e1x - dir.x * e1z,
      e2z = dir.x * e1y - dir.y * e1x;
    for (let k = 0; k < 16; k++) {
      const t = (k / 16) * 2 * Math.PI;
      const ct = Math.cos(t) * s;
      const st = Math.sin(t) * s;
      fwd.set(
        dir.x * c + e1x * ct + e2x * st,
        dir.y * c + e1y * ct + e2y * st,
        dir.z * c + e1z * ct + e2z * st,
      );
      fwd.applyMatrix4(cam.matrixWorldInverse);
      if (fwd.z >= -1e-6) return false; // part of the cone is behind the camera: full screen
      fwd.applyMatrix4(cam.projectionMatrix);
      box.x = Math.min(box.x, fwd.x * 0.5 + 0.5);
      box.y = Math.min(box.y, fwd.y * 0.5 + 0.5);
      boxMax.x = Math.max(boxMax.x, fwd.x * 0.5 + 0.5);
      boxMax.y = Math.max(boxMax.y, fwd.y * 0.5 + 0.5);
    }
    return true;
  }

  function captureCube(gl: WebGLRenderer, view: ViewState): void {
    const prevAuto = gl.autoClear;
    gl.autoClear = true;
    cubeCam.update(gl, render.scenes.background);
    gl.autoClear = prevAuto;
    cubeFrame = view.frameIndex;
    cubeExposure = view.exposure;
    common.uCubeReady.value = 1;
  }

  return {
    id: 'blackholes.lensing',
    stage: 'lensing',
    order: 0,
    target: () => best,
    active(view: ViewState): boolean {
      return pick(view) !== null;
    },
    setSize(w: number, h: number) {
      fullW = w;
      fullH = h;
      resizeMarch();
    },
    render(
      gl: WebGLRenderer,
      input: WebGLRenderTarget,
      depth: DepthTexture,
      output: WebGLRenderTarget,
      view: ViewState,
    ): void {
      const t = best;
      if (!t) return;
      const h = t.hole;
      const preset = LENSING_PRESETS[view.quality] ?? LENSING_PRESETS.medium;
      if (preset.scale !== scale) {
        scale = preset.scale;
        resizeMarch();
      }
      // Background cube: on activation, on a new hole, then every CUBE_INTERVAL frames.
      if (cubeHole !== h || view.frameIndex - cubeFrame >= CUBE_INTERVAL || view.frameIndex < cubeFrame) {
        cubeHole = h;
        captureCube(gl, view);
      }
      common.uCubeScale.value = view.exposure / Math.max(cubeExposure, 1e-30);

      const cam = view.camera;
      const D = t.dist / h.rs;
      const diskOn = state.disk && h.diskMode !== 'none';
      const rb = boundRadius(h, state.disk);
      const fullMarch = D < 3 * rb;
      common.uInput.value = input.texture;
      common.uDepth.value = depth;
      common.uCamToWorld.value.setFromMatrix4(cam.matrixWorld);
      common.uViewProj.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      const tanY = Math.tan(view.fovY / 2);
      common.uTanHalf.value.set(tanY * (view.viewport[0] / view.viewport[1]), tanY);
      const hd = common.uHoleDir.value.set(t.rel.x / t.dist, t.rel.y / t.dist, t.rel.z / t.dist);
      common.uCamDir.value.copy(hd).negate();
      common.uHoleDist.value = t.dist;
      common.uDistRs.value = D;
      common.uRBound.value = rb;
      common.uBoundM.value = rb * h.rs;
      common.uBend.value = state.lensing ? 1 : 0;

      // Disk parameters for this hole and mode.
      const realistic = state.mode === 'realistic';
      const du = diskUniforms;
      du.uDiskMode.value = !diskOn ? 0 : realistic ? 2 : 1;
      du.uDiskN.value.set(h.diskNormal.x, h.diskNormal.y, h.diskNormal.z);
      du.uDiskA.value.set(h.diskA.x, h.diskA.y, h.diskA.z);
      du.uDiskB.value.set(h.diskB.x, h.diskB.y, h.diskB.z);
      du.uDiskIn.value = 3;
      du.uDiskOut.value = h.disk.rOut;
      du.uDiskTmax.value = h.disk.tMaxK;
      du.uDiskLum.value = h.disk.lum;
      du.uRiafT.value = h.disk.riafTK;
      du.uRiafLum.value = h.disk.riafLum;
      du.uDoppler.value = state.beaming ? 1 : 0;
      du.uGravity.value = state.redshift ? 1 : 0;
      du.uObsShift.value = 1 / Math.sqrt(Math.max(1 - 1 / D, 1e-3));
      // Keplerian shear clock in r_s/c, advancing at most 1/120 of a cycle per frame.
      const period = 4 * 2 * Math.PI * Math.sqrt(2 * 27); // 4 orbits at r_isco
      if (Number.isFinite(lastJd)) {
        const dTau = (view.dtSim * 299_792_458) / h.rs;
        tauVis += Math.max(-period / 120, Math.min(period / 120, dTau));
      } else tauVis = ((view.jd - 2451545) * 86400 * 299_792_458) / h.rs;
      lastJd = view.jd;
      const T = tauVis / period;
      const fa = T - Math.floor(T);
      const fb = T + 0.5 - Math.floor(T + 0.5);
      du.uPhase.value.set(period * fa, period * fb, 1 - Math.abs(2 * fa - 1));
      du.uSteps.value = preset.steps;
      du.uStepK.value = stepFactor(preset.steps);
      du.uFullMarch.value = fullMarch ? 1 : 0;

      // Weak-field radius: deflection above ~0.5 px.
      const psiWeak = state.lensing ? Math.min(1.5, 4 / (D * view.pixelAngle)) : 0;
      compMat.uniforms.uWeakCos.value = state.lensing ? Math.cos(psiWeak) : 2;

      // March inside the scissor box around the bound sphere (with a 10% margin).
      let marchOn = false;
      const rho = Math.asin(Math.min(1, (1.12 * rb) / D));
      const boxed = !fullMarch && rho < 1.2 && coneBox(view, hd, rho);
      const mw = march.width;
      const mh = march.height;
      let x0 = 0,
        y0 = 0,
        x1 = mw,
        y1 = mh;
      if (boxed) {
        x0 = Math.max(0, Math.floor(box.x * mw) - 2);
        y0 = Math.max(0, Math.floor(box.y * mh) - 2);
        x1 = Math.min(mw, Math.ceil(boxMax.x * mw) + 2);
        y1 = Math.min(mh, Math.ceil(boxMax.y * mh) + 2);
      }
      if (x1 > x0 && y1 > y0) {
        quad.material = marchMat;
        gl.setRenderTarget(march);
        march.scissor.set(x0, y0, x1 - x0, y1 - y0);
        march.scissorTest = true;
        gl.render(scene, ortho);
        march.scissorTest = false;
        marchOn = true;
      }
      compMat.uniforms.uMarch.value = march.texture;
      compMat.uniforms.uMarchOn.value = marchOn ? 1 : 0;
      quad.material = compMat;
      gl.setRenderTarget(output);
      gl.render(scene, ortho);
    },
    memoryBytes() {
      return march.width * march.height * 8 + 6 * 256 * 256 * 8 + LUT_SIZE * 4;
    },
    dispose() {
      march.dispose();
      cubeTarget.dispose();
      lut.dispose();
      marchMat.dispose();
      compMat.dispose();
      geo.dispose();
    },
  };
}

/** Apparent shadow diameter seen from distance d (m) for Schwarzschild radius rs, rad (small angle). */
export const shadowDiameter = (rs: number, d: number): number => (2 * B_CRIT * rs) / d;
