/**
 * Galaxy renderable (P5-A): one Points draw for all catalogue galaxies and one instanced-quad draw for
 * their oriented impostors, both RTE in Mpc relative to the `universe` origin. The point fades out as the
 * impostor fades in (angular radius 1.5-3 px); galaxies brighter than V ~ 7 seen from the Sun are faded
 * near the Sun where the stars panorama already contains them (milkyway `skyWeight`).
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  Points,
  RGBAFormat,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector3,
  type IUniform,
} from 'three';
import { ROOT_FRAME, SSB_FRAME, type Quatd, type Renderable } from '../../core/contracts';
import { qrotate, qset, quat, vec3 } from '../../core/math64';
import { blackbodyRgb, LUX_MAG0 } from '../../core/photometry';
import { MPC } from '../../core/units';
import { createRteUniforms, RTE_GLSL } from '../../render/chunks';
import { skyWeight } from '../milkyway/public';
import type { GalaxyData } from './format';
import impostorShader from './impostors.glsl?raw';
import type { MorphAtlas } from './morph';
import pointShader from './points.glsl?raw';

/** Point → impostor crossfade, angular radius in pixels. */
export const IMPOSTOR_LO = 1.5;
export const IMPOSTOR_HI = 3.0;
/** Galaxies brighter than this (apparent, from the Sun) are in the stars panorama. */
export const PANO_MAG = 7.0;
/** Old- and young-population colours (luminance 1), approximate. */
export const WARM_TEFF = 4300;
export const COOL_TEFF = 8500;
/** Young-light fraction of each Hubble type code (point colour), approximate. */
export const YOUNG_FRACTION = [0, 0, 0, 0, 0, 0, 0, 0, 0.1, 0.3, 0.45, 0.65, 0.3, 0.45, 0.6, 0.85];

const DEFINES = `#define IMPOSTOR_LO ${IMPOSTOR_LO.toFixed(2)}\n#define IMPOSTOR_HI ${IMPOSTOR_HI.toFixed(2)}\n#define PANO_MAG ${PANO_MAG.toFixed(2)}\n`;

export interface GalaxyLayer extends Renderable {
  visible: boolean;
}

const v3 = (c: [number, number, number]) => new Vector3(c[0], c[1], c[2]);

