import { describe, expect, it } from 'vitest';
import { QUALITY_PRESETS } from '../../../src/core/contracts';
import { PRESET_KNOBS } from '../../../src/core/quality';
import { MARCH_SCALE, marchSize } from '../../../src/modules/atmosphere/pass';
import { stepCounts } from '../../../src/modules/atmosphere/space';

describe('atmosphere march cost (P4-P)', () => {
  it('marches at half resolution below ultra', () => {
    expect(QUALITY_PRESETS.map((p) => MARCH_SCALE[p])).toEqual([0.5, 0.5, 0.5, 0.5, 1]);
    expect(marchSize(1280, 720, 0.5)).toEqual([640, 360]);
    expect(marchSize(1281, 1, 0.5)).toEqual([641, 1]);
  });

  it('keeps medium pixel-steps for an outside view at 1080p under a quarter of the old cost', () => {
    const px = 1920 * 1080;
    const old = px * 48; // full-resolution composite, medium's former 32-step knob (raymarch 48)
    const s = stepCounts(PRESET_KNOBS.medium.atmosphereSteps).march;
    const [w, h] = marchSize(1920, 1080, MARCH_SCALE.medium);
    expect(w * h * s + px).toBeLessThan(old / 4);
  });
});
