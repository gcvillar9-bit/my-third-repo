/**
 * Galaxy portraits: the emission/absorption model (pure TypeScript, no DOM; CPU twin of portrait.glsl).
 * Galaxy-local kpc, disc in xy, normal +z. Components, each normalised to unit integral so the light
 * shares of `PortraitParams` sum to the catalogue flux with dust off:
 *
 * - disc (old, young, HII): baked face-on surface map M_c(x, y) × exponential vertical profile
 *   exp(-|z - z0|/h)/(2h) (z0: optional warp). The march integrates the vertical profile exactly per
 *   interval (so thin layers never fall between samples) and samples the map at the interval midpoint.
 * - dust: baked face-on optical depth D(x, y) (V band) × the same vertical profile with h_dust; absorbs
 *   with reddening `redden` (per-channel tau / tau_V).
 * - bulge / elliptical body: oblate 3D Sersic-like spheroid exp(-b_n (m/re)^(1/n)), m^2 = x^2 + y^2 +
 *   (z/q)^2, cut off at bulgeMax. Its line integral along any ray interval is exact through a baked
 *   cumulative table G(b, s) (impact parameter b, arc length s, both in the z-scaled space).
 * - polar feature (bipolar cones or a one-sided jet): Gaussian tube of width w(s) = w0 + s tan(open)
 *   along an axis, integrated analytically at the ray's closest approach to the axis.
 *
 * Map channels: R old light, G young light, B dust tau_V (absolute), A HII knots.
 */
import type { PortraitParams, Rgb } from './portrait-params';
import { seededRandom } from './portrait-params';

export const LUT_N = 96;
/** Dust slab half-thickness in dust scale heights (the dense part of the march). */
export const SLAB_H = 5;

export interface PortraitContext {
  /** Unit vector from the galaxy towards the observer (Milky Way), galaxy-local axes. */
  losLocal?: Rgb;
  /** Azimuth (disc plane, radians) the tail/bridge points to (companion direction). */
  tailAngleRad?: number;
}

export interface PortraitModel {
  params: PortraitParams;
  /** Map size (texels per side), physical and warped half-extents, kpc, and the radial warp scale. */
  size: number;
  extent: number;
  gExtent: number;
  mapWarpKpc: number;
  /** size² × 4 floats: old, young, dust tau_V, HII. */
  map: Float32Array;
  /** LUT_N² floats: G(b, s) of the spherical (z-scaled) bulge profile. */
  lut: Float32Array;
  /** Bulge cutoff radius (scaled space), kpc. */
  lutMax: number;
  /** Amplitude per component: light share / integral. Emission = amp × field (luminance 1 colours). */
  amp: { bulge: number; old: number; young: number; hii: number; polar: number };
  /** Integrals (kpc² for maps, kpc³ for the bulge and polar feature). */
  integrals: { bulge: number; old: number; young: number; hii: number; polar: number };
  /** Bounding box half-extents, kpc. */
  half: Rgb;
  /** Dust slab half-thickness and cylinder radius, kpc. */
  slabHalf: number;
  cylR: number;
  /** Resolved polar axis (unit, local) or null. */
  polarAxis: Rgb | null;
  /** The map reaches far beyond the dust cylinder: march the off-slab segments with more steps. */
  outerSteps: boolean;
  /** Arm 0 phase actually used (tail aiming may rotate it). */
  armPhaseRad: number;
}

// ---------------------------------------------------------------------------------------------
// Noise (deterministic)
// ---------------------------------------------------------------------------------------------

function hash3(ix: number, iy: number, iz: number, seed: number): number {
  let h =
    Math.imul(ix, 374761393) ^
    Math.imul(iy, 668265263) ^
    Math.imul(iz, 1274126177) ^
    Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = Math.imul(h ^ (h >>> 16), 2654435761);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

function vnoise3(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const sz = fz * fz * (3 - 2 * fz);
  let acc = 0;
  for (let c = 0; c < 8; c++) {
    const dx = c & 1;
    const dy = (c >> 1) & 1;
    const dz = (c >> 2) & 1;
    const w = (dx ? sx : 1 - sx) * (dy ? sy : 1 - sy) * (dz ? sz : 1 - sz);
    acc += w * hash3(ix + dx, iy + dy, iz + dz, seed);
  }
  return acc;
}

const fbm3 = (x: number, y: number, z: number, seed: number): number =>
  0.5 * vnoise3(x, y, z, seed) +
  0.3 * vnoise3(2.03 * x, 2.03 * y, 2.03 * z, seed + 1) +
  0.2 * vnoise3(4.1 * x, 4.1 * y, 4.1 * z, seed + 2);

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Gaussian deviate from two uniforms. */
const gauss = (rnd: () => number): number =>
  Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());

// ---------------------------------------------------------------------------------------------
// Disc pattern
// ---------------------------------------------------------------------------------------------

/** Arm phase phi = m (theta - phase0 - ln(r / Rd) / tan(pitch)); ridges where cos(phi) = 1. */
export function armPhase(p: PortraitParams, phase0: number, r: number, theta: number): number {
  return p.armCount * (theta - phase0 - Math.log(Math.max(r, 1e-3) / p.discScaleKpc) / Math.tan(p.pitchRad));
}

/** Azimuth of the ridge of arm k at radius r. */
export const armRidgeTheta = (p: PortraitParams, phase0: number, r: number, k = 0): number =>
  phase0 +
  Math.log(Math.max(r, 1e-3) / p.discScaleKpc) / Math.tan(p.pitchRad) +
  (2 * Math.PI * k) / p.armCount;

const wrapPi = (a: number): number => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));

/** Inner radius where the arms start (bar ends or bulge edge). */
const armStart = (p: PortraitParams): number =>
  Math.max(p.barLengthKpc, 1.6 * p.bulgeReKpc, 0.12 * p.discScaleKpc);

