/**
 * Guide renderables of the atlas: markers (one Points draw), lines (one LineSegments draw) and
 * shells (one instanced draw for spheres and ellipsoids, one mesh for the Local Bubble surface).
 * All sit in the background layer, additive, behind every body. Styling comes from looks.json.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LineSegments,
  Mesh,
  Points,
  ShaderMaterial,
  Vector3,
  type IUniform,
  type Object3D,
} from 'three';
import { MW_FRAME, SSB_FRAME, type Quatd, type Renderable, type ViewState } from '../../../core/contracts';
import { ICRS_TO_GALACTIC } from '../../../core/frames';
import { quat, v3len, vec3 } from '../../../core/math64';
import { PC } from '../../../core/units';
import { createRteUniforms, RTE_GLSL, setRteCamera, type RteUniforms } from '../../../render/chunks';
import { cameraModel } from '../galaxy';
import { guideAlpha, type AtlasState } from '../guides';
import type { Atlas } from './catalog';
import { modelToIcrsPc, spiralPoints } from './geometry';
import shader from './guides.glsl?raw';
import { GROUPS, MARKER_CODES, styleOf } from './style';
import type { AtlasObject } from './types';

const DEG = Math.PI / 180;
/** Lines in the Galactic plane fade out between these sines of the camera's elevation above it. */
export const PLANE_FADE = [0.08, 0.3];
const groupIndex = (id: string): number =>
  Math.max(
    0,
    GROUPS.findIndex((g) => g.id === id),
  );

interface GuideUniforms extends RteUniforms {
  uGuide: IUniform<number>;
  uGroup: IUniform<number[]>;
  uPixelAngle: IUniform<number>;
  uPlaneFade: IUniform<number>;
}

function guideMaterial(variant: string, extra = ''): { material: ShaderMaterial; uniforms: GuideUniforms } {
  const uniforms: GuideUniforms = {
    ...createRteUniforms(),
    uGuide: { value: 0 },
    uGroup: { value: new Array<number>(8).fill(1) },
    uPixelAngle: { value: 1e-3 },
    uPlaneFade: { value: 1 },
  };
  const head = `#define ${variant}\n${extra}`;
  // cosmos:no-depth (background layer: guides are drawn as directions behind every body)
  const material = new ShaderMaterial({
    vertexShader: `#define COSMOS_VERTEX\n${head}${RTE_GLSL}\n${shader}`,
    fragmentShader: `${head}${shader}`,
    uniforms,
    blending: AdditiveBlending,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: DoubleSide,
  });
  return { material, uniforms };
}

/** Shared per-frame update of a guide object: camera, orientation, opacity and group switches. */
function guideRenderable(
  id: string,
  object: Object3D,
  uniforms: GuideUniforms,
  state: AtlasState,
  bytes: number,
  dispose: () => void,
): Renderable {
  object.frustumCulled = false;
  object.renderOrder = -7;
  const cam = vec3();
  const camPc = vec3();
  const zero = vec3();
  const tmp = vec3();
  const q: Quatd = quat();
  return {
    id,
    layer: 'background',
    object,
    update(view: ViewState) {
      const t = view.toCamera(SSB_FRAME, zero, cam);
      const alpha = guideAlpha(state, v3len(t), v3len(view.toCamera(MW_FRAME, zero, tmp)));
      object.visible = alpha > 0.004;
      if (!object.visible) return;
      camPc.x = -t.x / PC;
      camPc.y = -t.y / PC;
      camPc.z = -t.z / PC;
      setRteCamera(uniforms, camPc);
      view.frameQuat(SSB_FRAME, q);
      object.quaternion.set(q.x, q.y, q.z, q.w);
      uniforms.uGuide.value = alpha;
      uniforms.uPixelAngle.value = view.pixelAngle;
      // Sine of the camera's elevation above the Galactic plane, seen from Sgr A*.
      cameraModel(view, tmp);
      const elev = Math.abs(tmp.z) / Math.max(Math.hypot(tmp.x, tmp.y, tmp.z), 1e-9);
      const pf = Math.min(1, Math.max(0, (elev - PLANE_FADE[0]) / (PLANE_FADE[1] - PLANE_FADE[0])));
      uniforms.uPlaneFade.value = pf * pf * (3 - 2 * pf);
      GROUPS.forEach((g, i) => (uniforms.uGroup.value[i] = state.groups[g.id] === false ? 0 : 1));
    },
    memoryBytes: () => bytes,
    dispose,
  };
}

