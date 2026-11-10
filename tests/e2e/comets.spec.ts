import { expect, test, type Page } from '@playwright/test';

/**
 * comets at 480x270 potato. The head's screen position comes from the comet's label (data-x / data-y are
 * the projected nucleus), so the probes follow the bookmark geometry: tail views put the anti-sunward axis
 * 24 degrees above screen-right, with the dust tail curving away below it.
 */
type Rgb = [number, number, number];
const lum = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

async function open(page: Page, bookmark: string): Promise<string[]> {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.goto(`?test=1&q=potato&ui=1&b=${bookmark}`);
  await page.waitForFunction(() => window.__universe !== undefined);
  await page.evaluate(async () => {
    await window.__universe!.ready();
    await window.__universe!.renderFrames(4);
  });
  // Hide the HUD for the screenshot; the labels (a separate layer) stay.
  await page.addStyleTag({ content: '.cz-root { visibility: hidden !important; }' });
  return problems;
}

/** Projected nucleus of a comet (CSS px) from its label. */
async function head(page: Page, id: string): Promise<{ x: number; y: number }> {
  const label = page.locator(`.cz-label[data-label-id="${id}"]`).first();
  await expect(label).toHaveCount(1);
  return { x: Number(await label.getAttribute('data-x')), y: Number(await label.getAttribute('data-y')) };
}

const probe = (page: Page, x: number, y: number, size: number) =>
  page.evaluate(([px, py, s]) => window.__universe!.probe(px - s / 2, py - s / 2, s, s), [
    x,
    y,
    size,
  ] as const) as Promise<Rgb>;

/** Offsets along the anti-sunward axis (24 degrees above screen-right) and below it. */
const ROLL = (24 * Math.PI) / 180;
const along = (h: { x: number; y: number }, s: number, below = 0) => ({
  x: h.x + s * Math.cos(ROLL) + below * Math.sin(ROLL),
  y: h.y - s * Math.sin(ROLL) + below * Math.cos(ROLL),
});

test(
  'halley-1986: bright head, blue ion tail and yellow dust tail away from the Sun',
  { tag: '@smoke' },
  async ({ page }) => {
    const problems = await open(page, 'halley-1986');
    await page.screenshot({ path: 'artifacts/comets/halley-1986.png' });
    expect(await page.evaluate(() => window.__universe!.errors())).toEqual([]);
    expect(problems).toEqual([]);

    const h = await head(page, 'halley');
    expect(h.x).toBeGreaterThan(40);
    expect(h.x).toBeLessThan(240);
    // The coma is bright at the nucleus.
    expect(lum(await probe(page, h.x, h.y, 5))).toBeGreaterThan(0.2);

    // Ion tail: on the anti-sunward axis. Dust tail: behind it, below the axis on screen.
    const ionAt = along(h, 85);
    const dustAt = along(h, 85, 55);
    const sunAt = along(h, -55);
    const ion = await probe(page, ionAt.x, ionAt.y, 8);
    const dust = await probe(page, dustAt.x, dustAt.y, 16);
    const sunward = await probe(page, sunAt.x, sunAt.y, 16);
    // The anti-sunward side carries the tails; the sunward side is empty sky.
    expect(lum(ion)).toBeGreaterThan(0.02);
    expect(lum(dust)).toBeGreaterThan(0.02);
    expect(lum(ion)).toBeGreaterThan(3 * lum(sunward));
    expect(lum(dust)).toBeGreaterThan(3 * lum(sunward));
    // The ion tail is blue, the dust tail pale yellow.
    expect(ion[2]).toBeGreaterThan(1.3 * ion[0]);
    expect(dust[0]).toBeGreaterThan(dust[2]);
    expect(ion[2] / ion[0]).toBeGreaterThan(1.6 * (dust[2] / dust[0]));
    // The ion tail is narrow: well off the axis on the far side from the dust there is only sky.
    const offAxis = along(h, 85, -40);
    expect(lum(ion)).toBeGreaterThan(3 * lum(await probe(page, offAxis.x, offAxis.y, 12)));

    const stats = await page.evaluate(() => window.__universe!.stats());
    expect(stats.calls).toBeLessThanOrEqual(150);
    expect(stats.triangles).toBeLessThanOrEqual(60000);
  },
);

