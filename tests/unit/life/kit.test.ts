import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUILDINGS, buildBuilding, type BuildingKind } from '../../../src/modules/life/kit/buildings';
import { buildCreature } from '../../../src/modules/life/kit/creatures';
import { MeshBuilder, PART, type Joint, type V3 } from '../../../src/modules/life/kit/mesh';
import { MODELS } from '../../../src/modules/life/kit/models';
import { PLANTS, buildPlant, type PlantKind } from '../../../src/modules/life/kit/plants';

// The life material culls back faces (three.js FrontSide: counter-clockwise is the front), so every
// closed or solid part must be wound counter-clockwise seen from outside. Only fans, fronds and grass
// blades are double-sided (each face twice, once per winding).

type Tri = [V3, V3, V3];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const still: Joint = { part: PART.body, pivot: [0, 0, 0] };
const grey: V3 = [0.5, 0.5, 0.5];

function tris(m: MeshBuilder, from = 0, to = m.triangles): Tri[] {
  const { pos } = m.arrays();
  const out: Tri[] = [];
  for (let t = from; t < to; t++) {
    const v = (k: number): V3 => [pos[9 * t + 3 * k], pos[9 * t + 3 * k + 1], pos[9 * t + 3 * k + 2]];
    out.push([v(0), v(1), v(2)]);
  }
  return out;
}

/** Area-weighted normal (cross product in vertex order; |n| = 2 * area). */
const normal = ([a, b, c]: Tri): V3 => cross(sub(b, a), sub(c, a));
const centre = ([a, b, c]: Tri): V3 => [
  (a[0] + b[0] + c[0]) / 3,
  (a[1] + b[1] + c[1]) / 3,
  (a[2] + b[2] + c[2]) / 3,
];

function vertexCentroid(ts: Tri[]): V3 {
  const c: V3 = [0, 0, 0];
  for (const t of ts) for (const p of t) for (let i = 0; i < 3; i++) c[i] += p[i] / (3 * ts.length);
  return c;
}

/** Signed volume enclosed relative to `o` (positive when the faces point away from `o` on average). */
function signedVolume(ts: Tri[], o: V3): number {
  let v = 0;
  for (const [a, b, c] of ts) v += dot(sub(a, o), cross(sub(b, o), sub(c, o))) / 6;
  return v;
}

const area = (ts: Tri[]) => ts.reduce((s, t) => s + Math.hypot(...normal(t)) / 2, 0);
const key = (p: V3) => p.map((v) => Math.round(v * 1e6)).join(',');

/**
 * Directed-edge census of a triangle set (vertices matched to 1 um; degenerate triangles skipped).
 * `twice`: directed edges used by two triangles (the neighbours disagree on the winding).
 * `open`: directed edges whose reverse is missing (a hole or a border).
 */
function edges(ts: Tri[]): { twice: number; open: number } {
  const count = new Map<string, number>();
  for (const t of ts) {
    const k = t.map(key);
    if (k[0] === k[1] || k[1] === k[2] || k[2] === k[0]) continue;
    for (let i = 0; i < 3; i++) {
      const e = `${k[i]}|${k[(i + 1) % 3]}`;
      count.set(e, (count.get(e) ?? 0) + 1);
    }
  }
  let twice = 0;
  let open = 0;
  for (const [e, n] of count) {
    if (n > 1) twice++;
    const [a, b] = e.split('|');
    if (!count.has(`${b}|${a}`)) open++;
  }
  return { twice, open };
}

