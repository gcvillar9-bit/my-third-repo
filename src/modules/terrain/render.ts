/**
 * Terrain Renderable for one body: one Mesh per selected leaf tile, all sharing one material built
 * from the body's SurfaceShading (same GLSL and uniform objects as the sphere provider).
 */
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Matrix3,
  Matrix4,
  Mesh,
  Quaternion,
  ShaderMaterial,
  Vector3,
  type IUniform,
} from 'three';
import {
  SURFACE_DETAIL_BANDS,
  SURFACE_DETAIL_BASE_M,
  SURFACE_INPUT_GLSL,
  SURFACE_NOISE_PERIOD,
  type Body,
  type RegistryReader,
  type Renderable,
  type SurfaceShading,
  type Vec3d,
  type ViewState,
} from '../../core/contracts';
import { qrotate, qrotateInv, quat, v3dot, v3len, v3scale, v3sub, vec3 } from '../../core/math64';
import { solarIlluminance, SUN_RGB } from '../../core/photometry';
import { R_SUN } from '../../core/units';
import {
  DEPTH_GLSL,
  NOISE_GLSL,
  SHADOWS_GLSL,
  createShadowUniforms,
  setShadowUniforms,
} from '../../render/chunks/index';
import terrainFrag from './glsl/terrain.frag.glsl?raw';
import terrainVert from './glsl/terrain.vert.glsl?raw';
import type { TerrainManager, Tile } from './manager';
import { patchIndex } from './patch';

export function terrainFragmentShader(shading: SurfaceShading): string {
  return [DEPTH_GLSL, SURFACE_INPUT_GLSL, SHADOWS_GLSL, NOISE_GLSL, shading.glsl, terrainFrag].join('\n');
}

export const terrainVertexShader = (): string => `${DEPTH_GLSL}\n${terrainVert}`;

/** Morph weight of the relief: 0 at the 3 R hand-off altitude, 1 below 2.5 R. */
export function morphAt(altitude: number, radius: number): number {
  return Math.min(1, Math.max(0, (3 * radius - altitude) / (0.5 * radius)));
}

/** frac(origin / λ_k / P)·P per detail band, computed in float64 (SURFACE_INPUT_GLSL contract). */
export function detailOrigins(origin: Vec3d, out: Vec3d[] = []): Vec3d[] {
  const P = SURFACE_NOISE_PERIOD;
  const f = (v: number, l: number) => {
    const x = v / l / P;
    return (x - Math.floor(x)) * P;
  };
  for (let k = 0; k < SURFACE_DETAIL_BANDS; k++) {
    const l = SURFACE_DETAIL_BASE_M * 10 ** -k;
    out[k] = vec3(f(origin.x, l), f(origin.y, l), f(origin.z, l));
  }
  return out;
}

export interface TerrainRenderDeps {
  registry: RegistryReader;
  exposure: IUniform<number>;
  manager: () => TerrainManager | undefined;
  fixedFrame: string;
}

function tileGeometry(t: Tile): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(t.positions, 3));
  g.setAttribute('normal', new BufferAttribute(t.normals, 3));
  g.setAttribute('aUpH', new BufferAttribute(t.upH, 4));
  g.setIndex(new BufferAttribute(patchIndex(), 1));
  return g;
}