// ---------------------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------------------
export function createMarkers(atlas: Atlas, state: AtlasState): Renderable | null {
  const pos: number[] = [];
  const col: number[] = [];
  const grp: number[] = [];
  const par: number[] = [];
  for (const o of atlas.objects) {
    const s = styleOf(o.cls, o.file);
    if (s.marker === 'none' || o.shape) continue;
    pos.push(o.x, o.y, o.z);
    col.push(...s.color);
    grp.push(groupIndex(s.group));
    par.push(o.r, s.markerPx, s.markerFar, MARKER_CODES[s.marker]);
  }
  if (!grp.length) return null;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(col, 3));
  geometry.setAttribute('group', new Float32BufferAttribute(grp, 1));
  geometry.setAttribute('params', new Float32BufferAttribute(par, 4));
  const { material, uniforms } = guideMaterial('GUIDE_MARKER');
  return guideRenderable(
    'milkyway.atlas.markers',
    new Points(geometry, material),
    uniforms,
    state,
    grp.length * 44,
    () => {
      geometry.dispose();
      material.dispose();
    },
  );
}

// ---------------------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------------------
/** Line brightness by rank (0..3): minor stream tracks stay faint so the famous ones stand out. */
export const LINE_RANK_DIM = [0.2, 0.25, 0.5, 1];

/** How far beyond its measured range an arm is drawn dashed, degrees of azimuth. */
export const ARM_EXTRAPOLATION_DEG = 40;

export function createLines(atlas: Atlas, state: AtlasState): Renderable | null {
  const pos: number[] = [];
  const col: number[] = [];
  const grp: number[] = [];
  const flat: number[] = [];
  const segment = (
    a: readonly number[],
    b: readonly number[],
    o: AtlasObject,
    dim = 1,
    inPlane = 0,
  ): void => {
    const s = styleOf(o.cls, o.file);
    pos.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    for (let k = 0; k < 2; k++) {
      col.push(s.color[0] * dim, s.color[1] * dim, s.color[2] * dim);
      grp.push(groupIndex(s.group));
      flat.push(inPlane);
    }
  };
  for (const o of atlas.objects) {
    const shape = o.shape;
    if (shape?.kind === 'polyline') {
      const p = shape.points;
      const dim = LINE_RANK_DIM[Math.min(3, Math.max(0, o.rank))];
      for (let i = 0; i + 1 < p.length; i++) segment(p[i], p[i + 1], o, dim);
      if (shape.closed && p.length > 2) segment(p[p.length - 1], p[0], o, dim);
    } else if (shape?.kind === 'log-spiral') {
      const [b0, b1] = shape.betaMeasuredDeg;
      const solid = spiralPoints(shape, b0, b1).map(([x, y]) => modelToIcrsPc(x, y, 0));
      for (let i = 0; i + 1 < solid.length; i++) segment(solid[i], solid[i + 1], o, 1, 1);
      // Extrapolation beyond the measured range: dashed (every other segment) and dimmer.
      for (const [from, to] of [
        [b0, b0 - ARM_EXTRAPOLATION_DEG],
        [b1, b1 + ARM_EXTRAPOLATION_DEG],
      ]) {
        const dash = spiralPoints(shape, from, to).map(([x, y]) => modelToIcrsPc(x, y, 0));
        for (let i = 0; i + 1 < dash.length; i += 2) segment(dash[i], dash[i + 1], o, 0.6, 1);
      }
    }
  }
  if (!grp.length) return null;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(col, 3));
  geometry.setAttribute('group', new Float32BufferAttribute(grp, 1));
  geometry.setAttribute('flat', new Float32BufferAttribute(flat, 1));
  const { material, uniforms } = guideMaterial('GUIDE_LINE');
  return guideRenderable(
    'milkyway.atlas.lines',
    new LineSegments(geometry, material),
    uniforms,
    state,
    grp.length * 32,
    () => {
      geometry.dispose();
      material.dispose();
    },
  );
}

