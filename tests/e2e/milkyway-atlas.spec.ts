import { expect, test, type Page } from '@playwright/test';

/**
 * Milky Way atlas: guides (outlines, lines, markers) and real light (cluster member stars) at
 * their measured places. 480x270 on potato, no UI. Each test renders a view twice, with a switch
 * on and off (URL overrides), and compares 16 px cells: `lit` counts the cells that the switch
 * brightens, `rgb` sums what it adds there, so the assertions do not depend on the galaxy behind.
 */
type Rgb = [number, number, number];
const lum = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const COLS = 30;
const ROWS = 16;

async function cells(page: Page, bookmark: string, query: string, problems: string[]): Promise<Rgb[]> {
  page.removeAllListeners('console');
  page.removeAllListeners('pageerror');
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.goto(`?test=1&q=potato&${query}&b=${bookmark}`);
  await page.waitForFunction(() => window.__universe !== undefined);
  await page.evaluate(() => window.__universe!.ready());
  await page.evaluate(() => window.__universe!.renderFrames(4));
  expect(await page.evaluate(() => window.__universe!.errors())).toEqual([]);
  expect((await page.evaluate(() => window.__universe!.stats())).calls).toBeLessThanOrEqual(400);
  return page.evaluate(
    async ([cols, rows]) => {
      const out: [number, number, number][] = [];
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < cols; x++) out.push(await window.__universe!.probe(x * 16, y * 16, 16, 16));
      return out;
    },
    [COLS, ROWS] as const,
  );
}

/** Cells that are brighter in `on` than in `off`, and the summed colour difference there. */
function added(on: Rgb[], off: Rgb[], threshold = 0.003) {
  const lit: number[] = [];
  const rgb: Rgb = [0, 0, 0];
  on.forEach((c, i) => {
    if (lum(c) - lum(off[i]) <= threshold) return;
    lit.push(i);
    for (let k = 0; k < 3; k++) rgb[k] += c[k] - off[i][k];
  });
  return { lit, rgb };
}
const rowOf = (i: number) => Math.floor(i / COLS);
const colOf = (i: number) => i % COLS;

test(
  'atlas: mw-bubbles outlines the bubbles above and below the disc',
  { tag: '@smoke' },
  async ({ page }) => {
    const problems: string[] = [];
    const on = await cells(page, 'mw-bubbles', '', problems);
    await page.screenshot({ path: 'artifacts/milkyway/mw-bubbles.png' });
    const off = await cells(page, 'mw-bubbles', 'milkyway.guides=off', problems);
    // Only the outlines of the bubbles: switch the stream and arm lines off as well for this pair.
    const shells = await cells(page, 'mw-bubbles', 'milkyway.guides.halo=0', problems);
    const all = added(on, off);
    const bubbles = added(shells, off);
    console.log('bubbles', { all: all.lit.length, shells: bubbles.lit.length, rgb: bubbles.rgb });
    expect(bubbles.lit.length).toBeGreaterThan(20);
    expect(all.lit.length).toBeGreaterThanOrEqual(bubbles.lit.length);
    // Violet outline: more blue and red than green.
    expect(bubbles.rgb[2]).toBeGreaterThan(1.3 * bubbles.rgb[1]);
    expect(bubbles.rgb[0]).toBeGreaterThan(bubbles.rgb[1]);
    // Lobes on both sides of the disc (row 8 holds the mid-plane), near the centre columns.
    expect(bubbles.lit.filter((i) => rowOf(i) < 7).length).toBeGreaterThan(8);
    expect(bubbles.lit.filter((i) => rowOf(i) > 9).length).toBeGreaterThan(8);
    for (const i of bubbles.lit) expect(Math.abs(colOf(i) - 14.5)).toBeLessThan(7);
    // The galaxy itself is unchanged by the guides: the bulge stays the brightest cell.
    const brightest = on.reduce((b, c, i) => (lum(c) > lum(on[b]) ? i : b), 0);
    expect(rowOf(brightest)).toBeGreaterThanOrEqual(7);
    expect(rowOf(brightest)).toBeLessThanOrEqual(9);
    expect(problems).toEqual([]);
  },
);

