/**
 * Low-poly mesh builder for the procedural creatures and plants (life module). Model space: metres,
 * +x forward, +y up, +z to the right; the origin is on the ground under the animal. Triangles are not
 * indexed and carry no normals: the fragment shader takes the face normal from screen-space derivatives,
 * which keeps the faceted look after the vertex shader has posed the limbs.
 *
 * Every vertex carries the joint it hangs from, for the procedural gaits in glsl/life.vert.glsl:
 * - aJoint.xyz: pivot of the limb, neck or tail; aJoint.w: the part (PART below).
 * - aBend.xyz: second pivot (knee or elbow; for tails and necks unused); aBend.w: 0 above the knee,
 *   1 below it; for tails, necks and wings 0 at the root .. 1 at the tip; for plants, the sway weight.
 */
import { BufferAttribute, BufferGeometry } from 'three';

export type V3 = [number, number, number];

/** Part codes (aJoint.w); keep in sync with glsl/life.vert.glsl. */
export const PART = {
  body: 0,
  legFL: 1,
  legFR: 2,
  legBL: 3,
  legBR: 4,
  neck: 5,
  tail: 6,
  wingL: 7,
  wingR: 8,
  armL: 9,
  armR: 10,
  plant: 11,
} as const;

export interface Joint {
  part: number;
  pivot: V3;
  /** Second pivot (knee/elbow). */
  knee?: V3;
}

/** sRGB hex to linear RGB. */
export function rgb(hex: number): V3 {
  const c = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return [c((hex >> 16) & 255), c((hex >> 8) & 255), c(hex & 255)];
}

export function mixRgb(a: V3, b: V3, t: number): V3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** One loft cross-section: centre, half-width (z), half-height (y), and colours. */
export interface Ring {
  p: V3;
  w: number;
  h: number;
  /** Back colour (top) and belly colour (bottom); belly defaults to top. */
  top: V3;
  belly?: V3;
  /** Bend weight 0..1 (tails and necks) or below-knee flag (legs). */
  bend?: number;
}

/** Deterministic pseudo-random in [0, 1) from integers. */
export function hash01(...n: number[]): number {
  let h = 2166136261;
  for (const v of n) {
    h ^= Math.floor(v) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995) >>> 0;
    h ^= h >>> 15;
  }
  return (h >>> 0) / 4294967296;
}

export class MeshBuilder {
  private pos: number[] = [];
  private col: number[] = [];
  private joint: number[] = [];
  private bend: number[] = [];
  /** Optional per-builder colour jitter amplitude (facet-to-facet variation). */
  jitter = 0.06;
  private tri = 0;

  get triangles(): number {
    return this.tri;
  }

  private vertex(p: V3, c: V3, j: Joint, b: number): void {
    this.pos.push(p[0], p[1], p[2]);
    this.col.push(c[0], c[1], c[2]);
    const pv = j.pivot;
    this.joint.push(pv[0], pv[1], pv[2], j.part);
    const k = j.knee ?? j.pivot;
    this.bend.push(k[0], k[1], k[2], b);
  }

  /** A triangle with one colour (lightly jittered per facet) and per-vertex bend weights. */
  triangle(a: V3, b: V3, c: V3, colour: V3, j: Joint, ba = 0, bb = ba, bc = ba): void {
    const r = this.jitter ? 1 + this.jitter * (2 * hash01(this.tri, 7) - 1) : 1;
    const cc: V3 = [colour[0] * r, colour[1] * r, colour[2] * r];
    this.vertex(a, cc, j, ba);
    this.vertex(b, cc, j, bb);
    this.vertex(c, cc, j, bc);
    this.tri++;
  }

  quad(a: V3, b: V3, c: V3, d: V3, colour: V3, j: Joint, ba = 0, bb = ba, bc = bb, bd = ba): void {
    this.triangle(a, b, c, colour, j, ba, bb, bc);
    this.triangle(a, c, d, colour, j, ba, bc, bd);
  }

  /**
   * Lofts elliptical cross-sections along a path (each ring perpendicular to the path), capping both
   * ends. `sides` 5-8 keeps the faceted look; `twist` rotates the rings (radians).
   */
  loft(
    rings: Ring[],
    sides: number,
    j: Joint,
    opts: { capStart?: boolean; capEnd?: boolean; twist?: number } = {},
  ) {
    const n = rings.length;
    const frames: { s: V3; u: V3 }[] = [];
    for (let i = 0; i < n; i++) {
      const a = rings[Math.max(0, i - 1)].p;
      const b = rings[Math.min(n - 1, i + 1)].p;
      const t = norm(sub(b, a));
      let side = cross(t, [0, 1, 0]);
      if (len(side) < 1e-3) side = cross(t, [1, 0, 0]);
      side = norm(side);
      const up = norm(cross(side, t));
      frames.push({ s: side, u: up });
    }
    const tw = opts.twist ?? Math.PI / sides;
    const pt = (i: number, k: number): V3 => {
      const r = rings[i];
      const a = tw + (2 * Math.PI * k) / sides;
      const { s, u } = frames[i];
      return add(r.p, add(scale(s, Math.cos(a) * r.w), scale(u, Math.sin(a) * r.h)));
    };
    const colourAt = (i: number, k: number): V3 => {
      const r = rings[i];
      const a = tw + (2 * Math.PI * (k + 0.5)) / sides;
      const below = Math.sin(a) < -0.2;
      return below && r.belly ? r.belly : r.top;
    };
    for (let i = 0; i < n - 1; i++) {
      const b0 = rings[i].bend ?? 0;
      const b1 = rings[i + 1].bend ?? 0;
      for (let k = 0; k < sides; k++) {
        const k1 = (k + 1) % sides;
        const c = mixRgb(colourAt(i, k), colourAt(i + 1, k), 0.5);
        this.quad(pt(i, k), pt(i + 1, k), pt(i + 1, k1), pt(i, k1), c, j, b0, b1, b1, b0);
      }
    }
    const cap = (i: number, flip: boolean) => {
      const r = rings[i];
      if (r.w < 1e-4 && r.h < 1e-4) return;
      const b = r.bend ?? 0;
      for (let k = 0; k < sides; k++) {
        const k1 = (k + 1) % sides;
        const c = colourAt(i, k);
        if (flip) this.triangle(r.p, pt(i, k1), pt(i, k), c, j, b);
        else this.triangle(r.p, pt(i, k), pt(i, k1), c, j, b);
      }
    };
    if (opts.capStart !== false) cap(0, true);
    if (opts.capEnd !== false) cap(n - 1, false);
  }

