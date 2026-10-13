/**
 * Full-screen pass helpers for ScreenPass implementations and engine passes. A single
 * oversized triangle covers the viewport; vUv runs 0..1 across the screen.
 */
import {
  BufferGeometry,
  Float32BufferAttribute,
  Mesh,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  type ShaderMaterialParameters,
  type WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';

/** Vertex shader for full-screen passes (gl_Position at depth 0, vUv 0..1). */
export const FULLSCREEN_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

let sharedGeometry: BufferGeometry | null = null;

export function fullscreenTriangle(): BufferGeometry {
  if (!sharedGeometry) {
    sharedGeometry = new BufferGeometry();
    sharedGeometry.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    sharedGeometry.setAttribute('uv', new Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  }
  return sharedGeometry;
}

/**
 * A full-screen material: depth test/write off, no tone mapping. Pass `fragmentShader`
 * (it receives `varying vec2 vUv`). Include DEPTH_GLSL when decoding the depth texture.
 */
export function fullscreenMaterial(params: ShaderMaterialParameters): ShaderMaterial {
  // cosmos:no-depth (full-screen passes draw without depth; the fragment includes DEPTH_GLSL when it reads depth)
  return new ShaderMaterial({
    vertexShader: FULLSCREEN_VERTEX,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    ...params,
  });
}

/** Draws one material over the whole target (null = canvas). */
export class FullscreenPass {
  readonly scene = new Scene();
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  readonly mesh: Mesh;

  constructor(public material: ShaderMaterial) {
    this.mesh = new Mesh(fullscreenTriangle(), material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  render(renderer: WebGLRenderer, target: WebGLRenderTarget | null): void {
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.material.dispose();
  }
}
