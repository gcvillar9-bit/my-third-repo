/**
 * Loads the atlas files and turns them into one list of AtlasObjects plus fact access for the
 * info cards. Pure data: no three.js, so the unit tests read the shipped files through it.
 */
import type { AtlasObject, AtlasSource, Cell, Feature, FeatureFile, LayerColumn, LayerFile } from './types';

/** Files under public/data/milkyway/atlas/. A missing file is skipped with a console warning. */
export const LAYER_FILES = [
  'open-clusters',
  'cepheids',
  'masers',
  'hii-regions',
  'clouds',
  'remnants',
  'pulsars',
  'satellites',
  'associations',
] as const;
export const FEATURE_FILES = ['structure', 'centre', 'bubbles', 'streams', 'magellanic', 'local'] as const;

const RESERVED = new Set(['id', 'name', 'aliases', 'x', 'y', 'z', 'r', 'rank', 'note', 'rowSource']);

export interface Fact {
  label: string;
  value: string | number;
  unit?: string;
  source: string;
  approximate?: boolean;
}

export interface ObjectDetails {
  noun: string;
  facts: Fact[];
  description?: string;
  /** Licence texts of the sources used, for the credit line. */
  credit: string;
}

export interface Layer {
  file: LayerFile;
  col: Record<string, number>;
  /** Index of the first object of this layer in `Atlas.objects`. */
  first: number;
}

export class Atlas {
  readonly objects: AtlasObject[] = [];
  readonly layers = new Map<string, Layer>();
  readonly features = new Map<string, FeatureFile>();
  private readonly byId = new Map<string, AtlasObject>();

  addLayer(file: LayerFile): void {
    const col: Record<string, number> = {};
    file.columns.forEach((c, i) => (col[c.key] = i));
    const first = this.objects.length;
    this.layers.set(file.layer, { file, col, first });
    const num = (row: Cell[], key: string): number => {
      const v = col[key] === undefined ? null : row[col[key]];
      return typeof v === 'number' ? v : 0;
    };
    file.rows.forEach((row, index) => {
      const aliases = col.aliases === undefined ? null : row[col.aliases];
      this.push({
        id: `mw:${file.layer}:${String(row[col.id])}`,
        cls: file.layer,
        file: file.layer,
        name: String(row[col.name]),
        aliases: Array.isArray(aliases) ? aliases : [],
        noun: file.noun,
        x: num(row, 'x'),
        y: num(row, 'y'),
        z: num(row, 'z'),
        r: num(row, 'r'),
        rank: col.rank === undefined ? 1 : num(row, 'rank'),
        index,
      });
    });
  }

  addFeatures(file: FeatureFile): void {
    this.features.set(file.group, file);
    file.features.forEach((f, index) => {
      this.push({
        id: `mw:${file.group}:${f.id}`,
        cls: f.type,
        file: `features-${file.group}`,
        name: f.name,
        aliases: f.aliases ?? [],
        noun: f.noun,
        x: f.x,
        y: f.y,
        z: f.z,
        r: f.r ?? 0,
        rank: f.rank ?? 2,
        index,
        shape: f.shape,
      });
    });
  }

  private push(o: AtlasObject): void {
    if (this.byId.has(o.id)) return;
    this.byId.set(o.id, o);
    this.objects.push(o);
  }

  get(id: string): AtlasObject | undefined {
    return this.byId.get(id);
  }

  /** Objects of one style class (layer id or feature type). */
  ofClass(cls: string): AtlasObject[] {
    return this.objects.filter((o) => o.cls === cls);
  }

  /** The catalogue row of an object (undefined for features). */
  row(o: AtlasObject): Cell[] | undefined {
    return this.layers.get(o.file)?.file.rows[o.index];
  }

  /** A numeric catalogue cell, or null. */
  value(o: AtlasObject, key: string): number | null {
    const layer = this.layers.get(o.file);
    const c = layer?.col[key];
    if (!layer || c === undefined) return null;
    const v = layer.file.rows[o.index][c];
    return typeof v === 'number' ? v : null;
  }

