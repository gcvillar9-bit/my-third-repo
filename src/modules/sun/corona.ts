/**
 * Corona shell renderable (Baumbach K+F brightness with the cycle's flattening, helmet streamers over the
 * prominence anchors and fine rays; prominences near the limb; see glsl/corona.glsl).
 */
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
import { quat, qrotate, v3len, v3set, vec3 } from '../../core/math64';
import { SUN_DISK_LUMINANCE, SUN_RGB } from '../../core/photometry';
import { DEPTH_GLSL } from '../../render/chunks';
import { MAX_PROMINENCES, sunspotNumber, type SunActivity } from './activity';
import coronaGlsl from './glsl/corona.glsl?raw';
import type { SunViewSwitches } from './shading';
import { ACTIVITY_MIN_PX, halphaI0 } from './shading';
import data from './sun-data.json';

export const CORONA_ID = 'sun.corona';
/** Sunspot number at which the corona is round (uRound = 1); flattened (0) at minimum. */
export const ROUND_SSN = 200;

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function createCorona(
  body: Body,
  exposure: IUniform<number>,
  hasFrame: (f: FrameId) => boolean,
  activity?: SunActivity,
  switches?: SunViewSwitches,
): Renderable {
  const [vs, fs] = coronaGlsl.split(/^\/\/#fragment$/m);
  const c = data.corona;
  const shellR = c.shellRadii;
  const pr = data.prominences;
  const promY = 0.2126 * pr.colour[0] + 0.7152 * pr.colour[1] + 0.0722 * pr.colour[2];
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
    uCoronaOn: { value: 1 },
    uHalpha: { value: 0 },
    uProm: { value: new Float32Array(MAX_PROMINENCES * 4) },
    uPromB: { value: activity?.promB ?? new Float32Array(MAX_PROMINENCES * 4) },
    uPromCount: { value: 0 },
    uPromL: {
      value: new Vector3(...pr.colour.map((v) => (v / promY) * SUN_DISK_LUMINANCE * pr.brightness)),
    },
    uHaPromL: { value: new Vector3(...halphaI0(SUN_DISK_LUMINANCE).map((v) => v * pr.halphaBrightness)) },
    uChromo: { value: activity ? pr.chromosphereBrightness / pr.brightness : 0 },
    uPixAngle: { value: 1e-3 },
    uRound: { value: 0.5 },
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
  const a = vec3();
  const Z = vec3(0, 0, 1);
  const ORIGIN = vec3();
  const fixed = body.fixedFrame ?? `${body.id}.fixed`;
  let roundJd = NaN;
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
      uniforms.uPixAngle.value = view.pixelAngle;
      if (!(Math.abs(view.jd - roundJd) < 1)) {
        roundJd = view.jd;
        uniforms.uRound.value = Math.min(1, sunspotNumber(view.jd) / ROUND_SSN);
      }
      const halpha = !!switches?.halpha;
      uniforms.uHalpha.value = halpha ? 1 : 0;
      uniforms.uCoronaOn.value = halpha ? 0 : 1;
      if (hasFrame(fixed)) {
        view.frameQuat(fixed, q);
        qrotate(pole, q, Z);
        uniforms.uSunPole.value.set(pole.x, pole.y, pole.z);
        uniforms.uPromCount.value = 0;
        // Prominences (and the helmet streamers over them) only once the disk is a few pixels across.
        if (activity && body.radius / Math.max(d, 1) / view.pixelAngle >= ACTIVITY_MIN_PX) {
          activity.update(view.jd);
          const src = activity.prom;
          const dst = uniforms.uProm.value;
          for (let i = 0; i < activity.promCount; i++) {
            v3set(a, src[i * 4], src[i * 4 + 1], src[i * 4 + 2]);
            qrotate(a, q, a);
            dst[i * 4] = a.x;
            dst[i * 4 + 1] = a.y;
            dst[i * 4 + 2] = a.z;
            dst[i * 4 + 3] = src[i * 4 + 3];
          }
          uniforms.uPromCount.value = activity.promCount;
        }
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
