import { describe, expect, it } from 'vitest';
import {
  creditsLine,
  EV_COMP_LIMIT,
  FOV_MAX_DEG,
  FOV_MIN_DEG,
  PhotoState,
  photoFileName,
} from '../../../src/modules/photo/photo';

function fake() {
  const s = { hud: true, flag: false, fovY: 1, exposure: { compensation: 0.25 }, changes: 0 };
  const state = new PhotoState({
    setHudVisible: (v) => (s.hud = v),
    setFlag: (on) => (s.flag = on),
    getFovY: () => s.fovY,
    setFovY: (r) => (s.fovY = r),
    exposure: s.exposure,
    changed: () => s.changes++,
  });
  return { s, state };
}

describe('photo mode state', () => {
  it('entering hides the UI (HUD and document flag); exiting shows it again', () => {
    const { s, state } = fake();
    state.toggle();
    expect(state.active).toBe(true);
    expect(s.hud).toBe(false);
    expect(s.flag).toBe(true);
    state.enter(); // idempotent
    state.toggle();
    expect(state.active).toBe(false);
    expect(s.hud).toBe(true);
    expect(s.flag).toBe(false);
    expect(s.changes).toBe(2);
  });

  it('clamps FOV to 5-120 degrees and restores FOV and exposure on exit', () => {
    const { s, state } = fake();
    state.enter();
    state.setFovDeg(1);
    expect(state.fovDeg).toBeCloseTo(FOV_MIN_DEG, 9);
    state.setFovDeg(500);
    expect(state.fovDeg).toBeCloseTo(FOV_MAX_DEG, 9);
    state.setFovDeg(Number.NaN);
    expect(state.fovDeg).toBeCloseTo(FOV_MAX_DEG, 9);
    state.nudgeExposure(1); // brighter = lower EV compensation
    expect(s.exposure.compensation).toBeCloseTo(-0.75, 9);
    for (let i = 0; i < 40; i++) state.nudgeExposure(1);
    expect(s.exposure.compensation).toBe(-EV_COMP_LIMIT);
    state.exit();
    expect(s.fovY).toBe(1);
    expect(s.exposure.compensation).toBe(0.25);
  });

  it('credits line and file name', () => {
    expect(creditsLine(new Date(Date.UTC(2026, 0, 2, 3, 4)))).toMatch(
      /^Cosmos · 2026-01-02 03:04 UTC · data: .*CREDITS/,
    );
    expect(creditsLine(null)).toMatch(/^Cosmos · data:/);
    expect(photoFileName(new Date(2026, 9, 14, 9, 5))).toBe('cosmos-2026-10-14-0905.png');
  });
});
