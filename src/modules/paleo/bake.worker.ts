/**
 * Paleo bake worker (comlink): fetches and decodes PaleoDEM maps, derives their fields (cached, a few
 * maps), fits the moisture model to today's Earth once, and bakes the synthetic surface for a pair
 * of maps and a blend weight. Returns RGBA8 rows from the south (transferred).
 */
import { expose, transfer } from 'comlink';
import { decode } from 'fast-png';
import { bakeSurface, fitMoisture, paletteFrom, type Palette } from './biome';
import type { BiomeRow, Vegetation } from './climate';
import { sliceFields, type SliceFields } from './fields';

export interface PaleoBakeConfig {
  /** URL of a map with '{age}' for the zero-padded age, e.g. '/my-third-repo/data/paleo/dem/{age}.png'. */
  demUrl: string;
  moistureUrl: string;
  elevationScaleM: number;
  biomes: BiomeRow[];
  /** Today's global mean temperature (the moisture fit's climate). */
  todayGmstC: number;
  width: number;
  height: number;
}

export interface PaleoBakeRequest {
  a: number;
  b: number;
  w: number;
  gmstC: number;
  veg: Vegetation;
}

export interface PaleoBakeApi {
  init(cfg: PaleoBakeConfig): Promise<void>;
  bake(req: PaleoBakeRequest): Promise<Uint8Array>;
}

const CACHE = 6;
let cfg: PaleoBakeConfig | null = null;
let palette: Palette | null = null;
let weights: number[] | null = null;
const cache = new Map<number, Promise<SliceFields>>();

async function fetchGrey(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`paleo: ${res.status} for ${url}`);
  return decode(new Uint8Array(await res.arrayBuffer())).data as Uint8Array;
}

function fields(age: number): Promise<SliceFields> {
  let f = cache.get(age);
  if (f) {
    cache.delete(age);
    cache.set(age, f); // most recently used last
    return f;
  }
  const c = cfg!;
  f = fetchGrey(c.demUrl.replace('{age}', String(age).padStart(3, '0'))).then((g) =>
    sliceFields(g, c.elevationScaleM),
  );
  cache.set(age, f);
  f.catch(() => cache.delete(age));
  while (cache.size > CACHE) cache.delete(cache.keys().next().value!);
  return f;
}

const api: PaleoBakeApi = {
  async init(c) {
    cfg = c;
    palette = paletteFrom(c.biomes);
    const [today, target] = await Promise.all([fields(0), fetchGrey(c.moistureUrl)]);
    weights = fitMoisture(today, target, c.todayGmstC);
  },
  async bake(req) {
    if (!cfg || !palette || !weights) throw new Error('paleo: bake before init');
    const [a, b] = await Promise.all([fields(req.a), fields(req.b)]);
    const out = bakeSurface({
      a,
      b,
      w: req.w,
      gmstC: req.gmstC,
      veg: req.veg,
      palette,
      moistureWeights: weights,
      width: cfg.width,
      height: cfg.height,
    });
    return transfer(out, [out.buffer]);
  },
};

expose(api);
