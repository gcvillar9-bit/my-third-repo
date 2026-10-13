/**
 * _debug: a lit sphere in its own frame plus the 'debug-sphere' bookmark, so e2e can exercise
 * the whole pipeline (frames, log depth, photometry, exposure, post) without other modules.
 * The frame sits 1e22 m from the root (precision torture) and is registered only with ?test=1
 * or ?debug, so it never shows up in normal use.
 */
import { Mesh, ShaderMaterial, SphereGeometry, Vector3 } from 'three';
import { ROOT_FRAME, type Renderable, type UniverseModule, type ViewState } from '../../core/contracts';
import { qrotate, quat, v3set, vec3 } from '../../core/math64';
import { SOLAR_ILLUMINANCE_1AU, SUN_RGB } from '../../core/photometry';
import { DEPTH_GLSL } from '../../render/chunks/index';

export const DEBUG_FRAME = 'debug';
export const DEBUG_BODY = 'debug-sphere';
export const DEBUG_RADIUS = 1e6;
/** Distance of the debug frame from the root, m. */
export const DEBUG_OFFSET = 1e22;
/** Direction towards the light in debug-frame axes: screen-left in the bookmark view. */
const LIGHT_DIR = vec3(-1, 0, 0);

const vertexShader = /* glsl */ `
${DEPTH_GLSL}
varying vec3 vNormalW;
void main() {
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  LOG_DEPTH_VERTEX();
}`;

const fragmentShader = /* glsl */ `
${DEPTH_GLSL}
uniform vec3 uLightDir;
uniform vec3 uIlluminance; // lux per channel
uniform float uAlbedo;
uniform float uExposure;
varying vec3 vNormalW;
void main() {
  float ndl = max(dot(normalize(vNormalW), uLightDir), 0.0);
  vec3 L = uIlluminance * uAlbedo / 3.14159265 * ndl; // Lambert, cd/m²
  gl_FragColor = vec4(L * uExposure, 1.0);
  LOG_DEPTH_FRAGMENT();
}`;

function createSphere(exposure: { value: number }): Renderable {
  const geometry = new SphereGeometry(1, 64, 32);
  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uLightDir: { value: new Vector3(-1, 0, 0) },
      uIlluminance: { value: new Vector3(...SUN_RGB).multiplyScalar(SOLAR_ILLUMINANCE_1AU) },
      uAlbedo: { value: 0.3 },
      uExposure: exposure,
    },
  });
  const mesh = new Mesh(geometry, material);
  mesh.scale.setScalar(DEBUG_RADIUS);
  mesh.frustumCulled = false;
  const rel = vec3();
  const q = quat();
  return {
    id: '_debug.sphere',
    layer: 'opaque',
    object: mesh,
    update(view: ViewState) {
      view.toCamera(DEBUG_FRAME, vec3(), rel);
      mesh.position.set(rel.x, rel.y, rel.z);
      // The debug frame has root (supergalactic) axes; shaders work in world (ICRF) axes.
      const l = qrotate(vec3(), view.frameQuat(DEBUG_FRAME, q), LIGHT_DIR);
      (material.uniforms.uLightDir.value as Vector3).set(l.x, l.y, l.z);
    },
    memoryBytes() {
      const pos = geometry.getAttribute('position');
      return pos.count * (3 + 3 + 2) * 4 + (geometry.index?.count ?? 0) * 2;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

const debugModule: UniverseModule = {
  id: '_debug',
  init(ctx) {
    if (!ctx.env.test && !ctx.env.debug) return;
    ctx.registry.addFrame({
      id: DEBUG_FRAME,
      parent: ROOT_FRAME,
      influenceRadius: 1e9,
      positionAt: (_jd, out) => v3set(out, DEBUG_OFFSET, 0, 0),
    });
    ctx.registry.addBody({
      id: DEBUG_BODY,
      name: 'Debug sphere',
      kind: 'minor',
      frame: DEBUG_FRAME,
      radius: DEBUG_RADIUS,
      influenceRadius: 1e9,
      albedo: 0.3,
      simulated: true,
    });
    ctx.registry.addRenderable(createSphere(ctx.render.uniforms.uExposure));
    ctx.registry.addBookmarks([
      {
        id: 'debug-sphere',
        title: 'Debug sphere',
        frame: DEBUG_FRAME,
        pos: { x: 0, y: 0, z: 3 * DEBUG_RADIUS },
        quat: { x: 0, y: 0, z: 0, w: 1 },
        lookAt: DEBUG_BODY,
        ev: 15,
        lookTarget:
          'A grey sphere filling about two thirds of the height, lit from the left: left half bright, right half black, black background.',
      },
    ]);
  },
};

export default debugModule;
