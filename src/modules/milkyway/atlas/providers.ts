/** Search entries, info cards and fly-to views for atlas objects. */
import {
  SSB_FRAME,
  type Bookmark,
  type InfoCard,
  type InfoProvider,
  type SearchEntry,
  type SearchProvider,
} from '../../../core/contracts';
import { qlookRotation, quat, vec3 } from '../../../core/math64';
import { PC } from '../../../core/units';
import type { Atlas } from './catalog';
import type { AtlasObject } from './types';

/** Largest number of objects per layer that go into the fuzzy index (the rest answer `query`). */
const INDEXED_MIN_RANK = 2;

const KIND: Record<string, SearchEntry['kind']> = {
  'open-clusters': 'cluster',
  cluster: 'cluster',
  nucleus: 'cluster',
  satellites: 'galaxy',
  satellite: 'galaxy',
  cepheids: 'star',
  pulsars: 'star',
};

/** Distance (pc) from which an object is viewed after a fly-to. */
export function viewDistancePc(o: AtlasObject): number {
  if (o.shape?.kind === 'ellipsoid-pair')
    return 3.5 * (o.shape.offsetPc + Math.max(o.shape.semiAxesPc[0], o.shape.semiAxesPc[2]));
  if (o.shape?.kind === 'polyline') {
    let far = 0;
    for (const p of o.shape.points) far = Math.max(far, Math.hypot(p[0] - o.x, p[1] - o.y, p[2] - o.z));
    return Math.max(2.5 * far, 50);
  }
  if (o.shape?.kind === 'log-spiral') return 30000;
  if (o.r > 0) return Math.max(5 * o.r, 0.02);
  return o.cls === 'pulsars' || o.cls === 'cepheids' ? 0.5 : 30;
}

/**
 * A view of the object from the Sun's side (objects near the Sun: from the side away from the
 * Galactic centre is not needed, the Sun side always works), Galactic north roughly up.
 */
export function objectBookmark(o: AtlasObject): Bookmark {
  const d = Math.hypot(o.x, o.y, o.z);
  const back = viewDistancePc(o);
  // Direction from which we look: from the Sun towards the object; for objects around the Sun
  // itself (the Local Bubble) look from above the Galactic plane instead.
  let dir = d > 1e-6 ? vec3(o.x / d, o.y / d, o.z / d) : vec3(0.4838, -0.747, -0.456);
  if (d < 0.5 * back) dir = vec3(0.4838350155, -0.7469822445, -0.4559837762); // towards the south Galactic pole
  const pos = vec3((o.x - dir.x * back) * PC, (o.y - dir.y * back) * PC, (o.z - dir.z * back) * PC);
  // Up: the north Galactic pole in ICRS axes (falls back inside qlookRotation when parallel).
  const up = vec3(-0.867666149, -0.1980763734, 0.4559837762);
  const parallel = Math.abs(dir.x * up.x + dir.y * up.y + dir.z * up.z) > 0.98;
  return {
    id: o.id,
    title: o.name,
    frame: SSB_FRAME,
    pos,
    quat: qlookRotation(quat(), dir, parallel ? vec3(-0.0548755604, -0.8734370902, -0.4838350155) : up),
    fovY: (40 * Math.PI) / 180,
    lookTarget: `${o.noun}: ${o.name} at the centre of the view.`,
  };
}

const subtitle = (o: AtlasObject): string => o.noun.replace(/\s*\(.*\)$/, '');

function entry(o: AtlasObject): SearchEntry {
  return {
    id: o.id,
    name: o.name,
    aliases: o.aliases.length ? [...o.aliases] : undefined,
    subtitle: subtitle(o),
    kind: KIND[o.cls] ?? 'other',
    target: objectBookmark(o),
    priority: o.rank - 1,
  };
}

const norm = (s: string): string => s.toLowerCase().replace(/[\s_-]+/g, '');

export function createAtlasSearch(atlas: Atlas): SearchProvider {
  // Famous and well-known objects go into the fuzzy index; the thousands of catalogue rows with
  // only a designation (pulsar J-names, Cepheid ids, minor clusters) answer exact-prefix queries.
  const indexed: SearchEntry[] = [];
  const bulk: { key: string; o: AtlasObject }[] = [];
  for (const o of atlas.objects) {
    if (o.rank >= INDEXED_MIN_RANK || o.file.startsWith('features-')) indexed.push(entry(o));
    else {
      bulk.push({ key: norm(o.name), o });
      for (const a of o.aliases) bulk.push({ key: norm(a), o });
    }
  }
  bulk.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return {
    id: 'milkyway.atlas',
    entries: () => indexed,
    query(text, limit) {
      const q = norm(text);
      if (q.length < 3) return [];
      // Binary search for the first key >= q, then take the run of keys that start with q.
      let lo = 0;
      let hi = bulk.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (bulk[mid].key < q) lo = mid + 1;
        else hi = mid;
      }
      const out: SearchEntry[] = [];
      const seen = new Set<string>();
      for (let i = lo; i < bulk.length && out.length < limit && bulk[i].key.startsWith(q); i++) {
        if (seen.has(bulk[i].o.id)) continue;
        seen.add(bulk[i].o.id);
        out.push(entry(bulk[i].o));
      }
      return out;
    },
  };
}

/** How each kind of object is drawn, for the info card's "simulated" note. */
const DRAWN: Record<string, string> = {
  'open-clusters':
    'The brightest member stars are real (Gaia positions and brightness, Hunt & Reffert 2023); their depth inside the cluster is simulated.',
  cepheids:
    'Drawn as a star at its measured position; its brightness comes from the period-luminosity relation.',
  satellites: 'Drawn as a cloud of simulated stars with the measured size, shape and total brightness.',
  nucleus: 'Drawn as a cloud of simulated stars with the measured size and total brightness.',
  cluster: 'Drawn as a cloud of simulated stars with the measured size.',
  stream: 'The line follows the measured track of the stream. The stream itself is too faint to see by eye.',
  bubble:
    'Seen only in gamma rays or X-rays. The outline is a guide with the measured size; its exact shape is simulated.',
  shell: 'Not visible to the eye. The surface is a guide drawn from the measured shape.',
  'gas-stream': 'Neutral hydrogen gas seen with radio telescopes. The line is a guide.',
  arm: 'The line follows the measured arm (solid) and its extrapolation (dashed).',
};

export function createAtlasInfo(atlas: Atlas): InfoProvider {
  return {
    id: 'milkyway.atlas',
    info(id): InfoCard | null {
      const o = atlas.get(id);
      if (!o) return null;
      const d = atlas.details(o);
      const drawn = DRAWN[o.cls] ?? 'Shown as a guide marker at its measured position.';
      return {
        title: o.name,
        subtitle: d.noun,
        facts: d.facts,
        description: d.description,
        simulated: true,
        credit: `${drawn} ${d.credit}`.trim(),
      };
    },
  };
}