// ---------------------------------------------------------------------------------------
// Shells
// ---------------------------------------------------------------------------------------
/** Quaternion (x, y, z, w) of the rotation Galactic axes -> ICRS axes. */
function galacticToIcrsQuat(): [number, number, number, number] {
  // ICRS_TO_GALACTIC is row-major; its transpose maps Galactic to ICRS.
  const g = ICRS_TO_GALACTIC;
  const m = [g[0], g[3], g[6], g[1], g[4], g[7], g[2], g[5], g[8]];
  const tr = m[0] + m[4] + m[8];
  let x: number;
  let y: number;
  let z: number;
  let w: number;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    w = 0.25 * s;
    x = (m[7] - m[5]) / s;
    y = (m[2] - m[6]) / s;
    z = (m[3] - m[1]) / s;
  } else if (m[0] > m[4] && m[0] > m[8]) {
    const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2;
    w = (m[7] - m[5]) / s;
    x = 0.25 * s;
    y = (m[1] + m[3]) / s;
    z = (m[2] + m[6]) / s;
  } else if (m[4] > m[8]) {
    const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2;
    w = (m[2] - m[6]) / s;
    x = (m[1] + m[3]) / s;
    y = 0.25 * s;
    z = (m[5] + m[7]) / s;
  } else {
    const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2;
    w = (m[3] - m[1]) / s;
    x = (m[2] + m[6]) / s;
    y = (m[5] + m[7]) / s;
    z = 0.25 * s;
  }
  return [x, y, z, w];
}

/** Sgr A* in pc from the Sun, ICRS axes (the model origin). */
export const centreIcrsPc = (): [number, number, number] => modelToIcrsPc(0, 0, 0);

export interface ShellInstance {
  center: [number, number, number];
  scale: [number, number, number];
  quat: [number, number, number, number];
  o: AtlasObject;
}

/** Sphere and ellipsoid instances of the atlas (ellipsoid pairs give two each). */
export function shellInstances(atlas: Atlas): ShellInstance[] {
  const out: ShellInstance[] = [];
  const gq = galacticToIcrsQuat();
  const c0 = centreIcrsPc();
  const g = ICRS_TO_GALACTIC;
  // North Galactic pole in ICRS axes (third row of ICRS_TO_GALACTIC).
  const pole = [g[6], g[7], g[8]];
  for (const o of atlas.objects) {
    const s = o.shape;
    if (s?.kind === 'ellipsoid-pair') {
      for (const sign of [1, -1])
        out.push({
          center: [
            c0[0] + sign * s.offsetPc * pole[0],
            c0[1] + sign * s.offsetPc * pole[1],
            c0[2] + sign * s.offsetPc * pole[2],
          ],
          scale: [...s.semiAxesPc],
          quat: gq,
          o,
        });
    } else if (s?.kind === 'sphere' && o.r > 0) {
      out.push({ center: [o.x, o.y, o.z], scale: [o.r, o.r, o.r], quat: [0, 0, 0, 1], o });
    }
  }
  return out;
}

