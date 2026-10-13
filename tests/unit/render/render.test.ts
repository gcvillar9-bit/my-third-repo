import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { decode } from 'fast-png';
import { describe, expect, it } from 'vitest';
import { CAMERA_FAR, type ScreenPass } from '../../../src/core/contracts';
import { splitDouble } from '../../../src/core/math64';
import {
  circleOverlap,
  DEPTH_GLSL,
  linearFromLogDepth,
  LOG2_FAR_PLUS_1,
  logDepthFromLinear,
  BLACKBODY_GLSL,
  NOISE_GLSL,
  PHASE_GLSL,
  RTE_GLSL,
  SHADOWS_GLSL,
} from '../../../src/render/chunks/index';
import { adaptEv, EV_NIGHT, evFromLuminance, exposureFromEv, targetEv } from '../../../src/render/exposure';
import { sortPasses } from '../../../src/render/screenpass-host';

const ROOT = new URL('../../../', import.meta.url).pathname;
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

describe('conventions', () => {
  const sources = walk(join(ROOT, 'src')).filter((f) => /\.(ts|tsx)$/.test(f));

  it('every ShaderMaterial/RawShaderMaterial includes the depth chunk (or opts out explicitly)', () => {
    const offenders: string[] = [];
    let checked = 0;
    for (const f of sources) {
      const text = readFileSync(f, 'utf8');
      if (!/new\s+(Raw)?ShaderMaterial\s*\(/.test(text)) continue;
      checked++;
      const includes = /DEPTH_GLSL|chunks\/depth\.glsl/.test(text);
      const optOut = /cosmos:no-depth\s*\(\s*\S[^)]*\)/.test(text);
      if (!includes && !optOut) offenders.push(relative(ROOT, f));
    }
    expect(checked).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  it('modules import other modules only through public.ts', () => {
    const offenders: string[] = [];
    for (const f of sources.filter((s) => s.includes('/src/modules/'))) {
      const own = /\/src\/modules\/([^/]+)\//.exec(f)![1];
      for (const m of readFileSync(f, 'utf8').matchAll(/from\s+'([^']+)'/g)) {
        const spec = m[1];
        if (!spec.startsWith('.')) continue;
        const target = join(f, '..', spec);
        const mod = /\/src\/modules\/([^/]+)\/(.*)$/.exec(target);
        if (mod && mod[1] !== own && !/^public(\.ts)?$/.test(mod[2]))
          offenders.push(`${relative(ROOT, f)} -> ${spec}`);
        if (!mod && !/\/src\/(core|render\/chunks)(\/|$)/.test(target))
          offenders.push(`${relative(ROOT, f)} -> ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('bakes log2(far + 1) into depth.glsl and guards every chunk', () => {
    const baked = Number(/COSMOS_LOG2_FAR_PLUS_1 ([\d.]+)/.exec(DEPTH_GLSL)![1]);
    expect(baked).toBeCloseTo(Math.log2(CAMERA_FAR + 1), 10);
    expect(LOG2_FAR_PLUS_1).toBeCloseTo(baked, 10);
    for (const chunk of [DEPTH_GLSL, RTE_GLSL, NOISE_GLSL, BLACKBODY_GLSL, SHADOWS_GLSL, PHASE_GLSL]) {
      expect(chunk).toMatch(/#ifndef COSMOS_\w+_GLSL/);
    }
    expect(DEPTH_GLSL).toContain('LOG_DEPTH_VERTEX');
    expect(DEPTH_GLSL).toContain('linearFromLogDepth');
  });
});

describe('render math', () => {
  it('decodes log depth back to linear distance', () => {
    for (const w of [0.05, 1, 1e4, 1.5e11, 1e22]) {
      expect(linearFromLogDepth(logDepthFromLinear(w)) / w).toBeCloseTo(1, 9);
    }
    expect(logDepthFromLinear(CAMERA_FAR)).toBeCloseTo(1, 12);
  });

  it('splits doubles for relative-to-eye rendering', () => {
    const v = 3.0856775814913673e16 + 0.123;
    const [h, l] = splitDouble(v);
    expect(Math.fround(h)).toBe(h);
    expect(Math.abs(h + l - v)).toBeLessThan(v * 2 ** -45);
  });

  it('computes eclipse overlap for umbra, penumbra and annular cases', () => {
    const sun = 0.00465; // rad
    expect(circleOverlap(sun, 0.0048, 0)).toBeCloseTo(Math.PI * sun * sun, 12); // total
    expect(circleOverlap(sun, 0.0044, 0) / (Math.PI * sun * sun)).toBeCloseTo((0.0044 / sun) ** 2, 9); // annular
    expect(circleOverlap(sun, 0.0048, 0.02)).toBe(0);
    const half = circleOverlap(1, 1, 1) / Math.PI;
    expect(half).toBeGreaterThan(0.38);
    expect(half).toBeLessThan(0.4);
  });

  it('meters exposure and adapts with tau 0.5 s brighter / 2 s darker', () => {
    expect(exposureFromEv(0)).toBeCloseTo(1 / 1.2, 12);
    expect(evFromLuminance(12.5 / 100)).toBeCloseTo(0, 12);
    expect(adaptEv(0, 10, 0.5)).toBeCloseTo(10 * (1 - Math.exp(-1)), 9);
    expect(adaptEv(10, 0, 2)).toBeCloseTo(10 * Math.exp(-1), 9);
    expect(targetEv(Math.log2(1e4), 0)).toBe(EV_NIGHT);
    expect(targetEv(Math.log2(1e4), 0.5)).toBeCloseTo(Math.log2(8e4), 9);
  });

  it('orders screen passes by stage then order', () => {
    const p = (id: string, stage: ScreenPass['stage'], order: number) =>
      ({ id, stage, order, active: () => true, render() {} }) as ScreenPass;
    const ids = sortPasses([
      p('fx', 'effects', 0),
      p('bh2', 'lensing', 5),
      p('sky', 'atmosphere', 9),
      p('bh1', 'lensing', 1),
    ]);
    expect(ids.map((x) => x.id)).toEqual(['sky', 'bh1', 'bh2', 'fx']);
  });

  it('ships a deterministic 64x64 blue-noise mask with a flat histogram', () => {
    const png = decode(readFileSync(join(ROOT, 'public/data/render/bluenoise64.png')));
    expect([png.width, png.height, png.channels]).toEqual([64, 64, 1]);
    const hist = new Array(256).fill(0);
    for (const v of png.data as Uint8Array) hist[v]++;
    expect(hist.every((n) => n === 16)).toBe(true);
  });
});
