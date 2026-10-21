/**
 * Procedural low-poly creatures: one generic body-plan builder driven by per-species parameters
 * (models.ts). Sizes are real sizes in metres. Five plans:
 * - quad: four column legs under a horizontal body (sauropods, ceratopsians, mammals).
 * - biped: two hind legs, horizontal body balanced by the tail, small arms (theropods, hadrosaurs).
 * - sprawl: four legs out to the sides (synapsids, amphibians, early reptiles).
 * - upright: an upright primate (hominins, humans); `knuckle` gives a leaning ape.
 * - flyer: a pterosaur with membrane wings (flaps while flying).
 */
import { MeshBuilder, PART, mixRgb, rgb, type Joint, type Ring, type V3 } from './mesh';

export type BodyPlan = 'quad' | 'biped' | 'sprawl' | 'upright' | 'flyer';

export interface Extra {
  type:
    | 'sail'
    | 'plates'
    | 'tailSpikes'
    | 'horns'
    | 'frill'
    | 'crest'
    | 'trunk'
    | 'tusks'
    | 'ears'
    | 'hump'
    | 'armour'
    | 'club'
    | 'antlers'
    | 'mane'
    | 'beak'
    | 'hair'
    | 'boneCrest'
    | 'spines';
  size?: number;
  colour?: number;
}

export interface CreatureSpec {
  plan: BodyPlan;
  /** Body length (hip to shoulder region), height and width, m. */
  bodyLen: number;
  bodyH: number;
  bodyW: number;
  /** Height of the hip joint above the ground (leg length), m. */
  hipH: number;
  /** Height of the shoulder joint (quad/sprawl), m; defaults to hipH. */
  shoulderH?: number;
  legW: number;
  /** Front legs thinner/shorter (fraction of the hind ones). */
  frontLegScale?: number;
  neckLen: number;
  /** Degrees above horizontal. */
  neckAngle: number;
  neckW: number;
  headLen: number;
  headH: number;
  headW: number;
  /** Degrees the head tilts down from the neck direction. */
  headDroop?: number;
  tailLen: number;
  tailW: number;
  /** Degrees the tail points down (negative raises it). */
  tailDroop?: number;
  armLen?: number;
  wingSpan?: number;
  top: number;
  belly: number;
  accent?: number;
  extras?: Extra[];
  /** Facets around the body (5..8). */
  sides?: number;
  /** Upright: lean forward (degrees), for apes and early hominins. */
  lean?: number;
  /** Upright: clothing colour over the torso (humans). */
  clothing?: number;
  hairColour?: number;
}

const DEG = Math.PI / 180;

/** Builds the mesh of a creature in model space (see mesh.ts). */
export function buildCreature(s: CreatureSpec): MeshBuilder {
  const m = new MeshBuilder();
  if (s.plan === 'upright') buildUpright(m, s);
  else buildHorizontal(m, s);
  return m;
}

const body: Joint = { part: PART.body, pivot: [0, 0, 0] };

function ring(p: V3, w: number, h: number, top: V3, belly: V3, bend = 0): Ring {
  return { p, w, h, top, belly, bend };
}

/** A two-segment leg from `hip` down to the ground with the knee bent forward (+1) or back (-1). */
function leg(
  m: MeshBuilder,
  part: number,
  hip: V3,
  ground: V3,
  w: number,
  kneeDir: number,
  colour: V3,
  foot: V3,
  sides: number,
  outward = 0,
) {
  const len = hip[1] - ground[1];
  const knee: V3 = [
    (hip[0] + ground[0]) / 2 + kneeDir * 0.12 * len,
    hip[1] - 0.5 * len,
    hip[2] + outward * 0.6 + (ground[2] - hip[2]) * 0.4,
  ];
  const ankle: V3 = [ground[0] - kneeDir * 0.02 * len, ground[1] + Math.max(0.06, 0.08 * len), ground[2]];
  const j: Joint = { part, pivot: hip, knee };
  m.loft(
    [
      { p: [hip[0], hip[1] + w * 0.6, hip[2]], w: w * 1.15, h: w * 1.3, top: colour, bend: 0 },
      { p: hip, w: w * 1.1, h: w * 1.1, top: colour, bend: 0 },
      { p: knee, w: w * 0.8, h: w * 0.85, top: colour, bend: 0 },
      { p: knee, w: w * 0.75, h: w * 0.8, top: colour, bend: 1 },
      { p: ankle, w: w * 0.55, h: w * 0.55, top: colour, bend: 1 },
      {
        p: [ground[0] + 0.25 * w, ground[1] + 0.02, ground[2]],
        w: w * 0.75,
        h: w * 0.25,
        top: foot,
        bend: 1,
      },
    ],
    Math.max(4, sides - 2),
    j,
  );
}

