/**
 * Constellation figures in true 3D (P4-C): Stellarium 'modern' HIP polylines mapped to stars.bin
 * indices at build time. One LineSegments draw call in the background layer (directions at infinity,
 * the same RTE camera and proper motion as the HYG points), plus labels at each figure's centre as
 * seen from the camera (mean direction of its stars), so figures visibly distort as you fly away.
 */
import { AdditiveBlending, BufferAttribute, BufferGeometry, LineSegments, ShaderMaterial } from 'three';
import {
  SSB_FRAME,
  type Bookmark,
  type InfoCard,
  type LabelItem,
  type LabelSource,
  type Renderable,
  type SearchEntry,
  type Vec3d,
} from '../../core/contracts';
import { qlookRotation, quat, vec3 } from '../../core/math64';
import { AU, PC } from '../../core/units';
import { createRteUniforms, RTE_GLSL, setRteCamera } from '../../render/chunks/index';
import { PM_PC_PER_KMS_YR, yearsSinceJ2000, type StarCatalog } from '../stars/public';
import fragmentShader from './lines.frag.glsl?raw';
import vertexBody from './lines.vert.glsl?raw';

export const CONSTELLATIONS_PATH = 'data/starsystems/constellations.json';

export interface Figure {
  /** IAU abbreviation, e.g. 'Ori'. */
  id: string;
  /** Latin IAU name, e.g. 'Gemini'. */
  name: string;
  /** English byname, e.g. 'Twins'. */
  english?: string;
  /** Flattened pairs of stars.bin indices. */
  segments: number[];
}

export interface ConstellationsFile {
  version: number;
  source: string;
  license: string;
  figures: Figure[];
  missingHip: number[];
}

/** Line colour (display-referred, pre-exposed linear RGB). */
export const LINE_COLOR: [number, number, number] = [0.05, 0.085, 0.16];
/** Angular gap left at each star, radians. */
export const LINE_GAP = 0.004;
/** Lines fade out between these distances of the camera from the Sun, pc. */
export const FADE_PC: [number, number] = [1500, 3000];

/** Unique star indices of a figure. */
export const figureStars = (f: Figure): number[] => [...new Set(f.segments)];

/** Star positions (pc) and velocities (pc/yr) as Float64 arrays for the given indices. */
function kinematics(cat: StarCatalog, idx: readonly number[]) {
  const p = new Float64Array(3 * idx.length);
  const v = new Float64Array(3 * idx.length);
  const t = vec3();
  idx.forEach((i, k) => {
    cat.positionPc(i, 0, t);
    p.set([t.x, t.y, t.z], 3 * k);
    cat.positionPc(i, 1e4, t);
    v.set([(t.x - p[3 * k]) / 1e4, (t.y - p[3 * k + 1]) / 1e4, (t.z - p[3 * k + 2]) / 1e4], 3 * k);
  });
  return { p, v };
}

/**
 * Mean direction (unit) of a figure's stars seen from `camPc` at `years`, and their mean distance (pc).
 * Pure; shared by labels, bookmarks and tests.
 */
export function figureCentre(
  cat: StarCatalog,
  stars: readonly number[],
  camPc: Vec3d,
  years: number,
  out: Vec3d,
): number {
  const t = vec3();
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let dist = 0;
  for (const i of stars) {
    cat.positionPc(i, years, t);
    const dx = t.x - camPc.x;
    const dy = t.y - camPc.y;
    const dz = t.z - camPc.z;
    const d = Math.hypot(dx, dy, dz);
    sx += dx / d;
    sy += dy / d;
    sz += dz / d;
    dist += d;
  }
  const l = Math.hypot(sx, sy, sz) || 1;
  out.x = sx / l;
  out.y = sy / l;
  out.z = sz / l;
  return dist / Math.max(1, stars.length);
}

export interface ConstellationLines extends Renderable {
  visible: boolean;
}

