import { expect, test, type Page } from '@playwright/test';

/**
 * Cities through history: street-level walk bookmarks at three dates (buildings by style from the
 * life test hook, pixels: a built-up horizon) and city labels from orbit at AD 117 (DOM labels with
 * ui=1: the cities of the time, not later ones).
 */
type RGB = [number, number, number];
const lum = ([r, g, b]: RGB) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

declare global {
  interface Window {
    __life?: {
      shown(): {
        plants: Record<string, number>;
        creatures: Record<string, number>;
        buildings: Record<string, number>;
      };
    };
  }
}

async function open(page: Page, bookmark: string, ui = false) {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.goto(`?test=1&q=potato${ui ? '&ui=1' : ''}&b=${bookmark}`);
  await page.waitForFunction(() => window.__universe !== undefined);
  await page.evaluate(async () => {
    for (let i = 0; i < 6; i++) {
      await window.__universe!.ready();
      await window.__universe!.renderFrames(1);
    }
    await window.__universe!.ready();
    await window.__universe!.renderFrames(4);
  });
  await page.screenshot({ path: `artifacts/cities/${bookmark}.png` });
  const stats = await page.evaluate(() => window.__universe!.stats());
  expect(await page.evaluate(() => window.__universe!.errors())).toEqual([]);
  expect(problems).toEqual([]);
  expect(stats.calls).toBeLessThanOrEqual(150);
  expect(stats.programs).toBeLessThanOrEqual(60);
  return { shown: () => page.evaluate(() => window.__life!.shown()) };
}

/** Luminance spread along the horizon band (buildings against the sky and the ground). */
async function horizonContrast(page: Page): Promise<number> {
  const l: number[] = [];
  for (let x = 0; x < 480; x += 40)
    l.push(lum((await page.evaluate(([px]) => window.__universe!.probe(px, 100, 40, 40), [x])) as RGB));
  return Math.max(...l) / Math.max(1e-6, Math.min(...l));
}

test(
  'city-giza-2450bc: the three pyramids stand, no modern buildings',
  { tag: '@smoke' },
  async ({ page }) => {
    const { shown } = await open(page, 'city-giza-2450bc');
    const b = (await shown()).buildings;
    expect(b.pyramid).toBe(3);
    expect(b.tower ?? 0).toBe(0);
    // Warm limestone against the blue sky: inside the largest pyramid (right of centre in the view
    // from the south-east) versus the sky just above it.
    const probe = (x: number, y: number, w: number, h: number) =>
      page.evaluate(
        ([px, py, pw, ph]) => window.__universe!.probe(px, py, pw, ph),
        [x, y, w, h],
      ) as Promise<RGB>;
    const stone = await probe(292, 132, 32, 14);
    const sky = await probe(292, 90, 32, 14);
    expect(stone[0]).toBeGreaterThan(stone[2]);
    expect(stone[0] / stone[2]).toBeGreaterThan(1.3 * (sky[0] / sky[2]));
  },
);

test('city-rome-117ad: a classical city with temples, houses and people', async ({ page }) => {
  const { shown } = await open(page, 'city-rome-117ad');
  const { buildings, creatures } = await shown();
  expect(buildings.temple).toBeGreaterThan(0);
  expect((buildings.stoneHouse ?? 0) + (buildings.insula ?? 0)).toBeGreaterThan(30);
  expect(buildings.tower ?? 0).toBe(0);
  expect(creatures['species:townsfolk']).toBeGreaterThan(0);
  expect(await horizonContrast(page)).toBeGreaterThan(1.3);
  // The Temple of Jupiter on the Capitoline fills the centre of the view up the street: pale marble,
  // neither blue sky (blue over red about 2.8) nor brick and earth (about 0.3-0.4). About 0.8 measured.
  const [r, , b] = (await page.evaluate(() => window.__universe!.probe(222, 105, 40, 30))) as RGB;
  expect(b / r).toBeGreaterThan(0.6);
  expect(b / r).toBeLessThan(1.4);
});

test('city-newyork-1935: towers and the Empire State Building', async ({ page }) => {
  const { shown } = await open(page, 'city-newyork-1935');
  const { buildings, creatures } = await shown();
  expect(buildings.tower).toBeGreaterThan(1);
  expect(buildings.temple ?? 0).toBe(0);
  expect(creatures['species:people']).toBeGreaterThan(0);
});

test('city-labels-117ad: labels of the cities of AD 117 from orbit', async ({ page }) => {
  await open(page, 'city-labels-117ad', true);
  const texts = await page.$$eval('.cz-label[data-label-id^="city:"]', (els) =>
    els.filter((e) => (e as HTMLElement).style.display !== 'none').map((e) => e.textContent ?? ''),
  );
  const all = texts.join(' | ');
  expect(all).toMatch(/Rome ≈/);
  expect(all).toMatch(/Alexandria ≈/);
  expect(all).not.toMatch(/Constantinople/); // founded in 330
  expect(all).not.toMatch(/Tenochtitlan|New York/);
});
