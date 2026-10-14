import { expect, test, type Page } from '@playwright/test';

/**
 * largescale: the Laniakea outline and the Great Attractor flow lines (overlay diagram).
 * 480x270 on potato, no UI; probes are mean linear RGB over CSS-pixel rectangles.
 */
type Rgb = [number, number, number];

/** Mean RGB of every `cell`-px cell over the viewport (one round trip). */
const cells = (page: Page, cell: number): Promise<Rgb[]> =>
  page.evaluate(async (c) => {
    const out: [number, number, number][] = [];
    for (let y = 0; y + c <= 270; y += c)
      for (let x = 0; x + c <= 480; x += c) out.push(await window.__universe!.probe(x, y, c, c));
    return out;
  }, cell);
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
  await page.screenshot({ path: `artifacts/largescale/${bookmark}.png` });
  return problems;
}

async function budgets(page: Page, problems: string[]): Promise<void> {
  expect(await page.evaluate(() => window.__universe!.errors())).toEqual([]);
  const stats = await page.evaluate(() => window.__universe!.stats());
  expect(stats.calls).toBeLessThanOrEqual(400);
  expect(problems).toEqual([]);
}

test(
  'largescale: great-attractor shows many flow lines converging on a bright knot',
  { tag: '@smoke' },
  async ({ page }) => {
    const problems = await open(page, 'great-attractor');
    const c = await cells(page, 10);
    const lit = c.filter((v) => lum(v) > 0.01).length;
    const peak = Math.max(...c.map(lum));
    // Flow lines are blue-to-gold: lit cells with a clear blue excess exist (galaxies are near white).
    const blue = c.filter((v) => lum(v) > 0.01 && v[2] > 1.3 * v[0]).length;
    console.log('great-attractor', { lit, peak, blue, cells: c.length });
    expect(lit).toBeGreaterThan(200);
    expect(blue).toBeGreaterThan(40);
    expect(peak).toBeGreaterThan(0.2);
    await budgets(page, problems);
  },
);

test('largescale: laniakea shows the outline and the flows in frame', async ({ page }) => {
  const problems = await open(page, 'laniakea');
  const c = await cells(page, 10);
  const lit = c.filter((v) => lum(v) > 0.01).length;
  // The outline is in frame: the border cells stay mostly dark.
  const border = c.filter((_, i) => i % 48 === 0 || i % 48 === 47 || i < 48 || i >= c.length - 48);
  const edgeLit = border.filter((v) => lum(v) > 0.05).length;
  console.log('laniakea', { lit, edgeLit, border: border.length });
  expect(lit).toBeGreaterThan(150);
  expect(edgeLit).toBeLessThan(border.length / 3);
  await budgets(page, problems);
});
