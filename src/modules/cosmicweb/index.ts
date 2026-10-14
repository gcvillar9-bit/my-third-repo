/**
 * cosmicweb (P5-A): a cheap procedural large-scale structure (generate.ts) beyond the galaxy catalogue's
 * completeness, as one RTE Points draw that fades in with the camera's distance from the Milky Way.
 * Generated lazily the first time it becomes visible. Bookmark 'cosmic-web-500mpc'; search and info
 * entry 'cosmicweb' (labelled simulated).
 */
import {
  AdditiveBlending,
  BufferGeometry,
  Float32BufferAttribute,
  Points,
  ShaderMaterial,
  Vector3,
  type IUniform,
} from 'three';
import {
  ROOT_FRAME,
  type Bookmark,
  type InfoCard,
  type Quatd,
  type Renderable,
  type UniverseModule,
} from '../../core/contracts';
import { qlookRotation, qrotate, qset, quat, v3len, vec3 } from '../../core/math64';
import { blackbodyRgb, LUX_MAG0 } from '../../core/photometry';
import { MPC } from '../../core/units';
import { createRteUniforms, RTE_GLSL } from '../../render/chunks';
import { generateWeb, tracerAbsMag, WEB_COUNT, WEB_NODES, WEB_RADIUS_MPC } from './generate';
import shader from './web.glsl?raw';

/** Tracers fade in between these distances from the Milky Way (catalogue completeness), Mpc. */
export const INNER_START = 60;
export const INNER_END = 140;
/** The layer fades in as the camera leaves the Local Volume (camera distance from the MW), Mpc. */
export const FADE_START = 20;
export const FADE_END = 120;
export const WEB_TEFF = 7000;
export const WEB_EV = -16.5;
export const WEB_ID = 'cosmicweb';
const DEG = Math.PI / 180;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function cosmicWebBookmark(): Bookmark {
  const pos = vec3(500 * MPC * 0.6, 500 * MPC * 0.48, 500 * MPC * 0.64);
  const d = v3len(pos);
  return {
    id: 'cosmic-web-500mpc',
    title: 'The cosmic web from 500 Mpc (simulated)',
    frame: ROOT_FRAME,
    pos,
    quat: qlookRotation(quat(), vec3(-pos.x / d, -pos.y / d, -pos.z / d), vec3(0, 0, 1)),
    fovY: 60 * DEG,
    ev: WEB_EV,
    lookTarget:
      'Looking back towards the Milky Way from 500 Mpc: a faint bluish-white web of clustered points, knots joined by filaments around dark voids (procedural, labelled simulated).',
  };
}

export function createWebLayer(count: number): Renderable {
  const geometry = new BufferGeometry();
  const rte = createRteUniforms();
  const c = blackbodyRgb(WEB_TEFF);
  const uniforms: Record<string, IUniform> = {
    ...rte,
    uScale: { value: 0 },
    uAbsMag: { value: tracerAbsMag(count) },
    uFade: { value: 0 },
    uColor: { value: new Vector3(c[0], c[1], c[2]) },
  };
  const defines = `#define INNER_START ${INNER_START.toFixed(1)}\n#define INNER_END ${INNER_END.toFixed(1)}\n`;
  // cosmos:no-depth (background layer: tracers are drawn as directions at infinity)
  const material = new ShaderMaterial({
    vertexShader: `#define COSMOS_VERTEX\n${defines}${RTE_GLSL}\n${shader}`,
    fragmentShader: shader,
    uniforms,
    blending: AdditiveBlending,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = -11;
  points.visible = false;
  let bytes = 0;
  const t = vec3();
  const cam = vec3();
  const zero = vec3();
  const q: Quatd = quat();
  const qi: Quatd = quat();
  const hi = rte.uCamHigh.value;
  const lo = rte.uCamLow.value;
  return {
    id: 'cosmicweb.points',
    layer: 'background',
    object: points,
    update(view) {
      const toOrigin = view.toCamera(ROOT_FRAME, zero, t);
      const fade = smooth(FADE_START, FADE_END, v3len(toOrigin) / MPC);
      points.visible = fade > 0 && enabled;
      if (!points.visible) return;
      if (bytes === 0) {
        const web = generateWeb(count);
        geometry.setAttribute('position', new Float32BufferAttribute(web.pos, 3));
        bytes = web.pos.byteLength;
      }
      view.frameQuat(ROOT_FRAME, q);
      points.quaternion.set(q.x, q.y, q.z, q.w);
      qrotate(cam, qset(qi, -q.x, -q.y, -q.z, q.w), toOrigin);
      cam.x = -cam.x / MPC;
      cam.y = -cam.y / MPC;
      cam.z = -cam.z / MPC;
      hi.set(Math.fround(cam.x), Math.fround(cam.y), Math.fround(cam.z));
      lo.set(cam.x - hi.x, cam.y - hi.y, cam.z - hi.z);
      uniforms.uFade.value = fade;
      uniforms.uScale.value = (LUX_MAG0 * view.exposure) / (view.pixelAngle * view.pixelAngle);
    },
    memoryBytes: () => bytes,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

let enabled = true;

export function webInfo(count: number): InfoCard {
  return {
    title: 'Cosmic web (simulated)',
    subtitle: 'Procedural large-scale structure',
    facts: [
      { label: 'Tracer points', value: count },
      { label: 'Cluster nodes', value: WEB_NODES },
      { label: 'Region radius', value: WEB_RADIUS_MPC, unit: 'Mpc', approximate: true },
      { label: 'Fades in beyond', value: INNER_START, unit: 'Mpc', approximate: true },
      {
        label: 'Tracer absolute magnitude',
        value: Number(tracerAbsMag(count).toFixed(2)),
        approximate: true,
      },
    ],
    description:
      'Beyond about 100 Mpc the galaxy catalogue thins out. This web of clusters, filaments and voids is a statistical illustration (filament-seeded clustered points), not a map of the real sky.',
    simulated: true,
    credit: 'Procedural (deterministic seed); not real galaxy positions.',
  };
}

const cosmicwebModule: UniverseModule = {
  id: 'cosmicweb',
  init(ctx) {
    const { registry, quality } = ctx;
    const count = WEB_COUNT[quality.preset];
    const bookmark = cosmicWebBookmark();
    registry.addRenderable(createWebLayer(count));
    registry.addBookmarks([bookmark]);
    registry.addSearch({
      id: 'cosmicweb',
      entries: () => [
        {
          id: WEB_ID,
          name: 'Cosmic web (simulated)',
          aliases: ['Large-scale structure', 'Filaments', 'Voids'],
          subtitle: 'Procedural large-scale structure',
          kind: 'other',
          target: bookmark,
        },
      ],
    });
    registry.addInfo({ id: 'cosmicweb', info: (id) => (id === WEB_ID ? webInfo(count) : null) });
    registry.addSetting({
      id: 'cosmicweb.enabled',
      label: 'Cosmic web (simulated)',
      group: 'Sky',
      type: 'boolean',
      default: true,
      onChange: (v) => void (enabled = v === true),
    });
  },
};

export default cosmicwebModule;