/** Warp height of the disc mid-plane at (x, y), kpc (GLSL twin in portrait.glsl). */
export function warpZ(p: PortraitParams, x: number, y: number): number {
  if (p.warpAmpKpc === 0) return 0;
  const r = Math.hypot(x, y);
  const u = Math.max(0, (r - p.warpStartKpc) / Math.max(p.radiusKpc - p.warpStartKpc, 1e-3));
  return p.warpAmpKpc * u * u * Math.sin(Math.atan2(y, x) - p.warpAngleRad);
}

/**
 * Map grid. Texel centres are uniform in a warped radius g(r) = Rc asinh(r / Rc) (identity when Rc = 0),
 * so long tidal tails fit in the map without starving the disc of texels. GLSL twin: pMapUv.
 */
export interface MapGrid {
  size: number;
  /** Physical half-extent (kpc) and warped half-extent G = g(E). */
  extent: number;
  gExtent: number;
  /** Warp scale, kpc (0: linear map). */
  rc: number;
  /** Physical position (x, y) of each texel centre and the physical area it represents, kpc². */
  xy: Float32Array;
  area: Float32Array;
}

export const gOfR = (rc: number, r: number): number => (rc > 0 ? rc * Math.asinh(r / rc) : r);
const rOfG = (rc: number, g: number) => (rc > 0 ? rc * Math.sinh(g / rc) : g);

export function makeGrid(size: number, extent: number, rc: number): MapGrid {
  const G = gOfR(rc, extent);
  const xy = new Float32Array(2 * size * size);
  const area = new Float32Array(size * size);
  const tg = (2 * G) / size;
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const gx = (i + 0.5) * tg - G;
      const gy = (j + 0.5) * tg - G;
      const gr = Math.hypot(gx, gy);
      const r = rOfG(rc, gr);
      const k = gr > 1e-9 ? r / gr : 1;
      const q = j * size + i;
      xy[2 * q] = gx * k;
      xy[2 * q + 1] = gy * k;
      // dA = (r / g) (dr / dg) dA_g
      area[q] = tg * tg * k * (rc > 0 ? Math.cosh(gr / rc) : 1);
    }
  return { size, extent, gExtent: G, rc, xy, area };
}

/** Fractional texel coordinates (texel centres at i + 0.5) of a physical point. */
function texelCoords(grid: MapGrid, x: number, y: number): [number, number] {
  const r = Math.hypot(x, y);
  const k = r > 1e-9 ? gOfR(grid.rc, r) / r : 1;
  const n = grid.size;
  return [((x * k) / grid.gExtent) * 0.5 * n + 0.5 * n, ((y * k) / grid.gExtent) * 0.5 * n + 0.5 * n];
}

