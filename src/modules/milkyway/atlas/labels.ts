/**
 * Atlas labels. A label is a guide: it follows the guide opacity (guides.ts) and the settings
 * group of its class. Each class has a camera-distance window per rank (looks.json), so famous
 * objects are named from far away and minor ones only from close by. The candidates are
 * re-selected only when the camera has moved, and at most MAX_LABELS are offered per frame.
 */
import {
  MW_FRAME,
  SSB_FRAME,
  type LabelItem,
  type LabelSource,
  type Vec3d,
  type ViewState,
} from '../../../core/contracts';
import { qrotate, v3len, vec3 } from '../../../core/math64';
import { PC } from '../../../core/units';
import { guideAlpha, type AtlasState } from '../guides';
import type { Atlas } from './catalog';
import { modelToIcrsPc, spiralPoints } from './geometry';
import { ARM_LABEL_BETA, cssColor, LABEL_ANCHORS, styleOf } from './style';
import type { AtlasObject } from './types';

export const MAX_LABELS = 48;
/** Base declutter priority; rank adds 3 per step. Stars (30 - 4 m) and bodies stay above. */
export const LABEL_PRIORITY = 8;

interface Candidate {
  o: AtlasObject;
  local: Vec3d;
  ax: number;
  ay: number;
  az: number;
  far: readonly number[];
  near: number;
  group: string;
  color: string;
}

/** Label anchor of an object, pc: its position, or a simulated placement for large structures. */
export function labelAnchor(o: AtlasObject): [number, number, number] {
  const a = LABEL_ANCHORS[o.id];
  if (a) return modelToIcrsPc(a[0], a[1], a[2]);
  const beta = ARM_LABEL_BETA[o.id];
  if (beta !== undefined && o.shape?.kind === 'log-spiral') {
    const [[x, y]] = spiralPoints(o.shape, beta, beta);
    return modelToIcrsPc(x, y, 0);
  }
  return [o.x, o.y, o.z];
}

export function createAtlasLabels(
  atlas: Atlas,
  state: AtlasState,
): LabelSource & { select(camPc: Vec3d): AtlasObject[] } {
  const all: Candidate[] = atlas.objects.map((o) => {
    const s = styleOf(o.cls, o.file);
    const a = labelAnchor(o);
    return {
      o,
      local: vec3(a[0] * PC, a[1] * PC, a[2] * PC),
      ax: a[0],
      ay: a[1],
      az: a[2],
      far: s.labelFar,
      near: s.labelNear * o.r,
      group: s.group,
      color: cssColor(s.color),
    };
  });
  let chosen: { c: Candidate; score: number }[] = [];
  const last = vec3(Infinity, 0, 0);
  const lastDir = vec3(0, 0, 0);
  let lastKey = '';
  const cam = vec3();
  const dir = vec3();
  const tmp = vec3();
  const zero = vec3();
  const FORWARD = vec3(0, 0, -1);

  /**
   * The labelled objects for a camera position (pc from the Sun, ICRS axes), best first. With a
   * view direction and the cosine of a cone half-angle, objects outside the cone are left out.
   */
  const pick = (c: Vec3d, view?: Vec3d, cosCone = -1): { c: Candidate; score: number }[] => {
    const out: { c: Candidate; score: number }[] = [];
    for (const cand of all) {
      if (state.groups[cand.group] === false) continue;
      const o = cand.o;
      const dx = cand.ax - c.x;
      const dy = cand.ay - c.y;
      const dz = cand.az - c.z;
      const d = Math.hypot(dx, dy, dz);
      const far = cand.far[Math.min(3, Math.max(0, o.rank))];
      if (d > far || d < cand.near) continue;
      if (view && d > 0 && (dx * view.x + dy * view.y + dz * view.z) / d < cosCone) continue;
      // Higher rank first; within a rank the nearer object, on a logarithmic scale, so that a
      // structure with a wide window (an arm, a satellite) does not crowd out what is close by.
      out.push({ c: cand, score: o.rank * 3 - 0.5 * Math.log10(Math.max(d, 1e-3)) });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, MAX_LABELS);
  };

  return {
    id: 'milkyway.atlas.labels',
    select(camPc) {
      return pick(camPc).map((p) => p.c.o);
    },
    labels(view: ViewState, out: LabelItem[]) {
      const t = view.toCamera(SSB_FRAME, zero, cam);
      const alpha = guideAlpha(state, v3len(t), v3len(view.toCamera(MW_FRAME, zero, tmp)), view.frame);
      if (alpha < 0.5) return;
      cam.x = -t.x / PC;
      cam.y = -t.y / PC;
      cam.z = -t.z / PC;
      qrotate(dir, view.worldQuat, FORWARD);
      const key = Object.keys(state.groups)
        .filter((k) => state.groups[k] === false)
        .join(',');
      const moved = Math.hypot(cam.x - last.x, cam.y - last.y, cam.z - last.z);
      const scale = Math.max(0.01, 0.02 * Math.hypot(cam.x, cam.y, cam.z));
      const turned = dir.x * lastDir.x + dir.y * lastDir.y + dir.z * lastDir.z < 0.9994; // 2 degrees
      if (moved > scale || turned || key !== lastKey || last.x === Infinity) {
        // Cone that covers the screen diagonal with a margin.
        const aspect = view.viewport[0] / Math.max(1, view.viewport[1]);
        const half = Math.atan(Math.tan(view.fovY / 2) * Math.hypot(1, aspect)) * 1.15;
        chosen = pick(cam, dir, Math.cos(Math.min(half, Math.PI / 2)));
        last.x = cam.x;
        last.y = cam.y;
        last.z = cam.z;
        lastDir.x = dir.x;
        lastDir.y = dir.y;
        lastDir.z = dir.z;
        lastKey = key;
      }
      for (const { c, score } of chosen)
        out.push({
          id: c.o.id,
          text: c.o.name,
          frame: SSB_FRAME,
          local: c.local,
          priority: LABEL_PRIORITY + score,
          color: c.color,
          target: c.o.id,
        });
    },
  };
}
