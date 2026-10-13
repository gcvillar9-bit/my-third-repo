/**
 * Palette search: fuse.js over every SearchProvider plus built-in entries for registered bodies
 * and bookmarks. Ranking = fuse score − exact/prefix bonuses − 0.01 · priority (lower first).
 */
import Fuse from 'fuse.js';
import type { Body, BodyKind, Bookmark, SearchEntry, SearchProvider } from '../core/contracts';

export interface SearchResult {
  entry: SearchEntry;
  score: number;
}

const KIND_PRIORITY: Partial<Record<BodyKind, number>> = {
  star: 6,
  planet: 6,
  dwarf: 4,
  moon: 3,
  blackhole: 4,
  galaxy: 4,
  cluster: 3,
  spacecraft: 2,
  comet: 2,
  minor: 1,
};

const KIND_LABEL: Partial<Record<BodyKind, string>> = {
  star: 'Star',
  planet: 'Planet',
  dwarf: 'Dwarf planet',
  moon: 'Moon',
  minor: 'Minor body',
  comet: 'Comet',
  blackhole: 'Black hole',
  spacecraft: 'Spacecraft',
  galaxy: 'Galaxy',
  cluster: 'Cluster',
};

/** Built-in entry for a registered body (providers may override it by id). */
export function bodyEntry(b: Body, parentName?: string): SearchEntry {
  const kind = KIND_LABEL[b.kind] ?? b.kind;
  return {
    id: b.id,
    name: b.name,
    subtitle: parentName && b.kind === 'moon' ? `Moon of ${parentName}` : kind,
    kind: b.kind,
    target: b.id,
    priority: KIND_PRIORITY[b.kind] ?? 0,
  };
}

/** Built-in entry for a bookmark. */
export function bookmarkEntry(bm: Bookmark): SearchEntry {
  return {
    id: `bookmark:${bm.id}`,
    name: bm.title,
    aliases: [bm.id],
    subtitle: 'Bookmark',
    kind: 'bookmark',
    target: bm,
    priority: -5,
  };
}

const norm = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

function bonus(e: SearchEntry, q: string): number {
  const names = [e.name, ...(e.aliases ?? [])].map(norm);
  if (names.includes(q)) return 1;
  if (names.some((n) => n.startsWith(q))) return 0.5;
  if (names.some((n) => n.split(/[\s\-()]+/).some((w) => w.startsWith(q)))) return 0.25;
  return 0;
}

export class SearchIndex {
  private fuse: Fuse<SearchEntry> | null = null;
  private entries: SearchEntry[] = [];
  private byIdMap = new Map<string, SearchEntry>();

  constructor(
    private readonly providers: () => readonly SearchProvider[],
    private readonly builtins: () => readonly SearchEntry[] = () => [],
  ) {}

  /** Drops the index; it is rebuilt on the next search. */
  invalidate(): void {
    this.fuse = null;
  }

  private build(): Fuse<SearchEntry> {
    const seen = new Map<string, SearchEntry>();
    for (const p of this.providers()) {
      for (const e of p.entries()) if (!seen.has(e.id)) seen.set(e.id, e);
    }
    for (const e of this.builtins()) if (!seen.has(e.id)) seen.set(e.id, e);
    this.entries = [...seen.values()];
    this.byIdMap = seen;
    this.fuse = new Fuse(this.entries, {
      keys: [
        { name: 'name', weight: 2 },
        { name: 'aliases', weight: 1 },
      ],
      includeScore: true,
      ignoreLocation: true,
      ignoreDiacritics: true,
      threshold: 0.34,
    });
    return this.fuse;
  }

  byId(id: string): SearchEntry | undefined {
    if (!this.fuse) this.build();
    return this.byIdMap.get(id);
  }

  search(text: string, limit = 12): SearchResult[] {
    const fuse = this.fuse ?? this.build();
    const q = norm(text);
    if (!q) {
      return [...this.entries]
        .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
        .slice(0, limit)
        .map((entry) => ({ entry, score: 0 }));
    }
    const out = new Map<string, SearchResult>();
    for (const r of fuse.search(q, { limit: Math.max(limit * 4, 40) })) {
      const e = r.item;
      out.set(e.id, { entry: e, score: (r.score ?? 1) - bonus(e, q) - 0.01 * (e.priority ?? 0) });
    }
    for (const p of this.providers()) {
      for (const e of p.query?.(text, limit) ?? []) {
        const score = 0.1 - bonus(e, q) - 0.01 * (e.priority ?? 0);
        const prev = out.get(e.id);
        if (!prev || prev.score > score) out.set(e.id, { entry: e, score });
      }
    }
    return [...out.values()].sort((a, b) => a.score - b.score).slice(0, limit);
  }
}