/** Bakes the face-on map (deterministic). */
export function bakeMap(
  p: PortraitParams,
  size: number,
  ctx: PortraitContext = {},
): { map: Float32Array; grid: MapGrid; phase0: number } {
  const E = p.mapExtentKpc;
  const grid = makeGrid(size, E, p.mapWarpKpc);
  const map = new Float32Array(size * size * 4);
  const Rd = p.discScaleKpc;
  const rs = armStart(p);
  const tanP = Math.tan(p.pitchRad);
  const grand = (p.armClass - 1) / 11;
  const power = 1.5 + 4.5 * grand * (1 - 0.5 * p.flocculence);
  const edge = p.edgeKpc;
  const tail = p.tail;
  const tailEnd = tail ? Math.min(edge + tail.lengthKpc, 0.97 * E) : 0;
  const tailStart = tail ? 0.75 * edge : 0;
  // Arm phase: aimed so arm 0's tail reaches the tail direction, else rooted at the bar ends.
  const tailAngle = tail ? (ctx.tailAngleRad ?? tail.angleRad ?? null) : null;
  const tanT = tail ? Math.tan(tail.pitchRad) : 1;
  const phase0 =
    tail && tailAngle !== null
      ? tailAngle - Math.log(tailEnd / tailStart) / tanT - Math.log(tailStart / Rd) / tanP
      : p.armPhaseFromBar && p.barStrength >= 0.5
        ? p.barAngleRad - Math.log(Math.max(p.barLengthKpc, 1e-3) / Rd) / tanP
        : p.armPhaseRad;
  const tailTheta0 = tail ? armRidgeTheta(p, phase0, tailStart, 0) : 0;
  const cosL = Math.cos(p.lopsidedAngleRad);
  const sinL = Math.sin(p.lopsidedAngleRad);
  const cb = Math.cos(p.barAngleRad);
  const sb = Math.sin(p.barAngleRad);
  const barL = Math.max(p.barLengthKpc, 1e-3);
  const barW = p.barAxisRatio * barL;
  const rIn = 0.8 * rs;
  const ringW = Math.max(p.ringWidthKpc, 1e-3);
  const ring2W = Math.max(p.ring2WidthKpc, 1e-3);
  const dRingW = Math.max(p.dustRingWidthKpc, 1e-3);
  const dNorm = Math.exp(1 / 1.3); // dust base = 1 at r = Rd
  const seed = p.seed;
  const texel = (2 * grid.gExtent) / size;
  // Noise frequency: patches ~ 0.6 kpc scaled by the galaxy (spiral coordinates for flocculence).
  const fNoise = 1 / Math.max(0.04 * p.radiusKpc, 2 * texel);
  const blobs = p.dustBlobs.map((d) => ({ ...d, c: Math.cos(d.angleRad), s: Math.sin(d.angleRad) }));
  const n2 = p.nucleus2;
  for (let q = 0; q < size * size; q++) {
    const x = grid.xy[2 * q];
    const y = grid.xy[2 * q + 1];
    const r = Math.hypot(x, y);
    const th = Math.atan2(y, x);
    const o = 4 * q;
    // Ragged outer edge for flocculent / irregular discs.
    const rag = p.flocculence * 0.35 * (2 * fbm3(Math.cos(th) * 1.4, Math.sin(th) * 1.4, 0.5, seed + 21) - 1);
    const edgeR = Math.min(edge * (1 + rag), 0.97 * E);
    const taper = 1 - smoothstep(0.8 * edgeR, edgeR, r);
    // Tails (beyond the disc edge too): arm 0 (and the opposite arm) with their own open pitch.
    let tailV = 0;
    if (tail && r > tailStart && r < tailEnd) {
      const fade = smoothstep(tailStart, 0.95 * edge, r) * (1 - smoothstep(0.85 * tailEnd, tailEnd, r));
      // Surface brightness falls slowly along the tail.
      const fall = Math.exp(-(r - tailStart) / Math.max(tailEnd - tailStart, 1e-3));
      const w = tail.widthKpc * (1 + (0.8 * (r - tailStart)) / (tailEnd - tailStart));
      for (let k = 0; k < tail.count; k++) {
        const dth = wrapPi(th - tailTheta0 - Math.PI * k - Math.log(r / tailStart) / tanT);
        const d = r * dth * Math.cos(tail.pitchRad);
        const clump = 0.6 + 0.8 * vnoise3(x * fNoise * 1.5, y * fNoise * 1.5, 7.5 + k, seed + 17);
        tailV += tail.strength * Math.exp(-edge / Rd) * Math.exp(-((d / w) ** 2)) * fade * clump * fall * 3;
      }
    }
    if (taper <= 0 && tailV <= 0) continue;
    const lop = 1 + p.lopsided * Math.min(1, r / Rd) * (Math.cos(th) * cosL + Math.sin(th) * sinL);
    const env = smoothstep(0.7 * rs, 1.3 * rs, r);
    const phi = armPhase(p, phase0, r, th);
    const s = 0.5 + 0.5 * Math.cos(phi);
    const sharp = Math.pow(s, power);
    // Flocculent patches in spiral coordinates (periodic in the spiral phase).
    const u = phi / p.armCount;
    const lr = Math.log(Math.max(r, 1e-3) / Rd);
    const F = Math.max(
      0,
      1.7 * fbm3(Math.cos(u) * 2.2, Math.sin(u) * 2.2, lr * 3.5 + x * fNoise * 0.35, seed + 3) - 0.55,
    );
    const armY = sharp * (1 - p.flocculence) + p.flocculence * F * (0.5 + s) * 1.6;
    // Large star-forming complexes and voids (flocculent / irregular discs).
    const Fp = fbm3(x * fNoise * 0.3, y * fNoise * 0.3, 1.7, seed + 31);
    const patch = 1 + p.flocculence * ((0.2 + 1.6 * Fp) ** 2 - 1);
    // Old disc.
    const base = Math.exp(-r / Rd) * lop * taper * (1 + 0.4 * (patch - 1));
    let old = base * Math.max(0, 1 + p.oldArmContrast * env * (2 * Math.pow(s, 1.5) - 0.7));
    let bar = 0;
    let barLane = 0;
    if (p.barStrength > 0) {
      const dx = x - p.barOffsetKpc[0];
      const dy = y - p.barOffsetKpc[1];
      const bx = dx * cb + dy * sb;
      const by = -dx * sb + dy * cb;
      bar = p.barStrength * Math.exp(-((Math.abs(bx) / barL) ** 3)) * Math.exp(-((by / barW) ** 2));
      old += 1.5 * bar * Math.exp(-barL / (3 * Rd));
      // Dust lanes along the bar's leading edges (point-symmetric).
      const off = by - Math.sign(bx) * 0.55 * barW;
      barLane =
        Math.exp(-((off / (0.25 * barW)) ** 2)) *
        Math.exp(-((Math.abs(bx) / (1.05 * barL)) ** 4)) *
        smoothstep(0.15 * barL, 0.4 * barL, Math.abs(bx));
    }
    const ringG = p.ringStrength > 0 ? Math.exp(-(((r - p.ringRadiusKpc) / ringW) ** 2)) : 0;
    old += 0.4 * p.ringStrength * ringG * Math.exp(-p.ringRadiusKpc / Rd) * taper;
    const ring2G = p.ring2Strength > 0 ? Math.exp(-(((r - p.ring2RadiusKpc) / ring2W) ** 2)) : 0;
    old += 1.2 * p.ring2Strength * ring2G * Math.exp(-p.ring2RadiusKpc / Rd) * taper;
    // Young disc.
    const hole = 1 - Math.exp(-((r / Math.max(rIn, 1e-3)) ** 2));
    const baseY = Math.exp(-r / (1.15 * Rd)) * lop * taper;
    let youngV =
      baseY *
      hole *
      patch *
      (1 - p.armContrast + p.armContrast * armY * 1.6) *
      Math.max(env, 1 - p.armContrast);
    youngV += 0.35 * p.barStrength * bar * (p.tStage >= 9 ? 2.5 : 0.2) * Math.exp(-barL / (3 * Rd));
    youngV += 4 * p.ringStrength * ringG * Math.exp(-p.ringRadiusKpc / (1.15 * Rd)) * taper;
    youngV += 0.8 * p.ring2Strength * ring2G * Math.exp(-p.ring2RadiusKpc / (1.15 * Rd)) * taper;
    // Dust (absolute tau_V): lanes on the inner edge of the arms.
    const sIn = 0.5 + 0.5 * Math.cos(armPhase(p, phase0, r * (1 + p.dustLaneShift), th));
    const lane = Math.pow(sIn, power * 1.3) * env;
    const Fd = fbm3(x * fNoise * 0.9, y * fNoise * 0.9, 3.3, seed + 9);
    const dHole = smoothstep(0.5 * p.dustHoleKpc, p.dustHoleKpc, r);
    let dust =
      p.dustTau *
      Math.exp(-r / (1.3 * Rd)) *
      dNorm *
      lop *
      taper *
      dHole *
      ((1 - p.dustSmooth) * lane * (0.7 + 0.6 * Fd) * 1.4 + p.dustSmooth * 0.5 * (0.4 + 1.2 * Fd) * patch);
    dust += 0.5 * p.dustTau * p.ringStrength * ringG * taper;
    dust += p.barDustTau * barLane * (0.7 + 0.6 * Fd);
    if (p.dustRingTau > 0)
      dust += p.dustRingTau * Math.exp(-(((r - p.dustRingKpc) / dRingW) ** 2)) * (0.8 + 0.4 * Fd);
    for (const d of blobs) {
      const ax = (x - d.x) * d.c + (y - d.y) * d.s;
      const ay = -(x - d.x) * d.s + (y - d.y) * d.c;
      dust += d.tau * Math.exp(-((ax / (d.size * d.elong)) ** 2) - (ay / d.size) ** 2) * (0.6 + 0.8 * Fd);
    }
    // Second body (merger): an exponential blob in old and young light.
    if (n2) {
      const rr = Math.hypot(x - n2.x, y - n2.y) / Math.max(n2.size, 1e-3);
      const b2 = Math.exp(-rr) * (1 + 0.4 * (patch - 1));
      old += n2.amp * b2;
      youngV += n2.amp * 0.8 * b2 * (0.5 + F);
    }
    old += 0.4 * tailV;
    youngV += 0.6 * tailV;
    map[o] = old;
    map[o + 1] = youngV;
    map[o + 2] = dust;
  }
  // Bright nucleus (young channel) as a share of the young light.
  if (p.nucleusShare > 0)
    addGaussians(map, grid, 1, [{ x: 0, y: 0, size: p.nucleusSizeKpc, share: p.nucleusShare }]);
  // HII knots: procedural along the arms (ring, second body, tails), then named giant regions by share.
  const rnd = seededRandom(seed * 7 + 1);
  const hii = new Float32Array(size * size);
  const outer = Math.max(edge, tailEnd);
  for (let k = 0; k < p.hiiCount; k++) {
    // Radius from r exp(-r / 1.1 Rd) by rejection between rIn and the edge.
    let r = 0;
    for (let tries = 0; tries < 20; tries++) {
      r = rIn + (edge - rIn) * rnd();
      if (rnd() < (r / Rd) * Math.exp(1 - r / (1.1 * Rd))) break;
    }
    let th: number;
    const pick = rnd();
    let cx = 0;
    let cy = 0;
    if (p.ringStrength > 0 && pick < 0.35) {
      r = p.ringRadiusKpc + ringW * 0.5 * gauss(rnd);
      th = rnd() * 2 * Math.PI;
    } else if (n2 && pick < 0.6) {
      r = n2.size * Math.abs(1.5 * gauss(rnd));
      th = rnd() * 2 * Math.PI;
      cx = n2.x;
      cy = n2.y;
    } else if (tail && pick > 0.9) {
      r = tailStart + (tailEnd - tailStart) * 0.6 * rnd();
      th = tailTheta0 + Math.PI * Math.floor(rnd() * tail.count) + Math.log(r / tailStart) / tanT;
    } else if (rnd() > p.flocculence * 0.7) {
      th = armRidgeTheta(p, phase0, r, Math.floor(rnd() * p.armCount)) + 0.12 * gauss(rnd);
    } else th = rnd() * 2 * Math.PI;
    const lop = 1 + p.lopsided * Math.min(1, r / Rd) * Math.cos(th - p.lopsidedAngleRad);
    const sz = p.hiiSizeKpc * (0.6 + 0.9 * rnd());
    const fadeK = cx || cy ? 1 : 1 - smoothstep(0.8 * outer, outer, r);
    const amp = Math.exp(0.9 * gauss(rnd)) * lop * fadeK;
    splat(hii, grid, cx + r * Math.cos(th), cy + r * Math.sin(th), Math.max(sz, 0.5 * texel), amp);
  }
  for (let q = 0; q < size * size; q++) map[4 * q + 3] = hii[q];
  if (p.knots.length) addGaussians(map, grid, 3, p.knots);
  return { map, grid, phase0 };
}