export function buildTerrain(body: Body, shading: SurfaceShading, deps: TerrainRenderDeps): Renderable {
  const a = body.radius;
  const c = a * (1 - (body.oblateness ?? 0));
  const shadow = createShadowUniforms();
  const uniforms: Record<string, IUniform> = {
    ...shading.uniforms,
    ...shadow,
    uExposure: deps.exposure,
    uPixelAngle: { value: 1e-3 },
    uMorph: { value: 1 },
    uRadii: { value: new Vector3(a, a, c) },
    uBodyToWorld: { value: new Matrix3() },
    uSunPos: { value: new Vector3() },
    uSunIlluminance: { value: new Vector3() },
    uDetailOrigin: { value: Array.from({ length: SURFACE_DETAIL_BANDS }, () => new Vector3()) },
    uDetailStrength: { value: 1 },
  };
  const material = new ShaderMaterial({
    vertexShader: terrainVertexShader(),
    fragmentShader: terrainFragmentShader(shading),
    uniforms,
    defines: { ...(shading.defines ?? {}) },
    side: DoubleSide,
  });
  const group = new Group();
  group.name = `terrain.${body.id}`;
  const pool: Mesh[] = [];

  const qf = quat();
  const tq = new Quaternion();
  const m4 = new Matrix4();
  const o = vec3();
  const cam = vec3();
  const rel = vec3();
  const sunRel = vec3();
  const toSun = vec3();
  const zero = vec3();
  const origins: Vec3d[] = [];

  const occluders = (view: ViewState): { center: Vec3d; radius: number }[] => {
    const list: { center: Vec3d; radius: number; score: number }[] = [];
    const sunDist = v3len(v3sub(toSun, sunRel, o));
    if (sunDist <= 0) return list;
    v3scale(toSun, toSun, 1 / sunDist);
    const consider = (id: string, radius: number) => {
      const b = deps.registry.body(id);
      if (!b || b.id === body.id) return;
      const center = view.toCamera(b.frame, zero, vec3());
      const d = v3sub(vec3(), center, o);
      const t = v3dot(d, toSun);
      if (t <= 0 || t >= sunDist) return;
      const perp = v3len(v3sub(vec3(), d, v3scale(vec3(), toSun, t)));
      if (perp > a + radius + (t * R_SUN) / sunDist) return;
      list.push({ center, radius, score: radius / v3len(d) });
    };
    if (body.parent && body.parent !== 'sun') {
      const p = deps.registry.body(body.parent);
      if (p) consider(p.id, p.radius);
    }
    for (const p of deps.registry.occluderProviders()) {
      if (p.receivers !== '*' && !p.receivers.includes(body.id)) continue;
      for (const oc of p.occluders(view)) consider(oc.bodyId, oc.radius);
    }
    return list.sort((x, y) => y.score - x.score);
  };

  return {
    id: `terrain.${body.id}`,
    layer: 'opaque',
    object: group,
    update(view: ViewState) {
      const mgr = deps.manager();
      if (!mgr) {
        group.visible = false;
        return;
      }
      mgr.observe(view, deps.fixedFrame);
      view.toCamera(deps.fixedFrame, zero, o); // camera -> body centre, world axes
      view.frameQuat(deps.fixedFrame, qf);
      tq.set(qf.x, qf.y, qf.z, qf.w);
      qrotateInv(cam, qf, v3scale(cam, o, -1));
      (uniforms.uBodyToWorld.value as Matrix3).setFromMatrix4(m4.makeRotationFromQuaternion(tq));
      view.sunToCamera(sunRel);
      (uniforms.uSunPos.value as Vector3).set(sunRel.x, sunRel.y, sunRel.z);
      const E = body.id === 'sun' ? 0 : solarIlluminance(Math.max(v3len(v3sub(rel, sunRel, o)), 1e6));
      (uniforms.uSunIlluminance.value as Vector3).set(E * SUN_RGB[0], E * SUN_RGB[1], E * SUN_RGB[2]);
      uniforms.uPixelAngle.value = view.pixelAngle;
      uniforms.uMorph.value = morphAt(v3len(cam) - a, a);
      detailOrigins(cam, origins);
      const det = uniforms.uDetailOrigin.value as Vector3[];
      for (let k = 0; k < SURFACE_DETAIL_BANDS; k++) det[k].set(origins[k].x, origins[k].y, origins[k].z);
      setShadowUniforms(shadow, sunRel, R_SUN, occluders(view));

      const leaves = mgr.leaves;
      while (pool.length < leaves.length) {
        const m = new Mesh(undefined, material);
        m.frustumCulled = false;
        m.matrixWorldAutoUpdate = true;
        pool.push(m);
        group.add(m);
      }
      for (let i = 0; i < pool.length; i++) {
        const m = pool[i];
        const t = leaves[i];
        if (!t) {
          m.visible = false;
          continue;
        }
        if (!t.gpu) {
          const g = tileGeometry(t);
          t.gpu = { geometry: g, dispose: () => g.dispose() };
        }
        m.geometry = t.gpu.geometry as BufferGeometry;
        m.visible = true;
        // Camera-relative tile centre in float64: (body centre − camera) + R_fixed · centre.
        qrotate(rel, qf, { x: t.centre[0], y: t.centre[1], z: t.centre[2] });
        m.position.set(o.x + rel.x, o.y + rel.y, o.z + rel.z);
        m.quaternion.copy(tq);
      }
      group.visible = leaves.length > 0;
    },
    memoryBytes() {
      const mgr = deps.manager();
      let n = 0;
      if (mgr)
        for (const t of mgr.tiles.values()) if (t.gpu) n += t.positions.byteLength * 2 + t.upH.byteLength;
      return n;
    },
    dispose() {
      material.dispose();
      for (const m of pool) group.remove(m);
      pool.length = 0;
    },
  };
}