  feature(o: AtlasObject): Feature | undefined {
    return o.file.startsWith('features-') ? this.features.get(o.file.slice(9))?.features[o.index] : undefined;
  }

  /** Facts with their sources for the info card. */
  details(o: AtlasObject): ObjectDetails {
    const facts: Fact[] = [];
    const used = new Set<AtlasSource>();
    const cite = (sources: Record<string, AtlasSource>, key: string | undefined): string => {
      const s = key ? sources[key] : undefined;
      if (s) used.add(s);
      return s?.cite ?? 'unknown';
    };
    const dist = Math.hypot(o.x, o.y, o.z);
    const layer = this.layers.get(o.file);
    let description: string | undefined;
    if (layer) {
      const { file, col } = layer;
      const row = file.rows[o.index];
      const rowSource = col.rowSource === undefined ? null : row[col.rowSource];
      const extra = typeof rowSource === 'string' && rowSource ? `; ${rowSource}` : '';
      const posSource = cite(file.sources, file.columns[col.x].source) + extra;
      facts.push(distanceFact(dist, posSource));
      file.columns.forEach((c: LayerColumn, i) => {
        if (RESERVED.has(c.key) || !c.label) return;
        const v = row[i];
        if (v === null || v === undefined || Array.isArray(v) || v === '') return;
        facts.push({
          label: c.label,
          value: typeof v === 'number' && c.digits !== undefined ? Number(v.toFixed(c.digits)) : v,
          unit: c.unit,
          source: cite(file.sources, c.source) + extra,
          approximate: c.approximate,
        });
      });
      const note = col.note === undefined ? null : row[col.note];
      if (typeof note === 'string' && note) description = note;
    } else {
      const group = this.features.get(o.file.slice(9));
      const f = group?.features[o.index];
      if (group && f) {
        if (dist > 0.5) facts.push(distanceFact(dist, cite(group.sources, f.positionSource), true));
        for (const fact of f.facts ?? []) facts.push({ ...fact, source: cite(group.sources, fact.source) });
        if (f.shape) cite(group.sources, f.shape.source);
        description = f.description;
      }
    }
    if (o.aliases.length)
      description = `${description ? `${description} ` : ''}Also known as ${o.aliases.join(', ')}.`;
    const licences = [...new Set([...used].map((s) => s.license))].join('; ');
    return { noun: o.noun, facts, description, credit: licences ? `Data licence: ${licences}.` : '' };
  }
}

function distanceFact(distPc: number, source: string, approximate?: boolean): Fact {
  return distPc >= 1000
    ? {
        label: 'Distance from the Sun',
        value: Number((distPc / 1000).toPrecision(4)),
        unit: 'kpc',
        source,
        approximate,
      }
    : {
        label: 'Distance from the Sun',
        value: Number(distPc.toPrecision(4)),
        unit: 'pc',
        source,
        approximate,
      };
}

/** Fetches every atlas file with `load` (a JSON loader) and builds the Atlas. */
export async function loadAtlas(load: <T>(path: string) => Promise<T>): Promise<Atlas> {
  const base = 'data/milkyway/atlas/';
  const atlas = new Atlas();
  const layers = await Promise.all(
    LAYER_FILES.map((n) => load<LayerFile>(`${base}${n}.json`).catch(() => null)),
  );
  const features = await Promise.all(
    FEATURE_FILES.map((n) => load<FeatureFile>(`${base}features-${n}.json`).catch(() => null)),
  );
  layers.forEach((f, i) => {
    if (f) atlas.addLayer(f);
    else console.warn(`[milkyway] atlas layer ${LAYER_FILES[i]} is missing`);
  });
  features.forEach((f, i) => {
    if (f) atlas.addFeatures(f);
    else console.warn(`[milkyway] atlas features ${FEATURE_FILES[i]} are missing`);
  });
  return atlas;
}
