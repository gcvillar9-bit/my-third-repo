/**
 * Spacecraft rendering (its own chunk, loaded after boot): 'spacecraft.models' draws the low-poly
 * craft when they span more than a pixel, 'spacecraft.overlay' the finder markers, the orbit rings
 * of the low-orbit craft, Webb's halo and the probes' paths. Everything is camera-relative: mesh
 * positions come from view.toCamera, line vertices are evaluated in float64 and only then written
 * to Float32. Markers and lines are finder aids in display-referred colour, not light.
 */
import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Group,
  LineSegments,
  Mesh,
  Points,
  ShaderMaterial,
  Vector3,
  type IUniform,
} from 'three';
import type { Quatd, Renderable, Vec3d, ViewState } from '../../core/contracts';
import { qrotateInv, quat, v3cross, v3dot, v3len, v3normalize, v3sub, vec3 } from '../../core/math64';
import { SUN_RGB, solarIlluminance } from '../../core/photometry';
import { R_SUN } from '../../core/units';
import { createShadowUniforms, DEPTH_GLSL, setShadowUniforms, SHADOWS_GLSL } from '../../render/chunks/index';
import { FILL_LIGHT } from './bookmarks';
import type { ModelId } from './data';
import { contextBody, craftView, markerFade, type Craft, type CraftView } from './fleet';
import craftFrag from './glsl/craft.frag.glsl?raw';
import craftVert from './glsl/craft.vert.glsl?raw';
import overlayGlsl from './glsl/overlay.glsl?raw';
import { MODEL_BUILDERS, type MeshData } from './models/index';
import { HaloMotion, LeoMotion, ProbeMotion } from './trajectory';

/** Models smaller than this many pixels are left to their marker. */
export const MODEL_MIN_PX = 0.7;
/** Earth's Bond albedo: the share of sunlight the planet below sends back up to a low orbit. */
const EARTH_ALBEDO = 0.3;
const EARTH_TINT: readonly [number, number, number] = [0.86, 0.93, 1];
const RING_SEGMENTS = 128;
const HALO_SEGMENTS = 96;
const COAST_SAMPLES = 48;
/** Display-referred colour of markers and trajectories (planet orbits are blue, dwarfs brown). */
const OVERLAY_RGB: readonly [number, number, number] = [0.45, 0.86, 0.8];

export interface RenderDeps {
  fleet: readonly Craft[];
  exposure: IUniform<number>;
  /** Radius of the body that eclipses the low-orbit craft, m. */
  earthRadius: number;
  hasFrame(id: string): boolean;
  enabled(): boolean;
  trajectories(): boolean;
}

const ZERO: Readonly<Vec3d> = Object.freeze(vec3());
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function geometryOf(mesh: MeshData): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(mesh.position, 3));
  g.setAttribute('aNormal', new BufferAttribute(mesh.normal, 4, true));
  g.setAttribute('aColor', new BufferAttribute(mesh.color, 4, true));
  return g;
}

const meshBytes = (m: MeshData): number => m.position.byteLength + m.normal.byteLength + m.color.byteLength;

interface Drawn {
  craft: Craft;
  group: Group;
  material: ShaderMaterial;
  uniforms: Record<string, IUniform>;
  tracked: Mesh[];
  view: CraftView;
}

