/**
 * Galaxy portraits: parameters (pure, no DOM). `derivePortraitParams` turns a catalogue row (Hubble type
 * code, radius, absolute magnitude), optional measured inputs (`PortraitMeasured`, filled in phase 2)
 * and an optional hand-tuned styling row (`looks.json`, all values simulated) into the resolved
 * `PortraitParams` the baker (portrait-model.ts) and the shader use. Precedence for each quantity:
 * measured > styling > Hubble-type default (seed-varied by catalogue index).
 */
import { blackbodyRgb, luminance } from '../../core/photometry';

export type Rgb = [number, number, number];

/** Optional measured inputs (phase 2). Every field has a Hubble-type default. */
export interface PortraitMeasured {
  /** Spiral arm pitch angle, degrees. */
  pitchDeg?: number;
  /** Number of spiral arms. */
  armCount?: number;
  /** Elmegreen arm class 1-12 (1-4 flocculent, 9/12 grand design). */
  armClass?: number;
  /** Bar radius / catalogue radius. */
  barRadiusFrac?: number;
  /** RC3 bar family: A none, AB weak, B strong. */
  barClass?: 'A' | 'AB' | 'B';
  /** Bulge-to-total light ratio. */
  bulgeToTotal?: number;
  /** Ring radius / catalogue radius (0 or absent: no ring). */
  ringRadiusFrac?: number;
  /** Disc inclination to the line of sight from the Sun, degrees (0 face-on). */
  inclinationDeg?: number;
  /** Integrated B-V colour. */
  colorBV?: number;
  /** RC3 numeric stage T, -5..10. */
  tStage?: number;
  /** Feature lengths: the polar jet, the bipolar outflow (cones) and the tidal tails, kpc. */
  jetLengthKpc?: number;
  outflowExtentKpc?: number;
  tailLengthKpc?: number;
}

