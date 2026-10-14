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
const JD_J2000 = 2_451_545;
const R_SUN = 6.957e8;
const YEAR_DAYS = 365.25;

export const MAX_SPOTS = 48;
export const MAX_REGIONS = data.spots.maxGroups;
export const MAX_PROMINENCES = 16;
/** Filament pattern bucket, days (filaments re-form, and the old ones vanish, every bucket). */
export const FILAMENT_BUCKET_DAYS = 13;

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
  minYear: number;
  maxYear: number;
  maxSsn: number;
}

const ROWS = data.cycle.rows;
const PERIOD = data.cycle.periodYears;

/** Cycle `n` (table row, or the generic cycle repeated every `periodYears` outside the table). */
export function cycle(n: number): Cycle {
  const row = ROWS.find((r) => r.cycle === n);
  if (row) return { n, minYear: row.minYear, maxYear: row.maxYear, maxSsn: row.maxSsn };
  const ref = n < ROWS[0].cycle ? ROWS[0] : ROWS[ROWS.length - 1];
  const minYear = ref.minYear + (n - ref.cycle) * PERIOD;
  return { n, minYear, maxYear: minYear + data.cycle.generic.riseYears, maxSsn: data.cycle.generic.maxSsn };
}

/** Smoothed sunspot number contributed by cycle `c` at decimal `year`. */
export function cycleSsn(c: Cycle, year: number): number {
  const b = (c.maxYear - c.minYear) / X_PEAK;
  return (c.maxSsn * shape((year - c.minYear) / b)) / SHAPE_PEAK;
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
/** Shader coefficients (A - frame, B, C), deg/day: drift = x + y s^2 + z s^4. */
export const DRIFT_COEFFS: readonly [number, number, number] = [
  ROT.aDegPerDay - ROT.frameDegPerDay,
  ROT.bDegPerDay,
  ROT.cDegPerDay,
];

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

export interface Spot {
  /** Unit direction, body-fixed (sun.fixed) axes. */
  dir: [number, number, number];
  /** Umbra radius, m (the penumbra reaches penumbraRatio times further). */
  umbraM: number;
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

function offsetDir(
  c: [number, number, number],
  axis: [number, number, number],
  ang: number,
): [number, number, number] {
  const x = c[0] + axis[0] * ang;
  const y = c[1] + axis[1] * ang;
  const z = c[2] + axis[2] * ang;
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

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
  for (const g of out) {
    const lo = g.lonDeg * DEG;
    const la = g.latDeg * DEG;
    const east: [number, number, number] = [-Math.sin(lo), Math.cos(lo), 0];
    const north: [number, number, number] = [
      -Math.sin(la) * Math.cos(lo),
      -Math.sin(la) * Math.sin(lo),
      Math.cos(la),
    ];
    const ti = g.tiltDeg * DEG;
    const s = Math.sign(g.latDeg);
    const axis: [number, number, number] = [0, 1, 2].map(
      (k) => Math.cos(ti) * east[k] - s * Math.sin(ti) * north[k],
    ) as [number, number, number];
    const half = (0.375 * g.lengthM * (0.6 + 0.4 * Math.min(1, g.strength * 2))) / R_SUN;
    const ru = (SP.umbraRadiusMm[0] + (SP.umbraRadiusMm[1] - SP.umbraRadiusMm[0]) * g.size) * 1e6;
    g.spots.push({ dir: offsetDir(g.centre, axis, half), umbraM: ru * Math.sqrt(g.strength) });
    g.spots.push({ dir: offsetDir(g.centre, axis, -half), umbraM: 0.7 * ru * g.strength });
    if (g.size > 0.35)
      g.spots.push({ dir: offsetDir(g.centre, axis, -0.25 * half), umbraM: 0.35 * ru * g.strength });
  }
  return out;
}

// --- Prominences ----------------------------------------------------------------------------------

export interface Prominence {
  /** Unit anchor direction, body-fixed. */
  dir: [number, number, number];
  /** Height and half-width along the limb, solar radii. */
  height: number;
  halfWidth: number;
  /** 0 = quiescent hedgerow, 1 = active-region loop. */
  type: 0 | 1;
  seed: number;
  /** 0..1 fade (birth / disappearance). */
  intensity: number;
}

const PR = data.prominences;
const Q_BUCKET = 24;

/** Prominence anchors at `jd`: quiescent ones on filament latitudes plus loops over big groups. */
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
    const n = 3 + Math.round(2 * Math.min(1.5, ssn / 160));
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
  for (const g of groups) {
    if (out.length >= MAX_PROMINENCES) break;
    if (g.size < 0.3 || g.strength < 0.3) continue;
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

// --- Uniform packing --------------------------------------------------------------------------------

/** Shared per-frame activity state (photosphere and corona read the same arrays). */
export class SunActivity {
  /** (dir.xyz body-fixed, umbra radius in solar radii). */
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
  /** Filament field: (seed, days since bucket start, fade, 0). */
  readonly filament = [0, 0, 0, 0];
  groups: SpotGroup[] = [];
  private jd = NaN;

  update(jd: number): void {
    if (jd === this.jd) return;
    this.jd = jd;
    const groups = (this.groups = activeGroups(jd));
    this.spots.fill(0);
    this.regions.fill(0);
    this.regionsB.fill(0);
    let ns = 0;
    let nr = 0;
    for (const g of groups) {
      if (nr >= MAX_REGIONS) break;
      if (ns + g.spots.length > MAX_SPOTS) continue;
      for (const s of g.spots) {
        this.spots.set([...s.dir, s.umbraM / R_SUN], ns * 4);
        ns++;
      }
      const rad = (0.5 * g.lengthM + SP.umbraRadiusMm[1] * 2e6) / R_SUN;
      this.regions.set([...g.centre, rad * (0.6 + 0.4 * Math.sqrt(g.strength))], nr * 4);
      this.regionsB.set([Math.sign(g.latDeg) * g.tiltDeg * DEG, g.strength, g.flare, g.seed], nr * 4);
      nr++;
    }
    this.spotCount = ns;
    this.regionCount = nr;
    const pr = prominences(jd, groups);
    this.prom.fill(0);
    this.promB.fill(0);
    pr.forEach((p, i) => {
      this.prom.set([...p.dir, p.type], i * 4);
      this.promB.set([p.height, p.halfWidth, p.seed, p.intensity], i * 4);
    });
    this.promCount = pr.length;
    const k = Math.floor(jd / FILAMENT_BUCKET_DAYS);
    const tau = jd - k * FILAMENT_BUCKET_DAYS;
    this.filament[0] = (hashInt(k) % 1000) / 10;
    this.filament[1] = tau;
    this.filament[2] =
      smoothstep(0, 1, tau) * (1 - smoothstep(FILAMENT_BUCKET_DAYS - 1, FILAMENT_BUCKET_DAYS, tau));
  }
}
