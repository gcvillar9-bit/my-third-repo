/**
 * Float64 frame tree (DESIGN 3.2). Every transform walks to the lowest common ancestor (LCA)
 * and only combines local offsets below it, so precision is bounded by the LCA's scale.
 * Positions and orientations are cached per jd (re-evaluated when jd changes).
 * FrameDef.positionAt/orientationAt must be pure functions of jd (they may be called lazily).
 */
import {
  MW_FRAME,
  ROOT_FRAME,
  SSB_FRAME,
  type FrameDef,
  type FrameId,
  type FrameTree,
  type JD,
  type Quatd,
  type Vec3d,
} from './contracts';
import {
  qconj,
  qcopy,
  qfromMatrix,
  qidentity,
  qmul,
  qnormalize,
  qrotate,
  quat,
  v3add,
  v3copy,
  v3len,
  v3set,
  v3sub,
  vec3,
} from './math64';
import { AU, KPC, R0_GALACTIC } from './units';

interface Node {
  def: FrameDef;
  parent: Node | null;
  depth: number;
  children: FrameId[];
  path: FrameId[];
  posJd: number;
  pos: Vec3d;
  oriJd: number;
  ori: Quatd;
  rootOriJd: number;
  rootOri: Quatd;
}

/** Optional filter for findAnchor (e.g. skip rotating `.fixed` frames in free flight). */
export type AnchorFilter = (id: FrameId) => boolean;

const ZERO: Readonly<Vec3d> = Object.freeze({ x: 0, y: 0, z: 0 });

export class FrameTreeImpl implements FrameTree {
  readonly rootId = ROOT_FRAME;
  private nodes = new Map<FrameId, Node>();

  constructor() {
    this.insert({
      id: ROOT_FRAME,
      parent: null,
      influenceRadius: Infinity,
      positionAt: (_jd, out) => v3set(out, 0, 0, 0),
    });
  }

  private insert(def: FrameDef): void {
    const parent = def.parent === null ? null : this.nodes.get(def.parent);
    if (def.parent !== null && !parent)
      throw new Error(`frames: unknown parent '${def.parent}' for '${def.id}'`);
    const node: Node = {
      def,
      parent: parent ?? null,
      depth: parent ? parent.depth + 1 : 0,
      children: [],
      path: parent ? [...parent.path, def.id] : [def.id],
      posJd: NaN,
      pos: vec3(),
      oriJd: NaN,
      ori: quat(),
      rootOriJd: NaN,
      rootOri: quat(),
    };
    this.nodes.set(def.id, node);
    parent?.children.push(def.id);
  }

  addFrame(f: FrameDef): void {
    if (this.nodes.has(f.id)) throw new Error(`frames: duplicate frame '${f.id}'`);
    this.insert(f);
  }

  removeFrame(id: FrameId): void {
    const n = this.nodes.get(id);
    if (!n) return;
    if (id === ROOT_FRAME) throw new Error('frames: cannot remove the root');
    if (n.children.length) throw new Error(`frames: '${id}' still has children`);
    const siblings = n.parent!.children;
    siblings.splice(siblings.indexOf(id), 1);
    this.nodes.delete(id);
  }

  has(id: FrameId): boolean {
    return this.nodes.has(id);
  }
  get(id: FrameId): FrameDef | undefined {
    return this.nodes.get(id)?.def;
  }
  children(id: FrameId): readonly FrameId[] {
    return this.nodes.get(id)?.children ?? [];
  }
  path(id: FrameId): readonly FrameId[] {
    return this.node(id).path;
  }
  /** All frame ids (insertion order). */
  ids(): FrameId[] {
    return [...this.nodes.keys()];
  }
  /** Drops cached positions/orientations (call when a FrameDef's data changed at the same jd). */
  invalidate(): void {
    for (const n of this.nodes.values()) n.posJd = n.oriJd = n.rootOriJd = NaN;
  }

  private node(id: FrameId): Node {
    const n = this.nodes.get(id);
    if (!n) throw new Error(`frames: unknown frame '${id}'`);
    return n;
  }

  private posOf(n: Node, jd: JD): Vec3d {
    if (n.posJd !== jd) {
      n.def.positionAt(jd, n.pos);
      n.posJd = jd;
    }
    return n.pos;
  }

  /** Rotation this → parent (identity when the frame shares its parent's axes). */
  private oriOf(n: Node, jd: JD): Quatd | null {
    if (!n.def.orientationAt) return null;
    if (n.oriJd !== jd) {
      n.def.orientationAt(jd, n.ori);
      qnormalize(n.ori, n.ori);
      n.oriJd = jd;
    }
    return n.ori;
  }

