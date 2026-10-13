/**
 * Quadtree selection (pure): best-first screen-space-error refinement with hysteresis, horizon and
 * frustum culling, a leaf budget (draw calls) and a resident-tile budget (cache cap).
 *
 * Every node in the heap is resident (its tile data is in the cache). A node splits only when all
 * of its non-culled children are resident; otherwise it renders and requests them. Culling of a
 * non-resident child uses bounds estimated from the parent's height range.
 */
import type { Vec3d } from '../../core/contracts';
import {
  cellSize,
  childKeys,
  ellipsoidRadius,
  faceCoord,
  faceDir,
  levelError,
  MAX_LEVEL,
  PATCH_CELLS,
  ROOT_KEYS,
  unpackKey,
  type NodeId,
} from './cube';

/** Merge hysteresis: a split node merges only when its SSE drops below target / HYSTERESIS. */
export const HYSTERESIS = 1.5;
/** Nodes whose bounding sphere comes this close to the camera are never frustum-culled, m. */
export const NEAR_KEEP = 10;

export interface NodeBounds {
  centre: Vec3d;
  /** Bounding-sphere radius, m. */
  radius: number;
  /** Max distance of the surface from the body centre, m. */
  rMax: number;
  hMin: number;
  hMax: number;
}

export interface SelectParams {
  /** Camera position, body-fixed, m. */
  cam: Vec3d;
  /** Inward unit normals of the side frustum planes (through the camera), body-fixed. Empty: no frustum culling. */
  planes: readonly Vec3d[];
  /** Radians per pixel. */
  pixelAngle: number;
  /** SSE target, px. */
  target: number;
  /** Max rendered leaves (draw calls). */
  maxLeaves: number;
  /** Max tiles kept by the selected tree (leaves + split nodes). */
  maxTiles: number;
  a: number;
  c: number;
  /** Radius of the occluding sphere for horizon culling (minimum surface radius), m. */
  rOcc: number;
  maxLevel?: number;
}

export interface Selection {
  /** Visible leaves to draw. */
  leaves: number[];
  /** Nodes kept split (hysteresis state for the next frame). */
  split: Set<number>;
  /** Every resident node used by the tree (pin set for the cache). */
  used: Set<number>;
  /** Missing tiles, most important first. */
  requests: { key: number; sse: number }[];
}

/** Screen-space error of a node, px. */
export function screenSpaceError(p: SelectParams, level: number, b: NodeBounds): number {
  const dx = b.centre.x - p.cam.x;
  const dy = b.centre.y - p.cam.y;
  const dz = b.centre.z - p.cam.z;
  const camR = Math.hypot(p.cam.x, p.cam.y, p.cam.z);
  const dist = Math.max(Math.hypot(dx, dy, dz) - b.radius, camR - b.rMax, 0);
  return levelError(p.a, level) / (Math.max(dist, 0.1) * p.pixelAngle);
}

/** True when the node is entirely behind the horizon or outside the frustum. */
export function culled(p: SelectParams, b: NodeBounds): boolean {
  const dx = b.centre.x - p.cam.x;
  const dy = b.centre.y - p.cam.y;
  const dz = b.centre.z - p.cam.z;
  const d = Math.hypot(dx, dy, dz);
  const near = d - b.radius;
  if (near <= 0) return false;
  // Horizon: the farthest visible point of radius rMax over a sphere of radius rOcc.
  const camR = Math.hypot(p.cam.x, p.cam.y, p.cam.z);
  if (camR > p.rOcc && b.rMax > p.rOcc) {
    const dVis = Math.sqrt(camR * camR - p.rOcc * p.rOcc) + Math.sqrt(b.rMax * b.rMax - p.rOcc * p.rOcc);
    if (near > dVis) return true;
  }
  if (near < NEAR_KEEP) return false;
  for (const n of p.planes) {
    if (n.x * dx + n.y * dy + n.z * dz < -b.radius) return true;
  }
  return false;
}

const est = new Float64Array(3);

/** Bounds of a node estimated from a height range (9 directions × 2 radii plus a curvature margin). */
export function estimateBounds(id: NodeId, a: number, c: number, hMin: number, hMax: number): NodeBounds {
  const g = [0, PATCH_CELLS / 2, PATCH_CELLS];
  const pts: Vec3d[] = [];
  let centre: Vec3d = { x: 0, y: 0, z: 0 };
  let rMax = 0;
  for (const j of g) {
    for (const i of g) {
      faceDir(
        id.face,
        faceCoord(id.x * PATCH_CELLS + i, id.level),
        faceCoord(id.y * PATCH_CELLS + j, id.level),
        est,
        0,
      );
      const re = ellipsoidRadius(a, c, est[0], est[1], est[2]);
      for (const h of [hMin, hMax]) {
        const r = re + h;
        rMax = Math.max(rMax, r);
        pts.push({ x: est[0] * r, y: est[1] * r, z: est[2] * r });
      }
      if (i === g[1] && j === g[1]) {
        const r = re + 0.5 * (hMin + hMax);
        centre = { x: est[0] * r, y: est[1] * r, z: est[2] * r };
      }
    }
  }
  // The centre lies on the surface, so the farthest points of the node are its corners (distance
  // to a great-circle edge is unimodal); a small margin covers the ellipsoid and skirts.
  let rad = 0;
  for (const q of pts) rad = Math.max(rad, Math.hypot(q.x - centre.x, q.y - centre.y, q.z - centre.z));
  return { centre, radius: rad * 1.01 + 2 * cellSize(a, id.level) + 1, rMax: rMax * 1.0001, hMin, hMax };
}