describe('mesh builder winding', () => {
  it('winds blobs outward and closes them, also when rough', () => {
    for (const rough of [0, 0.25, 0.4])
      for (const [lat, lon] of [
        [2, 4],
        [3, 6],
        [4, 7],
      ]) {
        const m = new MeshBuilder();
        const c: V3 = [1, 2, -3];
        m.blob(c, [3.2, 2.6, 3.2], grey, still, { lat, lon, rough, seed: 5 });
        const ts = tris(m);
        const label = `lat ${lat} lon ${lon} rough ${rough}`;
        for (const t of ts) expect(dot(normal(t), sub(centre(t), c)), label).toBeGreaterThan(0);
        expect(edges(ts), label).toEqual({ twice: 0, open: 0 });
        expect(signedVolume(ts, [0, 0, 0]), label).toBeGreaterThan(0);
      }
  });

  it('winds lofts, their end caps and cones outward', () => {
    const m = new MeshBuilder();
    // A closed cylinder along +x (both caps) and one along -y (vertical frames).
    for (const [a, b] of [
      [
        [0, 1, 0],
        [4, 1, 0],
      ],
      [
        [10, 5, 0],
        [10, 1, 0],
      ],
    ] as [V3, V3][]) {
      const from = m.triangles;
      m.loft(
        [
          { p: a, w: 0.5, h: 0.7, top: grey },
          { p: b, w: 0.4, h: 0.6, top: grey },
        ],
        6,
        still,
      );
      const ts = tris(m, from);
      const mid: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
      for (const t of ts) expect(dot(normal(t), sub(centre(t), mid))).toBeGreaterThan(0);
      expect(edges(ts)).toEqual({ twice: 0, open: 0 });
      expect(signedVolume(ts, [0, 0, 0])).toBeGreaterThan(0);
    }
    // A cone: the base cap faces away from the apex.
    const from = m.triangles;
    m.cone([0, 0, 5], [0.3, 2, 5], 0.5, 5, grey, still);
    const ts = tris(m, from);
    const inside: V3 = [0.1, 0.5, 5];
    for (const t of ts) expect(dot(normal(t), sub(centre(t), inside))).toBeGreaterThan(0);
    expect(edges(ts).twice).toBe(0);
    expect(signedVolume(ts, inside)).toBeGreaterThan(0);
  });

  it('makes fans double-sided', () => {
    const m = new MeshBuilder();
    m.fan(
      [0, 0, 0],
      [
        [1, 0, 0],
        [1, 1, 0],
        [0, 1, 0.2],
      ],
      grey,
      still,
    );
    const ns = tris(m).map(normal);
    expect(ns.length).toBe(4);
    for (let i = 0; i < ns.length; i += 2)
      for (let k = 0; k < 3; k++) expect(ns[i][k] + ns[i + 1][k]).toBeCloseTo(0, 12);
  });

  it('keeps mirrored parts wound outward', () => {
    const m = new MeshBuilder();
    m.blob([0.5, 1, 1.5], [0.4, 0.3, 0.2], grey, { part: PART.legBR, pivot: [0, 1, 1] }, { lat: 3, lon: 6 });
    const n = m.triangles;
    m.mirrorFrom(0, (p) => (p === PART.legBR ? PART.legBL : p));
    const ts = tris(m, n);
    expect(ts.length).toBe(n);
    for (const t of ts) expect(dot(normal(t), sub(centre(t), [0.5, 1, -1.5]))).toBeGreaterThan(0);
    expect(m.arrays().joint[4 * 3 * n + 3]).toBe(PART.legBL);
  });
});

describe('mesh builder blobs', () => {
  it('keeps the poles of rough blobs at c.y ± r.y: a blob centred at its radius rests on the ground', () => {
    for (const rough of [0, 0.3, 0.4])
      for (const seed of [0, 1, 2, 3, 9])
        for (const lat of [2, 3, 4]) {
          const m = new MeshBuilder();
          m.blob([0.3, 0.7, -0.2], [0.75, 0.7, 0.75], grey, still, { lat, lon: 5, rough, seed });
          const { pos } = m.arrays();
          let lo = Infinity;
          let hi = -Infinity;
          for (let i = 1; i < pos.length; i += 3) {
            lo = Math.min(lo, pos[i]);
            hi = Math.max(hi, pos[i]);
          }
          const label = `rough ${rough} seed ${seed} lat ${lat}`;
          expect(lo, label).toBeCloseTo(0, 9);
          expect(hi, label).toBeCloseTo(1.4, 9);
        }
  });
});

/** Primitive calls (outermost blob, loft or fan) made while building a model, by triangle range. */
interface Call {
  kind: 'blob' | 'loft' | 'fan';
  from: number;
  to: number;
}

let calls: Call[] = [];
const restore: (() => void)[] = [];

beforeAll(() => {
  const proto = MeshBuilder.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
  let depth = 0;
  for (const kind of ['blob', 'loft', 'fan'] as const) {
    const orig = proto[kind];
    proto[kind] = function (this: MeshBuilder, ...args: unknown[]) {
      const from = this.triangles;
      depth++;
      try {
        return orig.apply(this, args);
      } finally {
        depth--;
        if (depth === 0) calls.push({ kind, from, to: this.triangles });
      }
    };
    restore.push(() => (proto[kind] = orig));
  }
});

afterAll(() => {
  for (const r of restore) r();
});

function capture(build: () => MeshBuilder): { m: MeshBuilder; calls: Call[] } {
  calls = [];
  const m = build();
  return { m, calls };
}