  /** Rotation this → root. */
  private rootOriOf(n: Node, jd: JD): Quatd {
    if (n.rootOriJd !== jd) {
      if (!n.parent) qidentity(n.rootOri);
      else {
        const p = this.rootOriOf(n.parent, jd);
        const o = this.oriOf(n, jd);
        if (o) qmul(n.rootOri, p, o);
        else qcopy(n.rootOri, p);
      }
      n.rootOriJd = jd;
    }
    return n.rootOri;
  }

  lca(a: FrameId, b: FrameId): FrameId {
    let na = this.node(a);
    let nb = this.node(b);
    while (na.depth > nb.depth) na = na.parent!;
    while (nb.depth > na.depth) nb = nb.parent!;
    while (na !== nb) {
      na = na.parent!;
      nb = nb.parent!;
    }
    return na.def.id;
  }

  /** Point `local` in `frame` re-expressed in the coordinates of its ancestor `anc`. */
  private toAncestor(n: Node, local: Vec3d, anc: Node, jd: JD, out: Vec3d): Vec3d {
    v3copy(out, local);
    while (n !== anc) {
      const o = this.oriOf(n, jd);
      if (o) qrotate(out, o, out);
      v3add(out, out, this.posOf(n, jd));
      n = n.parent!;
    }
    return out;
  }

  /** Rotation from `n` axes into ancestor `anc` axes. */
  private oriToAncestor(n: Node, anc: Node, jd: JD, out: Quatd): Quatd {
    qidentity(out);
    while (n !== anc) {
      const o = this.oriOf(n, jd);
      if (o) qmul(out, o, out);
      n = n.parent!;
    }
    return out;
  }

  /** Rotation world → root, where world = ssb axes (root axes until ssb exists). */
  private worldToRoot(jd: JD, out: Quatd): Quatd {
    const ssb = this.nodes.get(SSB_FRAME);
    return ssb ? qcopy(out, this.rootOriOf(ssb, jd)) : qidentity(out);
  }

  orientation(frame: FrameId, jd: JD, out: Quatd): Quatd {
    const r = this.rootOriOf(this.node(frame), jd);
    const w = this.worldToRoot(jd, quat());
    return qmul(out, qconj(w, w), r);
  }

  toWorldDir(frame: FrameId, v: Vec3d, jd: JD, out: Vec3d): Vec3d {
    return qrotate(out, this.orientation(frame, jd, quat()), v);
  }

  fromWorldDir(frame: FrameId, v: Vec3d, jd: JD, out: Vec3d): Vec3d {
    const q = this.orientation(frame, jd, quat());
    return qrotate(out, qconj(q, q), v);
  }

  delta(a: FrameId, aLocal: Vec3d, b: FrameId, bLocal: Vec3d, jd: JD, out: Vec3d): Vec3d {
    const na = this.node(a);
    const nb = this.node(b);
    const l = this.node(a === b ? a : this.lca(a, b));
    const pa = this.toAncestor(na, aLocal, l, jd, vec3());
    const pb = this.toAncestor(nb, bLocal, l, jd, vec3());
    const q = this.orientation(l.def.id, jd, quat());
    return qrotate(out, q, v3sub(out, pb, pa));
  }

  relative(a: FrameId, b: FrameId, jd: JD, out: Vec3d): Vec3d {
    return this.delta(a, ZERO, b, ZERO, jd, out);
  }

  convertPoint(from: FrameId, local: Vec3d, to: FrameId, jd: JD, out: Vec3d): Vec3d {
    if (from === to) return v3copy(out, local);
    const nf = this.node(from);
    const nt = this.node(to);
    const l = this.node(this.lca(from, to));
    const p = this.toAncestor(nf, local, l, jd, vec3());
    const o = this.toAncestor(nt, ZERO, l, jd, vec3());
    const q = this.oriToAncestor(nt, l, jd, quat());
    v3sub(out, p, o);
    return qrotate(out, qconj(q, q), out);
  }

  toCamera(cam: { frame: FrameId; local: Vec3d }, frame: FrameId, local: Vec3d, jd: JD, out: Vec3d): Vec3d {
    return this.delta(cam.frame, cam.local, frame, local, jd, out);
  }

  findAnchor(
    from: FrameId,
    local: Vec3d,
    jd: JD,
    current?: FrameId,
    hysteresis = 0.1,
    filter?: AnchorFilter,
  ): FrameId {
    const keep = new Set(current && this.nodes.has(current) ? this.node(current).path : []);
    let node = this.node(ROOT_FRAME);
    const p = vec3();
    const d = vec3();
    for (;;) {
      this.convertPoint(from, local, node.def.id, jd, p);
      let best: Node | null = null;
      for (const cid of node.children) {
        if (filter && !filter(cid)) continue;
        const c = this.nodes.get(cid)!;
        const r = c.def.influenceRadius;
        if (!(r > 0)) continue;
        const eff = keep.has(cid) ? r * (1 + hysteresis) : r;
        const dist = v3len(v3sub(d, p, this.posOf(c, jd)));
        if (dist <= eff && (!best || r < best.def.influenceRadius)) best = c;
      }
      if (!best) return node.def.id;
      node = best;
    }
  }
}

