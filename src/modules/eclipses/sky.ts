/**
 * Eclipse sky dimming. The atmosphere pass lights the sky with the full Sun and does not know about
 * the Moon's shadow, so two tiny passes bracket it in the 'atmosphere' stage:
 * - 'eclipses.sky-capture' (order -100) copies the scene before the atmosphere composite;
 * - 'eclipses.sky-dim' (order 100) outputs pre + f * (post - pre): the atmosphere's contribution
 *   (inscatter and extinction) scaled by f = skyFactor(visible solar-disk fraction at the camera).
 * Both are active only within 150 km of Earth's surface while the Moon overlaps the Sun. In totality
 * the corona therefore skips atmospheric extinction (<20% at high Sun; documented).
 */
import {
  BufferGeometry,
  Float32BufferAttribute,
  HalfFloatType,
  Mesh,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  WebGLRenderTarget,
  type Texture,
  type WebGLRenderer,
} from 'three';
import type { ScreenPass, ViewState } from '../../core/contracts';
import { v3dot, v3len, vec3 } from '../../core/math64';
import { diskVisibleFraction, skyFactor } from './search';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;
const COPY = /* glsl */ `
uniform sampler2D tSrc;
varying vec2 vUv;
void main() { gl_FragColor = texture2D(tSrc, vUv); }`;
const MIX = /* glsl */ `
uniform sampler2D tPre;
uniform sampler2D tPost;
uniform float uFactor;
varying vec2 vUv;
void main() {
  vec4 a = texture2D(tPre, vUv);
  vec4 b = texture2D(tPost, vUv);
  gl_FragColor = vec4(a.rgb + uFactor * (b.rgb - a.rgb), b.a);
}`;

class Fullscreen {
  readonly scene = new Scene();
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  readonly geometry = new BufferGeometry();
  constructor(readonly material: ShaderMaterial) {
    this.geometry.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const mesh = new Mesh(this.geometry, material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }
  draw(gl: WebGLRenderer, target: WebGLRenderTarget): void {
    gl.setRenderTarget(target);
    gl.render(this.scene, this.camera);
  }
  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

// cosmos:no-depth (full-screen copy/mix passes: no geometry, depth is not read)
const fullscreenMaterial = (fragmentShader: string, uniforms: Record<string, { value: unknown }>) =>
  new ShaderMaterial({ vertexShader: VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false });

export interface EclipseSkyBodies {
  earthRadius: number;
  moonRadius: number;
  sunRadius: number;
}

/** Sky factor at the camera (1 = uneclipsed or far from Earth). */
export function cameraSkyFactor(view: ViewState, b: EclipseSkyBodies): number {
  const e = view.toCamera('earth', vec3(), vec3());
  if (v3len(e) - b.earthRadius > 150e3) return 1;
  const s = view.sunToCamera(vec3());
  const m = view.toCamera('moon', vec3(), vec3());
  const ds = v3len(s);
  const dm = v3len(m);
  const sep = Math.acos(Math.max(-1, Math.min(1, v3dot(s, m) / (ds * dm))));
  return skyFactor(diskVisibleFraction(Math.asin(b.sunRadius / ds), Math.asin(b.moonRadius / dm), sep));
}

export function createEclipseSkyPasses(bodies: EclipseSkyBodies): ScreenPass[] {
  const state = { factor: 1, frame: -1 };
  const copyU = { tSrc: { value: null as Texture | null } };
  const mixU = {
    tPre: { value: null as Texture | null },
    tPost: { value: null as Texture | null },
    uFactor: { value: 1 },
  };
  const copy = new Fullscreen(fullscreenMaterial(COPY, copyU));
  const mix = new Fullscreen(fullscreenMaterial(MIX, mixU));
  let pre: WebGLRenderTarget | null = null;
  const capture: ScreenPass = {
    id: 'eclipses.sky-capture',
    stage: 'atmosphere',
    order: -100,
    active(view) {
      state.factor = cameraSkyFactor(view, bodies);
      state.frame = view.frameIndex;
      return state.factor < 0.999;
    },
    render(gl, input, _depth, output) {
      if (!pre || pre.width !== input.width || pre.height !== input.height) {
        pre?.dispose();
        pre = new WebGLRenderTarget(input.width, input.height, { type: HalfFloatType, depthBuffer: false });
      }
      copyU.tSrc.value = input.texture;
      copy.draw(gl, pre);
      copy.draw(gl, output);
    },
    memoryBytes: () => (pre ? pre.width * pre.height * 8 : 0),
    dispose() {
      pre?.dispose();
      pre = null;
      copy.dispose();
    },
  };
  const dim: ScreenPass = {
    id: 'eclipses.sky-dim',
    stage: 'atmosphere',
    order: 100,
    active: (view) => state.frame === view.frameIndex && state.factor < 0.999 && pre !== null,
    render(gl, input, _depth, output) {
      mixU.tPre.value = pre!.texture;
      mixU.tPost.value = input.texture;
      mixU.uFactor.value = state.factor;
      mix.draw(gl, output);
    },
    dispose() {
      mix.dispose();
    },
  };
  return [capture, dim];
}
