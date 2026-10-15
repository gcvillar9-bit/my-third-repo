/**
 * Simulated solar activity (three-free, CPU side): the 11-year cycle, sunspot groups that are born and
 * decay deterministically in sim time, the butterfly diagram, Snodgrass differential rotation, flares
 * and prominence anchors. Nothing here is a real spot position: it is a procedural Sun whose statistics
 * follow the cycle. Everything is a pure function of the JD (seeded per day / hour bucket), so pause,
 * warp and test runs are reproducible. `SunActivity.update(jd)` packs the result into the small
 * Float32Array uniforms read by photosphere.glsl and corona.glsl.
 */
import data from './sun-data.json';

const DEG = Math.PI / 180;
type V3 = [number, number, number];
const JD_J2000 = 2_451_545;
const R_SUN = 6.957e8;
const YEAR_DAYS = 365.25;

export const MAX_SPOTS = 64;
export const MAX_REGIONS = data.spots.maxGroups;
export const MAX_PROMINENCES = 32;
/** On-disk H-alpha filaments (the quiescent prominences seen against the disk). */
export const MAX_FILAMENTS = 24;
/**
 * Leading and following polarity centres sit at +/-POLE_U region radii along the group axis (the shader's
 * pore field and flare ribbons assume it).
 */
export const POLE_U = 0.5;

export const jdToYear = (jd: number): number => 2000 + (jd - JD_J2000) / YEAR_DAYS;

// --- Cycle ----------------------------------------------------------------------------------

const SHAPE_C = data.cycle.shapeC;
/** Hathaway et al. (1994) cycle shape in units of the cycle's own timescale b. */
const shape = (x: number): number => (x <= 0 ? 0 : x ** 3 / (Math.exp(x * x) - SHAPE_C));
const X_PEAK = (() => {
  let bx = 0;
  let best = 0;
  for (let x = 0.01; x < 3; x += 1e-4) {
    const v = shape(x);
    if (v > best) {
      best = v;
      bx = x;
    }
  }
  return bx;
})();
const SHAPE_PEAK = shape(X_PEAK);

export interface Cycle {
  n: number;
  /** Smoothed minimum that starts the cycle (decimal year; also starts the butterfly). */
  minYear: number;
  /** Smoothed maximum (display value). */
  maxYear: number;
  /** Amplitude: the smoothed sunspot number at the peak of the fitted shape. */
  maxSsn: number;
  /** Start and timescale of the fitted Hathaway shape, years. */
  t0Year: number;
  bYears: number;
}

const ROWS = data.cycle.rows;
const PERIOD = data.cycle.periodYears;

/** Cycle `n` (table row, or the generic cycle repeated every `periodYears` outside the table). */
export function cycle(n: number): Cycle {
  const row = ROWS.find((r) => r.cycle === n);
  if (row) {
    const { minYear, maxYear, maxSsn, t0Year, bYears } = row;
    return { n, minYear, maxYear, maxSsn, t0Year, bYears };
  }
  const G = data.cycle.generic;
  const ref = n < ROWS[0].cycle ? ROWS[0] : ROWS[ROWS.length - 1];
  const minYear = ref.minYear + (n - ref.cycle) * PERIOD;
  const t0Year = minYear + G.t0OffsetYears;
  return { n, minYear, maxYear: t0Year + X_PEAK * G.bYears, maxSsn: G.maxSsn, t0Year, bYears: G.bYears };
}

/** Smoothed sunspot number contributed by cycle `c` at decimal `year` (its own fitted shape). */
export function cycleSsn(c: Cycle, year: number): number {
  return (c.maxSsn * shape((year - c.t0Year) / c.bYears)) / SHAPE_PEAK;
}

/** The cycles that can contribute at `year` (the current one, its two predecessors, the next). */
export function cyclesAt(year: number): Cycle[] {
  const r25 = ROWS.find((r) => r.cycle === 25)!;
  const n = 25 + Math.floor((year - r25.minYear) / PERIOD);
  return [n - 2, n - 1, n, n + 1].map(cycle);
}

/** Smoothed (13-month) sunspot number at `jd` (sum of the overlapping cycles). */
export function sunspotNumber(jd: number): number {
  const y = jdToYear(jd);
  return cyclesAt(y).reduce((s, c) => s + cycleSsn(c, y), 0);
}

