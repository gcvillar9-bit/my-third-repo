import { expect, test, type Page } from '@playwright/test';

/**
 * giants + rings (P3-A) bookmarks at 480x270 potato. Maps and the Saturn ring strip load lazily on
 * the first resolved frame, so each test renders once, waits for ready() again, then renders the
 * frames that are screenshotted and probed. Bookmarks keep the planet's pole up on screen, so the
 * ring ansae lie on the horizontal through the centre.
 */
type RGB = [number, number, number];
const lum = ([r, g, b]: RGB) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

async function open(page: Page, bookmark: string, problems: string[]) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.goto(`?test=1&q=potato&b=${bookmark}`);
  await page.waitForFunction(() => window.__universe !== undefined);
  await page.evaluate(async () => {
    await window.__universe!.ready();
    await window.__universe!.renderFrames(1);
    await window.__universe!.ready();
    await window.__universe!.renderFrames(4);
  });
  await page.screenshot({ path: `artifacts/giants/${bookmark}.png` });
  const probe = async (x: number, y: number, w = 4, h = 4) =>
    lum(
      (await page.evaluate(([a, b, c, d]) => window.__universe!.probe(a, b, c, d), [
        x,
        y,
        w,
        h,
      ] as const)) as RGB,
    );
  const stats = await page.evaluate(() => window.__universe!.stats());
  const errors = await page.evaluate(() => window.__universe!.errors());
  return { probe, stats, errors };
}

test('saturn-backlit-2013-07-19: rings glow brighter than the night side', async ({ page }) => {
  const problems: string[] = [];
  const { probe, stats, errors } = await open(page, 'saturn-backlit-2013-07-19', problems);
  expect(errors).toEqual([]);
  expect(problems).toEqual([]);
  const night = await probe(238, 133);
  // B ring (~88 px) and A ring (~108 px) ansae on both sides of the planet.
  const rings = await Promise.all([128, 148, 330, 350].map((x) => probe(x, 133)));
  const ringMax = Math.max(...rings);
  expect(ringMax).toBeGreaterThan(0.01);
  expect(ringMax).toBeGreaterThan(3 * night);
  expect(stats.calls).toBeLessThanOrEqual(400);
});

test("jupiter-io-shadow: Io's umbra is a dark spot on the lit disk", async ({ page }) => {
  const problems: string[] = [];
  const { probe, stats, errors } = await open(page, 'jupiter-io-shadow', problems);
  expect(errors).toEqual([]);
  expect(problems).toEqual([]);
  const spot = await probe(238, 133);
  const around = await Promise.all(
    [
      [198, 133],
      [278, 133],
      [238, 103],
      [238, 163],
    ].map(([x, y]) => probe(x, y)),
  );
  const disk = around.reduce((a, b) => a + b, 0) / around.length;
  expect(disk).toBeGreaterThan(0.02);
  expect(spot).toBeLessThan(0.3 * disk);
  expect(stats.calls).toBeLessThanOrEqual(400);
});

test('uranus-rings: dark rings at the ansa, epsilon brightest, within budget', async ({ page }) => {
  const problems: string[] = [];
  const { probe, stats, errors } = await open(page, 'uranus-rings', problems);
  expect(errors).toEqual([]);
  expect(problems).toEqual([]);
  // Mean over 2 px wide, 120 px tall strips across the ansa (rings are near-vertical arcs there).
  const strips = async (x0: number, x1: number) => {
    const out: number[] = [];
    for (let x = x0; x <= x1; x += 2) out.push(await probe(x, 75, 2, 120));
    return out;
  };
  const epsilon = Math.max(...(await strips(250, 310))); // epsilon arc crosses these columns
  const inner = Math.max(...(await strips(160, 240))); // rings 6 ... lambda
  const outside = await strips(320, 360);
  expect(epsilon).toBeGreaterThan(1e-3);
  expect(epsilon).toBeGreaterThan(5 * inner);
  expect(outside.reduce((a, b) => a + b, 0) / outside.length).toBeLessThan(epsilon / 20);
  expect(stats.calls).toBeLessThanOrEqual(400);
});