/** Adds a Gaussian exp(-d²/s²) of amplitude a at physical (cx, cy) into a single-channel buffer. */
function splat(buf: Float32Array, grid: MapGrid, cx: number, cy: number, s: number, a: number): void {
  const n = grid.size;
  const [u, v] = texelCoords(grid, cx, cy);
  // The warp only contracts (dg/dr <= 1), so a texel box of the linear radius is conservative.
  const rad = (3 * s * n) / (2 * grid.gExtent) + 1;
  const i0 = Math.max(0, Math.floor(u - rad));
  const i1 = Math.min(n - 1, Math.ceil(u + rad));
  const j0 = Math.max(0, Math.floor(v - rad));
  const j1 = Math.min(n - 1, Math.ceil(v + rad));
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const q = j * n + i;
      const x = grid.xy[2 * q];
      const y = grid.xy[2 * q + 1];
      buf[q] += a * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (s * s));
    }
}

/** Adds Gaussians carrying `share` of the channel's final (area-weighted) sum each. */
function addGaussians(
  map: Float32Array,
  grid: MapGrid,
  ch: number,
  items: readonly { x: number; y: number; size: number; share: number }[],
): void {
  const nn = grid.size * grid.size;
  let sum = 0;
  for (let q = 0; q < nn; q++) sum += map[4 * q + ch] * grid.area[q];
  const shares = Math.min(
    0.95,
    items.reduce((a, k) => a + k.share, 0),
  );
  const minSize = grid.gExtent / grid.size;
  const target = sum > 0 ? sum / (1 - shares) : 1;
  const buf = new Float32Array(nn);
  for (const k of items) {
    buf.fill(0);
    splat(buf, grid, k.x, k.y, Math.max(k.size, minSize), 1);
    let bs = 0;
    for (let q = 0; q < nn; q++) bs += buf[q] * grid.area[q];
    if (bs <= 0) continue;
    const a = (k.share * target) / bs;
    for (let q = 0; q < nn; q++) map[4 * q + ch] += a * buf[q];
  }
}

// ---------------------------------------------------------------------------------------------
// Bulge
// ---------------------------------------------------------------------------------------------

