import { expect, test, type Page } from '@playwright/test';

/**
 * Milky Way (P4-A): ray-marched GalaxyModel from outside, and the panorama band from Earth's
 * distance. 480x270 on potato, no UI; probes are mean linear RGB over CSS-pixel rectangles.
 *
 * Screen positions for mw-outside-100kpc (camera 100 kpc out, tilted 20 deg from the north
 * Galactic pole towards the Sun's side, fovY 30 deg, Sun-centre line pointing up): a model point
 * (x, y) kpc lands at X = 240 - 5.04 y, Y = 135 - 4.74 x (perspective < 2%). The bar's major axis
 * runs at 27 deg to the Sun-centre line: 4 kpc along it -> (231, 152) and (249, 118); 4 kpc across
 * it -> (222, 126) and (258, 144). The Sun (x = -8.18) sits at (240, 175).
 */
type Rgb = [number, number, number];
const lum = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const probe = (page: Page, x: number, y: number, w: number, h: number): Promise<Rgb> =>
  page.evaluate(([a, b, c, d]) => window.__universe!.probe(a, b, c, d), [x, y, w, h] as const);
const probeAt = async (page: Page, x: number, y: number, r = 2) =>
  lum(await probe(page, x - r, y - r, 2 * r, 2 * r));

async function open(page: Page, bookmark: string): Promise<string[]> {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.goto(`?test=1&q=potato&b=${bookmark}`);
  await page.waitForFunction(() => window.__universe !== undefined);
  await page.evaluate(() => window.__universe!.ready());
  await page.evaluate(() => window.__universe!.renderFrames(4));
  await page.screenshot({ path: `artifacts/milkyway/${bookmark}.png` });
  return problems;
}

async function budgets(page: Page, problems: string[]): Promise<void> {
  expect(await page.evaluate(() => window.__universe!.errors())).toEqual([]);
  const stats = await page.evaluate(() => window.__universe!.stats());
  expect(stats.calls).toBeLessThanOrEqual(400);
  expect(problems).toEqual([]);
}

test(
  'milkyway: mw-outside-100kpc shows a barred spiral with a bright centre',
  { tag: '@smoke' },
  async ({ page }) => {
    const problems = await open(page, 'mw-outside-100kpc');
    const centre = await probeAt(page, 240, 135, 3);
    const outskirts: number[] = [];
    for (const [x, y] of [
      [240, 85], // 10.5 kpc towards the far side
      [190, 135], // 10 kpc towards l = 90
      [290, 135], // 10 kpc towards l = 270
    ])
      outskirts.push(await probeAt(page, x, y, 3));
    const along = ((await probeAt(page, 231, 152)) + (await probeAt(page, 249, 118))) / 2;
    const across = ((await probeAt(page, 222, 126)) + (await probeAt(page, 258, 144))) / 2;
    const ring = await probe(page, 246, 173, 4, 4); // right edge of the "You are here" ring
    console.log('outside', { centre, outskirts, along, across, ring });
    expect(centre).toBeGreaterThan(0.3);
    for (const o of outskirts) expect(centre).toBeGreaterThan(3 * o);
    expect(along).toBeGreaterThan(1.15 * across); // the bar is elongated at 27 deg
    expect(ring[2]).toBeGreaterThan(1.5 * ring[0]); // cyan marker
    expect(await probeAt(page, 12, 12, 8)).toBeLessThan(0.05); // empty intergalactic corner
    await budgets(page, problems);
  },
);

test('milkyway: mw-edge-on shows the dust lane', async ({ page }) => {
  const problems = await open(page, 'mw-edge-on');
  const row = async (y: number) => lum(await probe(page, 200, y - 1, 80, 3));
  const lane = Math.min(await row(134), await row(135), await row(136));
  const above = await row(130);
  const below = await row(140);
  console.log('edge', { lane, above, below });
  expect(lane).toBeLessThan(0.85 * Math.min(above, below));
  expect(above).toBeGreaterThan(0.1);
  expect(await row(30)).toBeLessThan(0.3 * above); // thin disc: dark well above the plane
  await budgets(page, problems);
});

test('milkyway: mw-above-sun-1kpc shows the disc below a dark sky (sky cube)', async ({ page }) => {
  const problems = await open(page, 'mw-above-sun-1kpc');
  const lower = lum(await probe(page, 40, 150, 400, 40));
  const upper = lum(await probe(page, 40, 10, 400, 40));
  console.log('above', { lower, upper });
  expect(lower).toBeGreaterThan(0.02);
  expect(lower).toBeGreaterThan(3 * upper);
  await budgets(page, problems);
});

test('milkyway: mw-band-from-earth shows the band brighter than off-band sky', async ({ page }) => {
  const problems = await open(page, 'mw-band-from-earth');
  const band = lum(await probe(page, 40, 122, 400, 20));
  const top = lum(await probe(page, 40, 4, 400, 20));
  const bottom = lum(await probe(page, 40, 246, 400, 20));
  console.log('band', { band, top, bottom });
  expect(band).toBeGreaterThan(0.02);
  expect(band).toBeGreaterThan(3 * Math.max(top, bottom));
  await budgets(page, problems);
});
