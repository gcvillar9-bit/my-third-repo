import { expect, test, type Page } from '@playwright/test';

/**
 * Galaxy portraits: 3D emission/absorption models of the named galaxies, seen up close.
 * 480x270 on potato, no UI; probes are mean linear RGB over CSS-pixel rectangles.
 */
type Rgb = [number, number, number];
const lum = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const probeAt = async (page: Page, x: number, y: number, r = 2) =>
  lum(
    await page.evaluate(([a, b, c, d]) => window.__universe!.probe(a, b, c, d), [
      x - r,
      y - r,
      2 * r,
      2 * r,
    ] as const),
  );

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
  await page.screenshot({ path: `artifacts/galaxies/${bookmark}.png` });
  return problems;
}

async function budgets(page: Page, problems: string[]): Promise<void> {
  expect(await page.evaluate(() => window.__universe!.errors())).toEqual([]);
  const stats = await page.evaluate(() => window.__universe!.stats());
  expect(stats.calls).toBeLessThanOrEqual(400);
  expect(problems).toEqual([]);
}

/** Luminance at n points on an ellipse (semi-axes a horizontal, b vertical) around (cx, cy). */
const ring = (page: Page, cx: number, cy: number, a: number, b: number, n: number): Promise<number[]> =>
  page.evaluate(
    async ([cx, cy, a, b, n]) => {
      const out: number[] = [];
      for (let k = 0; k < n; k++) {
        const t = (2 * Math.PI * k) / n;
        const [r, g, bl] = await window.__universe!.probe(
          cx + a * Math.cos(t) - 2,
          cy + b * Math.sin(t) - 2,
          4,
          4,
        );
        out.push(0.2126 * r + 0.7152 * g + 0.0722 * bl);
      }
      return out;
    },
    [cx, cy, a, b, n] as const,
  );

const stats = (v: number[]) => {
  const mean = v.reduce((x, y) => x + y, 0) / v.length;
  const sd = Math.sqrt(v.reduce((x, y) => x + (y - mean) ** 2, 0) / v.length);
  const sorted = [...v].sort((x, y) => x - y);
  return { mean, cv: sd / mean, median: sorted[v.length >> 1], max: sorted[v.length - 1] };
};

test('galaxy portraits: whirlpool shows contrasted spiral arms', { tag: '@smoke' }, async ({ page }) => {
  const t0 = Date.now();
  const problems = await open(page, 'whirlpool');
  // M51 spans 60% of the width (radius 144 px), inclined ~56 deg: mid-radius ellipse 72 x 40 px.
  const mid = stats(await ring(page, 240, 135, 72, 40, 32));
  const centre = await probeAt(page, 240, 135, 3);
  console.log('whirlpool', { centre, ...mid, ms: Date.now() - t0 });
  expect(centre).toBeGreaterThan(0.2);
  expect(mid.mean).toBeGreaterThan(0.05);
  // Arms vs inter-arm along a circle of constant disc radius: a smooth disc gives cv ~0.
  expect(mid.cv).toBeGreaterThan(0.15);
  await budgets(page, problems);
});

test('galaxy portraits: sombrero shows a dark dust lane across a bright bulge', async ({ page }) => {
  const t0 = Date.now();
  const problems = await open(page, 'sombrero');
  const col: number[] = [];
  for (let y = 95; y <= 175; y += 2) col.push(await probeAt(page, 240, y, 2));
  // Darkest row relative to the rows 8 px above and below (the dust ring crossing the bulge).
  let dip = 1;
  for (let k = 4; k < col.length - 4; k++) dip = Math.min(dip, col[k] / Math.min(col[k - 4], col[k + 4]));
  const bulge = Math.max(...col);
  console.log('sombrero', col.map((v) => v.toFixed(3)).join(' '), { dip, bulge, ms: Date.now() - t0 });
  expect(bulge).toBeGreaterThan(0.3);
  expect(dip).toBeLessThan(0.85);
  await budgets(page, problems);
});

test('galaxy portraits: m87-jet shows a one-sided jet from the core', async ({ page }) => {
  const t0 = Date.now();
  const problems = await open(page, 'm87-jet');
  const centre = await probeAt(page, 240, 135, 3);
  const r50 = await ring(page, 240, 135, 50, 50, 72);
  const s = stats(r50);
  const kMax = r50.indexOf(s.max);
  const opposite = r50[(kMax + 36) % 72];
  console.log('m87', { centre, ...s, kMax, opposite, ms: Date.now() - t0 });
  expect(centre).toBeGreaterThan(0.2);
  // A narrow bright feature on one side of the core only (no counter-jet).
  expect(s.max).toBeGreaterThan(1.25 * s.median);
  expect(opposite).toBeLessThan(1.1 * s.median);
  await budgets(page, problems);
});

test('galaxy portraits: inside-m31 renders the disc from within', async ({ page }) => {
  const t0 = Date.now();
  const problems = await open(page, 'inside-m31');
  const rows: number[] = [];
  for (let y = 10; y < 270; y += 20) rows.push(await probeAt(page, 240, y, 4));
  const left = await probeAt(page, 60, 200, 6);
  const right = await probeAt(page, 420, 200, 6);
  console.log('inside', rows.map((v) => v.toFixed(3)).join(' '), { left, right, ms: Date.now() - t0 });
  // Bulge at the centre, the disc filling the lower view on both sides, dark sky above the disc.
  expect(Math.max(...rows)).toBeGreaterThan(0.3);
  expect(left).toBeGreaterThan(0.03);
  expect(right).toBeGreaterThan(0.03);
  expect(rows[0]).toBeLessThan(0.05);
  expect(rows[rows.length - 1]).toBeGreaterThan(0.03);
  await budgets(page, problems);
});
