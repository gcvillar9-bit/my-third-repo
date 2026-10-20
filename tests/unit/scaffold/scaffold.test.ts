import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CAMERA_FAR,
  CAMERA_NEAR,
  QUALITY_PRESETS,
  SURFACE_DETAIL_BANDS,
  SURFACE_INPUT_GLSL,
  WARP_LADDER,
} from '../../../src/core/contracts';
import viteConfig from '../../../vite.config';

describe('scaffold', () => {
  it('pins every dependency to an exact version', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
    const all: Record<string, string> = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const [name, version] of Object.entries(all)) {
      expect(version, name).toMatch(/^\d+\.\d+\.\d+$/);
    }
    expect(all['@playwright/test']).toBe('1.56.1');
    expect(all.three).toBe('0.186.1');
  });

  it('serves under the GitHub Pages subpath by default', () => {
    const base = (viteConfig as { base?: string }).base;
    expect(base).toMatch(/^\/.+\/$/);
    if (!process.env.BASE) expect(base).toBe('/my-third-repo/');
  });

  it('exposes the settled contract constants', () => {
    expect(CAMERA_NEAR).toBe(0.05);
    expect(CAMERA_FAR).toBe(1e27);
    expect(QUALITY_PRESETS).toEqual(['potato', 'low', 'medium', 'high', 'ultra']);
    expect(WARP_LADDER[0]).toBe(0);
    expect(WARP_LADDER.at(-1)).toBe(3.15576e14);
    for (let i = 1; i < WARP_LADDER.length; i++) expect(WARP_LADDER[i]).toBeGreaterThan(WARP_LADDER[i - 1]);
    expect(SURFACE_INPUT_GLSL).toContain('struct SurfaceInput');
    expect(SURFACE_INPUT_GLSL).toContain(`#define SURFACE_DETAIL_BANDS ${SURFACE_DETAIL_BANDS}`);
  });
});
