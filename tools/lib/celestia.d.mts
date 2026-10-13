export declare const AU_KM: number;
export declare const G_KM: number;
export declare const EARTH_MASS_KG: number;

export interface SscObject {
  keyword: string;
  name: string;
  names: string[];
  parent: string;
  path: string;
  raw: string;
  active: string;
  commented: string;
}

export interface SscOrbit {
  epoch: number;
  a: number;
  e: number;
  i: number;
  node: number;
  argPeri: number;
  meanAnomaly: number;
  period: number | null;
  frame: string;
  axes?: { x: number[]; y: number[]; z: number[] };
  center: string;
  fromComment: boolean;
}

export declare function stripComments(text: string): string;
export declare function commentedText(text: string): string;
export declare function parseSsc(text: string): SscObject[];
export declare function getBlock(text: string, key: string): string | null;
export declare function topLevel(text: string): string;
export declare function getNumber(text: string, key: string): { value: number; unit: string | null } | null;
export declare function getArray(text: string, key: string): number[] | null;
export declare function getString(text: string, key: string): string | null;
export declare function eclipticToEquatorial(v: number[]): number[];
export declare function extractOrbit(obj: SscObject): SscOrbit | null;
export declare function extractPhysical(obj: SscObject): {
  cls: string | null;
  radius: number | null;
  radiusIsMax: boolean;
  semiAxes: number[] | null;
  massKg: number | null;
  geomAlbedo: number | null;
  bondAlbedo: number | null;
  rotationPeriodHours: number | null;
  texture: string | null;
  rings: { inner?: number; outer?: number } | null;
};