test('hale-bopp-1997: both tails rise from a brilliant head', async ({ page }) => {
  const problems = await open(page, 'hale-bopp-1997');
  await page.screenshot({ path: 'artifacts/comets/hale-bopp-1997.png' });
  expect(await page.evaluate(() => window.__universe!.errors())).toEqual([]);
  expect(problems).toEqual([]);
  const h = await head(page, 'hale-bopp');
  expect(lum(await probe(page, h.x, h.y, 5))).toBeGreaterThan(0.4);
  const ionAt = along(h, 80);
  const sunAt = along(h, -50);
  const ion = await probe(page, ionAt.x, ionAt.y, 8);
  expect(lum(ion)).toBeGreaterThan(0.03);
  expect(ion[2]).toBeGreaterThan(1.3 * ion[0]);
  // This view is from the other side of the orbital plane: the dust tail curves away above the axis.
  let dustBest: Rgb = [0, 0, 0];
  for (const s of [40, 60, 80]) {
    for (const below of [-30, -45, -60]) {
      const p = along(h, s, below);
      const c = await probe(page, p.x, p.y, 12);
      if (lum(c) > lum(dustBest)) dustBest = c;
    }
  }
  expect(lum(dustBest)).toBeGreaterThan(0.05);
  expect(dustBest[0]).toBeGreaterThan(dustBest[2]);
  expect(lum(dustBest)).toBeGreaterThan(2 * lum(await probe(page, sunAt.x, sunAt.y - 30, 12)));
  const stats = await page.evaluate(() => window.__universe!.stats());
  expect(stats.calls).toBeLessThanOrEqual(150);
});

test('halley-nucleus: a dark rock lit from the right inside the coma glow', async ({ page }) => {
  const problems = await open(page, 'halley-nucleus');
  await page.screenshot({ path: 'artifacts/comets/halley-nucleus.png' });
  expect(await page.evaluate(() => window.__universe!.errors())).toEqual([]);
  expect(problems).toEqual([]);
  // The nucleus is at the centre (the label marks it); its sunlit side (right) is far brighter than its
  // night side (lower left).
  const h = await head(page, 'halley');
  const day = await probe(page, h.x, h.y + 15, 10);
  const night = await probe(page, h.x - 64, h.y + 73, 6);
  expect(lum(day)).toBeGreaterThan(0.08);
  expect(lum(day)).toBeLessThan(0.9); // exposed for the surface, not blown out
  expect(lum(day)).toBeGreaterThan(4 * lum(night));
  // The coma glows faintly around it and brightens towards the nucleus, without washing out the frame.
  const far = lum(await probe(page, 20, 20, 16));
  const near = lum(await probe(page, h.x + 80, h.y - 40, 10));
  expect(far).toBeGreaterThan(0.001);
  expect(far).toBeLessThan(0.25);
  expect(near).toBeGreaterThan(far);
  expect(lum(day)).toBeGreaterThan(2 * near);
  const stats = await page.evaluate(() => window.__universe!.stats());
  expect(stats.calls).toBeLessThanOrEqual(150);
  expect(stats.triangles).toBeLessThanOrEqual(60000);
});

test('neowise-2020-sky: a naked-eye comet among the stars from near Earth', async ({ page }) => {
  const problems = await open(page, 'neowise-2020-sky');
  await page.screenshot({ path: 'artifacts/comets/neowise-2020-sky.png' });
  expect(await page.evaluate(() => window.__universe!.errors())).toEqual([]);
  expect(problems).toEqual([]);
  const h = await head(page, 'neowise');
  // The head sits low in the frame, the tails point up.
  expect(h.y).toBeGreaterThan(135);
  expect(lum(await probe(page, h.x, h.y, 5))).toBeGreaterThan(0.3);
  const ion = await probe(page, h.x, h.y - 110, 6);
  expect(ion[2]).toBeGreaterThan(1.3 * ion[0]);
  const below = lum(await probe(page, h.x, h.y + 40, 12));
  expect(lum(ion)).toBeGreaterThan(2 * below);
  // The dust tail fans out to one side above the head.
  let dust = 0;
  for (const dx of [-70, -45, 45, 70]) dust = Math.max(dust, lum(await probe(page, h.x + dx, h.y - 60, 14)));
  expect(dust).toBeGreaterThan(0.05);
  expect(dust).toBeGreaterThan(2 * below);
});
