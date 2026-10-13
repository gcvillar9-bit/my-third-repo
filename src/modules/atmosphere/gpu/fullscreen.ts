/**
 * Minimal full-screen helpers private to the atmosphere module (src/render/passes.ts is
 * integrator-owned and not importable from modules). One oversized triangle; vUv runs 0..1.
 */
import {
  BufferGeometry,
  Float32BufferAttribute,
  HalfFloatType,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  WebGLRenderTarget,
  type IUniform,
  type WebGLRenderer,
} from 'three';

export const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * LUT material: draws into a private target with no depth buffer.
 * cosmos:no-depth (LUT passes render full-screen into private float targets without a depth buffer)
 */
export function lutMaterial(fragmentShader: string, uniforms: Record<string, IUniform>): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: FULLSCREEN_VERT,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}

/** HalfFloat RGBA target with linear filtering and clamp-to-edge (LUTs and atlases). */
export function lutTarget(w: number, h: number): WebGLRenderTarget {
  return new WebGLRenderTarget(w, h, {
    type: HalfFloatType,
    format: RGBAFormat,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    depthBuffer: false,
    generateMipmaps: false,
  });
}

/** Bytes of a HalfFloat RGBA target. */
export const targetBytes = (t: WebGLRenderTarget): number => t.width * t.height * 8;

export class FullscreenDraw {
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly geometry = new BufferGeometry();
  private readonly mesh: Mesh;

  constructor() {
    this.geometry.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.geometry.setAttribute('uv', new Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.mesh = new Mesh(this.geometry);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  render(gl: WebGLRenderer, material: ShaderMaterial, target: WebGLRenderTarget | null): void {
    this.mesh.material = material;
    gl.setRenderTarget(target);
    gl.render(this.scene, this.camera);
  }

  dispose(): void {
    this.geometry.dispose();
  }
}