/** Hand-tuned styling row (looks.json): simulated, artistic values. Any measured key may also appear. */
export interface PortraitLook extends PortraitMeasured {
  /** Arm phase, degrees (azimuth of arm 0 at r = disc scale length). */
  armPhaseDeg?: number;
  /** Arm/inter-arm contrast of the young light, 0..1. */
  armContrast?: number;
  /** Arm contrast of the old disc light, 0..1. */
  oldArmContrast?: number;
  /** Bar position angle in the disc plane, degrees. */
  barAngleDeg?: number;
  /** Bar centre offset from the nucleus, kpc [x, y] (Magellanic off-centre bars). */
  barOffsetKpc?: [number, number];
  /** Bar axis ratio b/a. */
  barAxisRatio?: number;
  /** Ring radial width / catalogue radius, and its share of the young light. */
  ringWidthFrac?: number;
  ringStrength?: number;
  /** 0..1: arms broken into short segments and patches. */
  flocculence?: number;
  /** m = 1 asymmetry amplitude 0..1 and direction, degrees. */
  lopsided?: number;
  lopsidedAngleDeg?: number;
  /** Disc scale length / catalogue radius. */
  discScaleFrac?: number;
  /** Disc scale heights / catalogue radius (old, young, dust). */
  hOldFrac?: number;
  hYoungFrac?: number;
  hDustFrac?: number;
  /** Bulge (or elliptical body) effective radius / catalogue radius, flattening c/a, shape index, cutoff / radius. */
  bulgeReFrac?: number;
  bulgeFlat?: number;
  bulgeN?: number;
  bulgeMaxFrac?: number;
  /** Bulge colour temperature, K. */
  bulgeTeff?: number;
  /** Old-disc and young colour temperatures, K. */
  oldTeff?: number;
  youngTeff?: number;
  /** Share of the young light in HII knots, 0..1. */
  hiiShare?: number;
  /** Number of procedural HII knots and their size / catalogue radius. */
  hiiCount?: number;
  hiiSizeFrac?: number;
  /** Face-on V optical depth of the dust layer through an arm lane. */
  dustTau?: number;
  /** Dust confined to the inner arm edges (0) .. smooth (1). */
  dustSmooth?: number;
  /** Radial shift of the dust lanes inside the arm ridge, fraction of r. */
  dustLaneShift?: number;
  /** Dust ring: radius / catalogue radius, width / radius, optical depth. */
  dustRingFrac?: number;
  dustRingWidthFrac?: number;
  dustRingTau?: number;
  /** Inner radius / catalogue radius below which there is no dust. */
  dustHoleFrac?: number;
  /** Named giant HII regions: position / catalogue radius, size / radius, share of the HII light. */
  knots?: { x: number; y: number; size: number; share: number }[];
  /** Tidal tail / bridge continuing arm 0 beyond the disc. */
  tail?: {
    /** Length beyond the disc edge / radius (a measured tailLengthKpc wins). */
    lengthFrac?: number;
    strength: number;
    widthFrac?: number;
    /** Catalogue index of the companion to aim at, or a fixed disc-plane angle, degrees. */
    toIndex?: number;
    angleDeg?: number;
    /** Pitch of the tail beyond the disc (opens faster than the arms), degrees. */
    pitchDeg?: number;
    /** 1 (arm 0) or 2 (arm 0 and the opposite one). */
    count?: number;
  };
  /** Second body (merger): position / radius, scale length / radius, peak relative to the disc centre. */
  nucleus2?: { x: number; y: number; size: number; amp: number };
  /** Bright compact nucleus: share of the young light and size / radius. */
  nucleusShare?: number;
  nucleusSizeFrac?: number;
  /** Second (outer) ring: radius / radius, width / radius, strength. */
  ring2?: { radiusFrac: number; widthFrac?: number; strength: number };
  /** Dust patches: position / radius, size / radius, elongation, angle (degrees), tau_V. */
  dustBlobs?: { x: number; y: number; size: number; elong?: number; angleDeg?: number; tau: number }[];
  /** Dust lanes along the bar's leading edges, tau_V. */
  barDustTau?: number;
  /**
   * A bar the RC3 (optical) family does not list, e.g. an inner bar seen in the infrared: added even
   * when the measured bar class is A. Radius / catalogue radius, strength 0..1.
   */
  innerBar?: { radiusFrac: number; strength: number };
  /** Root the arms at the bar ends (default true when barred and no armPhaseDeg). */
  armsFromBar?: boolean;
  /** Radial map warp scale / radius (0: linear; set automatically for long tails). */
  mapWarpFrac?: number;
  /** Disc warp: amplitude / radius at the edge, onset radius / radius, line-of-nodes angle, degrees. */
  warp?: { ampFrac: number; startFrac: number; angleDeg: number };
  /** Polar feature: bipolar cones or a one-sided jet. */
  polar?: PolarLook;
  /** Map half-extent / catalogue radius. */
  mapExtentFrac?: number;
  /** Disc truncation radius / catalogue radius. */
  edgeFrac?: number;
  /** Multiplier on the young-light share derived from the colour. */
  youngBoost?: number;
}

export interface PolarLook {
  kind: 'cones' | 'jet';
  /** Share of the total light. */
  share: number;
  /** Length / radius (a measured jetLengthKpc or outflowExtentKpc wins). */
  lengthFrac?: number;
  /** Base half-width / radius and cone half-opening, degrees. */
  widthFrac: number;
  openingDeg: number;
  /** Linear RGB, normalised to luminance 1. */
  color: Rgb;
  /** Axis in galaxy-local coordinates (default +z, the disc normal). */
  axis?: [number, number, number];
  /** Or axis relative to the line of sight from the Milky Way: angle to it and position angle, degrees. */
  losDeg?: number;
  paDeg?: number;
}

