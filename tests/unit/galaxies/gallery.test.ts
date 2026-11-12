import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { LabelItem, Vec3d, ViewState } from '../../../src/core/contracts';
import { GALACTIC_TO_SUPERGALACTIC, SSB_IN_MW } from '../../../src/core/frames';
import { MPC } from '../../../src/core/units';
import { decodeGalaxies } from '../../../src/modules/galaxies/format';
import factsJson from '../../../src/modules/galaxies/gallery-facts.json';
import {
  createNamedInfo,
  createNamedLabels,
  createNamedSearch,
  GALLERY,
  gallery,
  NAMED,
} from '../../../src/modules/galaxies/named';
import { GALLERY_GALAXIES, gallery as publicGallery } from '../../../src/modules/galaxies/public';

const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const file = readFileSync(root('public/data/galaxies/galaxies.bin'));
const data = decodeGalaxies(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
const names = (
  JSON.parse(readFileSync(root('public/data/galaxies/names.json'), 'utf8')) as { names: string[] }
).names;

const m = GALACTIC_TO_SUPERGALACTIC;
const s = [SSB_IN_MW.x / MPC, SSB_IN_MW.y / MPC, SSB_IN_MW.z / MPC];
/** Sun position in the universe frame, Mpc. */
const SUN = [0, 3, 6].map((i) => m[i] * s[0] + m[i + 1] * s[1] + m[i + 2] * s[2]);

describe('galaxy gallery', () => {
  it('has 54 unique rows, the first ten equal to NAMED', () => {
    expect(GALLERY).toHaveLength(54);
    expect(new Set(GALLERY.map((g) => g.id)).size).toBe(54);
    expect(GALLERY_GALAXIES).toBe(GALLERY);
    expect(publicGallery('m101').id).toBe('m101');
    // gallery rows additionally carry the catalogue key
    GALLERY.slice(0, 10).forEach((g, i) => {
      const { key, ...rest } = g;
      expect(key).toBeTruthy();
      expect(rest).toEqual(NAMED[i]);
    });
  });

  it('resolves every row in the shipped catalogue with a matching distance', () => {
    for (const g of GALLERY) {
      expect(names[g.index].split(':'), g.id).toContain(g.key);
      const p = [data.pos[3 * g.index], data.pos[3 * g.index + 1], data.pos[3 * g.index + 2]];
      const d = Math.hypot(p[0] - SUN[0], p[1] - SUN[1], p[2] - SUN[2]);
      expect(Math.abs(d - g.distSunMpc), g.id).toBeLessThan(1e-3);
      expect(Math.hypot(p[0] - g.pos[0], p[1] - g.pos[1], p[2] - g.pos[2]), g.id).toBeLessThan(1e-3);
    }
  });

  it('has one search entry per row', () => {
    const entries = createNamedSearch().entries();
    expect(entries).toHaveLength(54);
    expect(new Set(entries.map((e) => e.id)).size).toBe(54);
  });

  it('has an info card for a new galaxy', async () => {
    const card = await createNamedInfo().info('gal:m101');
    expect(card?.title).toBe(gallery('m101').title);
    expect(card?.simulated).toBe(true);
    expect(card?.facts.length).toBeGreaterThanOrEqual(6);
  });

  it('references only existing sources in gallery-facts.json', () => {
    const f = factsJson as unknown as {
      sources: Record<string, unknown>;
      galaxies: Record<string, { source: string }[]>;
    };
    for (const [id, rows] of Object.entries(f.galaxies)) {
      expect(
        GALLERY.some((g) => g.id === id),
        id,
      ).toBe(true);
      for (const r of rows) expect(f.sources[r.source], `${id}/${r.source}`).toBeDefined();
    }
  });

  it('emits new labels only within 6 Mpc of the galaxy', () => {
    const src = createNamedLabels(() => true);
    const run = (cam: Vec3d): string[] => {
      const view = {
        toCamera: (_f: string, l: Vec3d, out: Vec3d) => {
          out.x = l.x - cam.x;
          out.y = l.y - cam.y;
          out.z = l.z - cam.z;
          return out;
        },
      } as unknown as ViewState;
      const out: LabelItem[] = [];
      src.labels(view, out);
      return out.map((l) => l.id);
    };
    const far = run({ x: 1e4 * MPC, y: 0, z: 0 });
    expect(far).toEqual(NAMED.map((g) => `gal:${g.id}`));
    const m101 = gallery('m101');
    const near = run({ x: (m101.pos[0] + 1) * MPC, y: m101.pos[1] * MPC, z: m101.pos[2] * MPC });
    expect(near).toContain('gal:m101');
    expect(near.length).toBeGreaterThan(10);
    expect(near.length).toBeLessThan(54);
  });
});
