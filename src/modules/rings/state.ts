/**
 * Shared per-planet ring state: the baked profile texture (half float, CPU mip chain so narrow
 * ringlets average by coverage) and the camera-relative ring frame, updated once per frame by the
 * rings module and read by the ring renderable and by the giants' globe shading (ring shadow).
 */
import {
  ClampToEdgeWrapping,
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGBAFormat,
  Vector2,
  Vector3,
  type IUniform,
  type Texture,
} from 'three';
import type { Body, ViewState } from '../../core/contracts';
import { qrotate, quat, v3len, v3sub, vec3 } from '../../core/math64';
import { solarIlluminance } from '../../core/photometry';
import { PROFILE_SIZE, bakeProfile, mipChain, ringSystem, type RingSystemSpec } from './model';

export interface RingShadowUniforms {
  uRingShadowProfile: IUniform<Texture>;
  uRingShadowCentre: IUniform<Vector3>;
  uRingShadowNormal: IUniform<Vector3>;
  uRingShadowRange: IUniform<Vector2>;
}

export interface RingState {
  spec: RingSystemSpec;
  texture: DataTexture;
  uniforms: RingShadowUniforms;
  /** Float64 camera-relative planet centre, Sun, illuminance (lux) and pixel angle of this frame. */
  rel: { x: number; y: number; z: number };
  sunRel: { x: number; y: number; z: number };
  illuminance: number;
  /** True once the image-based profile (if any) has been baked. */
  detailed: boolean;
}

const states = new Map<string, RingState>();

function toHalf(src: Float32Array): Uint16Array {
  const out = new Uint16Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = DataUtils.toHalfFloat(src[i]);
  return out;
}

/** Uploads a baked profile (level 0, linear RGBA floats) with its mip chain. */
export function uploadProfile(tex: DataTexture, level0: Float32Array): void {
  const chain = mipChain(level0).map((d) => ({ data: toHalf(d), width: d.length / 4, height: 1 }));
  tex.image = chain[0] as unknown as typeof tex.image;
  tex.mipmaps = chain as unknown as typeof tex.mipmaps;
  tex.needsUpdate = true;
}

/** Ring state of `body` (created on first use from rings.json with the model-only profile). */
export function ringState(body: string): RingState | undefined {
  let s = states.get(body);
  if (s) return s;
  const spec = ringSystem(body);
  if (!spec) return undefined;
  const texture = new DataTexture(null, PROFILE_SIZE, 1, RGBAFormat, HalfFloatType);
  texture.wrapS = texture.wrapT = ClampToEdgeWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = false;
  texture.name = `rings.profile.${body}`;
  uploadProfile(texture, bakeProfile(spec));
  s = {
    spec,
    texture,
    uniforms: {
      uRingShadowProfile: { value: texture },
      uRingShadowCentre: { value: new Vector3() },
      uRingShadowNormal: { value: new Vector3(0, 0, 1) },
      uRingShadowRange: { value: new Vector2(spec.inner * 1e3, spec.outer * 1e3) },
    },
    rel: vec3(),
    sunRel: vec3(),
    illuminance: 0,
    detailed: !spec.profile,
  };
  states.set(body, s);
  return s;
}

const q = quat();
const n = vec3();
const zero = vec3();
const Z = vec3(0, 0, 1);
const toSun = vec3();

/** Per-frame update of the camera-relative ring frame (equatorial plane of `<body>.fixed`). */
export function updateRingFrame(s: RingState, view: ViewState, body: Body): void {
  view.toCamera(body.frame, zero, s.rel);
  view.sunToCamera(s.sunRel);
  s.illuminance = solarIlluminance(Math.max(v3len(v3sub(toSun, s.sunRel, s.rel)), 1e6));
  view.frameQuat(body.fixedFrame ?? body.frame, q);
  qrotate(n, q, Z);
  s.uniforms.uRingShadowCentre.value.set(s.rel.x, s.rel.y, s.rel.z);
  s.uniforms.uRingShadowNormal.value.set(n.x, n.y, n.z);
}

/** Memory of the profile texture with its mips, bytes. */
export const PROFILE_BYTES = PROFILE_SIZE * 2 * 4 * 2;

export function disposeRingStates(): void {
  for (const s of states.values()) s.texture.dispose();
  states.clear();
}