test('atlas: mw-halo-streams draws stream tracks around the galaxy', async ({ page }) => {
  const problems: string[] = [];
  const on = await cells(page, 'mw-halo-streams', '', problems);
  await page.screenshot({ path: 'artifacts/milkyway/mw-halo-streams.png' });
  const off = await cells(page, 'mw-halo-streams', 'milkyway.guides=off', problems);
  const noHalo = await cells(page, 'mw-halo-streams', 'milkyway.guides.halo=0', problems);
  const all = added(on, off);
  const rest = added(noHalo, off);
  console.log('streams', { all: all.lit.length, withoutHalo: rest.lit.length, rgb: all.rgb });
  expect(all.lit.length).toBeGreaterThan(40);
  // Most of it is the halo group (streams, Magellanic gas), and it spreads well beyond the disc.
  expect(all.lit.length).toBeGreaterThan(rest.lit.length + 25);
  expect(new Set(all.lit.map(colOf)).size).toBeGreaterThan(12);
  expect(new Set(all.lit.map(rowOf)).size).toBeGreaterThan(8);
  // Stream lines are green: they add more green than red.
  expect(all.rgb[1]).toBeGreaterThan(all.rgb[0]);
  expect(problems).toEqual([]);
});

test('atlas: mw-local-bubble shows the shell around the Sun only with the guides on', async ({ page }) => {
  const problems: string[] = [];
  // This bookmark switches the guides on when it is the initial view (the camera is 600 pc from the Sun).
  const on = await cells(page, 'mw-local-bubble', '', problems);
  await page.screenshot({ path: 'artifacts/milkyway/mw-local-bubble.png' });
  const off = await cells(page, 'mw-local-bubble', 'milkyway.guides=off', problems);
  const auto = await cells(page, 'mw-local-bubble', 'milkyway.guides=auto', problems);
  const shell = added(on, off);
  console.log('local bubble', { lit: shell.lit.length, rgb: shell.rgb, auto: added(auto, off).lit.length });
  expect(shell.lit.length).toBeGreaterThan(120);
  // Blue shell: more blue than red.
  expect(shell.rgb[2]).toBeGreaterThan(1.4 * shell.rgb[0]);
  // The shell surrounds the centre of the view.
  expect(shell.lit.filter((i) => colOf(i) < 13).length).toBeGreaterThan(20);
  expect(shell.lit.filter((i) => colOf(i) > 16).length).toBeGreaterThan(20);
  // In the default mode nothing is drawn this close to the Sun.
  expect(added(auto, off).lit.length).toBe(0);
  expect(problems).toEqual([]);
});

test('atlas: mw-pleiades-cluster adds real member stars to the cluster', async ({ page }) => {
  const problems: string[] = [];
  const on = await cells(page, 'mw-pleiades-cluster', 'milkyway.guides=off', problems);
  await page.screenshot({ path: 'artifacts/milkyway/mw-pleiades-cluster.png' });
  const off = await cells(page, 'mw-pleiades-cluster', 'milkyway.guides=off&milkyway.atlasLight=0', problems);
  const stars = added(on, off, 0.002);
  console.log('pleiades', { lit: stars.lit.length, rgb: stars.rgb });
  // Gaia members that the bright-star catalogue does not hold: a few cells, all near the cluster.
  expect(stars.lit.length).toBeGreaterThan(2);
  for (const i of stars.lit) {
    expect(Math.abs(colOf(i) - 14.5)).toBeLessThan(11);
  }
  // The bright stars of the cluster (already in the star catalogue) light the centre either way.
  const centre = (g: Rgb[]) =>
    Math.max(...[7, 8].flatMap((r) => [13, 14, 15, 16].map((c) => lum(g[r * COLS + c]))));
  expect(centre(off)).toBeGreaterThan(0.05);
  expect(centre(on)).toBeGreaterThanOrEqual(centre(off));
  expect(problems).toEqual([]);
});
