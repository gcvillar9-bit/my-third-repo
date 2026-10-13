import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));

interface Asset {
  id: string;
  url?: string;
  sha256?: string;
  bytes?: number;
  license: string;
  attribution: string;
  flags?: string[];
  licenseSidecar?: { url: string; sha256?: string; text?: string };
  outputs: string[];
}
const manifests = readdirSync(root('assets/manifest'))
  .filter((f) => f.endsWith('.json'))
  .map(
    (f) =>
      JSON.parse(readFileSync(root(`assets/manifest/${f}`), 'utf8')) as { module: string; assets: Asset[] },
  );
const assets = manifests.flatMap((m) => m.assets.map((a) => ({ ...a, module: m.module })));

describe('asset manifests', () => {
  it('cover the P1-B modules with recorded sha256, licence and attribution', () => {
    expect(manifests.map((m) => m.module)).toEqual(expect.arrayContaining(['solar-system', 'stars']));
    for (const a of assets) {
      expect(a.license, a.id).toBeTruthy();
      expect(a.attribution, a.id).toBeTruthy();
      if (!a.url) continue; // reference entry
      expect(a.url, a.id).toMatch(/^https:\/\/(raw|media)\.githubusercontent\.com\//);
      expect(a.sha256, a.id).toMatch(/^[0-9a-f]{64}$/);
      expect(a.bytes, a.id).toBeGreaterThan(0);
      if (a.licenseSidecar) {
        expect(a.licenseSidecar.sha256, a.id).toMatch(/^[0-9a-f]{64}$/);
        expect(a.licenseSidecar.text, a.id).toMatch(/SPDX-License-Identifier/);
      }
    }
    expect(new Set(assets.map((a) => a.id)).size).toBe(assets.length);
  });

  it('never fetches LFS files through raw.githubusercontent.com', () => {
    for (const a of assets.filter((x) => /\/8k_/.test(x.url ?? '')))
      expect(a.url).toMatch(/^https:\/\/media\./);
  });

  it('lists outputs that exist under public/', () => {
    for (const a of assets)
      for (const o of a.outputs) expect(existsSync(root(`public/${o}`)), `${a.id} -> ${o}`).toBe(true);
  });

  it('flags the non-commercial Pluto texture in the manifest and credits', () => {
    const pluto = assets.find((a) => a.id === 'celestia_pluto')!;
    expect(pluto.license).toBe('CC-BY-NC-SA-3.0');
    expect(pluto.flags).toContain('non-commercial');
    const credits = JSON.parse(readFileSync(root('public/credits.json'), 'utf8')) as {
      entries: { id: string; flags: string[]; license: string }[];
    };
    expect(credits.entries.map((e) => e.id).sort()).toEqual(assets.map((a) => a.id).sort());
    expect(credits.entries.find((e) => e.id === 'celestia_pluto')!.flags).toContain('non-commercial');
    expect(readFileSync(root('CREDITS.md'), 'utf8')).toMatch(/CC-BY-NC-SA-3\.0.*non-commercial/);
  });
});
