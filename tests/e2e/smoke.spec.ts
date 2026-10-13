import { expect, test } from '@playwright/test';

/** Boot smoke test: the page loads under the Pages subpath and renders with WebGL2. */
test('boot renders a WebGL2 frame without errors', { tag: '@smoke' }, async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));

  // Relative URL: resolves against baseURL (http://127.0.0.1:<port>/my-third-repo/).
  await page.goto('?test=1&q=potato');
  await page.waitForFunction(() => window.__universe !== undefined);
  await page.evaluate(() => window.__universe!.ready());
  await page.evaluate(() => window.__universe!.renderFrames(2));

  const canvas = page.locator('#app canvas');
  await expect(canvas).toHaveCount(1);
  const webgl2 = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('#app canvas');
    return !!c && c.getContext('webgl2') !== null;
  });
  expect(webgl2).toBe(true);

  const stats = await page.evaluate(() => window.__universe!.stats());
  expect(stats.frame).toBeGreaterThanOrEqual(2);

  // Default start is earth-dawn-400km (EV 13.5): the frame must be finite and not blown out.
  const [r, g, b] = await page.evaluate(() => window.__universe!.probe(0, 0, 480, 270));
  expect(Number.isFinite(r + g + b)).toBe(true);
  expect(r + g + b).toBeGreaterThan(0);
  expect(r + g + b).toBeLessThan(1.5);

  await page.screenshot({ path: 'artifacts/smoke/boot.png' });
  expect(await page.evaluate(() => window.__universe!.errors())).toEqual([]);
  expect(problems).toEqual([]);
});
