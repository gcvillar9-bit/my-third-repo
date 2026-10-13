/**
 * Cloud shell: a cube-sphere CLOUD_ALTITUDE_M above the ellipsoid on the transparent layer
 * (premultiplied alpha, depth test on, depth write off). Drawn from outside (front faces) or from
 * below (back faces), and faded with the same 1.5 -> 3 px weight as the planet sphere.
 */
import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  FrontSide,
  Matrix3,
  Mesh,
  NormalBlending,
  Quaternion,
  ShaderMaterial,
  Vector3,
  type IUniform,
} from 'three';
import type { Body, Renderable, ViewState } from '../../core/contracts';
import { qrotateInv, quat, v3len, vec3 } from '../../core/math64';
import { SUN_RGB, solarIlluminance } from '../../core/photometry';
import { DEPTH_GLSL } from '../../render/chunks/index';
import cloudFrag from './glsl/cloud.frag.glsl?raw';
import cloudVert from './glsl/cloud.vert.glsl?raw';
import { CLOUD_ALTITUDE_M, EARTH_PRELUDE, apparentPx, setWorldToBody } from './shading';

/** Unit cube-sphere (tan-warped faces, n x n cells each). */
export function cubeSphere(n: number): { pos: Float32Array; index: Uint32Array } {
  const faces = [
    [1, 0, 0, 0, 1, 0, 0, 0, 1],
    [-1, 0, 0, 0, -1, 0, 0, 0, 1],
    [0, 1, 0, -1, 0, 0, 0, 0, 1],
    [0, -1, 0, 1, 0, 0, 0, 0, 1],
    [0, 0, 1, 0, 1, 0, -1, 0, 0],
    [0, 0, -1, 0, 1, 0, 1, 0, 0],
  ];
  const vpf = (n + 1) * (n + 1);
  const pos = new Float32Array(6 * vpf * 3);
  const index = new Uint32Array(6 * n * n * 6);
  let k = 0;
  let t = 0;
  faces.forEach((f, fi) => {
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const a = Math.tan((i / n - 0.5) * (Math.PI / 2));
        const b = Math.tan((j / n - 0.5) * (Math.PI / 2));
        const x = f[0] + a * f[3] + b * f[6];
        const y = f[1] + a * f[4] + b * f[7];
        const z = f[2] + a * f[5] + b * f[8];
        const l = Math.hypot(x, y, z);
        pos[k++] = x / l;
        pos[k++] = y / l;
        pos[k++] = z / l;
      }
    }
    const base = fi * vpf;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const p = base + j * (n + 1) + i;
        const q = p + n + 1;
        index.set([p, p + 1, q + 1, p, q + 1, q], t);
        t += 6;
      }
    }
  });
  return { pos, index };
}

/** Sphere weight of the point/sphere crossfade (1.5 -> 3 px). */
export function sphereWeight(px: number): number {
  const x = Math.min(1, Math.max(0, (px - 1.5) / 1.5));
  return x * x * (3 - 2 * x);
}

export interface CloudShellDeps {
  body: Body;
  shared: Record<string, IUniform>;
  textures: Record<string, IUniform>;
  atmosphere: Record<string, IUniform>;
  exposure: IUniform<number>;
  segments: number;
}

export function createCloudShell(deps: CloudShellDeps): Renderable {
  const { body } = deps;
  const { pos, index } = cubeSphere(deps.segments);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(pos, 3));
  geometry.setIndex(new BufferAttribute(index, 1));
  const a = body.radius + CLOUD_ALTITUDE_M;
  const c = body.radius * (1 - (body.oblateness ?? 0)) + CLOUD_ALTITUDE_M;
  const uniforms: Record<string, IUniform> = {
    ...deps.textures,
    ...deps.shared,
    ...deps.atmosphere,
    uExposure: deps.exposure,
    uFade: { value: 1 },
    uPixelAngle: { value: 1e-3 },
    uCloudRadii: { value: new Vector3(a, a, c) },
    uCloudSunPos: { value: new Vector3() },
    uCloudSunIllum: { value: new Vector3() },
  };
  const material = new ShaderMaterial({
    vertexShader: `${DEPTH_GLSL}\n${cloudVert}`,
    fragmentShader: `${DEPTH_GLSL}\n${EARTH_PRELUDE}\n${cloudFrag}`,
    uniforms,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: NormalBlending,
    premultipliedAlpha: true,
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.scale.set(a, a, c);
  mesh.renderOrder = 1;
  mesh.name = 'earth.clouds';
  const rel = vec3();
  const sun = vec3();
  const local = vec3();
  const q = quat();
  const tq = new Quaternion();
  return {
    id: 'earth.clouds',
    layer: 'transparent',
    object: mesh,
    update(view: ViewState) {
      view.toCamera(body.frame, vec3(), rel);
      const dist = v3len(rel);
      const fade = sphereWeight(apparentPx(body.radius, dist, view.pixelAngle));
      mesh.visible = fade > 0;
      if (!mesh.visible) return;
      mesh.position.set(rel.x, rel.y, rel.z);
      view.frameQuat(body.fixedFrame ?? body.frame, q);
      mesh.quaternion.copy(tq.set(q.x, q.y, q.z, q.w));
      setWorldToBody(deps.shared.uEarthWorldToBody.value as Matrix3, q);
      // camera in body axes: inside the shell -> draw the cloud base (back faces)
      qrotateInv(local, q, { x: -rel.x, y: -rel.y, z: -rel.z });
      const e = (local.x * local.x + local.y * local.y) / (a * a) + (local.z * local.z) / (c * c);
      material.side = e < 1 ? BackSide : FrontSide;
      view.sunToCamera(sun);
      (uniforms.uCloudSunPos.value as Vector3).set(sun.x, sun.y, sun.z);
      const E = solarIlluminance(Math.hypot(sun.x - rel.x, sun.y - rel.y, sun.z - rel.z));
      (uniforms.uCloudSunIllum.value as Vector3).set(E * SUN_RGB[0], E * SUN_RGB[1], E * SUN_RGB[2]);
      uniforms.uFade.value = fade;
      uniforms.uPixelAngle.value = view.pixelAngle;
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
