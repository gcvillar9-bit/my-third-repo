import { expect, test, type Page } from '@playwright/test';

/**
 * oort (cloud part) at 480x270 potato. Both views look along the north Galactic pole at the Sun with
 * ecliptic north up (src/modules/oort/cloud/bookmarks.ts): the dark polar sky lies behind the cloud.
 * - oort-cloud: the whole cloud from 170,000 AU; a white inner cloud at the centre inside a faint halo.
 * - oort-spiral: the inner cloud from 22,000 AU; an untwisted ecliptic disc would be mirror-symmetric left to
 *   right, the Galactic tide's twist makes the upper-left and lower-right quadrants brighter.
 */
type RGB = [number, number, number];
const lum = ([r, g, b]: RGB) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

async function open(page: Page, id: string): Promise<string[]> {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.goto(`?test=1&q=potato&b=${id}`);
  await page.waitForFunction(() => window.__universe !== undefined);
  await page.evaluate(async () => {
    await window.__universe!.ready();
    await window.__universe!.renderFrames(4);
  });
  await page.screenshot({ path: `artifacts/oort/${id}.png` });
  return problems;
}

/** Mean linear luminance of a box centred `dx`, `dy` px from the screen centre. */
const probe = async (page: Page, dx: number, dy: number, size: number): Promise<number> =>
  lum(
    (await page.evaluate(([x, y, s]) => window.__universe!.probe(x, y, s, s), [
      240 + dx - size / 2,
      135 + dy - size / 2,
      size,
    ] as const)) as RGB,
  );

async function checkHealth(page: Page, problems: string[]): Promise<void> {
  const stats = await page.evaluate(() => window.__universe!.stats());
  const errors = await page.evaluate(() => window.__universe!.errors());
  expect(errors).toEqual([]);
  expect(problems).toEqual([]);
  expect(stats.points).toBeGreaterThanOrEqual(20000);
  expect(stats.calls).toBeLessThanOrEqual(150);
}

test(
  'oort-cloud: white inner cloud inside a faint halo, no errors, budgets',
  { tag: '@smoke' },
  async ({ page }) => {
    const problems = await open(page, 'oort-cloud');
    await checkHealth(page, problems);
    const centre = await probe(page, 0, 0, 12);
    // The halo ring 18 degrees out (55,000 AU from the Sun in projection), clear of the inner cloud's glow.
    const ring = [
      await probe(page, 70, 0, 24),
      await probe(page, -70, 0, 24),
      await probe(page, 0, 70, 24),
      await probe(page, 0, -70, 24),
    ];
    const ringMean = ring.reduce((a, b) => a + b) / 4;
    const corners = [
      await probe(page, -220, -115, 32),
      await probe(page, 220, -115, 32),
      await probe(page, -220, 115, 32),
      await probe(page, 220, 115, 32),
    ];
    const cornerMean = corners.reduce((a, b) => a + b) / 4;
    expect(centre).toBeGreaterThan(0.3);
    expect(centre).toBeGreaterThan(30 * ringMean);
    // The halo is faint but there: each side of the ring, and well above the dark polar sky in the corners.
    expect(Math.min(...ring)).toBeGreaterThan(0.001);
    expect(ringMean).toBeGreaterThan(10 * cornerMean);
  },
);

test('oort-spiral: the twisted inner cloud breaks mirror symmetry', async ({ page }) => {
  const problems = await open(page, 'oort-spiral');
  await checkHealth(page, problems);
  const box = 40;
  const off = 8 + box / 2;
  const ul = await probe(page, -off, -off, box);
  const ur = await probe(page, off, -off, box);
  const ll = await probe(page, -off, off, box);
  const lr = await probe(page, off, off, box);
  const corner = await probe(page, -220, -115, 32);
  expect(Math.min(ul, ur, ll, lr)).toBeGreaterThan(20 * corner);
  // An untwisted disc would give (UL + LR) / (UR + LL) = 1 in this view.
  expect((ul + lr) / (ur + ll)).toBeGreaterThan(1.2);
});
