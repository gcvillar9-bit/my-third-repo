import { expect, test, type Page } from '@playwright/test';

/**
 * oort (cloud part) at 480x270 potato. Both views look at the Sun with ecliptic north up
 * (src/modules/oort/cloud/bookmarks.ts).
 * - oort-cloud: the whole cloud from 170,000 AU above the north Galactic pole (dark polar sky behind it); a
 *   bright (not blown-out) inner cloud inside a faint halo.
 * - oort-spiral: the inner cloud from 24,000 AU in the ecliptic plane, on the Galactic pole's side; an
 *   untwisted ecliptic disc would be a horizontal bar, the Galactic tide's twist turns it into an S: a bar
 *   leaning from upper left to lower right whose arms turn steeper outwards.
 */
type RGB = [number, number, number];
const lum = ([r, g, b]: RGB) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

async function open(page: Page, id: string): Promise<string[]> {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.goto(`?test=1&q=potato&b=${id}`);
  await page.waitForFunction(() => window.__universe !== undefined);
  await page.evaluate(async () => {
    await window.__universe!.ready();
    await window.__universe!.renderFrames(4);
  });
  await page.screenshot({ path: `artifacts/oort/${id}.png` });
  return problems;
}

/** Mean linear luminance of a box centred `dx`, `dy` px from the screen centre. */
const probe = async (page: Page, dx: number, dy: number, size: number): Promise<number> =>
  lum(
    (await page.evaluate(([x, y, s]) => window.__universe!.probe(x, y, s, s), [
      240 + dx - size / 2,
      135 + dy - size / 2,
      size,
    ] as const)) as RGB,
  );

async function checkHealth(page: Page, problems: string[]): Promise<void> {
  const stats = await page.evaluate(() => window.__universe!.stats());
  const errors = await page.evaluate(() => window.__universe!.errors());
  expect(errors).toEqual([]);
  expect(problems).toEqual([]);
  expect(stats.points).toBeGreaterThanOrEqual(20000);
  expect(stats.calls).toBeLessThanOrEqual(150);
}

/** Probes on a ring of `n` boxes, `r` px around the screen centre. */
async function ring(page: Page, r: number, n: number, size: number): Promise<number[]> {
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    const t = (2 * Math.PI * k) / n;
    out.push(await probe(page, r * Math.cos(t), r * Math.sin(t), size));
  }
  return out;
}
const mean = (v: number[]) => v.reduce((a, b) => a + b) / v.length;

test(
  'oort-cloud: inner cloud not blown out inside a visible halo, no errors, budgets',
  { tag: '@smoke' },
  async ({ page }) => {
    const problems = await open(page, 'oort-cloud');
    await checkHealth(page, problems);
    // The inner cloud is bright but not saturated (the artificial contrast flattens the true r^-2.5 fall).
    const centre = await probe(page, 0, 0, 11);
    expect(centre).toBeGreaterThan(0.15);
    expect(centre).toBeLessThan(0.6);
    // The halo: every box 60 px out (15 degrees, about 46,000 AU in projection), and 110 px out on average
    // (about 90,000 AU; the ring crosses the scale shells there).
    expect(Math.min(...(await ring(page, 60, 8, 16)))).toBeGreaterThan(0.01);
    expect(mean(await ring(page, 110, 8, 16))).toBeGreaterThan(0.003);
    // Beyond the cloud: the dark polar sky.
    for (const [x, y] of [
      [-224, -119],
      [224, -119],
      [-224, 119],
      [224, 119],
    ])
      expect(await probe(page, x, y, 32)).toBeLessThan(0.001);
  },
);

/** Position angle (deg, clockwise from screen right) and relative amplitude of the bar on a ring. */
async function barAngle(page: Page, r: number): Promise<{ pa: number; amp: number }> {
  const n = 36;
  const v = await ring(page, r, n, 10);
  let c2 = 0;
  let s2 = 0;
  v.forEach((l, k) => {
    c2 += l * Math.cos((4 * Math.PI * k) / n);
    s2 += l * Math.sin((4 * Math.PI * k) / n);
  });
  return {
    pa: (0.5 * Math.atan2(s2, c2)) / (Math.PI / 180),
    amp: Math.hypot(c2, s2) / v.reduce((a, b) => a + b),
  };
}

test('oort-spiral: the twisted inner cloud is an S', async ({ page }) => {
  const problems = await open(page, 'oort-spiral');
  await checkHealth(page, problems);
  const quadrants = async (ox: number, oy: number, box: number) => {
    const [ul, ur, ll, lr] = [
      await probe(page, -ox, -oy, box),
      await probe(page, ox, -oy, box),
      await probe(page, -ox, oy, box),
      await probe(page, ox, oy, box),
    ];
    return { min: Math.min(ul, ur, ll, lr), ratio: (ul + lr) / (ur + ll) };
  };
  const corners: number[] = [];
  for (const [x, y] of [
    [-220, -115],
    [220, -115],
    [-220, 115],
    [220, 115],
  ])
    corners.push(await probe(page, x, y, 32));
  // Measured: 3.7 near the Sun, 2.3 along the arms. Near the Sun (about 3,000 AU out) and along the arms (about 6,000-8,000 AU): an untwisted ecliptic disc
  // would be a horizontal bar here, (UL + LR) / (UR + LL) = 1; the twist puts the bar and arms in UL and LR.
  const near = await quadrants(28, 28, 40);
  const arms = await quadrants(60, 45, 48);
  expect(near.min).toBeGreaterThan(8 * Math.min(...corners));
  expect(near.ratio).toBeGreaterThan(2.5);
  expect(arms.ratio).toBeGreaterThan(1.7);
  // The S: the bar turns clockwise on screen (steeper) from the core (about 2,000 AU) to the arms (6,000 AU);
  // measured 33 and 51 degrees.
  const inner = await barAngle(page, 20);
  const outer = await barAngle(page, 60);
  expect(inner.amp).toBeGreaterThan(0.2);
  expect(outer.amp).toBeGreaterThan(0.2);
  expect(inner.pa).toBeGreaterThan(15);
  expect(outer.pa - inner.pa).toBeGreaterThan(7);
});