/** The craft themselves. Geometry is built once per model id and shared (the two Voyagers, the two Pioneers). */
export function createModels(deps: RenderDeps): Renderable {
  const root = new Group();
  root.name = 'spacecraft.models';
  const geometries = new Map<ModelId, { geometry: BufferGeometry; bytes: number }[]>();
  const built = new Map<ModelId, ReturnType<(typeof MODEL_BUILDERS)[ModelId]>>();
  let bytes = 0;
  const drawn: Drawn[] = deps.fleet.map((craft) => {
    const id = craft.row.model;
    if (!built.has(id)) {
      const model = MODEL_BUILDERS[id]();
      built.set(id, model);
      geometries.set(
        id,
        model.parts.map((p) => ({ geometry: geometryOf(p.mesh), bytes: meshBytes(p.mesh) })),
      );
      for (const p of model.parts) bytes += meshBytes(p.mesh);
    }
    const uniforms: Record<string, IUniform> = {
      uExposure: deps.exposure,
      uSunDir: { value: new Vector3(0, 0, 1) },
      uSunLux: { value: new Vector3() },
      uPlanetDir: { value: new Vector3(0, 0, -1) },
      uPlanetLux: { value: new Vector3() },
      uFill: { value: FILL_LIGHT },
      ...createShadowUniforms(),
    };
    const material = new ShaderMaterial({
      vertexShader: `${DEPTH_GLSL}\n${craftVert}`,
      fragmentShader: `${DEPTH_GLSL}\n${SHADOWS_GLSL}\n${craftFrag}`,
      uniforms,
    });
    const group = new Group();
    group.name = `spacecraft.model.${craft.row.id}`;
    group.visible = false;
    const tracked: Mesh[] = [];
    const model = built.get(id)!;
    model.parts.forEach((part, k) => {
      const mesh = new Mesh(geometries.get(id)![k].geometry, material);
      mesh.position.set(part.pivot[0], part.pivot[1], part.pivot[2]);
      mesh.frustumCulled = false;
      if (part.track === 'sun-y') tracked.push(mesh);
      group.add(mesh);
    });
    root.add(group);
    return {
      craft,
      group,
      material,
      uniforms,
      tracked,
      view: { rel: vec3(), dist: 0, pxDiam: 0, weight: 0 },
    };
  });

  const sunRel = vec3();
  const earthRel = vec3();
  const toSun = vec3();
  const toEarth = vec3();
  const sunBody = vec3();
  const q: Quatd = quat();
  return {
    id: 'spacecraft.models',
    layer: 'opaque',
    object: root,
    update(view: ViewState) {
      root.visible = deps.enabled();
      if (!root.visible) return;
      view.sunToCamera(sunRel);
      const earth = deps.hasFrame('earth');
      if (earth) view.toCamera('earth', ZERO, earthRel);
      for (const d of drawn) {
        const { craft, group, uniforms } = d;
        if (!craft.active) {
          group.visible = false;
          continue;
        }
        const cv = craftView(craft, view, sunRel, d.view);
        group.visible = cv.pxDiam >= MODEL_MIN_PX;
        if (!group.visible) continue;
        group.position.set(cv.rel.x, cv.rel.y, cv.rel.z);
        view.frameQuat(craft.fixedFrame.id, q);
        group.quaternion.set(q.x, q.y, q.z, q.w);
        v3sub(toSun, sunRel, cv.rel);
        const rSun = v3len(toSun);
        v3normalize(toSun, toSun);
        const lux = solarIlluminance(Math.max(rSun, 1e6));
        (uniforms.uSunDir.value as Vector3).set(toSun.x, toSun.y, toSun.z);
        (uniforms.uSunLux.value as Vector3).set(lux * SUN_RGB[0], lux * SUN_RGB[1], lux * SUN_RGB[2]);
        const planetLux = uniforms.uPlanetLux.value as Vector3;
        if (craft.row.kind === 'leo' && earth) {
          v3sub(toEarth, earthRel, cv.rel);
          const r = v3len(toEarth);
          v3normalize(toEarth, toEarth);
          (uniforms.uPlanetDir.value as Vector3).set(toEarth.x, toEarth.y, toEarth.z);
          // Sunlit ground straight below, seen under the solid angle of the planet.
          const day = Math.max(0, -v3dot(toEarth, toSun));
          const e = lux * EARTH_ALBEDO * (deps.earthRadius / r) ** 2 * day;
          planetLux.set(e * EARTH_TINT[0], e * EARTH_TINT[1], e * EARTH_TINT[2]);
          setShadowUniforms(uniforms as ReturnType<typeof createShadowUniforms>, sunRel, R_SUN, [
            { center: earthRel, radius: deps.earthRadius },
          ]);
        } else {
          planetLux.set(0, 0, 0);
          setShadowUniforms(uniforms as ReturnType<typeof createShadowUniforms>, sunRel, R_SUN, []);
        }
        if (d.tracked.length) {
          // Alpha joint: the array wings turn about the truss (body y) so their cells (-z at rest) face the Sun.
          qrotateInv(sunBody, q, toSun);
          const alpha = Math.atan2(-sunBody.x, -sunBody.z);
          for (const m of d.tracked) m.rotation.y = alpha;
        }
      }
    },
    memoryBytes: () => bytes,
    dispose() {
      for (const list of geometries.values()) for (const g of list) g.geometry.dispose();
      for (const d of drawn) d.material.dispose();
    },
  };
}

