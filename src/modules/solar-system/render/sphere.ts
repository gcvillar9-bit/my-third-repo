/**
 * 'sphere' SurfaceGeometryProvider (priority 0): a cube-sphere per body, shaded by whatever
 * SurfaceShading wins for that body. Fills SurfaceInput (shadows via shadows.glsl with up to 4
 * sphere occluders) and crossfades with the photometric point LOD between 1.5 and 3 px.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Matrix3,
  Matrix4,
  Mesh,
  Quaternion,
  ShaderMaterial,
  Vector3,
  type IUniform,
} from 'three';
import {
  SURFACE_INPUT_GLSL,
  type Body,
  type RegistryReader,
  type Renderable,
  type SurfaceGeometryProvider,
  type SurfaceShading,
  type Vec3d,
  type ViewState,
} from '../../../core/contracts';
import { quat, v3dot, v3len, v3scale, v3sub, vec3 } from '../../../core/math64';
import { SUN_RGB } from '../../../core/photometry';
import { R_SUN } from '../../../core/units';
import {
  DEPTH_GLSL,
  SHADOWS_GLSL,
  createShadowUniforms,
  setShadowUniforms,
} from '../../../render/chunks/index';
import sphereFrag from '../glsl/sphere.frag.glsl?raw';
import sphereVert from '../glsl/sphere.vert.glsl?raw';
import { POINT_MAX_PX, apparentDiameterPx, sphereWeight, type SceneState } from './scene-state';

export const SPHERE_PROVIDER_ID = 'sphere';

const templates = new Map<number, { pos: Float32Array; index: Uint16Array | Uint32Array }>();

/** Unit cube-sphere (each face an n×n grid, vertices normalised), non-indexed seams per face. */
export function cubeSphereArrays(n: number): { pos: Float32Array; index: Uint16Array | Uint32Array } {
  const cached = templates.get(n);
  if (cached) return cached;
  const faces: [number[], number[], number[]][] = [
    [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    [
      [-1, 0, 0],
      [0, -1, 0],
      [0, 0, 1],
    ],
    [
      [0, 1, 0],
      [-1, 0, 0],
      [0, 0, 1],
    ],
    [
      [0, -1, 0],
      [1, 0, 0],
      [0, 0, 1],
    ],
    [
      [0, 0, 1],
      [0, 1, 0],
      [-1, 0, 0],
    ],
    [
      [0, 0, -1],
      [0, 1, 0],
      [1, 0, 0],
    ],
  ];
  const vpf = (n + 1) * (n + 1);
  const pos = new Float32Array(6 * vpf * 3);
  const count = 6 * n * n * 6;
  const index = 6 * vpf > 65535 ? new Uint32Array(count) : new Uint16Array(count);
  let k = 0;
  let t = 0;
  faces.forEach(([c, u, v], f) => {
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        // tan-warped grid: more uniform cells than a plain cube projection
        const a = Math.tan((i / n - 0.5) * (Math.PI / 2));
        const b = Math.tan((j / n - 0.5) * (Math.PI / 2));
        const x = c[0] + a * u[0] + b * v[0];
        const y = c[1] + a * u[1] + b * v[1];
        const z = c[2] + a * u[2] + b * v[2];
        const l = Math.hypot(x, y, z);
        pos[k++] = x / l;
        pos[k++] = y / l;
        pos[k++] = z / l;
      }
    }
    const base = f * vpf;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const p = base + j * (n + 1) + i;
        const q = p + n + 1;
        index[t++] = p;
        index[t++] = p + 1;
        index[t++] = q + 1;
        index[t++] = p;
        index[t++] = q + 1;
        index[t++] = q;
      }
    }
  });
  const out = { pos, index };
  templates.set(n, out);
  return out;
}

/** Builds the fragment shader: chunks + the shading's GLSL + the provider's main(). */
export function sphereFragmentShader(shading: SurfaceShading): string {
  return [DEPTH_GLSL, SURFACE_INPUT_GLSL, SHADOWS_GLSL, shading.glsl, sphereFrag].join('\n');
}

export interface SphereDeps {
  scene: SceneState;
  registry: RegistryReader;
  exposure: IUniform<number>;
  /** Candidate shadow casters per body id (parent, siblings, moons). */
  occluderCandidates(bodyId: string): readonly string[];
  /** Cube-sphere face resolution. */
  segments(): number;
}

interface Occ {
  center: Vec3d;
  radius: number;
  score: number;
}

