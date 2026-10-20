import { expect, test, type Page } from '@playwright/test';

/**
 * Deep-time Earth (paleo): whole-disc views at 250 Ma, 90 Ma and 21 ka centred on their sites, and a
 * ground-level sunset at 66 Ma with time running. Data and bakes load lazily on the first deep-time
 * frames, so the page alternates ready() and single frames before the probed frames.
 */
type RGB = [number, number, number];
type Box = [number, number, number, number];
const lum = ([r, g, b]: RGB) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const redness = ([r, , b]: RGB) => r / b;

async function open(page: Page, bookmark: string, problems: string[]) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.goto(`?test=1&q=potato&b=${bookmark}`);
  await page.waitForFunction(() => window.__universe !== undefined);
  await page.evaluate(async () => {
    for (let i = 0; i < 4; i++) {
      await window.__universe!.ready();
      await window.__universe!.renderFrames(1);
    }
    await window.__universe!.ready();
    await window.__universe!.renderFrames(4);
  });
  await page.screenshot({ path: `artifacts/paleo/${bookmark}.png` });
  const probe = (...b: Box) =>
    page.evaluate(([x, y, w, h]) => window.__universe!.probe(x, y, w, h), b) as Promise<RGB>;
  const stats = await page.evaluate(() => window.__universe!.stats());
  const errors = await page.evaluate(() => window.__universe!.errors());
  expect(errors).toEqual([]);
  expect(problems).toEqual([]);
  expect(stats.calls).toBeLessThanOrEqual(150);
  expect(stats.programs).toBeLessThanOrEqual(60);
  return { probe };
}

// The disc (radius ~77 px) is centred on the site; probes: the centre, and the disc left and right of it.
const CENTRE: Box = [210, 115, 60, 40];
const LEFT: Box = [180, 128, 14, 14];
const RIGHT: Box = [286, 128, 14, 14];
// At 250 Ma these fall on the ocean either side of Pangaea (checked against the 250 Ma map's screenshot).
const PANTHALASSA: Box = [168, 128, 20, 14];
const TETHYS: Box = [294, 128, 16, 14];

test(
  'paleo earth-pangaea-250ma: land where the South Atlantic is today',
  { tag: '@smoke' },
  async ({ page }) => {
    const { probe } = await open(page, 'earth-pangaea-250ma', []);
    const centre = await probe(...CENTRE);
    const west = redness(await probe(...PANTHALASSA));
    const east = redness(await probe(...TETHYS));
    // On today's grid this spot is the South Atlantic; at 250 Ma it is the dry interior of Pangaea,
    // with ocean either side.
    expect(west).toBeLessThan(0.65);
    expect(east).toBeLessThan(0.65);
    expect(redness(centre)).toBeGreaterThan(0.75);
    expect(redness(centre)).toBeGreaterThan(1.4 * Math.max(west, east));
  },
);

test('paleo earth-seaway-90ma: a seaway between two halves of North America', async ({ page }) => {
  const { probe } = await open(page, 'earth-seaway-90ma', []);
  // About 1 px per degree here: the 10-degree channel spans x 235-245, with land either side.
  const channel = await probe(236, 129, 6, 8);
  const west = await probe(225, 129, 8, 8);
  const east = await probe(249, 129, 8, 8);
  // Bright shallow water between darker, forested land masses.
  expect(lum(channel)).toBeGreaterThan(1.4 * lum(west));
  expect(lum(channel)).toBeGreaterThan(1.4 * lum(east));
});

test('paleo earth-lgm-21ka: ice sheet over Canada', async ({ page }) => {
  const { probe } = await open(page, 'earth-lgm-21ka', []);
  const centre = await probe(...CENTRE);
  const around = [await probe(...LEFT), await probe(...RIGHT), await probe(233, 176, 14, 14)];
  const mean = around.reduce((s, c) => s + lum(c), 0) / around.length;
  expect(lum(centre)).toBeGreaterThan(1.35 * mean); // bright ice dome over Hudson Bay
  expect(centre[0]).toBeGreaterThan(0.95 * centre[2]); // white-grey, not blue water or sky haze
});

test('paleo earth-dusk-66ma: the Sun sets in deep time and the night has no city lights', async ({
  page,
}) => {
  // The warm-up frames run the clock for 9 minutes at 1 h/s: the Sun is still about 6 deg up.
  const { probe } = await open(page, 'earth-dusk-66ma', []);
  const SKY: Box = [140, 20, 200, 40];
  expect(lum(await probe(...SKY))).toBeGreaterThan(0.03);
  // 1 h/s for 120 frames (2 s): two hours later the Sun is far below the horizon.
  await page.evaluate(() => window.__universe!.renderFrames(120));
  await page.screenshot({ path: 'artifacts/paleo/earth-dusk-66ma-night.png' });
  expect(lum(await probe(...SKY))).toBeLessThan(0.002);
  expect(lum(await probe(0, 0, 480, 270))).toBeLessThan(0.003);
  expect(await page.evaluate(() => window.__universe!.errors())).toEqual([]);
});
