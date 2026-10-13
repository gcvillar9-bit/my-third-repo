import { expect, test, type Page } from '@playwright/test';

/**
 * atmosphere at 480x270 potato. mars-gale-sunset: camera 2 m above Gale crater, Sun 3 deg above the
 * horizon at screen centre-bottom (about x 240, y 156), blue aureole around it, butterscotch sky away.
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
  await page.screenshot({ path: `artifacts/atmosphere/${bookmark}.png` });
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
  'mars-gale-sunset: blue sky around the low Sun, butterscotch away from it',
  { tag: '@smoke' },
  async ({ page }) => {
    const problems: string[] = [];
    const { probe, stats, errors } = await open(page, 'mars-gale-sunset', problems);
    expect(errors).toEqual([]);
    expect(problems).toEqual([]);
    const nearSun: RGB = await probe(225, 115, 30, 25);
    const away: RGB = await probe(10, 10, 60, 30);
    const ground: RGB = await probe(200, 240, 80, 20);
    expect(lum(nearSun)).toBeGreaterThan(0.02);
    expect(nearSun[2]).toBeGreaterThan(1.08 * nearSun[0]); // blue aureole 15-40 px above the Sun
    expect(away[0]).toBeGreaterThan(away[2]); // butterscotch away from it
    expect(lum(nearSun)).toBeGreaterThan(lum(away));
    expect(lum(ground)).toBeLessThan(lum(away)); // dim ground at sunset
    expect(stats.calls).toBeLessThanOrEqual(150);
  },
);
