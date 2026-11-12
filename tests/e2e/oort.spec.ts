import { expect, test, type Page } from '@playwright/test';

/**
 * oort (cloud part) at 480x270 potato. Both views look along the north Galactic pole at the Sun with
 * ecliptic north up (src/modules/oort/cloud/bookmarks.ts): the dark polar sky lies behind the cloud.
 * - oort-cloud: the whole cloud from 170,000 AU; a bright (not blown-out) inner cloud inside a faint halo.
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

/** Probes on a ring of `n` boxes, `r` px around the screen centre. */
async function ring(page: Page, r: number, n: number, size: number): Promise<number[]> {
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    const t = (2 * Math.PI * k) / n;
    out.push(await probe(page, r * Math.cos(t), r * Math.sin(t), size));
  }
  return out;
}
const mean = (v: number[]) => v.reduce((a, b) => a + b) / v.length;

test(
  'oort-cloud: inner cloud not blown out inside a visible halo, no errors, budgets',
  { tag: '@smoke' },
  async ({ page }) => {
    const problems = await open(page, 'oort-cloud');
    await checkHealth(page, problems);
    // The inner cloud is bright but not saturated (the artificial contrast flattens the true r^-2.5 fall).
    const centre = await probe(page, 0, 0, 11);
    expect(centre).toBeGreaterThan(0.15);
    expect(centre).toBeLessThan(0.6);
    // The halo: every box 60 px out (15 degrees, about 46,000 AU in projection), and 110 px out on average
    // (about 90,000 AU; the ring crosses the scale shells there).
    expect(Math.min(...(await ring(page, 60, 8, 16)))).toBeGreaterThan(0.01);
    expect(mean(await ring(page, 110, 8, 16))).toBeGreaterThan(0.003);
    // Beyond the cloud: the dark polar sky.
    for (const [x, y] of [
      [-224, -119],
      [224, -119],
      [-224, 119],
      [224, 119],
    ])
      expect(await probe(page, x, y, 32)).toBeLessThan(0.001);
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
  expect(Math.min(ul, ur, ll, lr)).toBeGreaterThan(8 * corner);
  // An untwisted disc would give (UL + LR) / (UR + LL) = 1 in this view.
  expect((ul + lr) / (ur + ll)).toBeGreaterThan(1.2);
});
