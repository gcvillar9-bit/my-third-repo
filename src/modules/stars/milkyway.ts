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
  LinearMipmapLinearFilter,
  Matrix3,
  Mesh,
  RepeatWrapping,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  Vector4,
  type IUniform,
  type Texture,
} from 'three';
import { SSB_FRAME, type Renderable, type Vec3d } from '../../core/contracts';
import { ICRS_TO_GALACTIC } from '../../core/frames';
import { v3len, vec3 } from '../../core/math64';
import { PC } from '../../core/units';
import shader from './milkyway.glsl?raw';

/**
 * Panorama luminance (cd/m²) for a texel value of 1. The upstream 8-bit panorama values are treated as linear
 * light; the shipped tiers store them sRGB-encoded (tools/build-stars.mjs), which the GPU decodes back to the
 * same linear values with finer steps in the dark sky. At 3e-3 the band measured only ~1.0e-4 cd/m² (~22.3 mag/arcsec²)
 * towards (l, b) = (8°, -2°), where the Sagittarius star clouds are 1-2e-3 and the milkyway
 * GalaxyModel gives ~7e-4; P5-B raised it 8x (3 stops) so the band reads at the night
 * auto-exposure and the 200-400 pc crossfade to the GalaxyModel sky cube is continuous.
 */
export const MILKY_WAY_LUMINANCE = 2.4e-2;
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

/** A soft hole in the panorama around an object another module draws itself (see setHole). */
export interface PanoramaHole {
  /** Sun-centred ICRS direction of the object's centre (any length). */
  dir: Vec3d;
  /** Radius (rad) inside which the panorama is fully replaced by its ring mean. */
  inner: number;
  /** Radius (rad) where the replacement has faded out. */
  outer: number;
  /** Radius (rad) of the ring of 8 taps from which the replacement is interpolated. */
  ring: number;
  /** 0..1 (0 = no hole). */
  strength: number;
}

/** Unit direction `d` and two unit vectors `a`, `b` spanning the tangent plane at it (right-handed). */
export function holeBasis(dir: Vec3d): { d: Vec3d; a: Vec3d; b: Vec3d } {
  const n = Math.hypot(dir.x, dir.y, dir.z) || 1;
  const d = { x: dir.x / n, y: dir.y / n, z: dir.z / n };
  const ref = Math.abs(d.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
  const ax = ref.y * d.z - ref.z * d.y;
  const ay = ref.z * d.x - ref.x * d.z;
  const az = ref.x * d.y - ref.y * d.x;
  const an = Math.hypot(ax, ay, az);
  const a = { x: ax / an, y: ay / an, z: az / an };
  const b = { x: d.y * a.z - d.z * a.y, y: d.z * a.x - d.x * a.z, z: d.x * a.y - d.y * a.x };
  return { d, a, b };
}

/** The 8 ring taps around `dir` at angular radius `ring` (position angles k·45° from `a` towards `b`), as uvs. */
export function ringUvs(dir: Vec3d, ring: number): { u: number; v: number }[] {
  const { d, a, b } = holeBasis(dir);
  const c = Math.cos(ring);
  const s = Math.sin(ring);
  const out: { u: number; v: number }[] = [];
  for (let k = 0; k < 8; k++) {
    const p = (k * Math.PI) / 4;
    const q = {
      x: c * d.x + s * (Math.cos(p) * a.x + Math.sin(p) * b.x),
      y: c * d.y + s * (Math.cos(p) * a.y + Math.sin(p) * b.y),
      z: c * d.z + s * (Math.cos(p) * a.z + Math.sin(p) * b.z),
    };
    const { u, v } = galacticUv(q);
    out.push({ u, v });
  }
  return out;
}

export interface MilkyWayLayer extends Renderable {
  gain: number;
  visible: boolean;
  /** Sets (or with strength 0 clears) the panorama hole. */
  setHole(hole: PanoramaHole | null): void;
}

export function createMilkyWay(map: Texture, exposure: IUniform<number>): MilkyWayLayer {
  map.wrapS = RepeatWrapping;
  map.wrapT = ClampToEdgeWrapping;
  // Mipmapped: trilinear when minified (small screens, wide fields), B-spline filtered when magnified
  // (telescope fields), so neither aliasing nor texel blocks show (milkyway.glsl).
  map.minFilter = LinearMipmapLinearFilter;
  map.magFilter = LinearFilter;
  map.generateMipmaps = true;
  map.needsUpdate = true;
  const img = map.image as { width?: number; height?: number } | undefined;
  const width = img?.width ?? 2048;
  const height = img?.height ?? 1024;
  const a = ICRS_TO_GALACTIC;
  const uniforms: Record<string, IUniform> = {
    uMap: { value: map },
    uMapSize: { value: new Vector2(width, height) },
    uIcrsToGal: { value: new Matrix3().set(a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[8]) },
    uLuminance: { value: MILKY_WAY_LUMINANCE },
    uExposure: exposure,
    uHole: { value: new Vector4(0, 0, 1, 0) },
    uHoleCos: { value: new Vector2(0, 1) },
    uRingUv: { value: Array.from({ length: 8 }, () => new Vector2()) },
    uRingLod: { value: 0 },
    uRingRadius: { value: 1 },
    uHoleA: { value: new Vector3(1, 0, 0) },
    uHoleB: { value: new Vector3(0, 1, 0) },
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
  const texBytes = Math.round(width * height * 4 * (4 / 3));
  const self: MilkyWayLayer = {
    id: 'stars.milkyway',
    layer: 'background',
    object: mesh,
    gain: 1,
    visible: true,
    setHole(hole) {
      const h = uniforms.uHole.value as Vector4;
      if (!hole || hole.strength <= 0) {
        h.w = 0;
        return;
      }
      const { d, a: ta, b: tb } = holeBasis(hole.dir);
      h.set(d.x, d.y, d.z, Math.min(1, hole.strength));
      (uniforms.uHoleA.value as Vector3).set(ta.x, ta.y, ta.z);
      (uniforms.uHoleB.value as Vector3).set(tb.x, tb.y, tb.z);
      (uniforms.uHoleCos.value as Vector2).set(Math.cos(hole.outer), Math.cos(hole.inner));
      uniforms.uRingRadius.value = hole.ring;
      const uvs = ringUvs(hole.dir, hole.ring);
      (uniforms.uRingUv.value as Vector2[]).forEach((v, k) => v.set(uvs[k].u, uvs[k].v));
      // Each tap averages a patch about a third of the ring radius across.
      uniforms.uRingLod.value = Math.max(0, Math.log2(((hole.ring / 3) * width) / (2 * Math.PI)));
    },
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