function buildHorizontal(m: MeshBuilder, s: CreatureSpec) {
  const sides = s.sides ?? 7;
  const top = rgb(s.top);
  const belly = rgb(s.belly);
  const accent = rgb(s.accent ?? s.top);
  const dark = mixRgb(top, [0, 0, 0], 0.35);
  const L = s.bodyLen;
  const hipH = s.hipH;
  const shH = s.shoulderH ?? hipH;
  const sprawl = s.plan === 'sprawl';
  const biped = s.plan === 'biped';
  const flyer = s.plan === 'flyer';
  // Hip and shoulder along the spine.
  const hipX = -0.32 * L;
  const shX = 0.3 * L;
  const backY = (x: number) => {
    const t = (x - hipX) / (shX - hipX);
    return hipH + (shH - hipH) * t;
  };
  const cy = (x: number) => backY(x) + (sprawl ? 0.05 : 0.1) * s.bodyH;
  // Body: tail root .. hip .. belly .. chest .. neck root.
  const bx = [hipX - 0.22 * L, hipX, (hipX + shX) / 2, shX, shX + 0.18 * L];
  const bh = [0.7, 0.95, 1.0, 0.9, 0.62].map((f) => (f * s.bodyH) / 2);
  const bw = [0.65, 0.9, 1.0, 0.9, 0.6].map((f) => (f * s.bodyW) / 2);
  const humpX = s.extras?.find((e) => e.type === 'hump');
  const bodyRings: Ring[] = bx.map((x, i) =>
    ring(
      [x, cy(x) + (humpX && i === 3 ? 0.12 * s.bodyH * (humpX.size ?? 1) : 0), 0],
      bw[i],
      bh[i] * (humpX && i === 3 ? 1 + 0.25 * (humpX.size ?? 1) : 1),
      top,
      belly,
    ),
  );
  m.loft(bodyRings, sides, body);

  // Tail: from the tail root back and down, tapering to a point.
  if (s.tailLen > 0.01) {
    const droop = (s.tailDroop ?? 8) * DEG;
    const root = bodyRings[0].p;
    const tj: Joint = { part: PART.tail, pivot: root };
    const n = 5;
    const rings: Ring[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const d = s.tailLen * t;
      const sag = Math.sin(droop) * d + 0.15 * s.tailLen * t * t * Math.sin(droop + 0.2);
      rings.push(
        ring(
          [root[0] - Math.cos(droop) * d, Math.max(0.05, root[1] - sag), 0],
          (s.tailW / 2) * (1 - 0.92 * t),
          (s.tailW / 2) * (1 - 0.9 * t) * 1.1,
          top,
          belly,
          t,
        ),
      );
    }
    m.loft(rings, Math.max(4, sides - 1), tj, { capStart: false });
    for (const e of s.extras ?? []) {
      if (e.type === 'tailSpikes') {
        const p = rings[n - 1].p;
        for (const z of [-1, 1])
          for (const k of [0, 1]) {
            const base: V3 = [p[0] + 0.25 * k * s.tailLen * 0.2, p[1] + 0.05, z * 0.05];
            m.cone(
              base,
              [base[0] - 0.15 * (e.size ?? 1), base[1] + 0.35 * (e.size ?? 1), z * 0.6 * (e.size ?? 1)],
              0.06 * (e.size ?? 1),
              4,
              rgb(e.colour ?? 0xe8dcc0),
              tj,
              0.85,
              0.85,
            );
          }
      }
      if (e.type === 'club') {
        const p = rings[n].p;
        m.blob(
          [p[0] + 0.1, p[1], 0],
          [0.35 * (e.size ?? 1), 0.22 * (e.size ?? 1), 0.4 * (e.size ?? 1)],
          dark,
          tj,
          { bend: 1, lat: 3, lon: 6 },
        );
      }
    }
  }

  // Neck and head.
  const neckRoot = bodyRings[4].p;
  const na = s.neckAngle * DEG;
  const nj: Joint = { part: PART.neck, pivot: [shX, cy(shX), 0] };
  const neckEnd: V3 = [neckRoot[0] + Math.cos(na) * s.neckLen, neckRoot[1] + Math.sin(na) * s.neckLen, 0];
  if (s.neckLen > 0.01) {
    const n = 4;
    const rings: Ring[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      // Long necks curve: rise steeper at the base, flatter near the head.
      const a = na * (1.15 - 0.3 * t);
      const prev = rings.length ? rings[rings.length - 1].p : neckRoot;
      const step = i === 0 ? 0 : s.neckLen / n;
      const p: V3 = i === 0 ? neckRoot : [prev[0] + Math.cos(a) * step, prev[1] + Math.sin(a) * step, 0];
      const w = (s.neckW / 2) * (1 - 0.35 * t);
      rings.push(ring(p, w, w * 1.15, top, belly, 0.3 + 0.7 * t));
    }
    neckEnd[0] = rings[n].p[0];
    neckEnd[1] = rings[n].p[1];
    m.loft(rings, Math.max(4, sides - 1), nj, { capStart: false });
  }
  // Head: from the neck end forward, drooping.
  const hd = na - (s.headDroop ?? 25) * DEG - (s.neckLen > 0.01 ? 0 : na);
  const fwd: V3 = [Math.cos(hd), Math.sin(hd), 0];
  const h0: V3 = [neckEnd[0] - fwd[0] * 0.15 * s.headLen, neckEnd[1] - fwd[1] * 0.15 * s.headLen, 0];
  const at = (t: number, dy = 0): V3 => [
    h0[0] + fwd[0] * s.headLen * t,
    h0[1] + fwd[1] * s.headLen * t + dy,
    0,
  ];
  const beak = s.extras?.some((e) => e.type === 'beak');
  m.loft(
    [
      ring(at(0), (s.headW / 2) * 0.85, (s.headH / 2) * 0.9, top, belly, 1),
      ring(at(0.3), s.headW / 2, s.headH / 2, top, belly, 1),
      ring(at(0.7, -0.05 * s.headH), (s.headW / 2) * 0.75, (s.headH / 2) * 0.7, top, belly, 1),
      ring(
        at(1, -0.15 * s.headH),
        (s.headW / 2) * (beak ? 0.1 : 0.45),
        (s.headH / 2) * (beak ? 0.15 : 0.35),
        beak ? accent : top,
        belly,
        1,
      ),
    ],
    Math.max(5, sides - 1),
    nj,
  );
  // Eyes.
  const eye = at(0.35, 0.2 * s.headH);
  for (const z of [-1, 1])
    m.blob(
      [eye[0], eye[1], z * s.headW * 0.42],
      [0.06 * s.headH + 0.01, 0.06 * s.headH + 0.01, 0.03 * s.headH + 0.01],
      [0.02, 0.02, 0.02],
      nj,
      { lat: 2, lon: 4, bend: 1 },
    );

  // Legs.
  const legCol = mixRgb(top, belly, 0.25);
  const foot = mixRgb(dark, [0.05, 0.05, 0.05], 0.4);
  const zHip = s.bodyW * (sprawl ? 0.42 : 0.3);
  const out = sprawl ? s.bodyW * 0.55 : 0;
  if (!flyer) {
    for (const z of [-1, 1]) {
      leg(
        m,
        z > 0 ? PART.legBR : PART.legBL,
        [hipX, hipH, z * zHip],
        [hipX + 0.05 * hipH, 0, z * (zHip + out)],
        s.legW,
        biped ? 1 : 0.5,
        legCol,
        foot,
        sides,
        z * out,
      );
      if (!biped) {
        const fs = s.frontLegScale ?? 1;
        leg(
          m,
          z > 0 ? PART.legFR : PART.legFL,
          [shX, shH, z * zHip * 0.95],
          [shX + 0.02 * shH, 0, z * (zHip * 0.95 + out)],
          s.legW * fs,
          -0.5,
          legCol,
          foot,
          sides,
          z * out,
        );
      }
    }
  } else {
    // Pterosaur: short hind legs tucked under the body.
    for (const z of [-1, 1]) {
      const p: V3 = [hipX, cy(hipX) - 0.3 * s.bodyH, z * 0.2 * s.bodyW];
      m.cone(p, [hipX - 0.4 * s.bodyLen, p[1] - 0.1 * s.bodyLen, z * 0.3 * s.bodyW], s.legW, 4, legCol, body);
    }
  }
  // Arms (bipeds): small, held forward.
  if (biped && (s.armLen ?? 0) > 0) {
    for (const z of [-1, 1]) {
      const sh: V3 = [shX - 0.05 * L, cy(shX) - 0.25 * s.bodyH, z * s.bodyW * 0.38];
      const el: V3 = [sh[0] + 0.25 * s.armLen!, sh[1] - 0.5 * s.armLen!, sh[2]];
      const hand: V3 = [el[0] + 0.45 * s.armLen!, el[1] - 0.15 * s.armLen!, sh[2]];
      const aj: Joint = { part: z > 0 ? PART.armR : PART.armL, pivot: sh, knee: el };
      m.loft(
        [
          { p: sh, w: s.legW * 0.45, h: s.legW * 0.5, top: legCol, bend: 0 },
          { p: el, w: s.legW * 0.35, h: s.legW * 0.35, top: legCol, bend: 1 },
          { p: hand, w: s.legW * 0.15, h: s.legW * 0.25, top: foot, bend: 1 },
        ],
        4,
        aj,
      );
    }
  }
  // Wings.
  if (flyer && s.wingSpan) {
    const half = s.wingSpan / 2;
    for (const z of [-1, 1]) {
      const sh: V3 = [shX * 0.6, cy(shX), z * s.bodyW * 0.45];
      const wj: Joint = { part: z > 0 ? PART.wingR : PART.wingL, pivot: sh };
      const tip: V3 = [sh[0] - 0.05 * half, sh[1] + 0.02 * half, z * half];
      const elbow: V3 = [sh[0] + 0.12 * half, sh[1] + 0.03 * half, z * 0.4 * half];
      const trail: V3 = [hipX * 0.8, cy(hipX), z * s.bodyW * 0.4];
      const mid: V3 = [sh[0] - 0.22 * half, sh[1], z * 0.55 * half];
      const memb = mixRgb(accent, top, 0.4);
      m.fan(trail, [sh, elbow, tip, mid], memb, wj, [0, 0.4, 1, 0.55], 0.05);
      // Leading-edge arm.
      m.loft(
        [
          { p: sh, w: 0.07 * s.bodyW, h: 0.07 * s.bodyW, top, bend: 0 },
          { p: elbow, w: 0.05 * s.bodyW, h: 0.05 * s.bodyW, top, bend: 0.4 },
          { p: tip, w: 0.01, h: 0.01, top, bend: 1 },
        ],
        4,
        wj,
      );
    }
  }

  for (const e of s.extras ?? [])
    extra(m, s, e, { hipX, shX, cy, at, nj, top, accent, dark, sides, headFwd: fwd });
}

