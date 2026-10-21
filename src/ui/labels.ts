/**
 * Decluttered labels overlay (DESIGN 3.3 step 8): bodies from the registry plus LabelSources,
 * projected each frame, occlusion-tested against body spheres (ray-sphere), then placed greedily
 * by priority without overlaps, at most MAX_LABELS. DOM nodes are pooled and moved with transforms.
 */
import type {
  Body,
  BodyKind,
  LabelItem,
  LabelSource,
  Quatd,
  RegistryReader,
  Vec3d,
  ViewState,
} from '../core/contracts';
import { qrotateInv, vec3 } from '../core/math64';

export const MAX_LABELS = 64;

export interface LabelBox {
  item: LabelItem;
  /** Anchor (CSS px, top-left origin): the projected point. */
  x: number;
  y: number;
  /** Label rectangle (CSS px). */
  left: number;
  top: number;
  w: number;
  h: number;
}

const overlaps = (a: LabelBox, b: LabelBox, pad: number) =>
  a.left < b.left + b.w + pad &&
  b.left < a.left + a.w + pad &&
  a.top < b.top + b.h + pad &&
  b.top < a.top + a.h + pad;

/** Greedy declutter: highest priority first, drop anything overlapping an accepted label. */
export function declutter(cands: LabelBox[], max = MAX_LABELS, pad = 2): LabelBox[] {
  const sorted = [...cands].sort((a, b) => b.item.priority - a.item.priority);
  const out: LabelBox[] = [];
  for (const c of sorted) {
    if (out.length >= max) break;
    if (out.some((o) => overlaps(o, c, pad))) continue;
    out.push(c);
  }
  return out;
}

/** Estimated label size for a text (CSS px; 11 px system font). */
export const labelSize = (text: string): { w: number; h: number } => ({ w: 6.2 * text.length + 8, h: 15 });

/** Camera-space projection (three.js camera looks down −Z). Returns null when behind the camera. */
export function project(
  rel: Vec3d,
  worldQuat: Quatd,
  fovY: number,
  cssW: number,
  cssH: number,
  out: { x: number; y: number; depth: number },
): { x: number; y: number; depth: number } | null {
  const v = qrotateInv(vec3(), worldQuat, rel);
  if (v.z >= 0) return null;
  const t = Math.tan(fovY / 2);
  const nx = v.x / -v.z / (t * (cssW / cssH));
  const ny = v.y / -v.z / t;
  out.x = ((nx + 1) / 2) * cssW;
  out.y = ((1 - ny) / 2) * cssH;
  out.depth = -v.z;
  return out;
}

const KIND_PRIORITY: Partial<Record<BodyKind, number>> = {
  star: 90,
  planet: 80,
  dwarf: 60,
  blackhole: 70,
  galaxy: 50,
  cluster: 40,
  moon: 45,
  spacecraft: 35,
  comet: 30,
  minor: 25,
};
const ALWAYS: ReadonlySet<BodyKind> = new Set(['star', 'planet', 'dwarf', 'galaxy', 'blackhole', 'cluster']);

/** Label priority of a body (labelPriority wins; else kind plus a size term). */
export const bodyPriority = (b: Body): number =>
  b.labelPriority ??
  (KIND_PRIORITY[b.kind] ?? 20) + Math.min(9, Math.max(0, Math.log10(Math.max(b.radius, 1)) - 3));

interface Occluder {
  id: string;
  c: Vec3d;
  r: number;
}

/** True when the ray from the camera to `p` hits an occluder sphere before reaching p. */
export function occluded(p: Vec3d, occluders: readonly Occluder[], selfId: string): boolean {
  const dp = Math.hypot(p.x, p.y, p.z);
  if (dp === 0) return false;
  const ux = p.x / dp;
  const uy = p.y / dp;
  const uz = p.z / dp;
  for (const o of occluders) {
    if (o.id === selfId) continue;
    const t = o.c.x * ux + o.c.y * uy + o.c.z * uz;
    if (t <= 0) continue;
    const c2 = o.c.x * o.c.x + o.c.y * o.c.y + o.c.z * o.c.z;
    if (c2 <= o.r * o.r) continue; // the camera is inside (below the ground's bounding sphere)
    const d2 = c2 - t * t;
    if (d2 >= o.r * o.r) continue;
    const tHit = t - Math.sqrt(o.r * o.r - d2);
    if (tHit < dp * (1 - 1e-9)) return true;
  }
  return false;
}

export interface LabelOverlayDeps {
  registry: RegistryReader;
  /** Ids that get a priority boost (camera target, selection). */
  emphasis(): { target: string | null; selection: string | null };
  onClick(item: LabelItem): void;
  onDoubleClick(item: LabelItem): void;
}

