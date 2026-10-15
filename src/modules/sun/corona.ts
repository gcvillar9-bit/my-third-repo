/** Corona shell renderable (Baumbach K+F brightness with radial streamers, see glsl/corona.glsl). */
import {
  AdditiveBlending,
  BackSide,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type IUniform,
} from 'three';
import type { Body, FrameId, Renderable, ViewState } from '../../core/contracts';
import { quat, qrotate, v3len, vec3 } from '../../core/math64';
import { SUN_DISK_LUMINANCE, SUN_RGB } from '../../core/photometry';
import { DEPTH_GLSL } from '../../render/chunks';
import coronaGlsl from './glsl/corona.glsl?raw';
import data from './sun-data.json';

export const CORONA_ID = 'sun.corona';

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function createCorona(
  body: Body,
  exposure: IUniform<number>,
  hasFrame: (f: FrameId) => boolean,
): Renderable {
  const [vs, fs] = coronaGlsl.split(/^\/\/#fragment$/m);
  const c = data.corona;
  const shellR = c.shellRadii;
  const uniforms = {
    uExposure: exposure,
    uFade: { value: 1 },
    uSunCenter: { value: new Vector3() },
    uSunRadius: { value: body.radius },
    uSunPole: { value: new Vector3(0, 0, 1) },
    uCoronaL: { value: new Vector3(...SUN_RGB.map((v) => v * SUN_DISK_LUMINANCE)) },
    uBaumA: { value: new Vector3(...c.terms.map((t) => t.a * c.scale)) },
    uBaumP: { value: new Vector3(...c.terms.map((t) => t.p)) },
    uShellR: { value: shellR },
  };
  const material = new ShaderMaterial({
    vertexShader: `${DEPTH_GLSL}\n${vs}`,
    fragmentShader: `${DEPTH_GLSL}\n${fs}`,
    uniforms,
    side: BackSide,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const geometry = new SphereGeometry(1, 48, 24);
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.name = CORONA_ID;
  const rel = vec3();
  const q = quat();
  const pole = vec3();
  const Z = vec3(0, 0, 1);
  const ORIGIN = vec3();
  const fixed = body.fixedFrame ?? `${body.id}.fixed`;
  return {
    id: CORONA_ID,
    layer: 'transparent',
    object: mesh,
    update(view: ViewState) {
      view.toCamera(body.frame, ORIGIN, rel);
      const d = v3len(rel);
      // Hidden once the whole shell is a few pixels wide (the photometric point takes over).
      const px = (shellR * body.radius) / Math.max(d, 1) / view.pixelAngle;
      const fade = smoothstep(2, 6, px);
      uniforms.uFade.value = fade;
      mesh.visible = fade > 0;
      if (!mesh.visible) return;
      mesh.position.set(rel.x, rel.y, rel.z);
      mesh.scale.setScalar(shellR * body.radius);
      uniforms.uSunCenter.value.set(rel.x, rel.y, rel.z);
      if (hasFrame(fixed)) {
        qrotate(pole, view.frameQuat(fixed, q), Z);
        uniforms.uSunPole.value.set(pole.x, pole.y, pole.z);
      }
    },
    memoryBytes() {
      const pos = geometry.getAttribute('position').count;
      return pos * (3 + 3 + 2) * 4 + (geometry.index?.count ?? 0) * 2;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
