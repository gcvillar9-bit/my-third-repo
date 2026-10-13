/**
 * bodies.json row types (docs/modules/data-formats.md) and small unit helpers. Rows are in the
 * file's units (km, km³/s², degrees, days); everything returned by helpers is SI.
 */
import type { BodyKind } from '../../core/contracts';

export const BODIES_PATH = 'data/solar-system/bodies.json';

export type TexturePath = string | { '2k': string; '4k'?: string };

export interface RotationRow {
  ra0?: number;
  raRate?: number;
  dec0?: number;
  decRate?: number;
  w0?: number;
  wdot?: number;
  periodHours?: number;
  synchronous?: boolean;
  chaotic?: boolean;
  approximate?: boolean;
}

export type ElementsFrame = 'ecliptic-j2000' | 'equator-j2000' | 'icrf-axes' | 'parent-equator';

export interface ElementsRow {
  epoch: number;
  frame: ElementsFrame;
  axes?: { x: number[]; y: number[]; z: number[] };
  center: string;
  a: number;
  e: number;
  i: number;
  node: number;
  argPeri: number;
  meanAnomaly: number;
  period: number;
  source: string;
}

export interface BodyRow {
  id: string;
  name: string;
  kind: Extract<BodyKind, 'star' | 'planet' | 'dwarf' | 'moon' | 'minor'>;
  parent: string | null;
  ephemeris: 'astronomy-engine' | 'kepler';
  radius: number;
  radiusEquatorial?: number;
  radiusPolar?: number;
  oblateness?: number;
  gm: number;
  albedoGeometric?: number;
  albedoBond?: number;
  teff?: number;
  absMag?: number;
  approximate?: boolean;
  rotation?: RotationRow;
  elements?: ElementsRow;
  rings?: { inner: number; outer: number; source: string };
  textures?: Partial<
    Record<
      'diffuse' | 'night' | 'brc' | 'normal' | 'specular' | 'surface' | 'ring' | 'ringProfile',
      TexturePath
    >
  >;
  source: string;
}

export interface BodiesFile {
  version: number;
  bodies: BodyRow[];
}

export const KM = 1e3;
/** GM row (km³/s²) → m³/s². */
export const gmSI = (row: BodyRow): number => row.gm * 1e9;
/** Equatorial radius in metres (mean radius when no equatorial value is given). */
export const equatorialRadius = (row: BodyRow): number => (row.radiusEquatorial ?? row.radius) * KM;
/** Flattening f = (a − c) / a (0 when unknown). */
export const flattening = (row: BodyRow): number =>
  row.oblateness ??
  (row.radiusEquatorial && row.radiusPolar ? 1 - row.radiusPolar / row.radiusEquatorial : 0);

/** Picks a texture tier for the quality preset's max texture edge. */
export function texturePath(t: TexturePath | undefined, maxTextureSize: number): string | undefined {
  if (!t) return undefined;
  if (typeof t === 'string') return t;
  return maxTextureSize >= 4096 && t['4k'] ? t['4k'] : t['2k'];
}

/** Bodies with a substantial atmosphere or no solid surface: Lambert shading instead of Lommel-Seeliger. */
export const ATMOSPHERE_BODIES: ReadonlySet<string> = new Set([
  'venus',
  'earth',
  'mars',
  'jupiter',
  'saturn',
  'uranus',
  'neptune',
  'titan',
]);

/** Bodies that get a dedicated bookmark (plus the special views in bookmarks.ts). */
export const BOOKMARKED_BODIES: readonly string[] = [
  'sun',
  'mercury',
  'venus',
  'earth',
  'moon',
  'mars',
  'jupiter',
  'io',
  'europa',
  'ganymede',
  'callisto',
  'saturn',
  'enceladus',
  'titan',
  'uranus',
  'neptune',
  'triton',
  'pluto',
  'charon',
  'ceres',
  'vesta',
];