  /** A faceted ellipsoid (low-poly blob) centred at c with radii r. */
  blob(
    c: V3,
    r: V3,
    colour: V3,
    j: Joint,
    opts: { lat?: number; lon?: number; seed?: number; rough?: number; bend?: number } = {},
  ) {
    const lat = opts.lat ?? 4;
    const lon = opts.lon ?? 6;
    const seed = opts.seed ?? 0;
    const rough = opts.rough ?? 0;
    const pts: V3[][] = [];
    for (let i = 0; i <= lat; i++) {
      const th = (Math.PI * i) / lat - Math.PI / 2;
      const row: V3[] = [];
      for (let k = 0; k < lon; k++) {
        const ph = (2 * Math.PI * (k + (i % 2) * 0.5)) / lon;
        const f = 1 + rough * (2 * hash01(seed, i, k) - 1);
        row.push([
          c[0] + Math.cos(th) * Math.cos(ph) * r[0] * f,
          c[1] + Math.sin(th) * r[1] * f,
          c[2] + Math.cos(th) * Math.sin(ph) * r[2] * f,
        ]);
      }
      pts.push(row);
    }
    const b = opts.bend ?? 0;
    for (let i = 0; i < lat; i++)
      for (let k = 0; k < lon; k++) {
        const k1 = (k + 1) % lon;
        const shade = 0.85 + 0.15 * (i / lat);
        const cc = scale(colour, shade);
        if (i === 0) this.triangle(pts[0][k], pts[1][k1], pts[1][k], cc, j, b);
        else if (i === lat - 1) this.triangle(pts[i][k], pts[i][k1], pts[i + 1][k], cc, j, b);
        else this.quad(pts[i][k], pts[i][k1], pts[i + 1][k1], pts[i + 1][k], cc, j, b);
      }
  }

  /** A cone from base centre `a` (radius r) to apex `b`. */
  cone(a: V3, b: V3, r: number, sides: number, colour: V3, j: Joint, bendA = 0, bendB = bendA) {
    this.loft(
      [
        { p: a, w: r, h: r, top: colour, bend: bendA },
        { p: b, w: 1e-5, h: 1e-5, top: colour, bend: bendB },
      ],
      sides,
      j,
      { capEnd: false },
    );
  }

  /** A flat, double-sided leaf/frond/plate: a polygon fan given as an outline around `base`. */
  fan(base: V3, outline: V3[], colour: V3, j: Joint, bends?: number[], baseBend = 0) {
    for (let i = 0; i < outline.length - 1; i++) {
      const b1 = bends?.[i] ?? baseBend;
      const b2 = bends?.[i + 1] ?? baseBend;
      this.triangle(base, outline[i], outline[i + 1], colour, j, baseBend, b1, b2);
      this.triangle(base, outline[i + 1], outline[i], colour, j, baseBend, b2, b1);
    }
  }

  /** Mirrors everything added since `from` (vertex index) across the z = 0 plane with a new joint part. */
  mirrorFrom(fromTri: number, partMap: (p: number) => number): void {
    const start = fromTri * 3;
    const end = this.tri * 3;
    for (let v = start; v < end; v += 3) {
      // reverse the winding: v, v+2, v+1
      for (const o of [0, 2, 1]) {
        const i = v + o;
        this.pos.push(this.pos[i * 3], this.pos[i * 3 + 1], -this.pos[i * 3 + 2]);
        this.col.push(this.col[i * 3], this.col[i * 3 + 1], this.col[i * 3 + 2]);
        this.joint.push(
          this.joint[i * 4],
          this.joint[i * 4 + 1],
          -this.joint[i * 4 + 2],
          partMap(this.joint[i * 4 + 3]),
        );
        this.bend.push(this.bend[i * 4], this.bend[i * 4 + 1], -this.bend[i * 4 + 2], this.bend[i * 4 + 3]);
      }
      this.tri++;
    }
  }

  /** Bounding radius about the origin (for culling) and height. */
  bounds(): { radius: number; height: number } {
    let r = 0;
    let h = 0;
    for (let i = 0; i < this.pos.length; i += 3) {
      r = Math.max(r, Math.hypot(this.pos[i], this.pos[i + 1], this.pos[i + 2]));
      h = Math.max(h, this.pos[i + 1]);
    }
    return { radius: r, height: h };
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('aJoint', new BufferAttribute(new Float32Array(this.joint), 4));
    g.setAttribute('aBend', new BufferAttribute(new Float32Array(this.bend), 4));
    const { radius } = this.bounds();
    g.boundingSphere = null;
    g.userData.radius = radius;
    return g;
  }

  /** Raw arrays (tests). */
  arrays() {
    return { pos: this.pos, col: this.col, joint: this.joint, bend: this.bend };
  }
}