export function createGalaxyLayer(data: GalaxyData, atlas: MorphAtlas): GalaxyLayer {
  const n = data.count;
  const rte = createRteUniforms();
  const shared: Record<string, IUniform> = {
    ...rte,
    uPixelAngle: { value: 1e-3 },
    uSunPos: { value: new Vector3() },
    uPanoFade: { value: 1 },
    uWarm: { value: v3(blackbodyRgb(WARM_TEFF)) },
    uCool: { value: v3(blackbodyRgb(COOL_TEFF)) },
  };

  // Points: one vertex per galaxy.
  const pg = new BufferGeometry();
  pg.setAttribute('position', new Float32BufferAttribute(data.pos, 3));
  pg.setAttribute('absMag', new Float32BufferAttribute(data.absMag, 1));
  pg.setAttribute('radius', new Float32BufferAttribute(data.radiusKpc, 1));
  pg.setAttribute('gtype', new BufferAttribute(new Float32Array(data.type), 1));
  const pointUniforms: Record<string, IUniform> = {
    ...shared,
    uScale: { value: 0 },
    uYoung: { value: YOUNG_FRACTION },
  };
  // cosmos:no-depth (background layer: galaxies are drawn as directions at infinity)
  const pointMat = new ShaderMaterial({
    vertexShader: `#define COSMOS_VERTEX\n${DEFINES}${RTE_GLSL}\n${pointShader}`,
    fragmentShader: `${DEFINES}${pointShader}`,
    uniforms: pointUniforms,
    blending: AdditiveBlending,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const points = new Points(pg, pointMat);
  points.frustumCulled = false;

  // Impostors: one instanced quad per galaxy, culled in the vertex shader.
  const ig = new InstancedBufferGeometry();
  ig.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  ig.setIndex([0, 1, 2, 0, 2, 3]);
  ig.setAttribute('iPos', new InstancedBufferAttribute(data.pos, 3));
  ig.setAttribute('iQuat', new InstancedBufferAttribute(data.quat, 4, true));
  ig.setAttribute('iRadius', new InstancedBufferAttribute(data.radiusKpc, 1));
  ig.setAttribute('iAbsMag', new InstancedBufferAttribute(data.absMag, 1));
  ig.setAttribute('iType', new InstancedBufferAttribute(new Float32Array(data.type), 1));
  ig.instanceCount = n;
  const tex = new DataTexture(atlas.data, atlas.width, atlas.height, RGBAFormat, UnsignedByteType);
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  const impUniforms: Record<string, IUniform> = {
    ...shared,
    uLumScale: { value: 0 },
    uSpriteGain: { value: atlas.gains },
    uAtlas: { value: tex },
    uTileSize: { value: new Vector2(atlas.size / atlas.width, atlas.size / atlas.height) },
  };
  // cosmos:no-depth (background layer: impostors are composited additively behind everything)
  const impMat = new ShaderMaterial({
    vertexShader: `#define COSMOS_VERTEX\n${DEFINES}${RTE_GLSL}\n${impostorShader}`,
    fragmentShader: `${DEFINES}${impostorShader}`,
    uniforms: impUniforms,
    side: DoubleSide,
    blending: AdditiveBlending,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const impostors = new Mesh(ig, impMat);
  impostors.frustumCulled = false;
  impostors.renderOrder = -10.4;

  const group = new Group();
  group.add(points, impostors);
  points.renderOrder = -10.5;

  const t = vec3();
  const cam = vec3();
  const zero = vec3();
  const q: Quatd = quat();
  const qi: Quatd = quat();
  const camHigh = rte.uCamHigh.value;
  const camLow = rte.uCamLow.value;
  const sunPos = shared.uSunPos.value as Vector3;
  const self: GalaxyLayer = {
    id: 'galaxies.catalogue',
    layer: 'background',
    object: group,
    visible: true,
    update(view) {
      group.visible = self.visible;
      if (!self.visible) return;
      view.frameQuat(ROOT_FRAME, q);
      group.quaternion.set(q.x, q.y, q.z, q.w);
      // Camera → universe origin in world axes; rotate into universe axes and flip: camera position, Mpc.
      qset(qi, -q.x, -q.y, -q.z, q.w);
      view.toCamera(ROOT_FRAME, zero, t);
      qrotate(cam, qi, t);
      cam.x = -cam.x / MPC;
      cam.y = -cam.y / MPC;
      cam.z = -cam.z / MPC;
      // RTE high/low split without allocations (same as splitDouble).
      camHigh.set(Math.fround(cam.x), Math.fround(cam.y), Math.fround(cam.z));
      camLow.set(cam.x - camHigh.x, cam.y - camHigh.y, cam.z - camHigh.z);
      // Sun (ssb origin) position in universe axes, Mpc.
      view.toCamera(SSB_FRAME, zero, t);
      qrotate(t, qi, t);
      sunPos.set(cam.x + t.x / MPC, cam.y + t.y / MPC, cam.z + t.z / MPC);
      const dSun = Math.hypot(t.x, t.y, t.z);
      shared.uPanoFade.value = skyWeight(dSun);
      shared.uPixelAngle.value = view.pixelAngle;
      pointUniforms.uScale.value = (LUX_MAG0 * view.exposure) / (view.pixelAngle * view.pixelAngle);
      impUniforms.uLumScale.value = LUX_MAG0 * view.exposure;
    },
    memoryBytes: () =>
      2 * (data.pos.byteLength + data.radiusKpc.byteLength + data.absMag.byteLength + 4 * n) +
      data.quat.byteLength +
      Math.round((atlas.data.byteLength * 4) / 3),
    dispose() {
      pg.dispose();
      ig.dispose();
      pointMat.dispose();
      impMat.dispose();
      tex.dispose();
    },
  };
  return self;
}
