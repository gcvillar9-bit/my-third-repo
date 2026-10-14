import { expect, test, type Page } from '@playwright/test';
import type { UniverseTestApiExtras } from '../../src/app/test-api';
import type { MarchWork } from '../../src/render/renderer';

/**
 * Performance regression budgets (P4-P, after the owner's laptop test: Earth close-up ~15 fps,
 * terrain walking ~30 fps on medium). Medium preset at 1280x720 (test mode: pixel ratio 1,
 * dynamic resolution off), checked per bookmark:
 * - draw calls and triangles (renderer.info, every pass of the last frame);
 * - ray-march fragment work: sum of target pixels x steps over the frame's march draws
 *   (EngineRenderer.workStats, an upper bound that ignores early-outs).
 * Budgets sit ~25-50% above the values measured when they were set, so a change that doubles a
 * pass's resolution or step count, or lifts the terrain tile cap, fails here. apollo11-2m (terrain
 * walking) is budgeted in tests/e2e/input.spec.ts, to keep at most four bookmarks per spec.
 */
interface Budget {
  calls: number;
  triangles: number;
  /** Max fragment steps per frame (pixels x steps), millions. */
  workM: number;
}

// Measured on medium 1280x720 when set (calls / triangles / fragment steps):
//   earth-dawn-400km   139 / 369k / 10.1M  (before P4-P: full-res composite x 48 steps = 44M alone)
//   mars-gale-sunset   158 / 359k / 11.9M
//   sgra-lensing        24 /   4k / 14.7M  (half-res lensing, 64 steps)
//   mw-outside-100kpc   23 /   4k /  2.8M  (quarter-res march, 48 steps)
const BUDGETS: Record<string, Budget> = {
  'earth-dawn-400km': { calls: 200, triangles: 600_000, workM: 14 },
  'mars-gale-sunset': { calls: 220, triangles: 600_000, workM: 16 },
  'sgra-lensing': { calls: 60, triangles: 50_000, workM: 20 },
  'mw-outside-100kpc': { calls: 60, triangles: 50_000, workM: 4 },
};

test.use({ viewport: { width: 1280, height: 720 } });

async function measure(page: Page, bookmark: string) {
  const problems: string[] = [];
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.goto(`?test=1&q=medium&b=${bookmark}`);
  await page.waitForFunction(() => window.__universe !== undefined);
  const known = await page.evaluate(() => window.__universe!.errors());
  await page.evaluate(async () => {
    await window.__universe!.ready();
    await window.__universe!.renderFrames(1);
    await window.__universe!.ready();
  });
  // Passes that cache their result while the view is still (the Milky Way march) only work when
  // something changed: an 8 px resize forces every pass to redo its work, and the budget applies to
  // the heaviest of the measured frames.
  let work: MarchWork = { fragmentSteps: 0, draws: 0, pixels: 0 };
  let stats = await page.evaluate(() => window.__universe!.stats());
  for (const h of [712, 720, 720]) {
    await page.setViewportSize({ width: 1280, height: h });
    const r = await page.evaluate(async () => {
      const u = window.__universe!;
      await u.renderFrames(1);
      return { stats: u.stats(), work: (u as unknown as UniverseTestApiExtras).work() };
    });
    if (r.work.fragmentSteps >= work.fragmentSteps) work = r.work;
    stats = r.stats;
  }
  await page.screenshot({ path: `artifacts/perf/${bookmark}.png` });
  const errors = await page.evaluate(() => window.__universe!.errors());
  return { stats, work, errors: [...known, ...errors], problems };
}

for (const [bookmark, budget] of Object.entries(BUDGETS)) {
  test(`perf budget on medium 1280x720: ${bookmark}`, async ({ page }) => {
    const { stats, work, errors, problems } = await measure(page, bookmark);
    // Bookmarks from wave-1 packages may be absent on a branch without them.
    test.skip(
      errors.some((e) => e.includes('unknown bookmark')),
      `${bookmark} not registered`,
    );
    console.log(
      `[perf] ${bookmark}: calls ${stats.calls}, triangles ${stats.triangles}, points ${stats.points}, ` +
        `tiles ${stats.tiles}, march draws ${work.draws}, march pixels ${work.pixels}, ` +
        `fragment steps ${(work.fragmentSteps / 1e6).toFixed(2)}M`,
    );
    expect(errors).toEqual([]);
    expect(problems).toEqual([]);
    expect(stats.calls).toBeLessThanOrEqual(budget.calls);
    expect(stats.triangles).toBeLessThanOrEqual(budget.triangles);
    expect(work.fragmentSteps / 1e6).toBeLessThanOrEqual(budget.workM);
  });
}