export function createSphereProvider(deps: SphereDeps): SurfaceGeometryProvider {
  const tmpRel = vec3();
  return {
    id: SPHERE_PROVIDER_ID,
    bodyId: '*',
    priority: 0,
    wants(view: ViewState, body: Body): boolean {
      const bv = deps.scene.get(body.id);
      if (bv && bv.body === body) return bv.pxDiam > POINT_MAX_PX;
      const d = v3len(view.toCamera(body.frame, vec3(), tmpRel));
      return apparentDiameterPx(body.radius, d, view.pixelAngle) > POINT_MAX_PX;
    },
    build(body: Body, shading: SurfaceShading): Renderable {
      return buildSphere(body, shading, deps);
    },
  };
}

function buildSphere(body: Body, shading: SurfaceShading, deps: SphereDeps): Renderable {
  const { pos, index } = cubeSphereArrays(deps.segments());
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(pos, 3));
  geometry.setIndex(new BufferAttribute(index, 1));
  const a = body.radius;
  const c = a * (1 - (body.oblateness ?? 0));
  const shadow = createShadowUniforms();
  const uniforms: Record<string, IUniform> = {
    ...shading.uniforms,
    ...shadow,
    uExposure: deps.exposure,
    uFade: { value: 1 },
    uPixelAngle: { value: 1e-3 },
    uRadii: { value: new Vector3(a, a, c) },
    uBodyToWorld: { value: new Matrix3() },
    uSunPos: { value: new Vector3() },
    uSunIlluminance: { value: new Vector3() },
  };
  const material = new ShaderMaterial({
    vertexShader: `${DEPTH_GLSL}\n${sphereVert}`,
    fragmentShader: sphereFragmentShader(shading),
    uniforms,
    defines: { ...(shading.defines ?? {}) },
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.scale.set(a, a, c);
  mesh.name = `solar-system.sphere.${body.id}`;

  const q = quat();
  const tq = new Quaternion();
  const m4 = new Matrix4();
  const rel = vec3();
  const toSun = vec3();
  const sunRel = vec3();
  const occ: Occ[] = [];
  const zero = vec3();

  const updateOccluders = (view: ViewState) => {
    occ.length = 0;
    const sunDist = v3len(v3sub(toSun, sunRel, rel));
    if (sunDist <= 0) return;
    v3scale(toSun, toSun, 1 / sunDist);
    const consider = (frame: string, radius: number) => {
      const center = view.toCamera(frame, zero, vec3());
      const d = v3sub(vec3(), center, rel);
      const t = v3dot(d, toSun);
      if (t <= 0 || t >= sunDist) return;
      const perp = v3len(v3sub(vec3(), d, v3scale(vec3(), toSun, t)));
      if (perp > a + radius + (t * R_SUN) / sunDist) return;
      occ.push({ center, radius, score: radius / v3len(d) });
    };
    for (const id of deps.occluderCandidates(body.id)) {
      const b = deps.registry.body(id);
      if (b) consider(b.frame, b.radius);
    }
    for (const p of deps.registry.occluderProviders()) {
      if (p.receivers !== '*' && !p.receivers.includes(body.id)) continue;
      for (const o of p.occluders(view)) {
        const b = deps.registry.body(o.bodyId);
        if (b && b.id !== body.id) consider(b.frame, o.radius);
      }
    }
    occ.sort((x, y) => y.score - x.score);
  };

  return {
    id: `solar-system.sphere.${body.id}`,
    layer: 'opaque',
    object: mesh,
    update(view: ViewState) {
      const bv = deps.scene.get(body.id);
      if (bv && bv.body === body) Object.assign(rel, bv.rel);
      else view.toCamera(body.frame, zero, rel);
      const dist = v3len(rel);
      mesh.position.set(rel.x, rel.y, rel.z);
      view.frameQuat(body.fixedFrame ?? body.frame, q);
      tq.set(q.x, q.y, q.z, q.w);
      mesh.quaternion.copy(tq);
      (uniforms.uBodyToWorld.value as Matrix3).setFromMatrix4(m4.makeRotationFromQuaternion(tq));
      view.sunToCamera(sunRel);
      (uniforms.uSunPos.value as Vector3).set(sunRel.x, sunRel.y, sunRel.z);
      const E = bv ? bv.illuminance : 0;
      (uniforms.uSunIlluminance.value as Vector3).set(E * SUN_RGB[0], E * SUN_RGB[1], E * SUN_RGB[2]);
      uniforms.uPixelAngle.value = view.pixelAngle;
      uniforms.uFade.value = sphereWeight(apparentDiameterPx(a, dist, view.pixelAngle));
      if (body.id === 'sun') occ.length = 0;
      else updateOccluders(view);
      setShadowUniforms(shadow, sunRel, R_SUN, occ);
    },
    memoryBytes() {
      return pos.byteLength + index.byteLength;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