interface Frame {
  hipX: number;
  shX: number;
  cy: (x: number) => number;
  at: (t: number, dy?: number) => V3;
  nj: Joint;
  top: V3;
  accent: V3;
  dark: V3;
  sides: number;
  headFwd: V3;
}

function extra(m: MeshBuilder, s: CreatureSpec, e: Extra, f: Frame) {
  const k = e.size ?? 1;
  const col = e.colour !== undefined ? rgb(e.colour) : f.accent;
  const backTop = (x: number) => f.cy(x) + 0.5 * s.bodyH * 0.95;
  switch (e.type) {
    case 'sail': {
      // A tall sail along the back (Dimetrodon, Spinosaurus).
      const n = 7;
      const x0 = f.hipX - 0.05 * s.bodyLen;
      const x1 = f.shX + 0.05 * s.bodyLen;
      const outline: V3[] = [];
      const bends: number[] = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = x0 + (x1 - x0) * t;
        outline.push([x, backTop(x) + k * Math.sin(Math.PI * t) * s.bodyH * 1.4 + 0.02, 0]);
        bends.push(0);
      }
      const base: V3 = [(x0 + x1) / 2, backTop((x0 + x1) / 2) - 0.05, 0];
      m.fan(base, outline, col, body, bends);
      // Spines.
      for (let i = 1; i < n; i++)
        m.cone(
          [outline[i][0], backTop(outline[i][0]) - 0.02, 0],
          [outline[i][0], outline[i][1] + 0.05, 0],
          0.025 * s.bodyH + 0.01,
          3,
          f.dark,
          body,
        );
      break;
    }
    case 'plates': {
      // Two alternating rows of plates (Stegosaurus).
      const n = 9;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const x = f.hipX - 0.45 * s.bodyLen + t * 0.95 * s.bodyLen;
        const hh = k * s.bodyH * (0.25 + 0.45 * Math.sin(Math.PI * Math.min(1, t * 1.15)));
        const z = (i % 2 ? 1 : -1) * 0.06 * s.bodyW;
        const y0 =
          x < f.hipX - 0.22 * s.bodyLen ? f.cy(f.hipX - 0.22 * s.bodyLen) + 0.3 * s.bodyH : backTop(x);
        const isTail = x < f.hipX - 0.22 * s.bodyLen;
        const j: Joint = isTail
          ? { part: PART.tail, pivot: [f.hipX - 0.22 * s.bodyLen, f.cy(f.hipX), 0] }
          : body;
        const b = isTail ? 0.2 : 0;
        m.fan(
          [x, y0 - 0.05, z],
          [
            [x - hh * 0.45, y0, z],
            [x - hh * 0.15, y0 + hh * 0.8, z],
            [x + hh * 0.1, y0 + hh, z],
            [x + hh * 0.4, y0, z],
          ],
          col,
          j,
          [b, b, b, b],
          b,
        );
      }
      break;
    }
    case 'horns': {
      // Brow horns forward-up, and a nose horn (Triceratops, ceratopsians, rhinos).
      const brow = f.at(0.3, 0.45 * s.headH);
      for (const z of [-1, 1])
        m.cone(
          [brow[0], brow[1], z * 0.25 * s.headW],
          [
            brow[0] + 0.75 * k * s.headLen * f.headFwd[0] + 0.1,
            brow[1] + 0.35 * k * s.headLen,
            z * 0.35 * s.headW,
          ],
          0.07 * s.headH * k + 0.02,
          5,
          col,
          f.nj,
          1,
          1,
        );
      const nose = f.at(0.85, 0.2 * s.headH);
      m.cone(
        [nose[0], nose[1], 0],
        [nose[0] + 0.1 * s.headLen, nose[1] + 0.22 * k * s.headLen, 0],
        0.06 * s.headH * k + 0.02,
        5,
        col,
        f.nj,
        1,
        1,
      );
      break;
    }
    case 'frill': {
      // A bony neck frill behind the head (ceratopsians).
      // An upright half disc behind the skull, tilted back.
      const c = f.at(0.05, 0.1 * s.headH);
      const r = k * s.headH * 1.25;
      const outline: V3[] = [];
      for (let i = 0; i <= 10; i++) {
        const a = (Math.PI * i) / 10;
        const y = r * (0.25 + 0.85 * Math.sin(a));
        outline.push([c[0] - 0.55 * y, c[1] + y, Math.cos(a) * r]);
      }
      m.fan(
        c,
        outline,
        col,
        f.nj,
        outline.map(() => 1),
        1,
      );
      break;
    }
    case 'crest': {
      // A tube crest sweeping back from the head (Parasaurolophus) or a pterosaur crest.
      const a = f.at(0.25, 0.4 * s.headH);
      m.cone(
        a,
        [a[0] - k * s.headLen * 1.1, a[1] + k * s.headLen * 0.35, 0],
        0.12 * s.headH,
        5,
        col,
        f.nj,
        1,
        1,
      );
      break;
    }
    case 'boneCrest': {
      // A low bony crest on the skull (pterosaurs: Pteranodon).
      const a = f.at(0.15, 0.3 * s.headH);
      m.fan(
        a,
        [
          [a[0] + 0.1 * s.headLen, a[1], 0],
          [a[0] - k * s.headLen * 0.9, a[1] + k * s.headLen * 0.25, 0],
          [a[0] - 0.15 * s.headLen, a[1] - 0.05, 0],
        ],
        col,
        f.nj,
        [1, 1, 1],
        1,
      );
      break;
    }
    case 'trunk': {
      const a = f.at(0.95, -0.1 * s.headH);
      const j = f.nj;
      m.loft(
        [
          { p: a, w: 0.18 * s.headH * k, h: 0.2 * s.headH * k, top: f.top, bend: 1 },
          {
            p: [a[0] + 0.15 * s.headLen, a[1] - 0.5 * s.headLen * k, 0],
            w: 0.12 * s.headH * k,
            h: 0.12 * s.headH * k,
            top: f.top,
            bend: 1,
          },
          {
            p: [a[0] + 0.12 * s.headLen, a[1] - 1.15 * s.headLen * k, 0],
            w: 0.08 * s.headH * k,
            h: 0.08 * s.headH * k,
            top: f.top,
            bend: 1,
          },
        ],
        5,
        j,
      );
      break;
    }
    case 'tusks': {
      const a = f.at(0.85, -0.25 * s.headH);
      for (const z of [-1, 1])
        m.loft(
          [
            {
              p: [a[0], a[1], z * 0.25 * s.headW],
              w: 0.06 * s.headH * k + 0.01,
              h: 0.06 * s.headH * k + 0.01,
              top: col,
              bend: 1,
            },
            {
              p: [a[0] + 0.45 * k * s.headLen, a[1] - 0.35 * k * s.headLen, z * 0.35 * s.headW],
              w: 0.04 * s.headH * k,
              h: 0.04 * s.headH * k,
              top: col,
              bend: 1,
            },
            {
              p: [a[0] + 0.85 * k * s.headLen, a[1] - 0.05 * k * s.headLen, z * 0.2 * s.headW],
              w: 0.005,
              h: 0.005,
              top: col,
              bend: 1,
            },
          ],
          4,
          f.nj,
        );
      break;
    }
    case 'ears': {
      const a = f.at(0.15, 0.2 * s.headH);
      for (const z of [-1, 1]) {
        const r = k * s.headH * 0.6;
        m.fan(
          [a[0], a[1], z * 0.4 * s.headW],
          [
            [a[0] + 0.2 * r, a[1] + 0.5 * r, z * (0.4 * s.headW + 0.2 * r)],
            [a[0] - 0.5 * r, a[1] + 0.2 * r, z * (0.4 * s.headW + 0.8 * r)],
            [a[0] - 0.3 * r, a[1] - 0.8 * r, z * (0.4 * s.headW + 0.6 * r)],
          ],
          mixRgb(f.top, f.dark, 0.3),
          f.nj,
          [1, 1, 1],
          1,
        );
      }
      break;
    }
    case 'antlers': {
      const a = f.at(0.2, 0.45 * s.headH);
      for (const z of [-1, 1]) {
        const b: V3 = [a[0] - 0.1, a[1] + 0.5 * k, z * 0.35 * k];
        m.cone([a[0], a[1], z * 0.15 * s.headW], b, 0.03, 4, col, f.nj, 1, 1);
        m.cone(b, [b[0] + 0.2 * k, b[1] + 0.35 * k, z * 0.55 * k], 0.02, 3, col, f.nj, 1, 1);
        m.cone(b, [b[0] - 0.2 * k, b[1] + 0.3 * k, z * 0.45 * k], 0.02, 3, col, f.nj, 1, 1);
      }
      break;
    }
    case 'armour': {
      // Rows of osteoderm knobs over the back (ankylosaurs).
      for (let i = 0; i < 7; i++)
        for (const z of [-0.6, -0.2, 0.2, 0.6]) {
          const x = f.hipX - 0.15 * s.bodyLen + (i / 6) * 0.75 * s.bodyLen;
          const y = backTop(x) - Math.abs(z) * 0.25 * s.bodyH;
          m.cone(
            [x, y - 0.05, z * 0.5 * s.bodyW],
            [x, y + 0.12 * k * s.bodyH, z * 0.62 * s.bodyW],
            0.06 * s.bodyH,
            4,
            f.dark,
            body,
          );
        }
      break;
    }
    case 'spines': {
      // Short spikes along the flanks (ankylosaur sides, Kentrosaurus).
      for (let i = 0; i < 6; i++)
        for (const z of [-1, 1]) {
          const x = f.hipX - 0.1 * s.bodyLen + (i / 5) * 0.7 * s.bodyLen;
          const y = f.cy(x);
          m.cone(
            [x, y, z * 0.45 * s.bodyW],
            [x - 0.05, y + 0.05, z * (0.5 * s.bodyW + 0.3 * k)],
            0.05 * k,
            4,
            col,
            body,
          );
        }
      break;
    }
    case 'mane': {
      const n = 6;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const x = f.shX + 0.15 * s.bodyLen + t * 0.4 * s.neckLen;
        const y = f.cy(f.shX) + 0.5 * s.bodyH + t * Math.sin(s.neckAngle * DEG) * s.neckLen * 0.9;
        m.blob([x, y, 0], [0.2 * k, 0.25 * k, 0.12 * k], col, i < 2 ? body : f.nj, {
          lat: 2,
          lon: 4,
          bend: t,
          rough: 0.2,
          seed: i,
        });
      }
      break;
    }
    case 'hair': {
      // Shaggy coat: rough blobs over the body (woolly mammoth, rhinos).
      for (let i = 0; i < 5; i++) {
        const x = f.hipX + (i / 4) * (f.shX - f.hipX);
        m.blob(
          [x, f.cy(x) - 0.25 * s.bodyH, 0],
          [0.22 * s.bodyLen, 0.32 * s.bodyH * k, 0.52 * s.bodyW],
          col,
          body,
          { lat: 3, lon: 6, rough: 0.25, seed: i + 3 },
        );
      }
      break;
    }
    case 'hump':
    case 'beak':
    case 'club':
    case 'tailSpikes':
      break; // handled with the body, head or tail
  }
}

