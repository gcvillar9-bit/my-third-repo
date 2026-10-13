import { expect, test, type Page } from '@playwright/test';

/**
 * solar-system bookmarks at 480×270 potato (look targets live on the bookmarks). Textures load
 * lazily on the first frame a body is resolved, so each test renders once, waits for ready()
 * again, then renders the frames that are screenshotted and probed.
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
  await page.screenshot({ path: `artifacts/solar-system/${bookmark}.png` });
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

test('earth-now: lit day side right, night side left', { tag: '@smoke' }, async ({ page }) => {
  const problems: string[] = [];
  const { probe, stats, errors } = await open(page, 'earth-now', problems);
  expect(errors).toEqual([]);
  expect(problems).toEqual([]);
  const day = lum(await probe(285, 125, 20, 20));
  const night = lum(await probe(175, 125, 20, 20));
  const sky = lum(await probe(4, 4, 30, 30));
  expect(day).toBeGreaterThan(0.02);
  expect(day).toBeGreaterThan(5 * Math.max(night, 1e-3));
  expect(sky).toBeLessThan(0.01);
  const [r, , b] = await probe(285, 125, 20, 20);
  expect(r + b).toBeGreaterThan(0); // textured surface, not a NaN/black hole
  expect(stats.calls).toBeLessThanOrEqual(150);
});

test('saturn: planet at the centre within budget', async ({ page }) => {
  const problems: string[] = [];
  const { probe, stats, errors } = await open(page, 'saturn', problems);
  expect(errors).toEqual([]);
  expect(problems).toEqual([]);
  const centre = lum(await probe(230, 125, 20, 20));
  const corner = lum(await probe(4, 4, 30, 30));
  expect(centre).toBeGreaterThan(0.02);
  expect(centre).toBeGreaterThan(10 * Math.max(corner, 1e-3));
  const [r, , b] = await probe(220, 115, 40, 40);
  expect(r).toBeGreaterThan(b); // Saturn is butterscotch, not blue
  expect(stats.calls).toBeLessThanOrEqual(150);
});

test('jupiter-moons: Jupiter bright at the centre, moon orbits drawn', async ({ page }) => {
  const problems: string[] = [];
  const { probe, stats, errors } = await open(page, 'jupiter-moons', problems);
  expect(errors).toEqual([]);
  expect(problems).toEqual([]);
  const centre = lum(await probe(234, 129, 12, 12));
  const ring = lum(await probe(40, 20, 400, 230));
  const corner = lum(await probe(0, 0, 20, 20));
  expect(centre).toBeGreaterThan(0.05);
  expect(ring).toBeGreaterThan(corner); // orbit lines and moon points add light around Jupiter
  expect(stats.calls).toBeLessThanOrEqual(150);
});

test('solar-system-overview: Sun at the centre, orbits around it', { tag: '@smoke' }, async ({ page }) => {
  const problems: string[] = [];
  const { probe, stats, errors } = await open(page, 'solar-system-overview', problems);
  expect(errors).toEqual([]);
  expect(problems).toEqual([]);
  const sun = lum(await probe(236, 131, 8, 8));
  const field = lum(await probe(0, 0, 480, 270));
  expect(sun).toBeGreaterThan(0.3);
  expect(field).toBeGreaterThan(0.001);
  expect(stats.calls).toBeLessThanOrEqual(150);
});