/** Pooled DOM overlay. `update(view)` runs in render.onAfterFrame. */
export class LabelOverlay {
  readonly el: HTMLDivElement;
  private readonly nodes: HTMLDivElement[] = [];
  private readonly items: (LabelItem | null)[] = [];
  private readonly sources = new Set<LabelSource>();
  visible = true;
  /** Last placed labels (e2e and tests read data attributes instead). */
  placed: LabelBox[] = [];

  constructor(
    parent: HTMLElement,
    private readonly deps: LabelOverlayDeps,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'cz-labels';
    parent.appendChild(this.el);
    for (let i = 0; i < MAX_LABELS; i++) {
      const n = document.createElement('div');
      n.className = 'cz-label';
      n.style.display = 'none';
      n.addEventListener('click', () => {
        const it = this.items[i];
        if (it) this.deps.onClick(it);
      });
      n.addEventListener('dblclick', () => {
        const it = this.items[i];
        if (it) this.deps.onDoubleClick(it);
      });
      this.el.appendChild(n);
      this.nodes.push(n);
      this.items.push(null);
    }
  }

  addSource(src: LabelSource): () => void {
    this.sources.add(src);
    return () => this.sources.delete(src);
  }

  update(view: ViewState): void {
    if (!this.visible) {
      this.el.style.display = 'none';
      return;
    }
    this.el.style.display = '';
    const cssW = this.el.clientWidth || view.viewport[0];
    const cssH = this.el.clientHeight || view.viewport[1];
    const pxAngle = view.fovY / cssH;
    const { target, selection } = this.deps.emphasis();
    const items: LabelItem[] = [];
    const occluders: Occluder[] = [];
    const rel = vec3();
    for (const b of this.deps.registry.bodies()) {
      try {
        view.toCamera(b.frame, vec3(), rel);
      } catch {
        continue;
      }
      const d = Math.hypot(rel.x, rel.y, rel.z);
      const pr = Math.atan2(b.radius, d) / pxAngle;
      if (pr > 1 && b.kind !== 'galaxy' && b.kind !== 'blackhole')
        // The polar radius: ground-level labels on an oblate body sit inside its equatorial sphere.
        occluders.push({ id: b.id, c: vec3(rel.x, rel.y, rel.z), r: b.radius * (1 - (b.oblateness ?? 0)) });
      const emph = b.id === target || b.id === selection;
      if (pr > 0.4 * cssH && !emph) continue;
      if (!ALWAYS.has(b.kind) && !emph && d > 3000 * b.radius) continue;
      items.push({
        id: b.id,
        text: b.name,
        frame: b.frame,
        local: vec3(),
        priority: bodyPriority(b),
        radius: b.radius,
        target: b.id,
      });
    }
    for (const s of this.sources) {
      try {
        s.labels(view, items);
      } catch (e) {
        console.error(`[ui] label source ${s.id} failed`, e);
      }
    }
    const cands: LabelBox[] = [];
    const proj = { x: 0, y: 0, depth: 0 };
    for (const it of items) {
      try {
        view.toCamera(it.frame, it.local, rel);
      } catch {
        continue;
      }
      if (!project(rel, view.worldQuat, view.fovY, cssW, cssH, proj)) continue;
      if (proj.x < -50 || proj.x > cssW + 50 || proj.y < -20 || proj.y > cssH + 20) continue;
      if (occluded(rel, occluders, it.id)) continue;
      const d = Math.hypot(rel.x, rel.y, rel.z);
      const off = it.radius ? Math.min(cssH, Math.atan2(it.radius, d) / pxAngle) : 0;
      const { w, h } = labelSize(it.text);
      const pri = it.priority + (it.id === target ? 1000 : 0) + (it.id === selection ? 500 : 0);
      cands.push({
        item: { ...it, priority: pri },
        x: proj.x,
        y: proj.y,
        left: proj.x + 4 + off * 0.7,
        top: proj.y - h - 2 - off * 0.7,
        w,
        h,
      });
    }
    this.placed = declutter(cands);
    for (let i = 0; i < MAX_LABELS; i++) {
      const n = this.nodes[i];
      const p = this.placed[i];
      if (!p) {
        if (this.items[i]) {
          n.style.display = 'none';
          this.items[i] = null;
        }
        continue;
      }
      if (this.items[i]?.id !== p.item.id || n.textContent !== p.item.text) {
        n.textContent = p.item.text;
        n.dataset.labelId = p.item.id;
        n.style.color = p.item.color ?? '';
        n.classList.toggle('cz-label-emph', p.item.id === target || p.item.id === selection);
      }
      this.items[i] = p.item;
      n.dataset.x = p.x.toFixed(1);
      n.dataset.y = p.y.toFixed(1);
      n.style.display = '';
      n.style.transform = `translate(${p.left.toFixed(1)}px, ${p.top.toFixed(1)}px)`;
    }
  }
}
