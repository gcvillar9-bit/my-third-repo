import { expect, test, type Page } from '@playwright/test';
import { decode } from 'fast-png';

/**
 * terrain bookmarks at 480×270 potato. The quadtree converges inside ready() in test mode (the
 * per-frame split budget is lifted), so each test renders once, waits again, then renders the
 * frames that are screenshotted and probed. Budgets: ≤ 400 draw calls, ≤ 3M triangles.
 */
type RGB = [number, number, number];
const lum = ([r, g, b]: RGB) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

async function open(page: Page, bookmark: string, problems: string[], shot = true) {
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
  const png = await page.screenshot(shot ? { path: `artifacts/terrain/${bookmark}.png` } : {});
  const probe = (x: number, y: number, w: number, h: number) =>
    page.evaluate(([a, b, c, d]) => window.__universe!.probe(a, b, c, d), [
      x,
      y,
      w,
      h,
    ] as const) as Promise<RGB>;
  const stats = await page.evaluate(() => window.__universe!.stats());
  const errors = await page.evaluate(() => window.__universe!.errors());
  return { probe, stats, errors, png };
}

function budgets(stats: { calls: number; triangles: number }) {
  expect(stats.calls).toBeLessThanOrEqual(400);
  expect(stats.triangles).toBeLessThanOrEqual(3e6);
  expect(stats.triangles).toBeGreaterThan(20_000); // terrain tiles are drawn (≈2.3k triangles each)
}

test('moon-low-orbit: lit cratered terrain below a dark sky', { tag: '@smoke' }, async ({ page }) => {
  const problems: string[] = [];
  const { probe, stats, errors } = await open(page, 'moon-low-orbit', problems);
  expect(errors).toEqual([]);
  expect(problems).toEqual([]);
  const sky = lum(await probe(10, 4, 460, 30));
  const ground = lum(await probe(140, 220, 200, 40));
  expect(sky).toBeLessThan(0.01);
  expect(ground).toBeGreaterThan(0.02);
  expect(ground).toBeGreaterThan(5 * Math.max(sky, 1e-3));
  budgets(stats);
});

test('apollo11-2m: horizon with lit regolith below and black sky above', async ({ page }) => {
  const problems: string[] = [];
  const { probe, stats, errors } = await open(page, 'apollo11-2m', problems);
  expect(errors).toEqual([]);
  expect(problems).toEqual([]);
  // Earth sits near the top centre; probe the sky in the top corners.
  const sky = Math.max(lum(await probe(4, 4, 60, 30)), lum(await probe(416, 4, 60, 30)));
  const ground = lum(await probe(140, 240, 200, 26));
  expect(sky).toBeLessThan(0.01);
  expect(ground).toBeGreaterThan(0.02);
  expect(ground).toBeGreaterThan(5 * Math.max(sky, 1e-3));
  budgets(stats);
});

test('jitter: renders 1 mm apart differ by < 1% mean', async ({ page }) => {
  const problems: string[] = [];
  const a = await open(page, 'terrain-jitter-a', problems, false);
  const b = await open(page, 'terrain-jitter-b', problems, false);
  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
  expect(problems).toEqual([]);
  const ia = decode(a.png);
  const ib = decode(b.png);
  expect(ia.width).toBe(ib.width);
  let sum = 0;
  let diff = 0;
  const ch = ia.channels;
  for (let i = 0; i < ia.data.length; i++) {
    if (i % ch === 3) continue;
    sum += ia.data[i];
    diff += Math.abs(ia.data[i] - ib.data[i]);
  }
  expect(sum).toBeGreaterThan(0);
  expect(diff / sum).toBeLessThan(0.01);
});
