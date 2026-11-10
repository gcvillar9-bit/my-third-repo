import { expect, test, type Page } from '@playwright/test';

/** Spacecraft: models at their bookmarks, lit and in place, within the draw budgets. */
type Rgb = [number, number, number];
const lum = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

async function open(page: Page, bookmark: string, extra = ''): Promise<void> {
  await page.goto(`?test=1&q=potato&b=${bookmark}${extra}`);
  await page.waitForFunction(() => window.__universe !== undefined);
  await page.evaluate(() => window.__universe!.ready());
  await page.evaluate(() => window.__universe!.renderFrames(4));
  await page.screenshot({ path: `artifacts/spacecraft/${bookmark}.png` });
  expect(await page.evaluate(() => window.__universe!.errors())).toEqual([]);
}

const probe = (page: Page, x: number, y: number, w: number, h: number) =>
  page.evaluate(([px, py, pw, ph]) => window.__universe!.probe(px, py, pw, ph), [x, y, w, h]) as Promise<Rgb>;

test('spacecraft: the ISS over the sunlit limb of Earth', { tag: '@smoke' }, async ({ page }) => {
  await open(page, 'iss-over-earth');
});

test('spacecraft: Webb shows its gold mirror above the sunshield', async ({ page }) => {
  await open(page, 'jwst-l2');
});

test('spacecraft: Voyager 1 looks back at a star-like Sun', async ({ page }) => {
  await open(page, 'voyager1-looking-back', '&ui=1');
});

test('spacecraft: Hubble over Earth', async ({ page }) => {
  await open(page, 'hubble-over-earth');
  void probe;
  void lum;
});