/** Upright primates: pelvis at hipH, torso, head, arms, legs. */
function buildUpright(m: MeshBuilder, s: CreatureSpec) {
  const skin = rgb(s.top);
  const hairC = rgb(s.hairColour ?? s.accent ?? s.top);
  const cloth = s.clothing !== undefined ? rgb(s.clothing) : null;
  const lean = (s.lean ?? 0) * DEG;
  const hipH = s.hipH;
  const torso = s.bodyH;
  const w = s.bodyW;
  const pelvis: V3 = [0, hipH, 0];
  const up: V3 = [Math.sin(lean), Math.cos(lean), 0];
  const along = (t: number): V3 => [pelvis[0] + up[0] * torso * t, pelvis[1] + up[1] * torso * t, 0];
  const torsoCol = cloth ?? skin;
  const furTorso = cloth ? cloth : mixRgb(skin, hairC, 0.6);
  m.loft(
    [
      ring(along(-0.08), w * 0.42, w * 0.3, torsoCol, torsoCol),
      ring(along(0.15), w * 0.46, w * 0.32, torsoCol, torsoCol),
      ring(along(0.55), w * 0.42, w * 0.3, furTorso, furTorso),
      ring(along(0.85), w * 0.5, w * 0.3, furTorso, furTorso),
      ring(along(1.0), w * 0.28, w * 0.2, furTorso, furTorso),
    ],
    6,
    body,
  );
  // Head on a short neck (part neck so it can nod).
  const neckBase = along(1.0);
  const nj: Joint = { part: PART.neck, pivot: neckBase };
  const hc: V3 = [
    neckBase[0] + up[0] * s.headH * 0.65 + (0.04 * (s.lean ?? 0)) / 10,
    neckBase[1] + up[1] * s.headH * 0.6,
    0,
  ];
  m.loft(
    [
      ring(neckBase, w * 0.14, w * 0.14, skin, skin, 1),
      ring([hc[0], hc[1] - s.headH * 0.3, 0], w * 0.12, w * 0.12, skin, skin, 1),
    ],
    5,
    nj,
  );
  // Face forward (+x), hair cap on top and back.
  m.blob(hc, [s.headLen / 2, s.headH / 2, s.headW / 2], skin, nj, { lat: 4, lon: 7, bend: 1 });
  m.blob(
    [hc[0] - 0.12 * s.headLen, hc[1] + 0.12 * s.headH, 0],
    [s.headLen * 0.48, s.headH * 0.42, s.headW * 0.52],
    hairC,
    nj,
    { lat: 3, lon: 7, bend: 1 },
  );
  if ((s.extras ?? []).some((e) => e.type === 'beak')) {
    // Prognathous muzzle (apes, early hominins).
    m.blob(
      [hc[0] + 0.38 * s.headLen, hc[1] - 0.18 * s.headH, 0],
      [s.headLen * 0.22, s.headH * 0.2, s.headW * 0.3],
      mixRgb(skin, [0.2, 0.15, 0.12], 0.3),
      nj,
      { lat: 3, lon: 6, bend: 1 },
    );
  }
  // Legs.
  const legC =
    cloth && (s.extras ?? []).some((e) => e.type === 'mane')
      ? cloth
      : mixRgb(skin, hairC, cloth ? 0.15 : 0.5);
  for (const z of [-1, 1]) {
    const hip: V3 = [0, hipH, z * w * 0.22];
    leg(
      m,
      z > 0 ? PART.legBR : PART.legBL,
      hip,
      [0.04, 0, z * w * 0.24],
      s.legW,
      1,
      legC,
      mixRgb(skin, [0.1, 0.08, 0.06], 0.5),
      6,
    );
  }
  // Arms from the shoulders.
  const armLen = s.armLen ?? hipH * 0.9;
  for (const z of [-1, 1]) {
    const sh: V3 = [along(0.88)[0], along(0.88)[1], z * w * 0.55];
    const el: V3 = [sh[0] - 0.05, sh[1] - armLen * 0.48, z * w * 0.6];
    const hand: V3 = [el[0] + 0.08 + 0.4 * Math.sin(lean) * armLen, el[1] - armLen * 0.48, z * w * 0.6];
    const aj: Joint = { part: z > 0 ? PART.armR : PART.armL, pivot: sh, knee: el };
    const upperC = cloth ?? mixRgb(skin, hairC, 0.5);
    m.loft(
      [
        { p: sh, w: s.legW * 0.6, h: s.legW * 0.6, top: upperC, bend: 0 },
        { p: el, w: s.legW * 0.45, h: s.legW * 0.45, top: upperC, bend: 0 },
        { p: el, w: s.legW * 0.42, h: s.legW * 0.42, top: skin, bend: 1 },
        { p: hand, w: s.legW * 0.35, h: s.legW * 0.4, top: skin, bend: 1 },
      ],
      5,
      aj,
    );
  }
}
