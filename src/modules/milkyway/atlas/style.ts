/** Style lookup for atlas classes (simulated styling, looks.json) and the shared guide switches. */
import raw from './looks.json';

export type MarkerShape = 'none' | 'dot' | 'ring' | 'cross' | 'diamond' | 'square';
export const MARKER_CODES: Record<MarkerShape, number> = {
  none: 0,
  dot: 1,
  ring: 2,
  cross: 3,
  diamond: 4,
  square: 5,
};

export interface ClassStyle {
  group: string;
  color: [number, number, number];
  marker: MarkerShape;
  markerPx: number;
  markerFar: number;
  labelFar: [number, number, number, number];
  labelNear: number;
  lineGain: number;
}

const DEFAULT = raw.default as ClassStyle;
const CLASSES = raw.classes as unknown as Record<string, Partial<ClassStyle>>;
const cache = new Map<string, ClassStyle>();

/** Style of a class; a `<file>/<cls>` entry of looks.json overrides the class for that file. */
export function styleOf(cls: string, file = ''): ClassStyle {
  const key = `${file}/${cls}`;
  let s = cache.get(key);
  if (!s) {
    s = { ...DEFAULT, ...(CLASSES[cls] ?? {}), ...(CLASSES[key] ?? {}) };
    cache.set(key, s);
  }
  return s;
}

/** Label anchors of large structures, model kpc (simulated placement). */
export const LABEL_ANCHORS = (raw as unknown as { labelAnchors: Record<string, [number, number, number]> })
  .labelAnchors;
/** Azimuth (degrees) at which each spiral arm is labelled. */
export const ARM_LABEL_BETA = (raw as unknown as { armLabelBeta: Record<string, number> }).armLabelBeta;

/** Settings groups: id and label. */
export const GROUPS: readonly { id: string; label: string }[] = Object.entries(raw.groups).map(
  ([id, label]) => ({
    id,
    label,
  }),
);

export const cssColor = (c: readonly number[]): string =>
  `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`;