/** Spherical bulge density at scaled radius m (peak 1). */
export function bulgeRho(p: PortraitParams, m: number): number {
  const bn = 2 * p.bulgeN - 1 / 3;
  return (
    Math.exp(-bn * Math.pow(m / p.bulgeReKpc, 1 / p.bulgeN)) *
    (1 - smoothstep(0.75 * p.bulgeMaxKpc, p.bulgeMaxKpc, m))
  );
}

/** Volume integral of the (flattened) bulge, kpc³. */
export function bulgeIntegral(p: PortraitParams): number {
  const n = 8000;
  const M = p.bulgeMaxKpc;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const u0 = i / n;
    const u1 = (i + 1) / n;
    const um = (u0 + u1) / 2;
    const m = M * um * um;
    const dm = M * (u1 * u1 - u0 * u0);
    acc += bulgeRho(p, m) * m * m * dm;
  }
  return 4 * Math.PI * p.bulgeFlat * acc;
}

/** Cumulative line-integral table G(b, s) = ∫_0^s rho(sqrt(b² + s'²)) ds' on sqrt-spaced grids. */
export function bakeBulgeLut(p: PortraitParams, n = LUT_N): Float32Array {
  const M = p.bulgeMaxKpc;
  const lut = new Float32Array(n * n);
  const sub = 16;
  for (let j = 0; j < n; j++) {
    const ub = j / (n - 1);
    const b = M * ub * ub;
    let acc = 0;
    lut[j * n] = 0;
    for (let i = 1; i < n; i++) {
      const sa = M * ((i - 1) / (n - 1)) ** 2;
      const sbb = M * (i / (n - 1)) ** 2;
      const ds = (sbb - sa) / sub;
      for (let k = 0; k < sub; k++) {
        const s = sa + (k + 0.5) * ds;
        acc += bulgeRho(p, Math.hypot(b, s)) * ds;
      }
      lut[j * n + i] = acc;
    }
  }
  return lut;
}

/** Bilinear lookup of G (GPU texel-centre convention), odd in s; 0 for b beyond the cutoff. */
export function lutG(model: PortraitModel, b: number, s: number): number {
  const M = model.lutMax;
  if (b >= M) return 0;
  const n = LUT_N;
  const ub = Math.sqrt(Math.max(0, b) / M) * (n - 1);
  const us = Math.sqrt(Math.min(Math.abs(s), M) / M) * (n - 1);
  const j0 = Math.min(n - 2, Math.floor(ub));
  const i0 = Math.min(n - 2, Math.floor(us));
  const fj = ub - j0;
  const fi = us - i0;
  const L = model.lut;
  const v =
    (L[j0 * n + i0] * (1 - fi) + L[j0 * n + i0 + 1] * fi) * (1 - fj) +
    (L[(j0 + 1) * n + i0] * (1 - fi) + L[(j0 + 1) * n + i0 + 1] * fi) * fj;
  return Math.sign(s) * v;
}

// ---------------------------------------------------------------------------------------------
// Polar feature
// ---------------------------------------------------------------------------------------------

/** Brightness profile g(s) along the axis (s >= 0). */
export function polarProfile(kind: 'cones' | 'jet', L: number, s: number): number {
  if (s < 0 || s > L) return 0;
  if (kind === 'cones') return Math.exp(-s / (0.45 * L)) * (1 - smoothstep(0.7 * L, L, s));
  return (
    (1 - smoothstep(0.75 * L, L, s)) * (0.55 + 0.45 * Math.exp(-s / (0.3 * L))) * smoothstep(0, 0.04 * L, s)
  );
}

export const polarWidth = (w0: number, openRad: number, s: number): number =>
  w0 + Math.abs(s) * Math.tan(openRad);

export function polarIntegral(p: PortraitParams): number {
  const f = p.polar;
  if (!f) return 1;
  const n = 4000;
  const L = f.lengthKpc;
  const open = (f.openingDeg * Math.PI) / 180;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const s = ((i + 0.5) / n) * L;
    const w = polarWidth(f.widthKpc, open, s);
    acc += polarProfile(f.kind, L, s) * Math.PI * w * w * (L / n);
  }
  return acc * (f.kind === 'cones' ? 2 : 1);
}

