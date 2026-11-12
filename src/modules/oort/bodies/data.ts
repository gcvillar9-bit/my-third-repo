/**
 * Shapes of the hand-entered tables of the oort bodies part (objects.json, flybys.json, markers.json),
 * bundled with the code (they are small). Three-free.
 */
import type { BodyKind } from '../../../core/contracts';
import type { CometElements } from '../../comets/public';
import flybysJson from './flybys.json';
import markersJson from './markers.json';
import objectsJson from './objects.json';

export type OortGroup = 'sednoid' | 'oort-comet' | 'interstellar';

export interface OortPhysical {
  radiusKm: number;
  /** Geometric albedo. */
  albedo: number;
  /** Linear multiplier on sunlight (reddish surfaces > 1 in red). */
  tint: [number, number, number];
  source: string;
  approximate?: boolean;
}

export interface OortObjectRow {
  id: string;
  name: string;
  /** Label text. */
  short: string;
  designation: string;
  group: OortGroup;
  kind: BodyKind;
  aliases: string[];
  elements: CometElements;
  physical: OortPhysical;
  /** Hyperbolic excess speed, km/s (interstellar visitors). */
  vInfKms?: number;
  discovered: string;
  description: string;
}

export interface OortObjectsFile {
  about: string;
  objects: OortObjectRow[];
}

export interface StarAstrometry {
  raDeg: number;
  decDeg: number;
  parallaxMas: number;
  /** Proper motion in right ascension times cos(dec) (Gaia's pmra), mas/yr. */
  pmRaMasYr: number;
  pmDecMasYr: number;
  rvKms: number;
  /** Epoch of the astrometry, Julian year (TT). */
  epochYear: number;
  source: string;
  approximate?: boolean;
}

export interface PublishedApproach {
  source: string;
  distancePc: number;
  distanceRangePc?: [number, number];
  /** Time of closest approach from now, Myr (negative: in the past). */
  timeMyr: number;
}

export interface FlybyStarRow {
  id: string;
  name: string;
  aliases: string[];
  spectral: string;
  teffK: number;
  absMagV: number;
  massSun: number;
  astrometry: StarAstrometry;
  published: PublishedApproach[];
  description: string;
}

export interface FlybysFile {
  about: string;
  /** Tracks are drawn this far either side of the closest approach, AU. */
  trackHalfLengthAu: number;
  stars: FlybyStarRow[];
}

export interface ShellRow {
  id: string;
  radiusAu: number;
  label: string;
  /** Linear RGB, display-referred. */
  color: [number, number, number];
  source: string;
  approximate?: boolean;
  description: string;
}

export interface VoyagerFacts {
  source: string;
  yearsToInnerEdge: number;
  yearsToExit: number;
  approximate?: boolean;
}

export interface MarkersFile {
  about: string;
  shells: ShellRow[];
  voyager: VoyagerFacts;
}

export const OBJECTS: OortObjectsFile = objectsJson as OortObjectsFile;
export const FLYBYS: FlybysFile = flybysJson as FlybysFile;
export const MARKERS: MarkersFile = markersJson as MarkersFile;

export const GROUP_SUBTITLE: Record<OortGroup, string> = {
  sednoid: 'Sednoid · inner Oort Cloud object',
  'oort-comet': 'Oort Cloud comet',
  interstellar: 'Interstellar visitor',
};

export const GROUP_PLAIN: Record<OortGroup, string> = {
  sednoid: 'Sednoid: a detached object whose orbit never comes near the planets (inner Oort Cloud)',
  'oort-comet': 'Long-period comet falling in from the Oort Cloud',
  interstellar: 'Interstellar object passing through on an unbound (hyperbolic) path',
};

/** Orbit-line colours by group (display-referred linear RGB). */
export const GROUP_COLOR: Record<OortGroup, [number, number, number]> = {
  sednoid: [1.0, 0.4, 0.15],
  'oort-comet': [0.35, 0.85, 0.95],
  interstellar: [0.55, 0.3, 1.0],
};
