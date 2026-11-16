import { expect, test, type Page } from '@playwright/test';

/**
 * Measured dust and star-forming regions in the galaxy volume (Edenhofer et al. 2024 near the
 * Sun). 480x270 on potato, guides off. Each view is rendered with the measured inputs on and off
 * (`?milkyway.measured=0`) and compared in 16 px cells.
 */
type Rgb = [number, number, number];
const lum = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const COLS = 30;
const ROWS = 16;

async function cells(page: Page, bookmark: string, query: string, problems: string[]): Promise<number[]> {
  page.removeAllListeners('console');
  page.removeAllListeners('pageerror');
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.goto(`?test=1&q=potato&milkyway.guides=off&${query}&b=${bookmark}`);
  await page.waitForFunction(() => window.__universe !== undefined);
  await page.evaluate(() => window.__universe!.ready());
  await page.evaluate(() => window.__universe!.renderFrames(4));
  expect(await page.evaluate(() => window.__universe!.errors())).toEqual([]);
  expect((await page.evaluate(() => window.__universe!.stats())).calls).toBeLessThanOrEqual(400);
  const rgb = await page.evaluate(
    async ([cols, rows]) => {
      const out: [number, number, number][] = [];
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < cols; x++) out.push(await window.__universe!.probe(x * 16, y * 16, 16, 16));
      return out;
    },
    [COLS, ROWS] as const,
  );
  return rgb.map(lum);
}
const rowOf = (i: number) => Math.floor(i / COLS);
const colOf = (i: number) => i % COLS;
/** Distance of a cell from the centre of the view, in cells. */
const fromCentre = (i: number) => Math.hypot(colOf(i) - 14.5, rowOf(i) - 7.9);

test(
  'dust: mw-local-dust shows measured clouds around the Sun and a clear Local Bubble',
  { tag: '@smoke' },
  async ({ page }) => {
    const problems: string[] = [];
    const on = await cells(page, 'mw-local-dust', '', problems);
    await page.screenshot({ path: 'artifacts/milkyway/mw-local-dust.png' });
    const off = await cells(page, 'mw-local-dust', 'milkyway.measured=0', problems);
    // The measured map is a circle of 1.2 kpc radius: 8.6 cells at this height and field of view.
    const inside = on.map((_, i) => i).filter((i) => fromCentre(i) < 7.5);
    const ratio = inside.map((i) => on[i] / off[i]);
    const darker = ratio.filter((r) => r < 0.93).length;
    const brighter = ratio.filter((r) => r > 1.04).length;
    // The four cells at the Sun against the cells of the measured circle, in the measured render.
    const sorted = inside.map((i) => on[i]).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const centre = [7, 8].flatMap((r) => [14, 15].map((c) => on[r * COLS + c] / median));
    console.log(
      'local dust',
      JSON.stringify({
        cells: inside.length,
        darker,
        brighter,
        min: Math.min(...ratio),
        max: Math.max(...ratio),
        centre,
        darkest: sorted[0] / median,
      }),
    );
    // Real clouds: many cells are clearly darker than the smooth model and others are clearer.
    expect(darker).toBeGreaterThan(15);
    expect(brighter).toBeGreaterThan(6);
    expect(Math.min(...ratio)).toBeLessThan(0.8);
    // The Sun sits in the Local Bubble, a patch with little dust: clearer than the typical cell,
    // while the darkest cloud cell is clearly darker than it.
    expect(centre.reduce((a, b) => a + b, 0) / 4).toBeGreaterThan(1.0);
    expect(sorted[0] / median).toBeLessThan(0.85);
    expect(problems).toEqual([]);
  },
);

test('dust: mw-dark-clouds shows dark clouds across the band towards the Galactic centre', async ({
  page,
}) => {
  const problems: string[] = [];
  const on = await cells(page, 'mw-dark-clouds', '', problems);
  await page.screenshot({ path: 'artifacts/milkyway/mw-dark-clouds.png' });
  const off = await cells(page, 'mw-dark-clouds', 'milkyway.measured=0', problems);
  // The band lies across the middle rows.
  const band = on.map((_, i) => i).filter((i) => rowOf(i) >= 6 && rowOf(i) <= 9);
  const ratio = band.map((i) => on[i] / off[i]);
  const darker = ratio.filter((r) => r < 0.85).length;
  const brighter = ratio.filter((r) => r > 1.1).length;
  const sky = on.map((_, i) => i).filter((i) => rowOf(i) <= 1);
  const skyChange = Math.max(...sky.map((i) => Math.abs(on[i] - off[i])));
  console.log(
    'dark clouds',
    JSON.stringify({
      band: band.length,
      darker,
      brighter,
      min: Math.min(...ratio),
      max: Math.max(...ratio),
      skyChange,
    }),
  );
  // Measured clouds darken parts of the band and leave other parts clearer than the smooth lane.
  expect(darker).toBeGreaterThan(5);
  expect(brighter).toBeGreaterThan(3);
  expect(Math.min(...ratio)).toBeLessThan(0.75);
  // The band is still there, brighter than the sky above it.
  const mean = (idx: number[], v: number[]) => idx.reduce((a, i) => a + v[i], 0) / idx.length;
  expect(mean(band, on)).toBeGreaterThan(2 * mean(sky, on));
  expect(problems).toEqual([]);
});