export function createConstellationLines(cat: StarCatalog, file: ConstellationsFile): ConstellationLines {
  const pairs = file.figures.flatMap((f) => f.segments);
  const n = pairs.length; // vertices
  const { p, v } = kinematics(cat, pairs);
  const position = new Float32Array(3 * n);
  const velocity = new Float32Array(3 * n);
  const other = new Float32Array(3 * n);
  const otherVel = new Float32Array(3 * n);
  const kmsPerPcYr = 1 / PM_PC_PER_KMS_YR;
  for (let k = 0; k < n; k++) {
    const o = k ^ 1; // the other end of the same segment
    for (let c = 0; c < 3; c++) {
      position[3 * k + c] = p[3 * k + c];
      velocity[3 * k + c] = v[3 * k + c] * kmsPerPcYr;
      other[3 * k + c] = p[3 * o + c];
      otherVel[3 * k + c] = v[3 * o + c] * kmsPerPcYr;
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('velocity', new BufferAttribute(velocity, 3));
  geometry.setAttribute('other', new BufferAttribute(other, 3));
  geometry.setAttribute('otherVel', new BufferAttribute(otherVel, 3));
  const rte = createRteUniforms();
  const uniforms = {
    ...rte,
    uYears: { value: 0 },
    uGap: { value: LINE_GAP },
    uColor: { value: LINE_COLOR.slice() },
    uFade: { value: 1 },
  };
  // cosmos:no-depth (background layer: constellation lines are directions at infinity, like the stars)
  const material = new ShaderMaterial({
    vertexShader: `${RTE_GLSL}\n${vertexBody}`,
    fragmentShader,
    uniforms,
    blending: AdditiveBlending,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const lines = new LineSegments(geometry, material);
  lines.frustumCulled = false;
  lines.visible = false;
  const toSun = vec3();
  const camPc = vec3();
  const zero = vec3();
  const q = quat();
  const bytes = 48 * n;
  return {
    id: 'starsystems.constellations',
    layer: 'background',
    object: lines,
    get visible() {
      return lines.visible;
    },
    set visible(on: boolean) {
      lines.visible = on;
    },
    update(view) {
      if (!lines.visible) return;
      view.toCamera(SSB_FRAME, zero, toSun);
      camPc.x = -toSun.x / PC;
      camPc.y = -toSun.y / PC;
      camPc.z = -toSun.z / PC;
      setRteCamera(rte, camPc);
      view.frameQuat(SSB_FRAME, q);
      lines.quaternion.set(q.x, q.y, q.z, q.w);
      uniforms.uYears.value = yearsSinceJ2000(view.jd);
      // Keep the gap about 5 px wide whatever the field of view.
      uniforms.uGap.value = Math.max(LINE_GAP, 5 * view.pixelAngle);
      const d = Math.hypot(camPc.x, camPc.y, camPc.z);
      uniforms.uFade.value = 1 - Math.min(1, Math.max(0, (d - FADE_PC[0]) / (FADE_PC[1] - FADE_PC[0])));
    },
    memoryBytes: () => bytes,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

/** Labels at each figure's centre as seen from the camera (no allocation per frame). */
export function createConstellationLabels(
  cat: StarCatalog,
  file: ConstellationsFile,
  enabled: () => boolean,
): LabelSource {
  const figs = file.figures.map((f) => {
    const stars = figureStars(f);
    return { f, stars, ...kinematics(cat, stars), local: vec3(), item: null as LabelItem | null };
  });
  const toSun = vec3();
  const zero = vec3();
  for (const g of figs)
    g.item = {
      id: `con:${g.f.id}`,
      text: g.f.name,
      frame: SSB_FRAME,
      local: g.local,
      priority: 4,
      color: '#7d95c4',
      target: `con:${g.f.id}`,
    };
  return {
    id: 'starsystems.constellations',
    labels(view, out) {
      if (!enabled()) return;
      view.toCamera(SSB_FRAME, zero, toSun);
      const cx = -toSun.x / PC;
      const cy = -toSun.y / PC;
      const cz = -toSun.z / PC;
      if (Math.hypot(cx, cy, cz) > FADE_PC[0]) return;
      const years = yearsSinceJ2000(view.jd);
      for (const g of figs) {
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let dist = 0;
        for (let k = 0; k < g.stars.length; k++) {
          const dx = g.p[3 * k] + g.v[3 * k] * years - cx;
          const dy = g.p[3 * k + 1] + g.v[3 * k + 1] * years - cy;
          const dz = g.p[3 * k + 2] + g.v[3 * k + 2] * years - cz;
          const d = Math.hypot(dx, dy, dz);
          sx += dx / d;
          sy += dy / d;
          sz += dz / d;
          dist += d;
        }
        const l = Math.hypot(sx, sy, sz) || 1;
        // At 1 pc along the mean direction: far enough that the label never collides with a body.
        const r = Math.min(1, dist / g.stars.length);
        g.local.x = (cx + (sx / l) * r) * PC;
        g.local.y = (cy + (sy / l) * r) * PC;
        g.local.z = (cz + (sz / l) * r) * PC;
        out.push(g.item!);
      }
    },
  };
}

const NORTH = vec3(0, 0, 1);

/** A bookmark 1 AU from the Sun (Earth-like vantage) looking at a figure's centre at `jd`. */
export function figureBookmarkFromEarth(
  cat: StarCatalog,
  f: Figure,
  opts: { id: string; title: string; jd?: number; fovDeg: number; lookTarget?: string },
): Bookmark {
  const years = opts.jd === undefined ? 0 : yearsSinceJ2000(opts.jd);
  const dir = vec3();
  figureCentre(cat, figureStars(f), vec3(), years, dir);
  return {
    id: opts.id,
    title: opts.title,
    frame: SSB_FRAME,
    pos: vec3(dir.x * AU, dir.y * AU, dir.z * AU),
    quat: qlookRotation(quat(), dir, NORTH),
    fovY: (opts.fovDeg * Math.PI) / 180,
    ev: -4,
    ...(opts.jd !== undefined ? { jd: opts.jd } : {}),
    ...(opts.lookTarget ? { lookTarget: opts.lookTarget } : {}),
  };
}

export function constellationSearch(cat: StarCatalog, file: ConstellationsFile): SearchEntry[] {
  return file.figures.map((f) => ({
    id: `con:${f.id}`,
    name: f.name,
    aliases: f.english ? [f.id, f.english] : [f.id],
    subtitle: 'Constellation',
    kind: 'constellation' as const,
    target: figureBookmarkFromEarth(cat, f, { id: `con-${f.id.toLowerCase()}`, title: f.name, fovDeg: 50 }),
  }));
}

export function constellationInfo(file: ConstellationsFile, id: string): InfoCard | null {
  const m = /^con:(\w+)$/.exec(id);
  const f = m && file.figures.find((x) => x.id === m[1]);
  if (!f) return null;
  return {
    title: f.name,
    subtitle: 'Constellation (IAU figure)',
    facts: [
      { label: 'Abbreviation', value: f.id },
      ...(f.english ? [{ label: 'Meaning', value: f.english }] : []),
      { label: 'Stars in the figure', value: figureStars(f).length },
      { label: 'Line segments', value: f.segments.length / 2 },
    ],
    description:
      'Lines join the stars at their true 3D positions. Fly away from the Sun and the figure falls apart, because its stars lie at very different distances.',
    credit: 'Figure: Stellarium modern sky culture (CC BY-SA 4.0); stars: HYG v4.1 (CC BY-SA 4.0)',
  };
}
