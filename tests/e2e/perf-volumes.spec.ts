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
 * Budgets sit ~25-50% above the values measured when they were set. One case runs the inside view at the owner's
 * 2268x1240 to check that the nebula march does not grow with the drawing buffer.
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

async function measure(page: Page, bookmark: string, width = 1280, height = 720) {
  const problems: string[] = [];
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  if (width !== 1280 || height !== 720) await page.setViewportSize({ width, height });
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
  for (const h of [height - 8, height, height]) {
    await page.setViewportSize({ width, height: h });
    // Two frames per size, each read: the resize may reach the renderer a frame late.
    for (let k = 0; k < 2; k++) {
      const r = await page.evaluate(async () => {
        const u = window.__universe!;
        await u.renderFrames(1);
        return { stats: u.stats(), work: (u as unknown as UniverseTestApiExtras).work() };
      });
      if (r.work.fragmentSteps >= work.fragmentSteps) work = r.work;
      stats = r.stats;
    }
  }
  await page.screenshot({
    path: `artifacts/perf-volumes/${bookmark}${width === 1280 ? '' : `-${width}`}.png`,
  });
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

// The owner's drawing buffer: the march target is capped at the 1280x720 texel budget (nebulae/render.ts
// marchSize), so the inside view costs the same as at 1280x720 rather than ~3x.
test('perf budget on medium 2268x1240: trapezium-inside', async ({ page }) => {
  const t0 = Date.now();
  const { stats, work, errors, problems } = await measure(page, 'trapezium-inside', 2268, 1240);
  console.log(
    `[perf-volumes] trapezium-inside 2268x1240: calls ${stats.calls}, march pixels ${work.pixels}, ` +
      `fragment steps ${(work.fragmentSteps / 1e6).toFixed(2)}M (${((Date.now() - t0) / 1e3).toFixed(1)} s)`,
  );
  expect(errors).toEqual([]);
  expect(problems).toEqual([]);
  expect(work.pixels).toBeGreaterThan(0); // the march ran in a measured frame
  expect(work.pixels).toBeLessThanOrEqual(1.01 * Math.ceil(1280 / 3) * Math.ceil(720 / 3));
  expect(work.fragmentSteps / 1e6).toBeLessThanOrEqual(BUDGETS['trapezium-inside'].workM);
});
