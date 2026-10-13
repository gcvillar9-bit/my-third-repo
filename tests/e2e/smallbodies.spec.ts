import { expect, test } from '@playwright/test';

/**
 * smallbodies at 480x270 potato. asteroid-belt-3au: inside the main belt 0.12 AU above the ecliptic,
 * looking prograde; 20,000 GPU-propagated points (potato), visibility-enhanced, densest upper left.
 */
type RGB = [number, number, number];
const lum = ([r, g, b]: RGB) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

test('asteroid-belt-3au: many belt points, no errors, budgets', { tag: '@smoke' }, async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.goto('?test=1&q=potato&b=asteroid-belt-3au');
  await page.waitForFunction(() => window.__universe !== undefined);
  await page.evaluate(async () => {
    await window.__universe!.ready();
    await window.__universe!.renderFrames(4);
  });
  await page.screenshot({ path: 'artifacts/smallbodies/asteroid-belt-3au.png' });
  const stats = await page.evaluate(() => window.__universe!.stats());
  const errors = await page.evaluate(() => window.__universe!.errors());
  expect(errors).toEqual([]);
  expect(problems).toEqual([]);
  expect(stats.points).toBeGreaterThanOrEqual(20000);
  expect(stats.calls).toBeLessThanOrEqual(150);
  // The belt is densest towards the upper left (the inner belt along the ecliptic): count 16x16 px
  // cells there clearly above the star background.
  let lit = 0;
  for (let y = 16; y < 160; y += 16)
    for (let x = 0; x < 320; x += 16) {
      const v = lum(
        (await page.evaluate(([a, b]) => window.__universe!.probe(a, b, 16, 16), [x, y] as const)) as RGB,
      );
      if (v > 0.01) lit++;
    }
  expect(lit).toBeGreaterThan(60); // of 180 cells
});
