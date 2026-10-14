import { expect, test, type Page } from '@playwright/test';

/**
 * Constellation lines in true 3D. Star labels (?ui=1) give the projected CSS position of named stars,
 * so the probe lands on the line between two of them: a straight 3D segment projects to a straight line.
 */
type Rgb = [number, number, number];
const lum = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const probe = (page: Page, x: number, y: number, w: number, h: number) =>
  page.evaluate(([a, b, c, d]) => window.__universe!.probe(a, b, c, d), [x, y, w, h] as const);

async function open(page: Page, bookmark: string): Promise<void> {
  await page.goto(`?test=1&q=potato&ui=1&b=${bookmark}`);
  await page.waitForFunction(() => window.__universe !== undefined);
  await page.evaluate(() => window.__universe!.ready());
  await page.evaluate(() => window.__universe!.renderFrames(4));
  await page.screenshot({ path: `artifacts/starsystems/${bookmark}.png` });
  expect(await page.evaluate(() => window.__universe!.errors())).toEqual([]);
}

async function labelPos(page: Page, id: string): Promise<[number, number]> {
  const el = page.locator(`.cz-label[data-label-id="${id}"]`);
  await expect(el).toHaveCount(1);
  const [x, y] = await el.evaluate((n: HTMLElement) => [Number(n.dataset.x), Number(n.dataset.y)]);
  return [x, y];
}

/** Brightest 3x3 probe along a short perpendicular scan through the midpoint of a-b (line is ~1 px). */
async function lineAt(page: Page, a: [number, number], b: [number, number]): Promise<number> {
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const nx = -(b[1] - a[1]) / len;
  const ny = (b[0] - a[0]) / len;
  let best = 0;
  for (let k = -2; k <= 2; k++)
    best = Math.max(best, lum(await probe(page, mx + k * nx - 1, my + k * ny - 1, 3, 3)));
  return best;
}

async function budgets(page: Page): Promise<void> {
  const stats = await page.evaluate(() => window.__universe!.stats());
  expect(stats.calls).toBeLessThanOrEqual(150);
  expect(stats.lines).toBeGreaterThan(0);
  expect(stats.points).toBeGreaterThan(0);
}

/** Screen-space Orion shape: |Betelgeuse - Saiph| / |Rigel - Saiph| (labels always shown at m < 2.5). */
async function orion(page: Page) {
  const bet = await labelPos(page, 'hip:27989');
  const rig = await labelPos(page, 'hip:24436');
  const sai = await labelPos(page, 'hip:27366');
  const ratio = Math.hypot(bet[0] - sai[0], bet[1] - sai[1]) / Math.hypot(rig[0] - sai[0], rig[1] - sai[1]);
  return { bet, rig, sai, ratio };
}

test('starsystems: orion lines from Earth, then broken from 200 ly', { tag: '@smoke' }, async ({ page }) => {
  await open(page, 'orion-lines-from-earth');
  const earth = await orion(page);
  // North up: Betelgeuse upper left of Rigel, Saiph lower left of Rigel.
  expect(earth.bet[0]).toBeLessThan(earth.rig[0]);
  expect(earth.bet[1]).toBeLessThan(earth.rig[1]);
  expect(earth.sai[1]).toBeGreaterThan(earth.bet[1]);
  // Saiph-Rigel is a segment of the figure: lit at its midpoint, dark sky well beside it.
  const on = await lineAt(page, earth.sai, earth.rig);
  expect(on).toBeGreaterThan(0.01);
  const off = lum(
    await probe(page, (earth.bet[0] + earth.rig[0]) / 2 + 40, (earth.bet[1] + earth.rig[1]) / 2 + 40, 3, 3),
  );
  expect(on).toBeGreaterThan(2 * off);
  await budgets(page);

  await open(page, 'orion-from-200ly');
  const far = await orion(page);
  expect(await lineAt(page, far.sai, far.rig)).toBeGreaterThan(0.01);
  // The stars sit 150-265 pc away, so 200 ly of sideways parallax changes the figure's proportions.
  expect(Math.abs(far.ratio / earth.ratio - 1)).toBeGreaterThan(0.2);
  await budgets(page);
});