const models: [string, () => MeshBuilder][] = [
  ...Object.entries(MODELS).map(([id, c]): [string, () => MeshBuilder] => [id, () => buildCreature(c.spec)]),
  ...(Object.keys(PLANTS) as PlantKind[]).map((k): [string, () => MeshBuilder] => [
    k,
    () => buildPlant(k, 3),
  ]),
  ...(Object.keys(BUILDINGS) as BuildingKind[]).map((k): [string, () => MeshBuilder] => [
    k,
    () => buildBuilding(k, 3),
  ]),
];

describe('model winding', () => {
  it('winds every blob, loft and cone of every creature, plant and building outward', () => {
    for (const [id, build] of models) {
      const { m, calls: cs } = capture(build);
      for (const [i, c] of cs.entries()) {
        if (c.kind === 'fan') continue;
        const ts = tris(m, c.from, c.to);
        const label = `${id}: ${c.kind} #${i}`;
        const e = edges(ts);
        expect(e.twice, label).toBe(0);
        if (c.kind === 'blob') expect(e.open, label).toBe(0);
        expect(signedVolume(ts, vertexCentroid(ts)), label).toBeGreaterThan(0);
      }
    }
  });

  it('makes fans, fronds and grass double-sided', () => {
    for (const [id, build] of models) {
      const { m, calls: cs } = capture(build);
      if (id in BUILDINGS) continue;
      const solid = new Set<number>();
      for (const c of cs) if (c.kind !== 'fan') for (let t = c.from; t < c.to; t++) solid.add(t);
      const sum: V3 = [0, 0, 0];
      let total = 0;
      tris(m).forEach((t, i) => {
        if (solid.has(i)) return;
        const n = normal(t);
        for (let k = 0; k < 3; k++) sum[k] += n[k];
        total += Math.hypot(...n);
      });
      expect(Math.hypot(...sum), id).toBeLessThan(1e-9 * Math.max(1, total));
    }
  });

  it('winds the walls, roofs and openings of every building outward', () => {
    for (const kind of Object.keys(BUILDINGS) as BuildingKind[]) {
      const { m, calls: cs } = capture(() => buildBuilding(kind, 3));
      const inCall = new Set<number>();
      for (const c of cs) for (let t = c.from; t < c.to; t++) inCall.add(t);
      const all = tris(m);
      // Exact repeats (e.g. a corner merlon listed twice) would make every edge look non-manifold.
      const seen = new Set<string>();
      const loose = all
        .map((_, i) => i)
        .filter((i) => {
          const k = all[i].map(key);
          const r = k.indexOf([...k].sort()[0]);
          const id = [k[r], k[(r + 1) % 3], k[(r + 2) % 3]].join('|');
          if (inCall.has(i) || seen.has(id)) return false;
          seen.add(id);
          return true;
        });
      // Faces joined by manifold edges (exactly two faces) form one piece: a box, a roof, a sawtooth.
      const byEdge = new Map<string, number[]>();
      for (const i of loose) {
        const k = all[i].map(key);
        for (let j = 0; j < 3; j++) {
          const e = [k[j], k[(j + 1) % 3]].sort().join('|');
          byEdge.set(e, [...(byEdge.get(e) ?? []), i]);
        }
      }
      const root = new Map<number, number>(loose.map((i) => [i, i]));
      const find = (i: number): number => {
        while (root.get(i)! !== i) i = root.get(i)!;
        return i;
      };
      for (const l of byEdge.values()) if (l.length === 2) root.set(find(l[0]), find(l[1]));
      const pieces = new Map<number, Tri[]>();
      for (const i of loose) pieces.set(find(i), [...(pieces.get(find(i)) ?? []), all[i]]);
      for (const ts of pieces.values()) {
        const c = vertexCentroid(ts);
        const v = signedVolume(ts, c);
        const label = `${kind}: piece of ${ts.length} at ${c.map((x) => x.toFixed(1))}`;
        if (Math.abs(v) > 1e-6 * area(ts) ** 1.5) {
          expect(v, label).toBeGreaterThan(0);
        } else {
          // Flat pieces (facade openings, gable ends) face away from the building's axis.
          const n = ts.map(normal).reduce((s, x) => [s[0] + x[0], s[1] + x[1], s[2] + x[2]]);
          expect(dot(n, [c[0], 0, c[2]]), label).toBeGreaterThan(0);
        }
      }
    }
  });
});