function resolvePolarAxis(p: PortraitParams, ctx: PortraitContext): Rgb | null {
  const f = p.polar;
  if (!f) return null;
  if (f.losDeg !== undefined) {
    const v = ctx.losLocal ?? [1, 0, 0];
    // Sky "up": local +z projected perpendicular to the line of sight (as approachBookmark's up).
    let ux = -v[2] * v[0];
    let uy = -v[2] * v[1];
    let uz = 1 - v[2] * v[2];
    let ul = Math.hypot(ux, uy, uz);
    if (ul < 1e-6) {
      ux = 1 - v[0] * v[0];
      uy = -v[0] * v[1];
      uz = -v[0] * v[2];
      ul = Math.hypot(ux, uy, uz);
    }
    ux /= ul;
    uy /= ul;
    uz /= ul;
    const ex = v[1] * uz - v[2] * uy;
    const ey = v[2] * ux - v[0] * uz;
    const ez = v[0] * uy - v[1] * ux;
    const a = (f.losDeg * Math.PI) / 180;
    const pa = ((f.paDeg ?? 0) * Math.PI) / 180;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const out: Rgb = [
      ca * v[0] + sa * (Math.cos(pa) * ux + Math.sin(pa) * ex),
      ca * v[1] + sa * (Math.cos(pa) * uy + Math.sin(pa) * ey),
      ca * v[2] + sa * (Math.cos(pa) * uz + Math.sin(pa) * ez),
    ];
    return out;
  }
  const a = f.axis ?? [0, 0, 1];
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

// ---------------------------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------------------------

/** Builds the full model (map, LUT, integrals, bounds). Deterministic in (params, size, ctx). */
export function buildPortraitModel(
  p: PortraitParams,
  size: number,
  ctx: PortraitContext = {},
): PortraitModel {
  const { map, grid, phase0 } = bakeMap(p, size, ctx);
  const extent = grid.extent;
  const sums = [0, 0, 0, 0];
  for (let q = 0; q < size * size; q++) for (let c = 0; c < 4; c++) sums[c] += map[4 * q + c] * grid.area[q];
  const iOld = sums[0] || 1;
  const iYoung = sums[1] || 1;
  const iHii = sums[3] || 1;
  // Dust lives inside the disc (and its rings); tails beyond it are marched as off-slab light.
  const cylR = Math.min(
    extent,
    1.1 * Math.max(p.edgeKpc, p.dustRingKpc + 2 * p.dustRingWidthKpc, p.ring2RadiusKpc + 2 * p.ring2WidthKpc),
  );
  const iBulge = bulgeIntegral(p);
  const iPolar = polarIntegral(p);
  const polarAxis = resolvePolarAxis(p, ctx);
  const slabHalf =
    SLAB_H * Math.max(p.hDustKpc, p.hYoungKpc) +
    Math.abs(p.warpAmpKpc) *
      Math.max(1, ((cylR - p.warpStartKpc) / Math.max(p.radiusKpc - p.warpStartKpc, 1e-3)) ** 2);
  let hx = Math.max(extent, p.bulgeMaxKpc);
  let hz = Math.max(p.bulgeMaxKpc * p.bulgeFlat, slabHalf, 10 * p.hOldKpc + Math.abs(p.warpAmpKpc));
  if (p.polar && polarAxis) {
    const f = p.polar;
    const wL = polarWidth(f.widthKpc, (f.openingDeg * Math.PI) / 180, f.lengthKpc);
    const reachXY = Math.hypot(polarAxis[0], polarAxis[1]) * f.lengthKpc + 2 * wL;
    const reachZ = Math.abs(polarAxis[2]) * f.lengthKpc + 2 * wL;
    hx = Math.max(hx, reachXY);
    hz = Math.max(hz, reachZ);
  }
  return {
    params: p,
    size,
    extent,
    gExtent: grid.gExtent,
    mapWarpKpc: grid.rc,
    map,
    lut: bakeBulgeLut(p),
    lutMax: p.bulgeMaxKpc,
    amp: {
      bulge: p.fBulge / iBulge,
      old: p.fOld / iOld,
      young: p.fYoung / iYoung,
      hii: p.fHii / iHii,
      polar: p.fPolar / iPolar,
    },
    integrals: { bulge: iBulge, old: iOld, young: iYoung, hii: iHii, polar: iPolar },
    half: [hx, hx, hz],
    slabHalf,
    cylR,
    polarAxis,
    outerSteps: extent > 1.5 * cylR,
    armPhaseRad: phase0,
  };
}

/** Bilinear map sample (GPU texel-centre convention, clamp to edge). */
export function sampleMap(model: PortraitModel, x: number, y: number, out: number[]): number[] {
  const n = model.size;
  const r = Math.hypot(x, y);
  const k = r > 1e-9 ? gOfR(model.mapWarpKpc, r) / r : 1;
  const u = ((x * k) / model.gExtent) * 0.5 * n + 0.5 * n - 0.5;
  const v = ((y * k) / model.gExtent) * 0.5 * n + 0.5 * n - 0.5;
  const cu = Math.min(n - 1, Math.max(0, u));
  const cv = Math.min(n - 1, Math.max(0, v));
  const i0 = Math.min(n - 2, Math.floor(cu));
  const j0 = Math.min(n - 2, Math.floor(cv));
  const fi = cu - i0;
  const fj = cv - j0;
  const M = model.map;
  for (let c = 0; c < 4; c++) {
    const a = M[4 * (j0 * n + i0) + c];
    const b = M[4 * (j0 * n + i0 + 1) + c];
    const d = M[4 * ((j0 + 1) * n + i0) + c];
    const e = M[4 * ((j0 + 1) * n + i0 + 1) + c];
    out[c] = (a * (1 - fi) + b * fi) * (1 - fj) + (d * (1 - fi) + e * fi) * fj;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// CPU twin of the shader march
// ---------------------------------------------------------------------------------------------

/** ∫ exp(-|z|/h)/(2h) dt over an interval where z goes linearly from za to zb in time dt. */
export function vertIntegral(za: number, zb: number, dt: number, h: number): number {
  const dz = zb - za;
  if (Math.abs(dz) < 0.05 * h) {
    const zm = 0.5 * (za + zb);
    return (Math.exp(-Math.abs(zm) / h) / (2 * h)) * dt;
  }
  const C = (z: number) => 0.5 * Math.sign(z) * (1 - Math.exp(-Math.abs(z) / h));
  return ((C(zb) - C(za)) / dz) * dt;
}

/** Mean offset of a truncated exponential exp(-u/h) on [0, d], as a fraction of d. */
function truncMeanFrac(d: number, h: number): number {
  const x = d / h;
  if (x < 0.1) return 0.5 - x / 12;
  return (h - d / Math.expm1(x)) / d;
}

/**
 * Fraction along an interval (z from za to zb, linear) of the centroid of exp(-|z|/h); `flat` (the
 * jitter) when z barely changes. GLSL twin: pCentroid.
 */
export function centroidFrac(za: number, zb: number, h: number, flat: number): number {
  const D = Math.abs(zb - za);
  if (D < 0.05 * h) return flat;
  if (za * zb >= 0) {
    const a = Math.abs(za);
    const b = Math.abs(zb);
    const m = truncMeanFrac(D, h);
    return a < b ? m : 1 - m;
  }
  const fc = za / (za - zb);
  const a = Math.abs(za);
  const b = Math.abs(zb);
  const w1 = -Math.expm1(-a / h);
  const w2 = -Math.expm1(-b / h);
  const m1 = truncMeanFrac(a, h) * a;
  const m2 = truncMeanFrac(b, h) * b;
  return (w1 * (fc - m1 / D) + w2 * (fc + m2 / D)) / Math.max(w1 + w2, 1e-12);
}

/** Ray/box intersection [t0, t1] (t0 clamped at 0); empty when t1 <= t0. */
function clipBox(ro: number[], rd: number[], h: Rgb): [number, number] {
  let t0 = 0;
  let t1 = 1e30;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(rd[a]) < 1e-12) {
      if (Math.abs(ro[a]) > h[a]) return [1, 0];
      continue;
    }
    const ta = (-h[a] - ro[a]) / rd[a];
    const tb = (h[a] - ro[a]) / rd[a];
    t0 = Math.max(t0, Math.min(ta, tb));
    t1 = Math.min(t1, Math.max(ta, tb));
  }
  return [t0, t1];
}

/** Ray ∩ (|z| < zs) ∩ (x² + y² < R²) within [lo, hi]. */
function clipSlab(
  ro: number[],
  rd: number[],
  zs: number,
  R: number,
  lo: number,
  hi: number,
): [number, number] {
  let t0 = lo;
  let t1 = hi;
  if (Math.abs(rd[2]) < 1e-12) {
    if (Math.abs(ro[2]) > zs) return [1, 0];
  } else {
    const a = (-zs - ro[2]) / rd[2];
    const b = (zs - ro[2]) / rd[2];
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  const A = rd[0] * rd[0] + rd[1] * rd[1];
  const B = ro[0] * rd[0] + ro[1] * rd[1];
  const C = ro[0] * ro[0] + ro[1] * ro[1] - R * R;
  if (A < 1e-12) {
    if (C > 0) return [1, 0];
  } else {
    const disc = B * B - A * C;
    if (disc <= 0) return [1, 0];
    const s = Math.sqrt(disc);
    t0 = Math.max(t0, (-B - s) / A);
    t1 = Math.min(t1, (-B + s) / A);
  }
  return [t0, t1];
}

export interface MarchOptions {
  steps: number;
  /** Sample offset inside each interval, 0..1. */
  jitter?: number;
  /** false: dust off. */
  dust?: boolean;
}

/**
 * Radiance along a ray (galaxy-local kpc, rd unit), per unit total flux (luminance; multiply by the
 * catalogue scale), as linear RGB. Mirrors portrait.glsl (without the fine-detail noise, mean 1).
 */
export function marchPortrait(model: PortraitModel, roIn: number[], rd: number[], opt: MarchOptions): Rgb {
  const p = model.params;
  const [tb0, tb1] = clipBox(roIn, rd, model.half);
  if (tb1 <= tb0) return [0, 0, 0];
  const ro = [roIn[0] + rd[0] * tb0, roIn[1] + rd[1] * tb0, roIn[2] + rd[2] * tb0];
  const tEnd = tb1 - tb0;
  const [s0, s1] = clipSlab(ro, rd, model.slabHalf, model.cylR, 0, tEnd);
  const hasSlab = s1 > s0;
  const N = Math.max(4, opt.steps);
  // Off-slab segments: one interval, or a quarter of the steps when the map reaches far beyond the
  // dust cylinder (tidal tails).
  const nOff = model.outerSteps ? N >> 2 : 1;
  const nA = hasSlab ? (s0 > 0 ? nOff : 0) : N >> 1;
  const nB = hasSlab ? (s1 < tEnd ? nOff : 0) : 0;
  const nS = hasSlab ? N - nA - nB : 0;
  const j = opt.jitter ?? 0.5;
  const dustOn = opt.dust !== false;
  const col = p.colors;
  // Scaled-space ray for the bulge.
  const q = p.bulgeFlat;
  const rdq = [rd[0], rd[1], rd[2] / q];
  const roq = [ro[0], ro[1], ro[2] / q];
  const k = Math.hypot(rdq[0], rdq[1], rdq[2]);
  const tq = -(roq[0] * rdq[0] + roq[1] * rdq[1] + roq[2] * rdq[2]) / (k * k);
  const bq = Math.hypot(roq[0] + rdq[0] * tq, roq[1] + rdq[1] * tq, roq[2] + rdq[2] * tq);
  const bulgeSeg = (ta: number, tb: number) =>
    (lutG(model, bq, k * (tb - tq)) - lutG(model, bq, k * (ta - tq))) / k;
  const smp = [0, 0, 0, 0];
  const L: Rgb = [0, 0, 0];
  const T: Rgb = [1, 1, 1];
  // One segment: n uniform intervals; dust only inside the slab.
  const segment = (t0: number, t1: number, n: number, dusty: boolean): void => {
    if (n <= 0 || t1 <= t0) return;
    const dt = (t1 - t0) / n;
    for (let i = 0; i < n; i++) {
      const ta = t0 + i * dt;
      const tb = ta + dt;
      // Warp height at the interval midpoint; sample the map where the vertical profile puts the
      // light (centroid), jittered when the ray runs parallel to the disc.
      const th = ta + 0.5 * dt;
      const z0 = warpZ(p, ro[0] + rd[0] * th, ro[1] + rd[1] * th);
      const f = centroidFrac(
        ro[2] + rd[2] * ta - z0,
        ro[2] + rd[2] * tb - z0,
        dusty ? p.hYoungKpc : p.hOldKpc,
        j,
      );
      const tm = ta + f * dt;
      sampleMap(model, ro[0] + rd[0] * tm, ro[1] + rd[1] * tm, smp);
      const za = ro[2] + rd[2] * ta - z0;
      const zb = ro[2] + rd[2] * tb - z0;
      const eOld = model.amp.old * smp[0] * vertIntegral(za, zb, dt, p.hOldKpc);
      const vy = vertIntegral(za, zb, dt, p.hYoungKpc);
      const eYoung = model.amp.young * smp[1] * vy;
      const eHii = model.amp.hii * smp[3] * vertIntegral(za, zb, dt, p.hHiiKpc);
      const eB = model.amp.bulge * bulgeSeg(ta, tb);
      const tauV = dusty && dustOn ? smp[2] * vertIntegral(za, zb, dt, p.hDustKpc) : 0;
      for (let c = 0; c < 3; c++) {
        const e = eOld * col.old[c] + eYoung * col.young[c] + eHii * col.hii[c] + eB * col.bulge[c];
        const tau = tauV * p.redden[c];
        const att = Math.exp(-tau);
        const f = tau > 1e-4 ? (1 - att) / tau : 1;
        L[c] += T[c] * e * f;
        T[c] *= att;
      }
    }
  };
  if (hasSlab) {
    segment(0, s0, nA, false);
    segment(s0, s1, nS, true);
    segment(s1, tEnd, nB, false);
  } else segment(0, tEnd, nA, false);
  // Polar feature (analytic), dimmed by the slab when its closest approach lies behind it.
  if (p.polar && model.polarAxis) {
    const e = polarLine(model, ro, rd);
    if (e.value > 0) {
      let tr: Rgb = [1, 1, 1];
      if (hasSlab && e.t > s1) tr = T;
      else if (hasSlab && e.t > s0) tr = [Math.sqrt(T[0]), Math.sqrt(T[1]), Math.sqrt(T[2])];
      for (let c = 0; c < 3; c++) L[c] += model.amp.polar * e.value * p.polar.color[c] * tr[c];
    }
  }
  return L;
}

/** Line integral of the polar tube's profile (without amplitude) and the closest-approach t. */
export function polarLine(model: PortraitModel, ro: number[], rd: number[]): { value: number; t: number } {
  const f = model.params.polar!;
  const a = model.polarAxis!;
  const b = rd[0] * a[0] + rd[1] * a[1] + rd[2] * a[2];
  const d = rd[0] * ro[0] + rd[1] * ro[1] + rd[2] * ro[2];
  const e = a[0] * ro[0] + a[1] * ro[1] + a[2] * ro[2];
  const den = Math.max(1 - b * b, 1e-8);
  const t = (b * e - d) / den;
  let s = (e - b * d) / den;
  if (f.kind === 'cones') s = Math.abs(s);
  const L = f.lengthKpc;
  if (s < 0 || s > L) return { value: 0, t };
  const open = (f.openingDeg * Math.PI) / 180;
  const w = polarWidth(f.widthKpc, open, s);
  const px = ro[0] + rd[0] * t - a[0] * (s * Math.sign((e - b * d) / den || 1));
  const py = ro[1] + rd[1] * t - a[1] * (s * Math.sign((e - b * d) / den || 1));
  const pz = ro[2] + rd[2] * t - a[2] * (s * Math.sign((e - b * d) / den || 1));
  const dist2 = px * px + py * py + pz * pz;
  const sinT = Math.sqrt(den);
  const SQRT_PI = 1.7724538509;
  const v =
    (polarProfile(f.kind, L, s) * Math.exp(-dist2 / (w * w)) * SQRT_PI * w) /
    Math.max(sinT, (SQRT_PI * w) / (2 * L));
  return { value: t > 0 ? v : 0, t };
}

// ---------------------------------------------------------------------------------------------
// Orientation helpers
// ---------------------------------------------------------------------------------------------

/**
 * Tilts a galaxy orientation (q: local → universe, [x, y, z, w]) about n × los by the smallest angle
 * that makes the disc inclination to the line of sight `los` (galaxy → observer) equal `deg`.
 */
export function tiltToInclination(q: readonly number[], los: readonly number[], deg: number): number[] {
  const [x, y, z, w] = q;
  // n = q · (0, 0, 1)
  const n = [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)];
  const ll = Math.hypot(los[0], los[1], los[2]) || 1;
  let l = [los[0] / ll, los[1] / ll, los[2] / ll];
  let c = n[0] * l[0] + n[1] * l[1] + n[2] * l[2];
  if (c < 0) {
    l = [-l[0], -l[1], -l[2]];
    c = -c;
  }
  const cur = Math.acos(Math.min(1, c));
  const target = (Math.min(90, Math.max(0, deg)) * Math.PI) / 180;
  let a = [n[1] * l[2] - n[2] * l[1], n[2] * l[0] - n[0] * l[2], n[0] * l[1] - n[1] * l[0]];
  let al = Math.hypot(a[0], a[1], a[2]);
  if (al < 1e-9) {
    // Face-on: any axis perpendicular to n.
    a = Math.abs(n[0]) < 0.9 ? [0, n[2], -n[1]] : [-n[2], 0, n[0]];
    al = Math.hypot(a[0], a[1], a[2]);
  }
  const ang = cur - target;
  const sh = Math.sin(ang / 2) / al;
  const r = [a[0] * sh, a[1] * sh, a[2] * sh, Math.cos(ang / 2)];
  // r · q
  const out = [
    r[3] * x + r[0] * w + r[1] * z - r[2] * y,
    r[3] * y - r[0] * z + r[1] * w + r[2] * x,
    r[3] * z + r[0] * y - r[1] * x + r[2] * w,
    r[3] * w - r[0] * x - r[1] * y - r[2] * z,
  ];
  const ol = Math.hypot(out[0], out[1], out[2], out[3]);
  return out.map((v) => v / ol);
}

/**
 * Disc-plane azimuth (galaxy-local, radians) whose projection on the sky (perpendicular to the unit
 * line of sight `los`) points the same way as `d` projected on the sky: aims a bridge at a companion
 * whatever the (uncertain) line-of-sight distances.
 */
export function skyAimAzimuth(d: readonly number[], los: readonly number[]): number {
  const dl = d[0] * los[0] + d[1] * los[1] + d[2] * los[2];
  const s = [d[0] - dl * los[0], d[1] - dl * los[1], d[2] - dl * los[2]];
  let best = 0;
  let bestCos = -2;
  for (let k = 0; k < 720; k++) {
    const a = (k / 720) * 2 * Math.PI;
    const u = [Math.cos(a), Math.sin(a), 0];
    const ul = u[0] * los[0] + u[1] * los[1];
    const pu = [u[0] - ul * los[0], u[1] - ul * los[1], -ul * los[2]];
    const c =
      (pu[0] * s[0] + pu[1] * s[1] + pu[2] * s[2]) /
      (Math.hypot(pu[0], pu[1], pu[2]) * Math.hypot(s[0], s[1], s[2]) || 1);
    if (c > bestCos) {
      bestCos = c;
      best = a;
    }
  }
  return best;
}
