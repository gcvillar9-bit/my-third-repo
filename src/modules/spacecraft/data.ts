/**
 * craft.json row types (three-free). Rows are in the file's units (km, km/s, degrees, UTC ISO
 * dates, JD in TDB); everything computed from them is SI and JD TT. Every row and every position
 * block carries a `source`; `approximate` marks values that are rounded, fitted or illustrative.
 */
import type { JD } from '../../core/contracts';
import { parseInstant } from '../../core/time';

export const CRAFT_PATH = 'data/spacecraft/craft.json';

export type CraftKind = 'leo' | 'l2' | 'probe';
export type ModelId = 'iss' | 'hubble' | 'jwst' | 'voyager' | 'newhorizons' | 'pioneer';

export interface FactRow {
  label: string;
  value: string | number;
  unit?: string;
  approximate?: boolean;
}

/** Mean elements of one published element set (TLE), TEME frame. */
export interface LeoOrbitRow {
  epochUtc: string;
  inclinationDeg: number;
  raanDeg: number;
  eccentricity: number;
  argPerigeeDeg: number;
  meanAnomalyDeg: number;
  meanMotionRevPerDay: number;
  source: string;
}

/** Ellipse about L2 in the rotating Sun-Earth frame (see the row's `frame` text). */
export interface HaloRow {
  arrivalUtc: string;
  epochJd: number;
  periodDays: number;
  centerKm: [number, number, number];
  cosKm: [number, number, number];
  sinKm: [number, number, number];
  fitRmsKm: number;
  frame: string;
  source: string;
}

/**
 * A point the path passes through. Encounters (launch, flybys): the craft is `caKm` from the centre
 * of `body` at `utc`. Waypoints: a published heliocentric ICRF position `posKm` at `jdTdb`, used
 * where the arc between two encounters spans about 180° and the Lambert plane would be undefined.
 */
export interface NodeRow {
  label: string;
  body?: string;
  utc?: string;
  caKm?: number;
  jdTdb?: number;
  posKm?: [number, number, number];
  source?: string;
}

export interface TrajectoryRow {
  nodes: NodeRow[];
  nodeSource: string;
  /** Heliocentric ICRF state after the last flyby. */
  coast: {
    epochJd: number;
    posKm: [number, number, number];
    velKmS: [number, number, number];
    source: string;
  };
}

export interface CraftRow {
  id: string;
  name: string;
  shortName?: string;
  aliases: string[];
  kind: CraftKind;
  model: ModelId;
  operator: string;
  launchUtc: string;
  launchNote?: string;
  massKg: number;
  massApproximate?: boolean;
  size: string;
  /** Collision and label radius: about half the main structure, m. */
  radiusM: number;
  influenceRadiusM: number;
  orbit?: LeoOrbitRow;
  halo?: HaloRow;
  trajectory?: TrajectoryRow;
  silentSinceUtc?: string;
  facts: FactRow[];
  description: string;
  source: string;
}

export interface CraftFile {
  version: number;
  note: string;
  craft: CraftRow[];
}

/** UTC ISO text → JD TT. Throws on a malformed date (a data error, caught by the unit tests). */
export function jdFromUtc(iso: string): JD {
  const jd = parseInstant(iso);
  if (jd === null) throw new Error(`spacecraft: bad date '${iso}'`);
  return jd;
}

/** Label shown next to the marker and on the card. */
export const displayName = (row: CraftRow): string => row.shortName ?? row.name;
