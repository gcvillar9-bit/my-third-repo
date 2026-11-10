/**
 * Low-poly mesh kit for the spacecraft models (three-free: plain arrays, unit-testable in Node).
 * Model space is the craft's body axes in metres, to scale. Triangles are not indexed; every
 * vertex carries a normal and a material so the one craft shader needs no textures:
 *
 * - position: Float32 xyz
 * - normal:   Int8 xyzw, normalised: unit normal, w = 1 for parts that never see the Sun because
 *             the craft's own sunshield covers them (the shader has no shadow maps)
 * - color:    Uint8 rgba, normalised: rgb = sqrt(albedo) (linear albedo squared back in the
 *             shader, which keeps dark coatings smooth in 8 bits), a = gloss 0..1
 *
 * Every face is wound counter-clockwise seen from outside and the material culls back faces, so a
 * thin sheet (solar panel, sunshield layer) is two faces back to back, each with its own colour.
 */
export type V3 = [number, number, number];

export interface Material {
  /** Linear albedo. */
  color: V3;
  /** 0 matte paint .. 1 mirror foil. */
  gloss?: number;
  /** True for parts in the permanent shadow of the craft's own sunshield. */
  shaded?: boolean;
}

/** sRGB hex colour → linear albedo material. */
export function mat(hex: number, gloss = 0.2, shaded = false): Material {
  const c = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return { color: [c((hex >> 16) & 255), c((hex >> 8) & 255), c(hex & 255)], gloss, shaded };
}

/** Same material, albedo scaled (panel-to-panel variation). */
export const tint = (m: Material, k: number): Material => ({
  ...m,
  color: [Math.min(1, m.color[0] * k), Math.min(1, m.color[1] * k), Math.min(1, m.color[2] * k)],
});

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
/** `a` moved along `dir` (any length) by `d` metres. */
export const along = (a: V3, dir: V3, d: number): V3 => add(a, scale(norm(dir), d));

/** Two unit vectors that complete `axis` to a right-handed basis (u × v = axis). */
export function basis(axis: V3): [V3, V3] {
  const d = norm(axis);
  const ref: V3 = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = norm(cross(ref, d));
  return [u, cross(d, u)];
}

/** Finished mesh data. */
export interface MeshData {
  position: Float32Array;
  normal: Int8Array;
  color: Uint8Array;
  triangles: number;
  /** Largest distance of a vertex from the origin, m. */
  radius: number;
}

export class MeshBuilder {
  private pos: number[] = [];
  private nrm: number[] = [];
  private col: number[] = [];
  private count = 0;

  get triangles(): number {
    return this.count;
  }

