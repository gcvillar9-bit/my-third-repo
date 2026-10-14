import { expect, test, type Page } from '@playwright/test';

/**
 * Galaxies + cosmic web (P5-A): catalogue points, oriented morphology impostors and the procedural web.
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

/** Luminance of every `cell`-px cell over the viewport (one round trip). */
const cells = (page: Page, cell: number): Promise<number[]> =>
  page.evaluate(async (c) => {
    const out: number[] = [];
    for (let y = 0; y + c <= 270; y += c)
      for (let x = 0; x + c <= 480; x += c) {
        const [r, g, b] = await window.__universe!.probe(x, y, c, c);
        out.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
      }
    return out;
  }, cell);

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

test(
  'galaxies: m31-approach shows a bright elongated galaxy at the centre',
  { tag: '@smoke' },
  async ({ page }) => {
    const problems = await open(page, 'm31-approach');
    const centre = await probeAt(page, 240, 135, 3);
    const along = ((await probeAt(page, 200, 135)) + (await probeAt(page, 280, 135))) / 2;
    const across = ((await probeAt(page, 240, 95)) + (await probeAt(page, 240, 175))) / 2;
    const corner = await probeAt(page, 20, 20, 8);
    console.log('m31', { centre, along, across, corner });
    expect(centre).toBeGreaterThan(0.2);
    expect(centre).toBeGreaterThan(3 * along);
    expect(along).toBeGreaterThan(3 * across); // inclined disc: major axis horizontal
    expect(corner).toBeLessThan(0.05);
    await budgets(page, problems);
  },
);

test('galaxies: virgo-cluster shows many galaxy points', async ({ page }) => {
  const problems = await open(page, 'virgo-cluster');
  const lit = (await cells(page, 10)).filter((v) => v > 0.01).length;
  console.log('virgo', { lit });
  expect(lit).toBeGreaterThan(40);
  await budgets(page, problems);
});

test('galaxies: cosmic-web-500mpc shows clustered (filamentary) points', async ({ page }) => {
  const problems = await open(page, 'cosmic-web-500mpc');
  const c = await cells(page, 15);
  const lit = c.filter((v) => v > 0.01).length;
  const mean = c.reduce((a, b) => a + b, 0) / c.length;
  const sd = Math.sqrt(c.reduce((a, b) => a + (b - mean) ** 2, 0) / c.length);
  console.log('web', { lit, n: c.length, mean, cv: sd / mean });
  expect(lit).toBeGreaterThan(60);
  expect(sd / mean).toBeGreaterThan(0.5); // clumpy, not a uniform haze
  await budgets(page, problems);
});
