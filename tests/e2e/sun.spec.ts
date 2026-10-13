import { expect, test, type Page } from '@playwright/test';

/**
 * sun at 480x270 potato. sun-closeup: 21,000 km above the photosphere looking 50 deg off nadir;
 * granulation fills the frame (cells largest at the bottom), black space above the limb at the top.
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
  await page.screenshot({ path: `artifacts/sun/${bookmark}.png` });
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

test(
  'sun-closeup: granulated photosphere with contrast, space above the limb',
  { tag: '@smoke' },
  async ({ page }) => {
    const problems: string[] = [];
    const { probe, stats, errors } = await open(page, 'sun-closeup', problems);
    expect(errors).toEqual([]);
    expect(problems).toEqual([]);
    // A row of 3x3 px samples across the lower frame, where granules span several pixels.
    const row: number[] = [];
    for (let x = 40; x < 440; x += 5) row.push(lum(await probe(x, 228, 3, 3)));
    const mean = row.reduce((a, b) => a + b, 0) / row.length;
    let hp = 0;
    for (let i = 1; i < row.length; i++) hp += Math.abs(row[i] - row[i - 1]);
    hp /= (row.length - 1) * mean;
    expect(mean).toBeGreaterThan(0.08); // bright photosphere
    expect(hp).toBeGreaterThan(0.025); // granulation: neighbouring samples differ by several percent
    const space = lum(await probe(180, 1, 120, 4));
    expect(space).toBeLessThan(0.2 * mean); // above the limb
    expect(stats.calls).toBeLessThanOrEqual(150);
  },
);
