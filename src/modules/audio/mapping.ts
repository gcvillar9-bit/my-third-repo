/**
 * Pure (three- and DOM-free) mappings from the camera situation to sound parameters. The engine
 * only applies what these return, so everything audible here is unit-tested.
 */
import atmospheres from './atmospheres.json';

/** Scale zones of the ambient pad, nearest first. */
export const ZONES = ['surface', 'orbit', 'interplanetary', 'interstellar', 'galactic', 'cosmic'] as const;
export type Zone = (typeof ZONES)[number];

/** Heliosphere-ish edge of the Solar System (~670 au), m. */
export const HELIO_EDGE_M = 1e14;
/** Edge of the solar neighbourhood (~100 pc), m. */
export const LOCAL_EDGE_M = 3e18;
/** Edge of the Milky Way halo region (~32 kpc from Sgr A*), m. */
export const GALAXY_EDGE_M = 1e21;

export interface ZoneInput {
  /** Altitude above the nearest surface, m (Infinity when none). */
  altitude: number;
  /** Radius of that body, m. */
  radius: number;
  /** Distance to the Solar System barycentre, m. */
  dSun: number;
  /** Distance to the Milky Way centre (Sgr A*), m. */
  dGalaxy: number;
}

export function classifyZone(z: ZoneInput): Zone {
  const r = Math.max(z.radius, 1);
  if (Number.isFinite(z.altitude)) {
    if (z.altitude < 0.02 * r) return 'surface';
    if (z.altitude < 30 * r) return 'orbit';
  }
  if (z.dSun < HELIO_EDGE_M) return 'interplanetary';
  if (z.dSun < LOCAL_EDGE_M) return 'interstellar';
  if (z.dGalaxy < GALAXY_EDGE_M) return 'galactic';
  return 'cosmic';
}

export interface PadVoice {
  /** Root frequency, Hz. */
  root: number;
  /** Chord intervals in semitones above the root. */
  intervals: readonly number[];
  /** Low-pass cutoff, Hz (timbre: warmer when lower). */
  cutoff: number;
  wave: OscillatorType;
  /** Detune between the two oscillators of a note, cents. */
  detune: number;
}

/** Chord and timbre per zone: warm and close near surfaces, colder and more open further out. */
export const PAD_VOICES: Readonly<Record<Zone, PadVoice>> = {
  surface: { root: 110, intervals: [0, 7, 16, 23], cutoff: 900, wave: 'triangle', detune: 5 },
  orbit: { root: 98, intervals: [0, 7, 14, 19], cutoff: 1300, wave: 'sawtooth', detune: 6 },
  interplanetary: { root: 87.31, intervals: [0, 7, 16, 21], cutoff: 1000, wave: 'sawtooth', detune: 7 },
  interstellar: { root: 73.42, intervals: [0, 7, 15, 22], cutoff: 800, wave: 'sawtooth', detune: 8 },
  galactic: { root: 65.41, intervals: [0, 10, 14, 19], cutoff: 650, wave: 'sawtooth', detune: 9 },
  cosmic: { root: 55, intervals: [0, 12, 19, 26], cutoff: 480, wave: 'triangle', detune: 11 },
};

export const noteHz = (root: number, semitones: number): number => root * Math.pow(2, semitones / 12);

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const sat = (x: number): number => 1 - Math.exp(-Math.max(0, x));

export interface FilteredGain {
  /** Linear gain, 0..1 (before the master volume). */
  gain: number;
  /** Filter centre/cutoff, Hz. */
  cutoff: number;
}

/**
 * Flight whoosh. `relSpeed` = speed / distance to the nearest surface (1/s; the free camera flies
 * at k · d, so cruising gives about k), `logRate` = d(ln speed)/dt (acceleration and braking).
 * Silent when still.
 */
export function whooshParams(relSpeed: number, logRate: number, out: FilteredGain): FilteredGain {
  const motion = sat(relSpeed / 1.5);
  const accel = sat(Math.abs(logRate) / 2);
  const level = clamp01(0.7 * motion + 0.6 * accel);
  out.gain = level < 0.02 ? 0 : 0.22 * level;
  out.cutoff = 220 * Math.pow(2, 4 * clamp01(0.55 * motion + 0.6 * accel));
  return out;
}

export interface AtmosphereRow {
  id: string;
  rho0: number;
  scaleHeightM: number;
  topM: number;
  approximate: boolean;
  source: string;
}

export const ATMOSPHERE_DENSITY: readonly AtmosphereRow[] = (atmospheres as { rows: AtmosphereRow[] }).rows;

/** Air density proxy, kg/m³ (exponential atmosphere; 0 above the top or for airless bodies). */
export function densityAt(bodyId: string, altitude: number, rows = ATMOSPHERE_DENSITY): number {
  const row = rows.find((r) => r.id === bodyId);
  if (!row || !(altitude < row.topM)) return 0;
  return row.rho0 * Math.exp(-Math.max(0, altitude) / row.scaleHeightM);
}

/**
 * Atmospheric wind: gain follows the dynamic pressure q = ½ρv² (log-compressed, so Mars and Venus
 * both stay audible), plus a faint breeze near the ground scaled by density.
 */
export function windParams(
  density: number,
  speed: number,
  altitude: number,
  out: FilteredGain,
): FilteredGain {
  if (!(density > 0)) {
    out.gain = 0;
    out.cutoff = 400;
    return out;
  }
  const q = 0.5 * density * speed * speed;
  const flow = clamp01(Math.log10(1 + q) / 4);
  const breeze = altitude < 5000 ? 0.05 * Math.sqrt(Math.min(1, density / 1.225)) : 0;
  out.gain = Math.min(0.4, 0.35 * flow + breeze);
  out.cutoff = 300 + 1700 * flow;
  return out;
}

/** Black-hole rumble level 0..1 from the distance in Schwarzschild radii (audible inside ~1e6 r_s). */
export function rumbleLevel(distance: number, rs: number): number {
  if (!(rs > 0) || !Number.isFinite(distance)) return 0;
  const x = clamp01((6 - Math.log10(Math.max(distance, rs) / rs)) / 5.5);
  return x * Math.sqrt(x);
}

/** Footsteps per second while walking (0 below 0.3 m/s). */
export function stepRate(speed: number): number {
  return speed < 0.3 ? 0 : Math.min(4, Math.max(1.2, speed / 0.75));
}

/** Footstep pitch factor from surface gravity g (m/s²): lower and softer on light worlds. */
export function gravityPitch(g: number): number {
  if (!(g > 0)) return 1;
  return Math.min(1.4, Math.max(0.55, Math.pow(g / 9.81, 0.25)));
}

/** Whether a smoothed parameter changed enough to be worth an AudioParam update. */
export const changed = (a: number, b: number, eps = 1e-3): boolean => Math.abs(a - b) > eps;
