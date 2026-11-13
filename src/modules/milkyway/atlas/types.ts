/**
 * Milky Way atlas data (public/data/milkyway/atlas/). Two file kinds, both written and validated
 * by tools/milkyway/lib.mjs: catalogue layers (many rows, one source per column) and features
 * (few hand-entered objects, a source on every fact). Positions are parsecs from the Sun in ICRS
 * axes. Nothing here is simulated: styling lives in looks.json.
 */
export interface AtlasSource {
  cite: string;
  url: string;
  license: string;
}

export interface LayerColumn {
  key: string;
  label?: string;
  unit?: string;
  source?: string;
  approximate?: boolean;
  digits?: number;
}

export type Cell = string | number | null | string[];

export interface LayerFile {
  layer: string;
  title: string;
  noun: string;
  sources: Record<string, AtlasSource>;
  columns: LayerColumn[];
  rows: Cell[][];
}

export interface FeatureFact {
  label: string;
  value: string | number;
  unit?: string;
  source: string;
  approximate?: boolean;
}

export type FeatureShape =
  | { kind: 'polyline'; points: [number, number, number][]; closed?: boolean; source: string }
  | { kind: 'sphere'; source: string }
  | { kind: 'ellipsoid-pair'; offsetPc: number; semiAxesPc: [number, number, number]; source: string }
  | { kind: 'radial-map'; nLon: number; nLat: number; radiiPc: number[]; source: string }
  | {
      kind: 'log-spiral';
      betaKinkDeg: number;
      rKinkKpc: number;
      psiLtDeg: number;
      psiGtDeg: number;
      widthKpc: number;
      betaMeasuredDeg: [number, number];
      source: string;
    };

export interface Feature {
  id: string;
  name: string;
  aliases?: string[];
  type: string;
  noun: string;
  rank?: number;
  x: number;
  y: number;
  z: number;
  r?: number;
  positionSource: string;
  facts?: FeatureFact[];
  description?: string;
  shape?: FeatureShape;
}

export interface FeatureFile {
  group: string;
  sources: Record<string, AtlasSource>;
  features: Feature[];
}

/** One atlas object, whichever file it came from. */
export interface AtlasObject {
  /** Global id: `mw:<layer or group>:<id>`. Search, info cards and labels use it. */
  id: string;
  /** Style class: the layer id for catalogue rows, the feature `type` for features. */
  cls: string;
  /** Layer id or `features-<group>`. */
  file: string;
  name: string;
  aliases: readonly string[];
  noun: string;
  /** Parsecs from the Sun, ICRS axes. */
  x: number;
  y: number;
  z: number;
  /** Characteristic radius, pc (0 when unknown). */
  r: number;
  /** 0..3, how widely the object is labelled. */
  rank: number;
  /** Row index in its layer (catalogue rows) or feature index. */
  index: number;
  shape?: FeatureShape;
}