  private vertex(p: V3, n: V3, m: Material): void {
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2], m.shaded ? 1 : 0);
    this.col.push(Math.sqrt(m.color[0]), Math.sqrt(m.color[1]), Math.sqrt(m.color[2]), m.gloss ?? 0.2);
  }

  /** A triangle, counter-clockwise from outside. Without normals it is flat. */
  tri(a: V3, b: V3, c: V3, m: Material, na?: V3, nb?: V3, nc?: V3): void {
    const flat = cross(sub(b, a), sub(c, a));
    if (len(flat) < 1e-12) return; // degenerate (e.g. the centre of a dish)
    const n = norm(flat);
    this.vertex(a, na ?? n, m);
    this.vertex(b, nb ?? n, m);
    this.vertex(c, nc ?? n, m);
    this.count++;
  }

  /** A flat quad a-b-c-d, counter-clockwise from outside. */
  quad(a: V3, b: V3, c: V3, d: V3, m: Material): void {
    this.tri(a, b, c, m);
    this.tri(a, c, d, m);
  }

  /** A sheet seen from both sides: corners c ± u ± v; `front` faces u × v. */
  panel(c: V3, u: V3, v: V3, front: Material, back: Material = front): void {
    const a = sub(sub(c, u), v);
    const b = sub(add(c, u), v);
    const cc = add(add(c, u), v);
    const d = add(sub(c, u), v);
    this.quad(a, b, cc, d, front);
    this.quad(a, d, cc, b, back);
  }

  /** A convex polygon seen from both sides; `front` faces the side from which it runs counter-clockwise. */
  polygon(points: V3[], front: Material, back: Material | null = front): void {
    for (let i = 1; i + 1 < points.length; i++) {
      this.tri(points[0], points[i], points[i + 1], front);
      if (back) this.tri(points[0], points[i + 1], points[i], back);
    }
  }

  /** A box with half-extents `h` along the unit axes ax, ay (az = ax × ay), centred at c. */
  box(c: V3, h: V3, m: Material, ax: V3 = [1, 0, 0], ay: V3 = [0, 1, 0]): void {
    const x = scale(norm(ax), h[0]);
    const y = scale(norm(ay), h[1]);
    const z = scale(norm(cross(ax, ay)), h[2]);
    const p = (sx: number, sy: number, sz: number): V3 =>
      add(add(add(c, scale(x, sx)), scale(y, sy)), scale(z, sz));
    this.quad(p(1, -1, -1), p(1, 1, -1), p(1, 1, 1), p(1, -1, 1), m); // +x
    this.quad(p(-1, -1, -1), p(-1, -1, 1), p(-1, 1, 1), p(-1, 1, -1), m); // -x
    this.quad(p(-1, 1, -1), p(-1, 1, 1), p(1, 1, 1), p(1, 1, -1), m); // +y
    this.quad(p(-1, -1, -1), p(1, -1, -1), p(1, -1, 1), p(-1, -1, 1), m); // -y
    this.quad(p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1), m); // +z
    this.quad(p(-1, -1, -1), p(-1, 1, -1), p(1, 1, -1), p(1, -1, -1), m); // -z
  }

  /**
   * A cylinder or cone frustum from p0 (radius r0) to p1 (radius r1). `smooth` shades it round;
   * otherwise each side is a flat facet (prisms such as a probe's bus). Caps close the ends.
   */
  cyl(
    p0: V3,
    p1: V3,
    r0: number,
    r1: number,
    sides: number,
    m: Material,
    opts: { smooth?: boolean; cap0?: Material | false; cap1?: Material | false; phase?: number } = {},
  ): void {
    const d = sub(p1, p0);
    const L = len(d);
    const dir = norm(d);
    const [u, v] = basis(dir);
    const phase = opts.phase ?? 0;
    const radial = (k: number): V3 => {
      const a = phase + (2 * Math.PI * k) / sides;
      return add(scale(u, Math.cos(a)), scale(v, Math.sin(a)));
    };
    const smooth = opts.smooth ?? true;
    for (let k = 0; k < sides; k++) {
      const ra = radial(k);
      const rb = radial(k + 1);
      const a0 = add(p0, scale(ra, r0));
      const a1 = add(p0, scale(rb, r0));
      const b0 = add(p1, scale(ra, r1));
      const b1 = add(p1, scale(rb, r1));
      if (smooth) {
        // Outward normal of a frustum: radial, tipped along the axis by the slope.
        const na = norm(add(scale(ra, L), scale(dir, r0 - r1)));
        const nb = norm(add(scale(rb, L), scale(dir, r0 - r1)));
        this.tri(a0, a1, b1, m, na, nb, nb);
        this.tri(a0, b1, b0, m, na, nb, na);
      } else {
        this.tri(a0, a1, b1, m);
        this.tri(a0, b1, b0, m);
      }
      const c0 = opts.cap0 ?? m;
      const c1 = opts.cap1 ?? m;
      if (c0 && r0 > 0) this.tri(p0, a1, a0, c0);
      if (c1 && r1 > 0) this.tri(p1, b0, b1, c1);
    }
  }

  /** A thin strut (boom, tripod leg): a three-sided or four-sided rod without caps. */
  strut(p0: V3, p1: V3, r: number, m: Material, sides = 4): void {
    this.cyl(p0, p1, r, r, sides, m, { smooth: false, cap0: false, cap1: false });
  }

  /**
   * A paraboloid dish with its vertex at `c`, opening along `axis`: `front` is the concave face.
   * z(r) = depth (r / radius)².
   */
  dish(
    c: V3,
    axis: V3,
    radius: number,
    depth: number,
    sides: number,
    rings: number,
    front: Material,
    back: Material,
  ): void {
    const dir = norm(axis);
    const [u, v] = basis(dir);
    const point = (j: number, k: number): V3 => {
      const r = (radius * j) / rings;
      const a = (2 * Math.PI * k) / sides;
      const z = depth * (r / radius) ** 2;
      return add(add(c, scale(dir, z)), add(scale(u, r * Math.cos(a)), scale(v, r * Math.sin(a))));
    };
    const normal = (j: number, k: number): V3 => {
      const r = (radius * j) / rings;
      const a = (2 * Math.PI * k) / sides;
      const slope = (2 * depth * r) / (radius * radius);
      return norm(sub(dir, scale(add(scale(u, Math.cos(a)), scale(v, Math.sin(a))), slope)));
    };
    for (let j = 0; j < rings; j++) {
      for (let k = 0; k < sides; k++) {
        const [i0, o0, o1, i1] = [point(j, k), point(j + 1, k), point(j + 1, k + 1), point(j, k + 1)];
        const [ni0, no0, no1, ni1] = [normal(j, k), normal(j + 1, k), normal(j + 1, k + 1), normal(j, k + 1)];
        const neg = (n: V3) => scale(n, -1);
        this.tri(i0, o0, o1, front, ni0, no0, no1);
        this.tri(i0, o1, i1, front, ni0, no1, ni1);
        this.tri(i0, o1, o0, back, neg(ni0), neg(no1), neg(no0));
        this.tri(i0, i1, o1, back, neg(ni0), neg(ni1), neg(no1));
      }
    }
  }

  /** A sphere or ellipsoid (radii along x, y, z), shaded round. */
  ball(c: V3, r: V3 | number, lat: number, lon: number, m: Material): void {
    const rr: V3 = typeof r === 'number' ? [r, r, r] : r;
    const p = (i: number, k: number): { p: V3; n: V3 } => {
      const th = (Math.PI * i) / lat - Math.PI / 2;
      const ph = (2 * Math.PI * k) / lon;
      const d: V3 = [Math.cos(th) * Math.cos(ph), Math.cos(th) * Math.sin(ph), Math.sin(th)];
      return {
        p: [c[0] + d[0] * rr[0], c[1] + d[1] * rr[1], c[2] + d[2] * rr[2]],
        n: norm([d[0] / rr[0], d[1] / rr[1], d[2] / rr[2]]),
      };
    };
    for (let i = 0; i < lat; i++) {
      for (let k = 0; k < lon; k++) {
        const [a, b, cc, d] = [p(i, k), p(i, k + 1), p(i + 1, k + 1), p(i + 1, k)];
        this.tri(a.p, b.p, cc.p, m, a.n, b.n, cc.n);
        this.tri(a.p, cc.p, d.p, m, a.n, cc.n, d.n);
      }
    }
  }

  /**
   * A lattice boom from p0 to p1: three longerons on a triangle of circumradius `r`, with a
   * batten triangle and one diagonal per bay. Reads as an open truss at any distance.
   */
  lattice(p0: V3, p1: V3, r: number, bays: number, rod: number, m: Material): void {
    const d = sub(p1, p0);
    const [u, v] = basis(d);
    const corner = (t: number, k: number): V3 => {
      const a = (2 * Math.PI * k) / 3;
      return add(add(p0, scale(d, t)), add(scale(u, r * Math.cos(a)), scale(v, r * Math.sin(a))));
    };
    for (let k = 0; k < 3; k++) this.strut(corner(0, k), corner(1, k), rod, m, 3);
    for (let b = 0; b <= bays; b++) {
      const t = b / bays;
      for (let k = 0; k < 3; k++) {
        this.strut(corner(t, k), corner(t, (k + 1) % 3), rod, m, 3);
        if (b < bays) this.strut(corner(t, k), corner((b + 1) / bays, (k + 1) % 3), rod, m, 3);
      }
    }
  }

  build(): MeshData {
    const n = this.pos.length / 3;
    const normal = new Int8Array(4 * n);
    const color = new Uint8Array(4 * n);
    let radius = 0;
    for (let i = 0; i < n; i++) {
      radius = Math.max(radius, Math.hypot(this.pos[3 * i], this.pos[3 * i + 1], this.pos[3 * i + 2]));
      for (let k = 0; k < 3; k++) normal[4 * i + k] = Math.round(127 * this.nrm[4 * i + k]);
      normal[4 * i + 3] = this.nrm[4 * i + 3] ? 127 : 0;
      for (let k = 0; k < 4; k++)
        color[4 * i + k] = Math.round(255 * Math.min(1, Math.max(0, this.col[4 * i + k])));
    }
    return { position: new Float32Array(this.pos), normal, color, triangles: this.count, radius };
  }
}

/** One rigid piece of a craft. */
export interface ModelPart {
  name: string;
  mesh: MeshData;
  /** Where the part's own origin sits in the craft's body axes, m. */
  pivot: V3;
  /** 'sun-y': the part turns about its y axis to face the Sun (the station's solar arrays). */
  track?: 'sun-y';
}

/** A craft model: parts plus the body-axes convention (documented per model). */
export interface CraftModel {
  parts: ModelPart[];
  /** Bounding radius about the body origin, m. */
  radius: number;
  triangles: number;
}

export function assemble(parts: ModelPart[]): CraftModel {
  let radius = 0;
  let triangles = 0;
  for (const p of parts) {
    radius = Math.max(radius, len(p.pivot) + p.mesh.radius);
    triangles += p.mesh.triangles;
  }
  return { parts, radius, triangles };
}