/** Resolved parameters, kpc and radians. */
export interface PortraitParams {
  seed: number;
  type: number;
  tStage: number;
  radiusKpc: number;
  mapExtentKpc: number;
  /** Light shares (sum 1, dust off). */
  fBulge: number;
  fOld: number;
  fYoung: number;
  fHii: number;
  fPolar: number;
  bulgeReKpc: number;
  bulgeFlat: number;
  bulgeN: number;
  bulgeMaxKpc: number;
  nucleus2: { x: number; y: number; size: number; amp: number } | null;
  nucleusShare: number;
  nucleusSizeKpc: number;
  ring2RadiusKpc: number;
  ring2WidthKpc: number;
  ring2Strength: number;
  dustBlobs: { x: number; y: number; size: number; elong: number; angleRad: number; tau: number }[];
  barDustTau: number;
  armPhaseFromBar: boolean;
  mapWarpKpc: number;
  discScaleKpc: number;
  edgeKpc: number;
  hOldKpc: number;
  hYoungKpc: number;
  hDustKpc: number;
  /** HII knots: thinner than the young disc so knots stay compact blobs. */
  hHiiKpc: number;
  armCount: number;
  pitchRad: number;
  armPhaseRad: number;
  armClass: number;
  armContrast: number;
  oldArmContrast: number;
  flocculence: number;
  barLengthKpc: number;
  barAngleRad: number;
  barAxisRatio: number;
  barStrength: number;
  barOffsetKpc: [number, number];
  ringRadiusKpc: number;
  ringWidthKpc: number;
  ringStrength: number;
  lopsided: number;
  lopsidedAngleRad: number;
  hiiCount: number;
  hiiSizeKpc: number;
  knots: { x: number; y: number; size: number; share: number }[];
  dustTau: number;
  dustSmooth: number;
  dustLaneShift: number;
  dustRingKpc: number;
  dustRingWidthKpc: number;
  dustRingTau: number;
  dustHoleKpc: number;
  tail: {
    lengthKpc: number;
    strength: number;
    widthKpc: number;
    angleRad: number | null;
    toIndex?: number;
    pitchRad: number;
    count: number;
  } | null;
  warpAmpKpc: number;
  warpStartKpc: number;
  warpAngleRad: number;
  polar: (PolarLook & { lengthKpc: number; widthKpc: number }) | null;
  colors: { bulge: Rgb; old: Rgb; young: Rgb; hii: Rgb };
  /** Optical depth per channel relative to V (reddening). */
  redden: Rgb;
  inclinationDeg: number | null;
}

export interface PortraitInput {
  /** Catalogue index (the seed). */
  index: number;
  /** Hubble type code 0-15 (GALAXY_TYPES). */
  type: number;
  radiusKpc: number;
  absMag: number;
  measured?: PortraitMeasured;
  look?: PortraitLook;
}

const DEG = Math.PI / 180;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Piecewise-linear table lookup on x. */
function table(x: number, rows: readonly (readonly [number, number])[]): number {
  if (x <= rows[0][0]) return rows[0][1];
  for (let i = 1; i < rows.length; i++)
    if (x <= rows[i][0]) {
      const [x0, y0] = rows[i - 1];
      const [x1, y1] = rows[i];
      return lerp(y0, y1, (x - x0) / (x1 - x0));
    }
  return rows[rows.length - 1][1];
}

/** Deterministic per-index random stream (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = (seed * 2654435761 + 0x9e3779b9) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** RC3 stage T of a Hubble type code (E0-E7 -5, S0 -2, Sa/SBa 1, Sb/SBb 3, Sc/SBc 5, Irr 10). */
export function tStageOfType(type: number): number {
  if (type <= 7) return -5;
  if (type === 8) return -2;
  if (type === 9 || type === 12) return 1;
  if (type === 10 || type === 13) return 3;
  if (type === 11 || type === 14) return 5;
  return 10;
}

const isBarredType = (type: number) => type >= 12 && type <= 14;
const isElliptical = (type: number, t: number) => type <= 7 || t <= -4;

/** Default integrated B-V by stage (approximate, Roberts & Haynes 1994 trend). */
export const defaultBV = (t: number): number =>
  table(t, [
    [-5, 0.95],
    [-2, 0.9],
    [1, 0.78],
    [3, 0.68],
    [5, 0.55],
    [7, 0.48],
    [10, 0.4],
  ]);

/** Young-light share of the total from B-V (tracks the point colour's young fraction). */
export const youngShareFromBV = (bv: number): number => clamp(1.6 * (0.95 - bv), 0, 0.9);

/** Default bulge-to-total by stage (approximate). */
export const defaultBulgeToTotal = (t: number): number =>
  table(t, [
    [-4, 1],
    [-2, 0.55],
    [0, 0.45],
    [1, 0.4],
    [3, 0.25],
    [5, 0.1],
    [7, 0.04],
    [9, 0.02],
    [10, 0.02],
  ]);

