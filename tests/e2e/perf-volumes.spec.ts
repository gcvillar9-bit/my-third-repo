import { expect, test, type Page } from '@playwright/test';
import type { UniverseTestApiExtras } from '../../src/app/test-api';
import type { MarchWork } from '../../src/render/renderer';

/**
 * Performance budgets of the volume-heavy views on the medium preset at 1280x720 (test mode: pixel ratio 1,
 * dynamic resolution off), like tests/e2e/perf.spec.ts: draw calls, triangles and ray-march fragment work
 * (EngineRenderer.workStats: target pixels x steps, an upper bound). The owner's target is 60 fps on medium on a
 * MacBook Pro M4 Pro (2268x1240 drawing buffer, ~3x these pixels).
 * - sun-sunspots: the living Sun's photosphere with spots over the whole frame (docs/requests/sun.md);
 * - m42-telescope, m42-from-20ly, trapezium-inside: the Orion Nebula march over its screen rect (the inside
 *   view marches the whole screen; design limit 8M fragment steps).
 * Budgets sit ~25-50% above the values measured when they were set.
 */
interface Budget {
  calls: number;
  triangles: number;
  /** Max fragment steps per frame (pixels x steps), millions. */
  workM: number;
}

// Measured on medium 1280x720 when set (calls / triangles / fragment steps):
//   sun-sunspots       29 /  36k / 0      (procedural photosphere shading, no march)
//   m42-telescope      54 / 158k / 1.49M  (the march covers the nebula's rect only)
//   m42-from-20ly      26 /   7k / 4.92M  (full screen at 1/3 resolution, 48 steps)
//   trapezium-inside   27 /   7k / 4.92M  (full screen; design limit 8M)
const BUDGETS: Record<string, Budget> = {
  'sun-sunspots': { calls: 45, triangles: 60_000, workM: 0.5 },
  'm42-telescope': { calls: 80, triangles: 220_000, workM: 2.5 },
  'm42-from-20ly': { calls: 40, triangles: 15_000, workM: 6.5 },
  'trapezium-inside': { calls: 40, triangles: 15_000, workM: 6.5 },
};

test.use({ viewport: { width: 1280, height: 720 } });

async function measure(page: Page, bookmark: string) {
  const problems: string[] = [];
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.goto(`?test=1&q=medium&b=${bookmark}`);
  await page.waitForFunction(() => window.__universe !== undefined);
  const known = await page.evaluate(() => window.__universe!.errors());
  // Cached passes (the nebula and Milky Way marches) only work when something changed: the first frame after
  // loading and an 8 px resize force every pass to redo its work, and the budget applies to the heaviest of the
  // measured frames (the resize reaches the renderer asynchronously, so it may land a frame late or not at all).
  const first = await page.evaluate(async () => {
    const u = window.__universe!;
    await u.ready();
    await u.renderFrames(1);
    return { stats: u.stats(), work: (u as unknown as UniverseTestApiExtras).work() };
  });
  let work: MarchWork = first.work;
  let stats = first.stats;
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
  await page.screenshot({ path: `artifacts/perf-volumes/${bookmark}.png` });
  const errors = await page.evaluate(() => window.__universe!.errors());
  return { stats, work, errors: [...known, ...errors], problems };
}

for (const [bookmark, budget] of Object.entries(BUDGETS)) {
  test(`perf budget on medium 1280x720: ${bookmark}`, async ({ page }) => {
    const { stats, work, errors, problems } = await measure(page, bookmark);
    test.skip(
      errors.some((e) => e.includes('unknown bookmark')),
      `${bookmark} not registered`,
    );
    console.log(
      `[perf-volumes] ${bookmark}: calls ${stats.calls}, triangles ${stats.triangles}, points ${stats.points}, ` +
        `march draws ${work.draws}, march pixels ${work.pixels}, fragment steps ${(work.fragmentSteps / 1e6).toFixed(2)}M`,
    );
    expect(errors).toEqual([]);
    expect(problems).toEqual([]);
    expect(stats.calls).toBeLessThanOrEqual(budget.calls);
    expect(stats.triangles).toBeLessThanOrEqual(budget.triangles);
    expect(work.fragmentSteps / 1e6).toBeLessThanOrEqual(budget.workM);
  });
}
