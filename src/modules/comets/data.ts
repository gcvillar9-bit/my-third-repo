/** Shapes of public/data/comets/comets.json (tools/build-comets.mjs). Three-free. */

export const COMETS_PATH = 'data/comets/comets.json';
export const COMETS_MODULE_ID = 'comets';

/** Perihelion-based osculating elements, ecliptic J2000. */
export interface CometElements {
  /** Orbit centre: the Sun, or the Solar System barycentre for inbound long-period solutions. */
  center: 'sun' | 'ssb';
  /** Perihelion distance, AU. */
  q: number;
  e: number;
  /** Inclination, longitude of the ascending node, argument of perihelion: degrees. */
  i: number;
  node: number;
  argPeri: number;
  /** Perihelion passage nearest the epoch, JD TT. */
  tp: number;
  /** Epoch of osculation, JD TT. */
  epoch: number;
  /** Orbital period in days (null when unbound). */
  periodDays: number | null;
  source: string;
  approximate?: boolean;
}

export interface CometPhysical {
  /** Largest semi-axis of the nucleus, km (the registry Body radius). */
  radiusKm: number;
  /** Geometric albedo. */
  albedo: number;
  rotationHours?: number;
  massKg?: number;
  source: string;
  approximate?: boolean;
}

/** Total visual magnitude m = H + 5 log10(delta) + K log10(r) (delta, r in AU). */
export interface CometPhotometry {
  H: number;
  K: number;
  source: string;
  approximate: true;
}

/** Appearance weights of the procedural model (not measurements). */
export interface CometLook {
  /** Dust-tail surface brightness relative to the coma (0 = no dust tail). */
  dust: number;
  /** Ion-tail surface brightness relative to the coma. */
  ion: number;
  /** Gas fraction of the coma light, 0..1 (tints the coma green-blue). */
  gas: number;
  /** Ion-tail length multiplier (default 1). */
  ionLength?: number;
  source: string;
  approximate: true;
}

export interface CometLobe {
  /** Semi-axes relative to the largest extent of the nucleus. */
  axes: [number, number, number];
  offset: [number, number, number];
}

export interface CometShape {
  lobes: CometLobe[];
  source: string;
  approximate: true;
}

export interface CometRow {
  id: string;
  name: string;
  /** Label text. */
  short: string;
  designation: string;
  class: 'periodic' | 'long-period' | 'non-periodic';
  apparition: string;
  aliases: string[];
  elements: CometElements;
  physical: CometPhysical;
  photometry: CometPhotometry;
  look: CometLook;
  shape: CometShape;
}

export interface CometDisplay {
  source: string;
  approximate: true;
  /** Activity fades linearly-smooth from 1 to 0 between these heliocentric distances, AU. */
  activityFadeAU: [number, number];
  /** Visual coma radius of an H = 5 comet at 1 AU, km. */
  comaRadiusKm: number;
  /** Surface-brightness gain of both tails relative to the coma's mean surface brightness. */
  tailGain: number;
  /** Tail surface brightness falls as (1 + s / comaRadius)^-tailFalloff along its length. */
  tailFalloff: number;
}

export interface CometsFile {
  about: string;
  display: CometDisplay;
  comets: CometRow[];
}
