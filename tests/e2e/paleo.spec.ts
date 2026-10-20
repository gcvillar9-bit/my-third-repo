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

// The disc is centred on the site; probes: the centre, and the disc left and right of it.
const CENTRE: Box = [210, 115, 60, 40];
const LEFT: Box = [180, 128, 14, 14];
const RIGHT: Box = [286, 128, 14, 14];

test(
  'paleo earth-pangaea-250ma: land where the South Atlantic is today',
  { tag: '@smoke' },
  async ({ page }) => {
    const { probe } = await open(page, 'earth-pangaea-250ma', []);
    const centre = await probe(...CENTRE);
    const ocean = (redness(await probe(...LEFT)) + redness(await probe(...RIGHT))) / 2;
    // Today this spot is open ocean (blue); at 250 Ma it is the dry interior of Pangaea.
    expect(redness(centre)).toBeGreaterThan(0.75);
    expect(redness(centre)).toBeGreaterThan(1.5 * ocean);
  },
);

test('paleo earth-seaway-90ma: a sea across today’s Great Plains', async ({ page }) => {
  const { probe } = await open(page, 'earth-seaway-90ma', []);
  const centre = await probe(230, 125, 20, 20);
  const north = await probe(233, 80, 14, 14);
  expect(redness(centre)).toBeLessThan(0.65); // water, where the Dakotas are land today
  expect(redness(north)).toBeGreaterThan(redness(centre) + 0.3); // land to the north
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
  const { probe } = await open(page, 'earth-dusk-66ma', []);
  const SKY: Box = [140, 20, 200, 40];
  expect(lum(await probe(...SKY))).toBeGreaterThan(0.03);
  // 6 h/s for 20 frames (1/3 s): two hours later the Sun is far below the horizon.
  await page.evaluate(() => window.__universe!.renderFrames(20));
  await page.screenshot({ path: 'artifacts/paleo/earth-dusk-66ma-night.png' });
  expect(lum(await probe(...SKY))).toBeLessThan(0.002);
  expect(lum(await probe(0, 0, 480, 270))).toBeLessThan(0.003);
  expect(await page.evaluate(() => window.__universe!.errors())).toEqual([]);
});
