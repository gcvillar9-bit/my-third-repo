import { expect, test, type Page } from '@playwright/test';

/**
 * Black holes: lensing ScreenPass, disks, Cyg X-1 binary, dormant-hole lensing. Every bookmark
 * looks straight at its hole, so the hole sits at the canvas centre (240, 135).
 */
type Rgb = [number, number, number];
const W = 480;
const H = 270;
const probe = (page: Page, x: number, y: number, w: number, h: number) =>
  page.evaluate(([a, b, c, d]) => window.__universe!.probe(a, b, c, d), [x, y, w, h] as const);
const lum = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

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
  await page.screenshot({ path: `artifacts/blackholes/${bookmark}.png` });
  return problems;
}

/** Brightest mean luminance of small probes on a circle of radius r around the centre. */
async function ringMax(page: Page, r: number): Promise<number> {
  let best = 0;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * 2 * Math.PI;
    const x = Math.round(W / 2 + r * Math.cos(a)) - 2;
    const y = Math.round(H / 2 + r * Math.sin(a)) - 2;
    best = Math.max(best, lum(await probe(page, x, y, 4, 4)));
  }
  return best;
}

/** Brightest block of a coarse grid over the canvas (returns its luminance and colour). */
async function gridMax(page: Page, cell: number): Promise<{ l: number; c: Rgb }> {
  let best = { l: 0, c: [0, 0, 0] as Rgb };
  for (let y = 0; y + cell <= H; y += cell)
    for (let x = 0; x + cell <= W; x += cell) {
      const c = await probe(page, x, y, cell, cell);
      if (lum(c) > best.l) best = { l: lum(c), c };
    }
  return best;
}

test(
  'blackholes: sgra-lensing shows a dark shadow inside a bright ring, within budget',
  { tag: '@smoke' },
  async ({ page }) => {
    const problems = await open(page, 'sgra-lensing');
    expect(await page.evaluate(() => window.__universe!.errors())).toEqual([]);
    const centre = lum(await probe(page, W / 2 - 2, H / 2 - 2, 4, 4));
    let ring = 0;
    for (const r of [26, 30, 34, 40, 48]) ring = Math.max(ring, await ringMax(page, r));
    expect(ring).toBeGreaterThan(0.1);
    expect(centre).toBeLessThan(0.02 * ring);
    const stats = await page.evaluate(() => window.__universe!.stats());
    expect(stats.calls).toBeLessThanOrEqual(400);
    expect(problems).toEqual([]);
  },
);

test('blackholes: m87-shadow is a face-on ring around a dark centre', async ({ page }) => {
  const problems = await open(page, 'm87-shadow');
  expect(await page.evaluate(() => window.__universe!.errors())).toEqual([]);
  const centre = lum(await probe(page, W / 2 - 2, H / 2 - 2, 4, 4));
  let ring = 0;
  for (const r of [18, 22, 26, 32]) ring = Math.max(ring, await ringMax(page, r));
  expect(ring).toBeGreaterThan(0.1);
  expect(centre).toBeLessThan(0.02 * ring);
  expect(problems).toEqual([]);
});

test('blackholes: cygx1-disk shows the blue supergiant, stream and disk', async ({ page }) => {
  const problems = await open(page, 'cygx1-disk');
  expect(await page.evaluate(() => window.__universe!.errors())).toEqual([]);
  const best = await gridMax(page, 30);
  expect(best.l).toBeGreaterThan(0.3);
  // A 31 000 K photosphere is blue-white.
  expect(best.c[2]).toBeGreaterThan(best.c[0]);
  const stats = await page.evaluate(() => window.__universe!.stats());
  expect(stats.calls).toBeLessThanOrEqual(400);
  expect(problems).toEqual([]);
});

test('blackholes: gaia-bh3-dormant lenses the star field around a black shadow', async ({ page }) => {
  const problems = await open(page, 'gaia-bh3-dormant');
  expect(await page.evaluate(() => window.__universe!.errors())).toEqual([]);
  // Shadow radius about 3.7 deg, 16 px at this field of view.
  expect(lum(await probe(page, W / 2 - 4, H / 2 - 4, 8, 8))).toBeLessThan(0.002);
  const best = await gridMax(page, 20);
  expect(best.l).toBeGreaterThan(0.002);
  expect(problems).toEqual([]);
});
