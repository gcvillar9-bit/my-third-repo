import { expect, test, type Page } from '@playwright/test';

/**
 * earth bookmarks at 480x270 potato. Textures load lazily on the first resolved frame, so each test
 * renders once, waits for ready() again, then renders the frames that are screenshotted and probed.
 */
type RGB = [number, number, number];
const lum = ([r, g, b]: RGB) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

async function open(page: Page, bookmark: string, problems: string[], query = '') {
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.goto(`?test=1&q=potato&b=${bookmark}${query}`);
  await page.waitForFunction(() => window.__universe !== undefined);
  await page.evaluate(async () => {
    await window.__universe!.ready();
    await window.__universe!.renderFrames(1);
    await window.__universe!.ready();
    await window.__universe!.renderFrames(4);
  });
  await page.screenshot({ path: `artifacts/earth/${bookmark}${query.replace(/[^a-z0-9]+/gi, '-')}.png` });
  const probe = (x: number, y: number, w: number, h: number) =>
    page.evaluate(([a, b, c, d]) => window.__universe!.probe(a, b, c, d), [
      x,
      y,
      w,
      h,
    ] as const) as Promise<RGB>;
  const stats = await page.evaluate(() => window.__universe!.stats());
  const errors = await page.evaluate(() => window.__universe!.errors());
  return { probe, stats, errors };
}

type Probe = (x: number, y: number, w: number, h: number) => Promise<RGB>;

/** First 2-px row (scanning down from y0) at column x..x+20 brighter than `thr`: the top of the limb glow. */
async function limbTop(probe: Probe, x: number, y0 = 30, y1 = 200, thr = 0.02): Promise<number> {
  for (let y = y0; y < y1; y += 2) if (lum(await probe(x, y, 20, 2)) > thr) return y;
  return -1;
}

test('earth-dawn-400km: blue limb above the dawn terminator', { tag: '@smoke' }, async ({ page }) => {
  const problems: string[] = [];
  const { probe, stats, errors } = await open(page, 'earth-dawn-400km', problems);
  expect(errors).toEqual([]);
  expect(problems).toEqual([]);
  const y = await limbTop(probe, 380);
  expect(y).toBeGreaterThan(60); // limb in the upper part, space above it
  expect(y).toBeLessThan(140);
  const band = await probe(380, y, 20, 6);
  expect(band[2]).toBeGreaterThan(band[0]); // blue limb over the sunlit side
  expect(lum(await probe(380, y - 30, 20, 10))).toBeLessThan(0.01); // black space above
  const dayRight = lum(await probe(400, 200, 60, 40));
  const nightLeft = lum(await probe(10, 200, 60, 40));
  expect(dayRight).toBeGreaterThan(2 * nightLeft); // terminator: day right, night left
  expect(stats.calls).toBeLessThanOrEqual(150);
});

test('earth-night-lights: warm city lights on the night side', async ({ page }) => {
  const problems: string[] = [];
  const { probe, stats, errors } = await open(page, 'earth-night-lights', problems);
  expect(errors).toEqual([]);
  expect(problems).toEqual([]);
  const centre = await probe(160, 95, 160, 80);
  expect(lum(centre)).toBeGreaterThan(0.004); // lights visible
  expect(centre[0]).toBeGreaterThan(1.5 * centre[2]); // warm sodium/LED mix, not blue sky
  expect(stats.calls).toBeLessThanOrEqual(150);
});

test('earth-limb-400km: blue atmosphere band over the sunlit limb', async ({ page }) => {
  const problems: string[] = [];
  const { probe, stats, errors } = await open(page, 'earth-limb-400km', problems);
  expect(errors).toEqual([]);
  expect(problems).toEqual([]);
  const y = await limbTop(probe, 230);
  expect(y).toBeGreaterThan(60);
  expect(y).toBeLessThan(140);
  const band = await probe(230, y, 20, 4);
  expect(band[2]).toBeGreaterThan(band[0]);
  expect(lum(await probe(230, y - 30, 20, 10))).toBeLessThan(0.01);
  expect(lum(await probe(200, 200, 80, 40))).toBeGreaterThan(0.05); // sunlit Earth below
  expect(stats.calls).toBeLessThanOrEqual(150);
});

test('earth-sunrise-400km: Sun above the limb, blue limb band, night below, ocean seed-independent', async ({
  page,
}) => {
  const problems: string[] = [];
  const { probe, stats, errors } = await open(page, 'earth-sunrise-400km', problems);
  expect(errors).toEqual([]);
  expect(problems).toEqual([]);
  // The Sun near the top centre (not a black frame: a NaN near the Sun used to blank the whole image).
  expect(lum(await probe(225, 0, 30, 30))).toBeGreaterThan(0.5);
  // The limb band below the Sun is blue-tinted to either side of the Sun's halo.
  for (const x of [100, 340]) {
    const band = await probe(x, 74, 40, 10);
    expect(band[2]).toBeGreaterThan(band[0]);
  }
  // Night side at the bottom (a single sunrise exposure cannot also show the city lights).
  expect(lum(await probe(0, 240, 480, 30))).toBeLessThan(0.02);
  expect(stats.calls).toBeLessThanOrEqual(150);
  // The ocean (glint) region under the Sun does not depend on the terrain seed: the sea is level.
  const sea = await probe(150, 84, 180, 30);
  await page.close();
  const page2 = await page.context().newPage();
  const second = await open(page2, 'earth-sunrise-400km', problems, '&seed=2');
  const sea2 = await second.probe(150, 84, 180, 30);
  for (let c = 0; c < 3; c++) expect(Math.abs(sea2[c] - sea[c])).toBeLessThan(0.01 * Math.max(sea[c], 0.01));
});