/** Mean emergence latitude (deg, unsigned) of cycle `c` at `year` (Sporer's law). */
export function meanEmergenceLatDeg(c: Cycle, year: number): number {
  const b = data.butterfly;
  return b.startLatDeg * Math.exp(-((year - c.minYear) * 12) / b.decayMonths);
}

// --- Differential rotation --------------------------------------------------------------------

const ROT = data.rotation;
/** Sidereal angular velocity, deg/day, at latitude `latRad` (Snodgrass 1983). */
export function rotationRateDegPerDay(latRad: number): number {
  const s2 = Math.sin(latRad) ** 2;
  return ROT.aDegPerDay + ROT.bDegPerDay * s2 + ROT.cDegPerDay * s2 * s2;
}
export const rotationPeriodDays = (latRad: number): number => 360 / rotationRateDegPerDay(latRad);
/** Drift rate relative to the `sun.fixed` frame (IAU W-dot), deg/day. */
export const driftDegPerDay = (latRad: number): number => rotationRateDegPerDay(latRad) - ROT.frameDegPerDay;

// --- Deterministic randomness -------------------------------------------------------------------

function hashInt(n: number): number {
  let h = (Math.floor(n) | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** mulberry32 PRNG in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function poisson(mean: number, r: () => number): number {
  const L = Math.exp(-mean);
  let k = 0;
  let p = r();
  while (p > L && k < 50) {
    k++;
    p *= r();
  }
  return k;
}

const gauss = (r: () => number): number => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// --- Sunspot groups -----------------------------------------------------------------------------

const SP = data.spots;
const MEAN_LIFE = SP.lifeDays[0] + (SP.lifeDays[1] - SP.lifeDays[0]) / 3; // size = u^2, E[u^2] = 1/3

/**
 * 'pore': a small umbra-like spot without a penumbra. 'embedded': an umbra inside a bigger spot's penumbra
 * (same polarity), sharing it. 'partial': a one-sided penumbra (umbra radius between poreMaxRadiusMm and
 * fullPenumbraMinRadiusMm). 'full': a whole penumbra (neighbouring ones merge into a common penumbra).
 */
export type SpotKind = 'pore' | 'embedded' | 'partial' | 'full';
/** Shader codes of the kinds (photosphere.glsl SPOT_*). */
export const SPOT_KIND_CODE: Record<SpotKind, number> = { pore: 0, embedded: 1, partial: 2, full: 3 };
/** Shape seeds per spot (the packed integer part is 32 * (kind code + 4 * following) + seed). */
export const SPOT_SEEDS = 32;

export interface Spot {
  /** Unit direction, body-fixed (sun.fixed) axes. */
  dir: [number, number, number];
  /** Umbra radius, m (the penumbra reaches about penumbraRatio times further). */
  umbraM: number;
  /** True when the spot draws a penumbra of its own ('partial' or 'full'). */
  penumbra: boolean;
  kind: SpotKind;
  /** Leading polarity (compact, round spots) or following (elongated along the group axis). */
  leading: boolean;
  /** 0..31 shape seed (outline, filament twist, light bridge), stable over the spot's life. */
  seed: number;
}

export interface SpotGroup {
  id: number;
  cycle: number;
  birthJd: number;
  lifeDays: number;
  /** 0..1 (most groups are small). */
  size: number;
  /** Emergence latitude, deg (signed); it stays fixed while the group drifts in longitude. */
  latDeg: number;
  /** Longitude in sun.fixed now, deg. */
  lonDeg: number;
  /** Joy's-law tilt, deg (leading spot nearer the equator). */
  tiltDeg: number;
  /** Growth/decay envelope 0..1 (area). */
  strength: number;
  lengthM: number;
  /** Unit centre direction, body-fixed. */
  centre: [number, number, number];
  spots: Spot[];
  /** Current flare brightness 0..~1 (H-alpha ribbons). */
  flare: number;
  seed: number;
}

const dirOf = (latDeg: number, lonDeg: number): [number, number, number] => {
  const la = latDeg * DEG;
  const lo = lonDeg * DEG;
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
};

/** Flare brightness of a group at `jd` (deterministic per hour bucket; minutes to ~3 h long). */
export function flareAt(id: number, size: number, jd: number): number {
  const hNow = Math.floor(jd * 24);
  let f = 0;
  for (let h = hNow - 3; h <= hNow; h++) {
    const r = rng(hashInt(id * 131 + h * 7 + 3));
    if (r() >= 0.008 + 0.1 * size * size) continue;
    const start = (h + r()) / 24;
    const dur = (0.15 + 2.5 * r() ** 2) / 24;
    const peak = 0.4 + 0.6 * size;
    const tau = (jd - start) / dur;
    if (tau < 0 || tau >= 1) continue;
    const v = tau < 0.08 ? tau / 0.08 : Math.exp(-(tau - 0.08) / 0.3) * (1 - tau);
    f = Math.max(f, peak * v);
  }
  return f;
}

/** Every simulated sunspot group alive at `jd`, largest first. */
export function activeGroups(jd: number): SpotGroup[] {
  const out: SpotGroup[] = [];
  const day = Math.floor(jd);
  const maxLife = Math.ceil(SP.lifeDays[1]);
  for (let d = day - maxLife - 1; d <= day; d++) {
    const r = rng(hashInt(d * 7919 + 13));
    const year = jdToYear(d + 0.5);
    const cycles = cyclesAt(year);
    const contrib = cycles.map((c) => cycleSsn(c, year));
    const ssn = contrib.reduce((a, b) => a + b, 0);
    const k = poisson((ssn * SP.groupsPerSsn) / MEAN_LIFE, r);
    for (let i = 0; i < k; i++) {
      // Draw everything first so the sequence does not depend on `jd`.
      let pick = r() * ssn;
      let ci = 0;
      while (ci < cycles.length - 1 && pick >= contrib[ci]) pick -= contrib[ci++];
      const size = r() ** 2;
      const life = SP.lifeDays[0] + (SP.lifeDays[1] - SP.lifeDays[0]) * size;
      const birth = d + r();
      const hemi = r() < 0.5 ? -1 : 1;
      const B = data.butterfly;
      const lat =
        hemi *
        Math.min(
          B.maxLatDeg,
          Math.max(B.minLatDeg, meanEmergenceLatDeg(cycles[ci], year) + B.sigmaDeg * gauss(r)),
        );
      const lon0 = r() * 360;
      const tiltJitter = (r() - 0.5) * 8;
      const seed = r();
      const t = jd - birth;
      if (t < 0 || t >= life) continue;
      const grow = Math.max(0.5, 0.15 * life);
      const strength = t < grow ? smoothstep(0, grow, t) : 1 - (t - grow) / (life - grow);
      const lonDeg = lon0 + driftDegPerDay(lat * DEG) * t;
      const tiltDeg = SP.joyTiltPerLat * Math.abs(lat) + tiltJitter;
      const lengthM = (SP.groupLengthMm[0] + (SP.groupLengthMm[1] - SP.groupLengthMm[0]) * size) * 1e6;
      const id = d * 64 + i;
      out.push({
        id,
        cycle: cycles[ci].n,
        birthJd: birth,
        lifeDays: life,
        size,
        latDeg: lat,
        lonDeg: ((lonDeg % 360) + 360) % 360,
        tiltDeg,
        strength,
        lengthM,
        centre: dirOf(lat, lonDeg),
        spots: [],
        flare: strength > 0.2 ? flareAt(id, size, jd) : 0,
        seed,
      });
    }
  }
  out.sort((a, b) => b.size * b.strength - a.size * a.strength);
  for (const g of out) g.spots = groupSpots(g);
  return out;
}

/** Unit vectors of a group's frame: the Joy-tilted axis (following -> leading) and the across direction. */
export function groupAxes(g: SpotGroup): { axis: V3; across: V3 } {
  const lo = g.lonDeg * DEG;
  const la = g.latDeg * DEG;
  const east: V3 = [-Math.sin(lo), Math.cos(lo), 0];
  const north: V3 = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
  const ti = g.tiltDeg * DEG;
  const s = Math.sign(g.latDeg);
  const axis = [0, 1, 2].map((k) => Math.cos(ti) * east[k] - s * Math.sin(ti) * north[k]) as V3;
  const c = g.centre;
  const across: V3 = [
    c[1] * axis[2] - c[2] * axis[1],
    c[2] * axis[0] - c[0] * axis[2],
    c[0] * axis[1] - c[1] * axis[0],
  ];
  return { axis, across };
}

/** Half the leading-following separation, solar radii (the group spreads as it grows). */
export const groupHalfLength = (g: SpotGroup): number =>
  (0.375 * g.lengthM * (0.6 + 0.4 * Math.min(1, g.strength * 2))) / R_SUN;

/** Outer penumbra radius of a spot of umbra radius `umbraM` with a penumbra, solar radii. */
const penumbraR = (umbraM: number): number => (SP.penumbraRatio * umbraM) / R_SUN;
/** Embedded umbrae sit within this fraction of their parent's penumbra radius. */
const EMBED_FRACTION = 0.72;

/**
 * Sorts out overlapping spots of one polarity (the spots' order is kept): a spot within reach of a bigger
 * spot's penumbra (their penumbra radii touch) that is small or already inside it becomes an umbra
 * embedded in that penumbra, pulled inside it if needed. A big spot just outside keeps its penumbra (the
 * shader merges the two into a common penumbra). Lone spots get a full penumbra above
 * `fullPenumbraMinRadiusMm`, a one-sided one above `poreMaxRadiusMm` and none (a pore) below.
 */
export function classifySpots(spots: Spot[]): void {
  const full = SP.fullPenumbraMinRadiusMm * 1e6;
  const pore = SP.poreMaxRadiusMm * 1e6;
  const order = spots.map((_, i) => i).sort((a, b) => spots[b].umbraM - spots[a].umbraM);
  const done: Spot[] = [];
  for (const i of order) {
    const s = spots[i];
    s.kind = s.umbraM > full ? 'full' : s.umbraM > pore ? 'partial' : 'pore';
    for (const p of done) {
      if (p.leading !== s.leading || (p.kind !== 'full' && p.kind !== 'partial')) continue;
      const dist = Math.hypot(...[0, 1, 2].map((k) => s.dir[k] - p.dir[k]));
      const Rp = penumbraR(p.umbraM);
      const Rs = s.kind === 'pore' ? s.umbraM / R_SUN : penumbraR(s.umbraM);
      if (dist >= Rp + Rs) continue;
      if (s.kind === 'full' && dist >= Rp) continue; // big neighbour: a common penumbra (shader)
      s.kind = 'embedded';
      // Pull it inside the parent's penumbra, clear of the parent's umbra where there is room.
      const target = Math.min(dist, Math.max(EMBED_FRACTION * Rp, (p.umbraM * 1.15 + s.umbraM) / R_SUN));
      if (target < dist && dist > 1e-12) {
        const x = [0, 1, 2].map((k) => p.dir[k] + ((s.dir[k] - p.dir[k]) * target) / dist);
        const l = Math.hypot(...x);
        s.dir = [x[0] / l, x[1] / l, x[2] / l];
      }
      break;
    }
    s.penumbra = s.kind === 'full' || s.kind === 'partial';
    done.push(s);
  }
}

/**
 * The resolved spots of a bipolar group: a compact leading spot (longest lived), a following spot that
 * decays first with a few fragments around it, a leading satellite and middle spots in big groups, sorted
 * out by classifySpots (pores, one-sided penumbrae, umbrae embedded in a common penumbra); the many
 * smaller pores are procedural (shader).
 */
export function groupSpots(g: SpotGroup): Spot[] {
  const { axis, across } = groupAxes(g);
  const half = groupHalfLength(g);
  const ru = (SP.umbraRadiusMm[0] + (SP.umbraRadiusMm[1] - SP.umbraRadiusMm[0]) * g.size) * 1e6;
  const r = rng(hashInt(g.id * 977 + 5));
  const spots: Spot[] = [];
  const add = (du: number, dv: number, umbraM: number, force = false) => {
    if (umbraM < SP.minSpotRadiusMm * 1e6 && !force) return;
    const x = g.centre.map((v, k) => v + (axis[k] * du + across[k] * dv) * half);
    const l = Math.hypot(...x);
    spots.push({
      dir: [x[0] / l, x[1] / l, x[2] / l],
      umbraM,
      penumbra: false,
      kind: 'pore',
      leading: du > 0,
      seed: hashInt(g.id * 31 + spots.length) % SPOT_SEEDS,
    });
  };
  const st = g.strength;
  // Leading spot: compact and longest lived, always first (the sunspot bookmark aims at it).
  add(1 + 0.08 * (r() - 0.5), 0.1 * (r() - 0.5), ru * Math.sqrt(st), true);
  // Following polarity: a main spot and fragments scattered around it.
  add(-0.92 + 0.12 * (r() - 0.5), 0.2 * (r() - 0.5), (0.5 + 0.25 * r()) * ru * st);
  const nf = g.size > 0.08 ? 1 + Math.floor(r() * (1.5 + 3 * g.size)) : 0;
  for (let i = 0; i < nf; i++) {
    const a = r() * 2 * Math.PI;
    const d = 0.12 + 0.22 * r();
    add(-0.92 + d * Math.cos(a), 0.8 * d * Math.sin(a), (0.16 + 0.24 * r()) * ru * st);
  }
  // A satellite behind the leading spot, and spots in the middle of big groups.
  if (g.size > 0.22) add(0.72 - 0.15 * r(), 0.25 * (r() - 0.5), (0.18 + 0.14 * r()) * ru * Math.sqrt(st));
  if (g.size > 0.4) add(-0.15 + 0.4 * (r() - 0.5), 0.3 * (r() - 0.5), (0.14 + 0.16 * r()) * ru * st);
  classifySpots(spots);
  return spots;
}

/** Packed `w` of a spot: 32 * (kind code + 4 * following) + seed + umbra radius in solar radii. */
export const packSpotW = (s: Spot): number =>
  SPOT_SEEDS * (SPOT_KIND_CODE[s.kind] + (s.leading ? 0 : 4)) + s.seed + s.umbraM / R_SUN;

// --- Prominences and filaments --------------------------------------------------------------------

export interface Prominence {
  /** Unit anchor direction, body-fixed. */
  dir: V3;
  /** Height and half-width along the limb, solar radii. */
  height: number;
  halfWidth: number;
  /** 0 = quiescent hedgerow, 1 = active-region loops. */
  type: 0 | 1;
  seed: number;
  /** 0..1 fade (birth / disappearance). */
  intensity: number;
}

const PR = data.prominences;
const Q_BUCKET = 24;

/**
 * Prominence anchors at `jd`: quiescent ones at filament latitudes (two staggered series that re-form
 * every 24 days, drifting with the differential rotation; their number follows the cycle) plus loop
 * systems over big groups. A quiescent prominence seen against the disk is a filament (see filaments()).
 */
export function prominences(jd: number, groups: readonly SpotGroup[]): Prominence[] {
  const out: Prominence[] = [];
  const ssn = sunspotNumber(jd);
  for (let series = 0; series < 2; series++) {
    const off = series * (Q_BUCKET / 2);
    const k = Math.floor((jd - off) / Q_BUCKET);
    const start = k * Q_BUCKET + off;
    const tau = jd - start;
    const fade = smoothstep(0, 2, tau) * (1 - smoothstep(Q_BUCKET - 2, Q_BUCKET, tau));
    const r = rng(hashInt(k * 2 + series + 99_991));
    const n = PR.perSeries[0] + Math.round(PR.perSeries[1] * Math.min(1.5, ssn / 160));
    for (let i = 0; i < n; i++) {
      const lat =
        (r() < 0.5 ? -1 : 1) *
        (PR.quiescentLatDeg[0] + (PR.quiescentLatDeg[1] - PR.quiescentLatDeg[0]) * r());
      const lon0 = r() * 360;
      const hMm = PR.heightMm[0] + (PR.heightMm[1] - PR.heightMm[0]) * r() ** 1.3;
      const wMm = hMm * (0.8 + 1.6 * r());
      const seed = r();
      out.push({
        dir: dirOf(lat, lon0 + driftDegPerDay(lat * DEG) * tau),
        height: (hMm * 1e6) / R_SUN,
        halfWidth: (wMm * 1e6) / R_SUN,
        type: 0,
        seed,
        intensity: fade,
      });
    }
  }
  let loops = 0;
  for (const g of groups) {
    if (loops >= PR.maxLoops) break;
    if (g.size < 0.3 || g.strength < 0.3) continue;
    loops++;
    out.push({
      dir: g.centre,
      height: (0.3 * g.lengthM) / R_SUN,
      halfWidth: (0.35 * g.lengthM) / R_SUN,
      type: 1,
      seed: g.seed,
      intensity: Math.min(1, g.strength * 1.5),
    });
  }
  return out.slice(0, MAX_PROMINENCES);
}

export interface Filament {
  /** Unit centre direction, body-fixed. */
  dir: V3;
  /** Half-length along the disk, solar radii. */
  halfLength: number;
  /** 0..255 shape seed (sinuosity, width, barbs; the shader derives the orientation from it too). */
  seed: number;
  intensity: number;
}

/** Long-axis angle from local east (rad), mostly east-west; photosphere.glsl computes the same. */
export const filamentAngle = (seed: number): number => (((seed * 0.618034) % 1) - 0.5) * 1.4;

/**
 * On-disk H-alpha filaments: the quiescent prominences seen from above (long, thin, sinuous dark
 * ribbons, a few times longer than the prominence is tall).
 */
export function filaments(proms: readonly Prominence[]): Filament[] {
  return proms
    .filter((p) => p.type === 0 && p.intensity > 0)
    .slice(0, MAX_FILAMENTS)
    .map((p) => ({
      dir: p.dir,
      halfLength: Math.min(0.45, Math.max(p.halfWidth * 1.4, 2.2 * p.height)),
      seed: Math.floor(p.seed * 256) % 256,
      intensity: p.intensity,
    }));
}

/** `n` unit directions along a filament's long axis (for framing views on it). */
export function filamentPoints(f: Filament, n = 7): V3[] {
  const A = f.dir;
  const el = Math.hypot(A[0], A[1]) || 1;
  const e: V3 = [-A[1] / el, A[0] / el, 0];
  const nn: V3 = [A[1] * e[2] - A[2] * e[1], A[2] * e[0] - A[0] * e[2], A[0] * e[1] - A[1] * e[0]];
  const a = filamentAngle(f.seed);
  const ax = [0, 1, 2].map((k) => Math.cos(a) * e[k] + Math.sin(a) * nn[k]);
  const out: V3[] = [];
  for (let i = 0; i < n; i++) {
    const u = n === 1 ? 0 : (2 * i) / (n - 1) - 1;
    const x = A.map((v, k) => v + ax[k] * u * 0.9 * f.halfLength);
    const l = Math.hypot(...x);
    out.push([x[0] / l, x[1] / l, x[2] / l]);
  }
  return out;
}

// --- Uniform packing --------------------------------------------------------------------------------

/** Activity is recomputed at most once per sim minute (spots drift ~2 km per minute). */
export const ACTIVITY_STEP_DAYS = 1 / 1440;
/** The JD the activity is evaluated at for a frame at `jd` (start of its sim minute). */
export const activityJd = (jd: number): number => Math.floor(jd / ACTIVITY_STEP_DAYS) * ACTIVITY_STEP_DAYS;

/** Shared per-frame activity state (photosphere and corona read the same arrays). */
export class SunActivity {
  /** (dir.xyz body-fixed, packSpotW: 32 * (kind + 4 * following) + seed + umbra radius in solar radii). */
  readonly spots = new Float32Array(MAX_SPOTS * 4);
  spotCount = 0;
  /** (centre.xyz, radius in solar radii) and (tilt rad signed, strength, flare, seed). */
  readonly regions = new Float32Array(MAX_REGIONS * 4);
  readonly regionsB = new Float32Array(MAX_REGIONS * 4);
  regionCount = 0;
  /** (anchor.xyz body-fixed, type) and (height, half-width, seed, intensity), radii. */
  readonly prom = new Float32Array(MAX_PROMINENCES * 4);
  readonly promB = new Float32Array(MAX_PROMINENCES * 4);
  promCount = 0;
  /** Filaments: (dir.xyz * intensity, seed + half-length): integer part 0..255, fraction in radii. */
  readonly fil = new Float32Array(MAX_FILAMENTS * 4);
  filCount = 0;
  groups: SpotGroup[] = [];
  private jd = NaN;
  private viewer: V3 | null = null;
  private packedFor = '';

  /**
   * Recomputes the activity for `jd` (evaluated at activityJd(jd), so at most once per sim minute).
   * `viewer` (body-fixed camera position in solar radii) only matters when the spots outnumber the uniform
   * slots: groups on the visible hemisphere are packed first.
   */
  update(jd: number, viewer?: V3 | null): void {
    if (viewer !== undefined) this.viewer = viewer;
    const t = activityJd(jd);
    if (t !== this.jd) {
      this.jd = t;
      this.groups = activeGroups(t);
      const pr = prominences(t, this.groups);
      const P = this.prom;
      const PB = this.promB;
      P.fill(0);
      PB.fill(0);
      for (let i = 0; i < pr.length; i++) {
        const p = pr[i];
        P[i * 4] = p.dir[0];
        P[i * 4 + 1] = p.dir[1];
        P[i * 4 + 2] = p.dir[2];
        P[i * 4 + 3] = p.type;
        PB[i * 4] = p.height;
        PB[i * 4 + 1] = p.halfWidth;
        PB[i * 4 + 2] = p.seed;
        PB[i * 4 + 3] = p.intensity;
      }
      this.promCount = pr.length;
      const fl = filaments(pr);
      const F = this.fil;
      F.fill(0);
      for (let i = 0; i < fl.length; i++) {
        const f = fl[i];
        const k = Math.max(f.intensity, 1e-3);
        F[i * 4] = f.dir[0] * k;
        F[i * 4 + 1] = f.dir[1] * k;
        F[i * 4 + 2] = f.dir[2] * k;
        F[i * 4 + 3] = f.seed + Math.min(f.halfLength, 0.999);
      }
      this.filCount = fl.length;
      this.packedFor = '';
    }
    this.pack();
  }

  private pack(): void {
    const groups = this.groups;
    let total = 0;
    for (const g of groups) total += g.spots.length;
    const v = this.viewer;
    const crowded = total > MAX_SPOTS || groups.length > MAX_REGIONS;
    // Re-pack only when the jd changed, or the viewer moved enough to matter for a crowded Sun.
    const key =
      crowded && v ? `${Math.round(v[0] * 20)},${Math.round(v[1] * 20)},${Math.round(v[2] * 20)}` : 'all';
    if (key === this.packedFor) return;
    this.packedFor = key;
    let order = groups;
    if (crowded && v) {
      const d = Math.hypot(...v);
      const horizon = 1 / Math.max(d, 1.0001) - 0.15;
      const seen = (g: SpotGroup) =>
        (g.centre[0] * v[0] + g.centre[1] * v[1] + g.centre[2] * v[2]) / d > horizon;
      order = [...groups.filter(seen), ...groups.filter((g) => !seen(g))];
    }
    this.spots.fill(0);
    this.regions.fill(0);
    this.regionsB.fill(0);
    let ns = 0;
    let nr = 0;
    const S = this.spots;
    const RG = this.regions;
    const RB = this.regionsB;
    for (const g of order) {
      if (nr >= MAX_REGIONS) break;
      if (ns + g.spots.length > MAX_SPOTS) continue;
      for (const s of g.spots) {
        // w = 32 * (kind + 4 * following) + seed + umbra radius: the radius stays below 0.02, the
        // integer part below 256 (float32 keeps the radius to ~1e-5 radii).
        S[ns * 4] = s.dir[0];
        S[ns * 4 + 1] = s.dir[1];
        S[ns * 4 + 2] = s.dir[2];
        S[ns * 4 + 3] = packSpotW(s);
        ns++;
      }
      RG[nr * 4] = g.centre[0];
      RG[nr * 4 + 1] = g.centre[1];
      RG[nr * 4 + 2] = g.centre[2];
      RG[nr * 4 + 3] = groupHalfLength(g) / POLE_U;
      RB[nr * 4] = Math.sign(g.latDeg) * g.tiltDeg * DEG;
      RB[nr * 4 + 1] = g.strength;
      RB[nr * 4 + 2] = g.flare;
      RB[nr * 4 + 3] = g.seed;
      nr++;
    }
    this.spotCount = ns;
    this.regionCount = nr;
  }
}
