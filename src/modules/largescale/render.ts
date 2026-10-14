/**
 * largescale rendering: one Renderable (overlay layer, display-referred diagram) holding two draws, the
 * Laniakea outline (lumpy shell, rim glow + contour slices) and the flow lines (LineSegments with a
 * moving dash). Both RTE in Mpc relative to the `universe` origin; built lazily the first time the camera
 * is beyond FADE_START from the Milky Way; no per-frame allocations.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  LineSegments,
  Mesh,
  ShaderMaterial,
  Vector3,
  type IUniform,
} from 'three';
import { ROOT_FRAME, type QualityPreset, type Quatd, type Renderable } from '../../core/contracts';
import { qrotate, qset, quat, v3len, vec3 } from '../../core/math64';
import { MPC } from '../../core/units';
import { createRteUniforms, RTE_GLSL } from '../../render/chunks';
import flowsGlsl from './flows.glsl?raw';
import { FLOW_LINES, generateFlows, LANIAKEA, shellMesh } from './model';
import { FADE_END, FADE_START } from './places';
import shellGlsl from './shell.glsl?raw';

export const DASH_MPC = 12;
/** Dash repeats per second (the dash moves DASH_MPC · DASH_RATE Mpc per second along the flow). */
export const DASH_RATE = 0.35;
export const CONTOUR_MPC = 10;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function createLargescaleLayer(preset: QualityPreset, enabled: () => boolean): Renderable {
  const rte = createRteUniforms();
  const fade: IUniform<number> = { value: 0 };
  const flowGeo = new BufferGeometry();
  const shellGeo = new BufferGeometry();
  const e3 = LANIAKEA.axes[2];
  const c = LANIAKEA.centre;
  // cosmos:no-depth (overlay diagram: additive lines drawn over the background, like the MW marker)
  const flowMat = new ShaderMaterial({
    vertexShader: `#define COSMOS_VERTEX\n#define DASH_MPC ${DASH_MPC.toFixed(1)}\n${RTE_GLSL}\n${flowsGlsl}`,
    fragmentShader: `#define DASH_MPC ${DASH_MPC.toFixed(1)}\n${flowsGlsl}`,
    uniforms: { ...rte, uFade: fade, uPhase: { value: 0 } },
    blending: AdditiveBlending,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  // cosmos:no-depth (overlay diagram: translucent outline shell, both faces, additive)
  const shellMat = new ShaderMaterial({
    vertexShader: `#define COSMOS_VERTEX\n#define CONTOUR_MPC ${CONTOUR_MPC.toFixed(1)}\n${RTE_GLSL}\n${shellGlsl}`,
    fragmentShader: `#define CONTOUR_MPC ${CONTOUR_MPC.toFixed(1)}\n${shellGlsl}`,
    uniforms: {
      ...rte,
      uFade: fade,
      uColor: { value: new Vector3(1.0, 0.78, 0.45) },
      uCentre: { value: new Vector3(c.x, c.y, c.z) },
      uAxisZ: { value: new Vector3(e3.x, e3.y, e3.z) },
    },
    blending: AdditiveBlending,
    transparent: true,
    side: DoubleSide,
    depthTest: false,
    depthWrite: false,
  });
  const lines = new LineSegments(flowGeo, flowMat);
  const shell = new Mesh(shellGeo, shellMat);
  for (const o of [lines, shell]) o.frustumCulled = false;
  shell.renderOrder = 0;
  lines.renderOrder = 1;
  const group = new Group();
  group.add(shell, lines);
  group.visible = false;
  let bytes = 0;
  const t = vec3();
  const cam = vec3();
  const zero = vec3();
  const q: Quatd = quat();
  const qi: Quatd = quat();
  const hi = rte.uCamHigh.value;
  const lo = rte.uCamLow.value;
  const phase = flowMat.uniforms.uPhase;

  const build = () => {
    const f = generateFlows(FLOW_LINES[preset]);
    flowGeo.setAttribute('position', new BufferAttribute(f.pos, 3));
    flowGeo.setAttribute('aFlow', new BufferAttribute(f.flow, 4));
    flowGeo.setIndex(new BufferAttribute(f.index, 1));
    const m = shellMesh(32, 64);
    shellGeo.setAttribute('position', new BufferAttribute(m.pos, 3));
    shellGeo.setIndex(new BufferAttribute(m.index, 1));
    shellGeo.computeVertexNormals();
    bytes =
      f.pos.byteLength + f.flow.byteLength + f.index.byteLength + m.pos.byteLength * 2 + m.index.byteLength;
  };

  return {
    id: 'largescale.flows',
    layer: 'overlay',
    object: group,
    update(view) {
      const toOrigin = view.toCamera(ROOT_FRAME, zero, t);
      const a = smooth(FADE_START, FADE_END, v3len(toOrigin) / MPC);
      group.visible = a > 0 && enabled();
      if (!group.visible) return;
      if (bytes === 0) build();
      view.frameQuat(ROOT_FRAME, q);
      group.quaternion.set(q.x, q.y, q.z, q.w);
      qrotate(cam, qset(qi, -q.x, -q.y, -q.z, q.w), toOrigin);
      cam.x = -cam.x / MPC;
      cam.y = -cam.y / MPC;
      cam.z = -cam.z / MPC;
      hi.set(Math.fround(cam.x), Math.fround(cam.y), Math.fround(cam.z));
      lo.set(cam.x - hi.x, cam.y - hi.y, cam.z - hi.z);
      fade.value = a;
      phase.value = (view.timeReal * DASH_RATE) % 1;
    },
    memoryBytes: () => bytes,
    dispose() {
      flowGeo.dispose();
      shellGeo.dispose();
      flowMat.dispose();
      shellMat.dispose();
    },
  };
}
