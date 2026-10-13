/**
 * Milky Way diffuse panorama (galactic equirectangular, point stars removed) as a background
 * sphere. Oriented with the IAU ICRS → galactic rotation and faded out between 200 and 400 pc
 * from the Sun, where the panorama stops being a valid view of the Galaxy.
 */
import {
  AdditiveBlending,
  BackSide,
  ClampToEdgeWrapping,
  LinearFilter,
  Matrix3,
  Mesh,
  RepeatWrapping,
  ShaderMaterial,
  SphereGeometry,
  type IUniform,
  type Texture,
} from 'three';
import { SSB_FRAME, type Renderable, type Vec3d } from '../../core/contracts';
import { ICRS_TO_GALACTIC } from '../../core/frames';
import { v3len, vec3 } from '../../core/math64';
import { PC } from '../../core/units';
import shader from './milkyway.glsl?raw';

/**
 * Panorama luminance (cd/m²) for a texel value of 1. The 8-bit panorama is sampled as linear
 * data (not sRGB-decoded): its values then track surface brightness, giving about 19.5
 * mag/arcsec² towards the galactic centre (texel 0.6) and about 22 in the Cygnus band (0.04).
 */
export const MILKY_WAY_LUMINANCE = 3e-3;
/** Fade distances from the Sun, m. */
export const FADE_START = 200 * PC;
export const FADE_END = 400 * PC;

/** Fade factor (1 near the Sun, 0 beyond FADE_END). */
export function milkyWayFade(distFromSun: number): number {
  const t = Math.min(1, Math.max(0, (distFromSun - FADE_START) / (FADE_END - FADE_START)));
  return 1 - t * t * (3 - 2 * t);
}

/**
 * CPU twin of the shader mapping: ICRS direction → texture uv (three.js convention, uv.y = 1 is
 * the top row of the image). Also returns galactic l, b in radians.
 */
export function galacticUv(d: Vec3d): { u: number; v: number; l: number; b: number } {
  const a = ICRS_TO_GALACTIC;
  const n = Math.hypot(d.x, d.y, d.z) || 1;
  const gx = (a[0] * d.x + a[1] * d.y + a[2] * d.z) / n;
  const gy = (a[3] * d.x + a[4] * d.y + a[5] * d.z) / n;
  const gz = (a[6] * d.x + a[7] * d.y + a[8] * d.z) / n;
  const l = Math.atan2(gy, gx);
  const b = Math.asin(Math.max(-1, Math.min(1, gz)));
  const u = 0.5 - l / (2 * Math.PI);
  return { u: u - Math.floor(u), v: 0.5 + b / Math.PI, l, b };
}

export interface MilkyWayLayer extends Renderable {
  gain: number;
  visible: boolean;
}

export function createMilkyWay(map: Texture, exposure: IUniform<number>): MilkyWayLayer {
  map.wrapS = RepeatWrapping;
  map.wrapT = ClampToEdgeWrapping;
  map.minFilter = LinearFilter;
  map.magFilter = LinearFilter;
  map.generateMipmaps = false;
  map.needsUpdate = true;
  const a = ICRS_TO_GALACTIC;
  const uniforms: Record<string, IUniform> = {
    uMap: { value: map },
    uIcrsToGal: { value: new Matrix3().set(a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[8]) },
    uLuminance: { value: MILKY_WAY_LUMINANCE },
    uExposure: exposure,
  };
  const geometry = new SphereGeometry(1, 48, 24);
  // cosmos:no-depth (background layer: the panorama is at infinity and drawn without depth)
  const material = new ShaderMaterial({
    vertexShader: `#define COSMOS_VERTEX\n${shader}`,
    fragmentShader: shader,
    uniforms,
    side: BackSide,
    blending: AdditiveBlending,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  const toSun = vec3();
  const img = map.image as { width?: number; height?: number } | undefined;
  const texBytes = Math.round((img?.width ?? 2048) * (img?.height ?? 1024) * 4);
  const self: MilkyWayLayer = {
    id: 'stars.milkyway',
    layer: 'background',
    object: mesh,
    gain: 1,
    visible: true,
    update(view) {
      const fade = milkyWayFade(v3len(view.toCamera(SSB_FRAME, vec3(), toSun)));
      mesh.visible = self.visible && fade > 0;
      uniforms.uLuminance.value = MILKY_WAY_LUMINANCE * fade * self.gain;
    },
    memoryBytes: () => texBytes + geometry.getAttribute('position').count * 32,
    dispose() {
      geometry.dispose();
      material.dispose();
      map.dispose();
    },
  };
  return self;
}