interface HeapItem {
  key: number;
  id: NodeId;
  sse: number;
  b: NodeBounds;
}

function push(h: HeapItem[], it: HeapItem): void {
  h.push(it);
  let i = h.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (h[p].sse >= h[i].sse) break;
    [h[p], h[i]] = [h[i], h[p]];
    i = p;
  }
}

function pop(h: HeapItem[]): HeapItem {
  const top = h[0];
  const last = h.pop()!;
  if (h.length) {
    h[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < h.length && h[l].sse > h[m].sse) m = l;
      if (r < h.length && h[r].sse > h[m].sse) m = r;
      if (m === i) break;
      [h[m], h[i]] = [h[i], h[m]];
      i = m;
    }
  }
  return top;
}

/**
 * Selects the leaves to draw. `bounds(key)` returns the exact bounds of any node built before
 * (resident or not) and `resident(key)` whether its tile data is in the cache (default: bounds
 * known). Exact bounds of evicted nodes keep culling decisions stable (no re-request loops).
 * `prevSplit` is the previous frame's split set (hysteresis).
 */
export function selectTree(
  p: SelectParams,
  bounds: (key: number) => NodeBounds | undefined,
  prevSplit: ReadonlySet<number>,
  resident: (key: number) => boolean = (k) => bounds(k) !== undefined,
): Selection {
  const maxLevel = p.maxLevel ?? MAX_LEVEL;
  const out: Selection = { leaves: [], split: new Set(), used: new Set(), requests: [] };
  const heap: HeapItem[] = [];
  const requested = new Set<number>();
  const request = (key: number, sse: number) => {
    if (requested.has(key)) return;
    requested.add(key);
    out.requests.push({ key, sse });
  };
  let leafCount = 0;
  for (const key of ROOT_KEYS) {
    const b = bounds(key);
    if (!b || !resident(key)) {
      request(key, Infinity);
      continue;
    }
    out.used.add(key);
    if (culled(p, b)) continue;
    const id = unpackKey(key);
    push(heap, { key, id, sse: screenSpaceError(p, 0, b), b });
    leafCount++;
  }
  let tiles = out.used.size;
  while (heap.length) {
    const n = pop(heap);
    const wantSplit =
      n.id.level < maxLevel && (n.sse > p.target || (prevSplit.has(n.key) && n.sse > p.target / HYSTERESIS));
    if (wantSplit) {
      const kids = childKeys(n.id);
      const visible: HeapItem[] = [];
      const missing: number[] = [];
      for (const k of kids) {
        const id = unpackKey(k);
        const kb = bounds(k);
        const m = 2 * levelError(p.a, n.id.level);
        const b = kb ?? estimateBounds(id, p.a, p.c, n.b.hMin - m, n.b.hMax + m);
        if (culled(p, b)) continue;
        if (!kb || !resident(k)) missing.push(k);
        else visible.push({ key: k, id, sse: screenSpaceError(p, id.level, kb), b: kb });
      }
      const need = visible.length + missing.length;
      const fits = leafCount - 1 + need <= p.maxLeaves && tiles + need <= p.maxTiles;
      if (!missing.length && fits) {
        out.split.add(n.key);
        leafCount += visible.length - 1;
        tiles += visible.length;
        for (const v of visible) {
          out.used.add(v.key);
          push(heap, v);
        }
        continue;
      }
      if (fits) {
        // Reserve the budget of the pending split and pin the siblings that already arrived, so
        // the cache never evicts half of a split it is still waiting for (no thrashing).
        for (const k of missing) request(k, n.sse);
        for (const v of visible) out.used.add(v.key);
        leafCount += need - 1;
        tiles += need;
      }
    }
    out.leaves.push(n.key);
  }
  out.requests.sort((x, y) => y.sse - x.sse);
  return out;
}

/** Deepest split level of the tree along a direction (leaf level under `dir`). */
export function leafLevelAt(split: ReadonlySet<number>, face: number, s: number, t: number): number {
  let level = 0;
  let x = 0;
  let y = 0;
  const g = (v: number) => (v + 1) * 0.5;
  for (;;) {
    const key = ((face * 32 + level) * 4194304 + x) * 4194304 + y;
    if (!split.has(key) || level >= MAX_LEVEL) return level;
    level++;
    const n = 2 ** level;
    x = Math.min(n - 1, Math.max(0, Math.floor(g(s) * n)));
    y = Math.min(n - 1, Math.max(0, Math.floor(g(t) * n)));
  }
}