/** Markers, orbit rings, Webb's halo and probe paths. */
export function createOverlay(deps: RenderDeps): Renderable {
  const group = new Group();
  group.name = 'spacecraft.overlay';
  const [vs, fs] = overlayGlsl.split(/^\/\/#fragment$/m);
  const material = (point: boolean, opacity: number, size: IUniform<number>) =>
    new ShaderMaterial({
      vertexShader: `${DEPTH_GLSL}\n${vs}`,
      fragmentShader: `${DEPTH_GLSL}\n${fs}`,
      uniforms: {
        uColor: { value: new Vector3(...OVERLAY_RGB) },
        uOpacity: { value: opacity },
        uPoint: { value: point ? 1 : 0 },
        uPointSize: size,
      },
      transparent: true,
      depthWrite: false,
    });
  const pointSize = { value: 11 };

  const n = deps.fleet.length;
  const mPos = new Float32Array(3 * n);
  const mAlpha = new Float32Array(n);
  const mGeo = new BufferGeometry();
  const mPosAttr = new BufferAttribute(mPos, 3).setUsage(DynamicDrawUsage);
  const mAlphaAttr = new BufferAttribute(mAlpha, 1).setUsage(DynamicDrawUsage);
  mGeo.setAttribute('position', mPosAttr);
  mGeo.setAttribute('aAlpha', mAlphaAttr);
  const markers = new Points(mGeo, material(true, 0.95, pointSize));

  // Line capacity: per probe every leg (33 points) plus the coast, per LEO craft a ring, the halo.
  let capacity = 0;
  for (const c of deps.fleet) {
    if (c.motion instanceof ProbeMotion)
      capacity += 2 * (33 * (c.motion.nodes.length - 1) + COAST_SAMPLES + 2);
    else if (c.motion instanceof LeoMotion) capacity += 2 * RING_SEGMENTS;
    else capacity += 2 * HALO_SEGMENTS;
  }
  const lPos = new Float32Array(3 * capacity);
  const lAlpha = new Float32Array(capacity);
  const lGeo = new BufferGeometry();
  const lPosAttr = new BufferAttribute(lPos, 3).setUsage(DynamicDrawUsage);
  const lAlphaAttr = new BufferAttribute(lAlpha, 1).setUsage(DynamicDrawUsage);
  lGeo.setAttribute('position', lPosAttr);
  lGeo.setAttribute('aAlpha', lAlphaAttr);
  const lines = new LineSegments(lGeo, material(false, 0.6, pointSize));
  for (const o of [markers, lines]) {
    o.frustumCulled = false;
    group.add(o);
  }

  /** Cached heliocentric path of each probe (rebuilt when the date has moved enough to matter). */
  const paths = new Map<string, { jd: number; pts: number[]; count: number }>();
  const pathOf = (motion: ProbeMotion, id: string, jd: number) => {
    let c = paths.get(id);
    const tol = Math.max(1e-3, 2e-4 * Math.abs(jd - motion.launchJd));
    if (!c || Math.abs(jd - c.jd) > tol) {
      const pts: number[] = [];
      c = { jd, pts, count: motion.samplePath(jd, COAST_SAMPLES, pts) };
      paths.set(id, c);
    }
    return c;
  };

  const sunRel = vec3();
  const earthRel = vec3();
  const cv: CraftView = { rel: vec3(), dist: 0, pxDiam: 0, weight: 0 };
  const r0 = vec3();
  const nrm = vec3();
  const side = vec3();
  const scratch: number[] = [];
  let used = 0;
  /** Appends the segment a-b (camera-relative, m) with the two alphas. */
  const segment = (
    ax: number,
    ay: number,
    az: number,
    aa: number,
    bx: number,
    by: number,
    bz: number,
    ba: number,
  ) => {
    if (used + 2 > capacity) return;
    lPos.set([ax, ay, az, bx, by, bz], 3 * used);
    lAlpha[used] = aa;
    lAlpha[used + 1] = ba;
    used += 2;
  };
  /** Draws a polyline (xyz triples relative to `base`), closing it when `closed`. */
  const polyline = (
    pts: number[],
    count: number,
    base: Vec3d,
    closed: boolean,
    weight: number,
    near0: number,
    near1: number,
    age: boolean,
  ) => {
    const alphaAt = (k: number, x: number, y: number, z: number): number => {
      const fade = smooth(near0, near1, Math.hypot(x, y, z));
      return weight * fade * (age ? 0.35 + 0.65 * (k / Math.max(1, count - 1)) : 1);
    };
    const total = closed ? count : count - 1;
    for (let k = 0; k < total; k++) {
      const j = (k + 1) % count;
      const ax = pts[3 * k] + base.x;
      const ay = pts[3 * k + 1] + base.y;
      const az = pts[3 * k + 2] + base.z;
      const bx = pts[3 * j] + base.x;
      const by = pts[3 * j + 1] + base.y;
      const bz = pts[3 * j + 2] + base.z;
      segment(ax, ay, az, alphaAt(k, ax, ay, az), bx, by, bz, alphaAt(j, bx, by, bz));
    }
  };

  return {
    id: 'spacecraft.overlay',
    layer: 'transparent',
    object: group,
    update(view: ViewState) {
      group.visible = deps.enabled();
      if (!group.visible) return;
      pointSize.value = Math.min(15, Math.max(9, view.viewport[1] / 60));
      view.sunToCamera(sunRel);
      const earth = deps.hasFrame('earth');
      if (earth) view.toCamera('earth', ZERO, earthRel);
      const drawLines = deps.trajectories();
      used = 0;
      deps.fleet.forEach((craft, i) => {
        mAlpha[i] = 0;
        if (!craft.active) return;
        const centre = contextBody(craft.row) === 'earth' && earth ? earthRel : sunRel;
        craftView(craft, view, centre, cv);
        mPos.set([cv.rel.x, cv.rel.y, cv.rel.z], 3 * i);
        mAlpha[i] = cv.weight * markerFade(cv.pxDiam);
        if (!drawLines || cv.weight < 0.01) return;
        const { motion, row } = craft;
        const near0 = 30 * row.radiusM;
        const near1 = 300 * row.radiusM;
        scratch.length = 0;
        if (motion instanceof LeoMotion) {
          // The orbit as it stands now: a circle through the craft in the precessing plane.
          motion.position(view.jd, r0);
          v3cross(side, motion.normal(view.jd, nrm), r0);
          for (let k = 0; k < RING_SEGMENTS; k++) {
            // Ten times finer steps next to the craft, where the line fades in, than on the far side.
            const u = (2 * Math.PI * k) / RING_SEGMENTS;
            const a = u - 0.9 * Math.sin(u);
            const c = Math.cos(a);
            const s = Math.sin(a);
            scratch.push(c * r0.x + s * side.x, c * r0.y + s * side.y, c * r0.z + s * side.z);
          }
          polyline(scratch, RING_SEGMENTS, earthRel, true, cv.weight, near0, near1, false);
        } else if (motion instanceof HaloMotion) {
          if (view.jd < motion.settledJd) return;
          motion.ring(view.jd, HALO_SEGMENTS, scratch);
          polyline(scratch, HALO_SEGMENTS, sunRel, true, cv.weight, near0, near1, false);
        } else if (motion instanceof ProbeMotion) {
          const path = pathOf(motion, row.id, view.jd);
          if (path.count < 2) return;
          // The cached path ends where the craft was when it was built: pin its end to the craft now.
          const last = 3 * (path.count - 1);
          path.pts[last] = cv.rel.x - sunRel.x;
          path.pts[last + 1] = cv.rel.y - sunRel.y;
          path.pts[last + 2] = cv.rel.z - sunRel.z;
          polyline(path.pts, path.count, sunRel, false, cv.weight, near0, near1, true);
        }
      });
      mPosAttr.needsUpdate = true;
      mAlphaAttr.needsUpdate = true;
      lGeo.setDrawRange(0, used);
      lines.visible = used > 0;
      if (used > 0) {
        lPosAttr.needsUpdate = true;
        lAlphaAttr.needsUpdate = true;
      }
    },
    memoryBytes: () => mPos.byteLength + mAlpha.byteLength + lPos.byteLength + lAlpha.byteLength,
    dispose() {
      for (const o of [markers, lines]) {
        o.geometry.dispose();
        (o.material as ShaderMaterial).dispose();
      }
    },
  };
}
