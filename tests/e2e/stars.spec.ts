import { expect, test, type Page } from '@playwright/test';

/**
 * Stars (HYG point sprites + Milky Way panorama). The labels overlay (?ui=1) gives the exact
 * projected CSS position of named stars (data-x / data-y), so colour probes land on the stars.
 */
type Rgb = [number, number, number];
const probe = (page: Page, x: number, y: number, w: number, h: number) =>
  page.evaluate(([a, b, c, d]) => window.__universe!.probe(a, b, c, d), [x, y, w, h] as const);
const lum = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

async function open(page: Page, bookmark: string): Promise<string[]> {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.goto(`?test=1&q=potato&ui=1&b=${bookmark}`);
  await page.waitForFunction(() => window.__universe !== undefined);
  await page.evaluate(() => window.__universe!.ready());
  await page.evaluate(() => window.__universe!.renderFrames(4));
  return problems;
}

async function labelPos(page: Page, id: string): Promise<[number, number]> {
  const el = page.locator(`.cz-label[data-label-id="${id}"]`);
  await expect(el).toHaveCount(1);
  const [x, y] = await el.evaluate((n: HTMLElement) => [Number(n.dataset.x), Number(n.dataset.y)]);
  return [x, y];
}

test(
  'stars: orion-from-earth shows Orion, Betelgeuse redder than Rigel',
  { tag: '@smoke' },
  async ({ page }) => {
    const problems = await open(page, 'orion-from-earth');
    await page.screenshot({ path: 'artifacts/stars/orion-from-earth.png' });
    expect(await page.evaluate(() => window.__universe!.errors())).toEqual([]);

    const [bx, by] = await labelPos(page, 'hip:27989'); // Betelgeuse
    const [rx, ry] = await labelPos(page, 'hip:24436'); // Rigel
    // North up, east left: Betelgeuse is upper left of Rigel, both near the centre.
    expect(bx).toBeLessThan(rx);
    expect(by).toBeLessThan(ry);
    for (const x of [bx, rx]) {
      expect(x).toBeGreaterThan(120);
      expect(x).toBeLessThan(360);
    }
    const betelgeuse = await probe(page, bx - 2, by - 2, 5, 5);
    const rigel = await probe(page, rx - 2, ry - 2, 5, 5);
    expect(lum(betelgeuse)).toBeGreaterThan(0.01);
    expect(lum(rigel)).toBeGreaterThan(0.01);
    const redness = (c: Rgb) => c[0] / Math.max(c[2], 1e-4);
    expect(redness(betelgeuse)).toBeGreaterThan(1.3 * redness(rigel));
    // Dark sky between the stars of the belt and the frame corner.
    expect(lum(await probe(page, 2, 250, 16, 16))).toBeLessThan(0.01);

    const stats = await page.evaluate(() => window.__universe!.stats());
    expect(stats.calls).toBeLessThanOrEqual(150);
    expect(stats.points).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  },
);

test('stars: sun-from-alpha-cen looks back at Cassiopeia', async ({ page }) => {
  const problems = await open(page, 'sun-from-alpha-cen');
  await page.screenshot({ path: 'artifacts/stars/sun-from-alpha-cen.png' });
  expect(await page.evaluate(() => window.__universe!.errors())).toEqual([]);
  // Schedar (α Cas) and Caph (β Cas) are labelled and lit; α Cen A itself is behind the camera.
  const [sx, sy] = await labelPos(page, 'hip:3179');
  expect(lum(await probe(page, sx - 2, sy - 2, 5, 5))).toBeGreaterThan(0.005);
  await expect(page.locator('.cz-label[data-label-id="hip:71683"]')).toHaveCount(0);
  expect(problems).toEqual([]);
});
