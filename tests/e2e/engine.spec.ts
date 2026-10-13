import { expect, test, type Page } from '@playwright/test';

/**
 * Engine pipeline on the _debug sphere (frame 1e22 m from the root): log depth, photometric
 * lighting, fixed-EV exposure, bloom + AgX, test API. Look target: a sphere lit from the left
 * (left half bright, right half black) on a black background.
 */
const probe = (page: Page, x: number, y: number, w: number, h: number) =>
  page.evaluate(([a, b, c, d]) => window.__universe!.probe(a, b, c, d), [x, y, w, h] as const);
const lum = ([r, g, b]: [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

test('engine renders debug-sphere lit from the left within budget', { tag: '@smoke' }, async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));

  await page.goto('?test=1&q=potato&b=debug-sphere');
  await page.waitForFunction(() => window.__universe !== undefined);
  await page.evaluate(() => window.__universe!.ready());
  await page.evaluate(() => window.__universe!.renderFrames(4));
  await page.screenshot({ path: 'artifacts/engine/debug-sphere.png' });

  expect(await page.evaluate(() => window.__universe!.errors())).toEqual([]);

  // Sphere centred at (240, 135), radius about 83 px; light from screen-left.
  const lit = lum(await probe(page, 180, 125, 20, 20));
  const dark = lum(await probe(page, 280, 125, 20, 20));
  const sky = lum(await probe(page, 4, 4, 40, 40));
  expect(lit).toBeGreaterThan(0.02);
  expect(dark).toBeLessThan(0.004);
  expect(sky).toBeLessThan(0.004);
  expect(lit).toBeGreaterThan(10 * Math.max(dark, 1e-4));
  const [r, , b] = await probe(page, 180, 125, 20, 20);
  expect(r).toBeGreaterThanOrEqual(b); // sunlight is slightly warm in D65 sRGB

  const stats = await page.evaluate(() => window.__universe!.stats());
  expect(stats.frame).toBeGreaterThanOrEqual(4);
  expect(stats.calls).toBeGreaterThan(0);
  expect(stats.calls).toBeLessThanOrEqual(150);
  expect(stats.gpuBytes).toBeGreaterThan(0);

  // goto / setTime round trip keeps the pipeline clean.
  await page.evaluate(async () => {
    window.__universe!.setTime('2026-06-01T12:00:00Z');
    await window.__universe!.goto('debug-sphere');
    await window.__universe!.renderFrames(1);
  });
  expect(await page.evaluate(() => window.__universe!.errors())).toEqual([]);
  expect(problems).toEqual([]);
});

test('engine eye adaptation meters and darkens a bright scene (?ev=auto)', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || /meter readback failed/.test(msg.text())) warnings.push(msg.text());
  });
  await page.goto('?test=1&q=potato&b=debug-sphere&ev=auto');
  await page.waitForFunction(() => window.__universe !== undefined);
  await page.evaluate(() => window.__universe!.ready());
  await page.evaluate(() => window.__universe!.renderFrames(4));
  const before = lum(await probe(page, 180, 125, 20, 20));
  // About 1 s of simulated real time: async readbacks land and EV rises from 12 towards ~16.
  await page.evaluate(() => window.__universe!.renderFrames(60));
  const after = lum(await probe(page, 180, 125, 20, 20));
  expect(after).toBeLessThan(before * 0.8);
  expect(after).toBeGreaterThan(0.01);
  expect(await page.evaluate(() => window.__universe!.errors())).toEqual([]);
  expect(warnings).toEqual([]);
});