export function createShells(atlas: Atlas, state: AtlasState): Renderable[] {
  const out: Renderable[] = [];
  const inst = shellInstances(atlas);
  if (inst.length) {
    const base = new IcosahedronGeometry(1, 5);
    const geometry = new InstancedBufferGeometry();
    geometry.setAttribute('position', base.getAttribute('position'));
    geometry.setIndex(base.getIndex());
    geometry.instanceCount = inst.length;
    const col: number[] = [];
    const grp: number[] = [];
    for (const i of inst) {
      const s = styleOf(i.o.cls, i.o.file);
      col.push(...s.color);
      grp.push(groupIndex(s.group));
    }
    geometry.setAttribute(
      'iCenter',
      new InstancedBufferAttribute(new Float32Array(inst.flatMap((i) => i.center)), 3),
    );
    geometry.setAttribute(
      'iScale',
      new InstancedBufferAttribute(new Float32Array(inst.flatMap((i) => i.scale)), 3),
    );
    geometry.setAttribute(
      'iQuat',
      new InstancedBufferAttribute(new Float32Array(inst.flatMap((i) => i.quat)), 4),
    );
    geometry.setAttribute('color', new InstancedBufferAttribute(new Float32Array(col), 3));
    geometry.setAttribute('group', new InstancedBufferAttribute(new Float32Array(grp), 1));
    const { material, uniforms } = guideMaterial('GUIDE_SHELL', '#define GUIDE_INSTANCED\n');
    out.push(
      guideRenderable('milkyway.atlas.shells', new Mesh(geometry, material), uniforms, state, 200_000, () => {
        geometry.dispose();
        base.dispose();
        material.dispose();
      }),
    );
  }
  for (const o of atlas.objects) {
    const s = o.shape;
    if (s?.kind !== 'radial-map') continue;
    const geometry = radialMapGeometry(s.nLon, s.nLat, s.radiiPc, o);
    const { material, uniforms } = guideMaterial('GUIDE_SHELL');
    material.uniforms.uShellCenter = { value: new Vector3(o.x, o.y, o.z) };
    material.uniforms.uShellRadius = { value: Math.max(o.r, 1) };
    out.push(
      guideRenderable(
        `milkyway.atlas.surface.${o.id}`,
        new Mesh(geometry, material),
        uniforms,
        state,
        s.nLon * s.nLat * 48,
        () => {
          geometry.dispose();
          material.dispose();
        },
      ),
    );
  }
  return out;
}

/** A closed surface around the object's anchor from radii on a regular Galactic (l, b) grid. */
export function radialMapGeometry(
  nLon: number,
  nLat: number,
  radiiPc: readonly number[],
  o: AtlasObject,
): BufferGeometry {
  const g = ICRS_TO_GALACTIC;
  const pos: number[] = [];
  const index: number[] = [];
  const vertex = (r: number, lDeg: number, bDeg: number): void => {
    const cb = Math.cos(bDeg * DEG);
    const X = r * cb * Math.cos(lDeg * DEG);
    const Y = r * cb * Math.sin(lDeg * DEG);
    const Z = r * Math.sin(bDeg * DEG);
    pos.push(
      o.x + g[0] * X + g[3] * Y + g[6] * Z,
      o.y + g[1] * X + g[4] * Y + g[7] * Z,
      o.z + g[2] * X + g[5] * Y + g[8] * Z,
    );
  };
  const mean = (i: number): number => {
    let s = 0;
    for (let j = 0; j < nLon; j++) s += radiiPc[i * nLon + j];
    return s / nLon;
  };
  for (let i = 0; i < nLat; i++)
    for (let j = 0; j < nLon; j++)
      vertex(radiiPc[i * nLon + j], (360 * (j + 0.5)) / nLon, -90 + (180 * (i + 0.5)) / nLat);
  const south = pos.length / 3;
  vertex(mean(0), 0, -90);
  const north = south + 1;
  vertex(mean(nLat - 1), 0, 90);
  for (let j = 0; j < nLon; j++) {
    const j1 = (j + 1) % nLon;
    index.push(south, j1, j);
    index.push(north, (nLat - 1) * nLon + j, (nLat - 1) * nLon + j1);
    for (let i = 0; i + 1 < nLat; i++) {
      const a = i * nLon + j;
      const b = i * nLon + j1;
      const c = (i + 1) * nLon + j;
      const d = (i + 1) * nLon + j1;
      index.push(a, b, c, b, d, c);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const s = styleOf(o.cls, o.file);
  const n = pos.length / 3;
  const col = new Float32Array(n * 3);
  const grp = new Float32Array(n).fill(groupIndex(s.group));
  for (let k = 0; k < n; k++) col.set(s.color, 3 * k);
  geometry.setAttribute('color', new BufferAttribute(col, 3));
  geometry.setAttribute('group', new BufferAttribute(grp, 1));
  return geometry;
}