// ---------------------------------------------------------------------------------------
// Standard skeleton: universe > mw > ssb (DESIGN 3.2)
// ---------------------------------------------------------------------------------------

/** ICRS → IAU galactic rotation (Hipparcos 1997, vol. 1 eq. 1.5.11), row-major: r_gal = A·r_icrs. */
export const ICRS_TO_GALACTIC: readonly number[] = [
  -0.0548755604162154, -0.873437090234885, -0.4838350155487132, 0.4941094278755837, -0.4448296299600112,
  0.7469822444972189, -0.8676661490190047, -0.1980763734312015, 0.4559837761750669,
];

const DEG = Math.PI / 180;
const unitLB = (l: number, b: number): Vec3d =>
  vec3(Math.cos(b * DEG) * Math.cos(l * DEG), Math.cos(b * DEG) * Math.sin(l * DEG), Math.sin(b * DEG));

/**
 * Galactic → supergalactic rotation (de Vaucouleurs: SG pole at l=47.37°, b=+6.32°; SGL=0 at
 * l=137.37°, b=0°), row-major: r_sg = M·r_gal.
 */
export const GALACTIC_TO_SUPERGALACTIC: readonly number[] = (() => {
  const x = unitLB(137.37, 0);
  const z = unitLB(47.37, 6.32);
  const y = vec3(z.y * x.z - z.z * x.y, z.z * x.x - z.x * x.z, z.x * x.y - z.y * x.x);
  return [x.x, x.y, x.z, y.x, y.y, y.z, z.x, z.y, z.z];
})();

/** Sgr A* ICRS position (Reid & Brunthaler 2004): RA 17h45m40.0409s, Dec −29°00′28.118″. */
export const SGRA_RA = (266.41683708 * Math.PI) / 180;
export const SGRA_DEC = (-29.00781056 * Math.PI) / 180;

const mat3MulVec = (m: readonly number[], v: Vec3d): Vec3d =>
  vec3(
    m[0] * v.x + m[1] * v.y + m[2] * v.z,
    m[3] * v.x + m[4] * v.y + m[5] * v.z,
    m[6] * v.x + m[7] * v.y + m[8] * v.z,
  );

/**
 * SSB origin in mw coordinates (galactic axes, origin Sgr A*): R0 along the observed Sgr A*
 * direction, so Sgr A* lands at its true ICRS position. (Z0 = 20.8 pc is the height above the
 * physical mid-plane, which is tilted against the IAU b = 0 plane; the P4 Milky Way model uses it.)
 */
export const SSB_IN_MW: Readonly<Vec3d> = (() => {
  const icrs = vec3(
    Math.cos(SGRA_DEC) * Math.cos(SGRA_RA),
    Math.cos(SGRA_DEC) * Math.sin(SGRA_RA),
    Math.sin(SGRA_DEC),
  );
  const g = mat3MulVec(ICRS_TO_GALACTIC, icrs);
  return Object.freeze(vec3(-g.x * R0_GALACTIC, -g.y * R0_GALACTIC, -g.z * R0_GALACTIC));
})();

/** Influence radii of the standard frames, m. */
export const MW_INFLUENCE = 100 * KPC;
export const SSB_INFLUENCE = 2e5 * AU;

/** Adds `mw` and `ssb` under the root. Idempotent. */
export function addStandardFrames(tree: FrameTree): void {
  const qMw = qfromMatrix(quat(), GALACTIC_TO_SUPERGALACTIC);
  const qSsb = qfromMatrix(quat(), ICRS_TO_GALACTIC);
  if (!tree.has(MW_FRAME)) {
    tree.addFrame({
      id: MW_FRAME,
      parent: ROOT_FRAME,
      influenceRadius: MW_INFLUENCE,
      positionAt: (_jd, out) => v3set(out, 0, 0, 0),
      orientationAt: (_jd, out) => qcopy(out, qMw),
    });
  }
  if (!tree.has(SSB_FRAME)) {
    tree.addFrame({
      id: SSB_FRAME,
      parent: MW_FRAME,
      influenceRadius: SSB_INFLUENCE,
      positionAt: (_jd, out) => v3copy(out, SSB_IN_MW),
      orientationAt: (_jd, out) => qcopy(out, qSsb),
    });
  }
}