export const defaultPitchDeg = (t: number): number =>
  table(t, [
    [-2, 8],
    [1, 10],
    [3, 15],
    [5, 22],
    [7, 28],
    [10, 32],
  ]);

const normLum = (c: Rgb): Rgb => {
  const l = luminance(c[0], c[1], c[2]) || 1;
  return [c[0] / l, c[1] / l, c[2] / l];
};
const bb = (teff: number): Rgb => blackbodyRgb(teff) as Rgb;
/** HII (H-alpha + H-beta + [OIII]) pink, linear RGB, luminance 1 (approximate). */
export const HII_RGB: Rgb = normLum([1.0, 0.32, 0.5]);
/** Dust optical depth per channel relative to V (Cardelli-like reddening at R, G, B; approximate). */
export const REDDEN: Rgb = [0.78, 1.0, 1.32];

/** Resolves every portrait parameter (pure and deterministic in the input). */
export function derivePortraitParams(input: PortraitInput): PortraitParams {
  const m = input.measured ?? {};
  const look = input.look ?? {};
  const pick = <K extends keyof PortraitMeasured>(k: K): PortraitMeasured[K] => m[k] ?? look[k];
  const rnd = seededRandom(input.index);
  const jit = (s: number) => 1 + s * (2 * rnd() - 1);
  const R = input.radiusKpc > 0 ? input.radiusKpc : 10;
  const type = clamp(Math.round(input.type), 0, 15);
  const T = clamp(pick('tStage') ?? tStageOfType(type), -5, 10);
  const ell = isElliptical(type, T);
  const irr = T >= 9.5;

  // Seed-varied structural defaults (drawn in a fixed order so every index gives a stable result).
  const rPitch = jit(0.2);
  const rClass = rnd();
  const rArms = rnd();
  const rBar = rnd();
  const rBarLen = jit(0.15);
  const rBarAngle = rnd() * Math.PI;
  const rPhase = rnd() * 2 * Math.PI;
  const rRing = rnd();
  const rLop = rnd();
  const rLopAngle = rnd() * 2 * Math.PI;
  const rFlat = jit(0.08);
  const rRe = jit(0.15);
  const rDust = jit(0.2);

  const bv = pick('colorBV') ?? defaultBV(T);
  let bt = clamp(pick('bulgeToTotal') ?? defaultBulgeToTotal(T), 0, 0.95);
  if (ell) bt = 1;
  const fPolar = look.polar ? clamp(look.polar.share, 0, 0.2) : 0;
  const rest = (1 - bt) * (1 - fPolar);
  const young = Math.min(youngShareFromBV(bv) * (look.youngBoost ?? 1), 0.92) * rest;
  const hiiShare = clamp(look.hiiShare ?? 0.15, 0, 0.8);
  const fYoung = young * (1 - hiiShare);
  const fHii = young * hiiShare;
  const fOld = Math.max(0, rest - young);
  const fBulge = bt * (1 - fPolar);

  // Arms.
  const pitchDeg = clamp(pick('pitchDeg') ?? defaultPitchDeg(T) * rPitch, 3, 50);
  const classDefault = irr
    ? 1 + Math.floor(rClass * 2)
    : T >= 6
      ? 2 + Math.floor(rClass * 4)
      : T >= 4
        ? 3 + Math.floor(rClass * 7)
        : 5 + Math.floor(rClass * 6);
  const armClass = clamp(Math.round(pick('armClass') ?? classDefault), 1, 12);
  const flocDefault = clamp((6 - armClass) / 5, 0, 1);
  const armCount = clamp(
    Math.round(pick('armCount') ?? (armClass <= 4 ? 2 + Math.floor(rArms * 3) : rArms < 0.85 ? 2 : 3)),
    1,
    6,
  );
  const grand = clamp((armClass - 1) / 11, 0, 1);

  // Bar.
  const barClass =
    pick('barClass') ?? (isBarredType(type) ? 'B' : irr ? 'B' : rBar < 0.3 && T > -3 ? 'AB' : 'A');
  const inner = look.innerBar;
  const classStrength = ell ? 0 : barClass === 'B' ? 1 : barClass === 'AB' ? 0.5 : 0;
  const barStrength = inner && inner.strength > classStrength ? inner.strength : classStrength;
  const barFrac = clamp(
    inner && inner.strength > classStrength
      ? inner.radiusFrac
      : (pick('barRadiusFrac') ?? (barClass === 'B' ? 0.3 : 0.2) * rBarLen),
    0.03,
    0.5,
  );
  const ringFrac = pick('ringRadiusFrac') ?? (T >= -2 && T <= 3 && rRing < 0.2 ? barFrac * 1.15 + 0.1 : 0);

  const discScale = R * (look.discScaleFrac ?? (irr ? 0.36 : 0.28));
  const reFrac = look.bulgeReFrac ?? (ell ? 0.28 : 0.035 + 0.12 * bt) * rRe;
  const ellFlat = type <= 7 ? 1 - type / 10 : 0.75;
  const tailLook = look.tail;
  const tailLen = tailLook ? (m.tailLengthKpc ?? (tailLook.lengthFrac ?? 0.4) * R) : 0;
  const edgeKpc = R * (look.edgeFrac ?? 1);
  const mapExtentKpc = look.mapExtentFrac
    ? look.mapExtentFrac * R
    : tailLook
      ? Math.max(1.05 * R, edgeKpc + tailLen * 1.04)
      : 1.05 * R;
  const warp = look.warp;
  const pol = look.polar;
  const polLen = pol
    ? ((pol.kind === 'jet' ? m.jetLengthKpc : m.outflowExtentKpc) ?? (pol.lengthFrac ?? 0.2) * R)
    : 0;
  const ring2 = look.ring2;
  return {
    seed: input.index,
    type,
    tStage: T,
    radiusKpc: R,
    mapExtentKpc,
    mapWarpKpc: look.mapWarpFrac !== undefined ? look.mapWarpFrac * R : mapExtentKpc > 1.6 * R ? 0.8 * R : 0,
    fBulge,
    fOld: ell ? 0 : fOld,
    fYoung: ell ? 0 : fYoung,
    fHii: ell ? 0 : fHii,
    fPolar,
    bulgeReKpc: R * reFrac,
    bulgeFlat: clamp(look.bulgeFlat ?? (ell ? ellFlat : 0.8) * rFlat, 0.2, 1),
    bulgeN: look.bulgeN ?? (ell ? 3 : 2),
    bulgeMaxKpc: R * (look.bulgeMaxFrac ?? (ell ? 1.1 : Math.min(1, reFrac * 8))),
    nucleus2: look.nucleus2
      ? {
          x: look.nucleus2.x * R,
          y: look.nucleus2.y * R,
          size: look.nucleus2.size * R,
          amp: look.nucleus2.amp,
        }
      : null,
    nucleusShare: clamp(look.nucleusShare ?? 0, 0, 0.8),
    nucleusSizeKpc: R * (look.nucleusSizeFrac ?? 0.012),
    ring2RadiusKpc: ring2 ? ring2.radiusFrac * R : 0,
    ring2WidthKpc: ring2 ? (ring2.widthFrac ?? 0.05) * R : 1,
    ring2Strength: ring2 ? ring2.strength : 0,
    dustBlobs: (look.dustBlobs ?? []).map((d) => ({
      x: d.x * R,
      y: d.y * R,
      size: d.size * R,
      elong: d.elong ?? 1,
      angleRad: (d.angleDeg ?? 0) * DEG,
      tau: d.tau,
    })),
    barDustTau: barStrength > 0 ? (look.barDustTau ?? 0.6 * barStrength) : 0,
    armPhaseFromBar: look.armsFromBar ?? look.armPhaseDeg === undefined,
    discScaleKpc: discScale,
    edgeKpc,
    hOldKpc: R * (look.hOldFrac ?? (irr ? 0.07 : 0.024)),
    hYoungKpc: R * (look.hYoungFrac ?? (irr ? 0.04 : 0.009)),
    hDustKpc: R * (look.hDustFrac ?? (irr ? 0.03 : 0.007)),
    hHiiKpc: Math.min(R * (look.hYoungFrac ?? (irr ? 0.04 : 0.009)), R * 1.2 * (look.hiiSizeFrac ?? 0.012)),
    armCount,
    pitchRad: pitchDeg * DEG,
    armPhaseRad: look.armPhaseDeg !== undefined ? look.armPhaseDeg * DEG : rPhase,
    armClass,
    armContrast: clamp(look.armContrast ?? lerp(0.55, 0.92, grand), 0, 1),
    oldArmContrast: clamp(look.oldArmContrast ?? lerp(0.1, 0.5, grand), 0, 1),
    flocculence: clamp(look.flocculence ?? (irr ? 0.8 : flocDefault), 0, 1),
    barLengthKpc: barStrength > 0 ? barFrac * R : 0,
    barAngleRad: look.barAngleDeg !== undefined ? look.barAngleDeg * DEG : rBarAngle,
    barAxisRatio: clamp(look.barAxisRatio ?? (barClass === 'B' ? 0.3 : 0.45), 0.1, 1),
    barStrength,
    barOffsetKpc: look.barOffsetKpc ?? [0, 0],
    ringRadiusKpc: ringFrac * R,
    ringWidthKpc: (look.ringWidthFrac ?? 0.05) * R,
    ringStrength: ringFrac > 0 ? (look.ringStrength ?? 0.3) : 0,
    lopsided: clamp(look.lopsided ?? (irr ? 0.35 : rLop < 0.3 ? 0.12 * rLop : 0), 0, 0.9),
    lopsidedAngleRad: look.lopsidedAngleDeg !== undefined ? look.lopsidedAngleDeg * DEG : rLopAngle,
    hiiCount: Math.round(look.hiiCount ?? clamp(20 + 260 * young, 0, 300)),
    hiiSizeKpc: R * (look.hiiSizeFrac ?? 0.012),
    knots: (look.knots ?? []).map((k) => ({ x: k.x * R, y: k.y * R, size: k.size * R, share: k.share })),
    dustTau: ell
      ? 0
      : (look.dustTau ??
        table(T, [
          [-2, 0.15],
          [1, 1.0],
          [3, 1.4],
          [5, 1.1],
          [7, 0.6],
          [10, 0.25],
        ]) * rDust),
    dustSmooth: clamp(look.dustSmooth ?? (irr ? 0.8 : lerp(0.7, 0.25, grand)), 0, 1),
    dustLaneShift: look.dustLaneShift ?? 0.06,
    dustRingKpc: (look.dustRingFrac ?? 0) * R,
    dustRingWidthKpc: (look.dustRingWidthFrac ?? 0.04) * R,
    dustRingTau: look.dustRingTau ?? 0,
    dustHoleKpc: (look.dustHoleFrac ?? 0.08) * R,
    tail: tailLook
      ? {
          lengthKpc: tailLen,
          strength: tailLook.strength,
          widthKpc: (tailLook.widthFrac ?? 0.05) * R,
          angleRad: tailLook.angleDeg !== undefined ? tailLook.angleDeg * DEG : null,
          toIndex: tailLook.toIndex,
          pitchRad: (tailLook.pitchDeg ?? 40) * DEG,
          count: tailLook.count === 2 ? 2 : 1,
        }
      : null,
    warpAmpKpc: warp ? warp.ampFrac * R : 0,
    warpStartKpc: warp ? warp.startFrac * R : R,
    warpAngleRad: warp ? warp.angleDeg * DEG : 0,
    polar: pol ? { ...pol, color: normLum(pol.color), lengthKpc: polLen, widthKpc: pol.widthFrac * R } : null,
    colors: {
      bulge: bb(look.bulgeTeff ?? (ell ? 4300 : 4000)),
      old: bb(look.oldTeff ?? lerp(4300, 5200, clamp((0.95 - bv) / 0.55, 0, 1))),
      young: bb(look.youngTeff ?? 9000),
      hii: HII_RGB,
    },
    redden: REDDEN,
    inclinationDeg: ell ? null : (pick('inclinationDeg') ?? null),
  };
}
