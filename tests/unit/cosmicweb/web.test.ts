import { describe, expect, it } from 'vitest';
import {
  generateWeb,
  mulberry32,
  pairExcess,
  tracerAbsMag,
  WEB_COUNT,
} from '../../../src/modules/cosmicweb/generate';
import { cosmicWebBookmark } from '../../../src/modules/cosmicweb/index';
import { MPC } from '../../../src/core/units';

describe('cosmic web', () => {
  const a = generateWeb(20_000, 1, 800, 600);

  it('is deterministic for a seed and changes with it', () => {
    const b = generateWeb(20_000, 1, 800, 600);
    expect(Buffer.from(a.pos.buffer).equals(Buffer.from(b.pos.buffer))).toBe(true);
    const c = generateWeb(20_000, 2, 800, 600);
    expect(Buffer.from(a.pos.buffer).equals(Buffer.from(c.pos.buffer))).toBe(false);
    expect(a.filaments).toBeGreaterThan(600);
  });

  it('stays inside the region and is clustered far above a uniform field', () => {
    let maxR = 0;
    for (let i = 0; i < a.count; i++)
      maxR = Math.max(maxR, Math.hypot(a.pos[3 * i], a.pos[3 * i + 1], a.pos[3 * i + 2]));
    expect(maxR).toBeLessThan(830);
    const uniform = new Float32Array(3 * 20_000);
    const rand = mulberry32(5);
    for (let i = 0; i < 20_000;) {
      const x = 2 * rand() - 1;
      const y = 2 * rand() - 1;
      const z = 2 * rand() - 1;
      if (x * x + y * y + z * z > 1) continue;
      uniform.set([x * 800, y * 800, z * 800], 3 * i++);
    }
    const web = pairExcess(a.pos, 4000, 10);
    const flat = pairExcess(uniform, 4000, 10);
    expect(flat).toBeGreaterThan(0.5);
    expect(flat).toBeLessThan(1.5);
    expect(web).toBeGreaterThan(5 * flat);
  });

  it('keeps the total light independent of the preset and has a 500 Mpc bookmark', () => {
    const lum = (n: number) => n * 10 ** (-0.4 * tracerAbsMag(n));
    expect(lum(WEB_COUNT.potato) / lum(WEB_COUNT.medium)).toBeCloseTo(1, 6);
    expect(WEB_COUNT.medium).toBe(200_000);
    const b = cosmicWebBookmark();
    expect(Math.hypot(b.pos.x, b.pos.y, b.pos.z) / MPC).toBeCloseTo(500, 3);
  });
});
