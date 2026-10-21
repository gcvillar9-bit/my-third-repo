import { expect, test, type Page } from '@playwright/test';

/**
 * Life at ground level: walk-mode bookmarks at four dates. The scene's cast comes from the test hook
 * window.__life (species shown now); pixels check that the horizon band holds plants and animals
 * (dark and bright patches), not bare ground and sky. Climate maps and species data load lazily, so the
 * page alternates ready() and single frames first.
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

async function open(page: Page, bookmark: string) {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.goto(`?test=1&q=potato&b=${bookmark}`);
  await page.waitForFunction(() => window.__universe !== undefined);
  await settle(page);
  await page.screenshot({ path: `artifacts/life/${bookmark}.png` });
  const stats = await page.evaluate(() => window.__universe!.stats());
  expect(await page.evaluate(() => window.__universe!.errors())).toEqual([]);
  expect(problems).toEqual([]);
  expect(stats.calls).toBeLessThanOrEqual(150);
  expect(stats.programs).toBeLessThanOrEqual(60);
  return { shown: () => page.evaluate(() => window.__life!.shown()) };
}

async function settle(page: Page) {
  await page.evaluate(async () => {
    for (let i = 0; i < 6; i++) {
      await window.__universe!.ready();
      await window.__universe!.renderFrames(1);
    }
    await window.__universe!.ready();
    await window.__universe!.renderFrames(4);
  });
}

/** Luminance spread along the horizon band: trees and animals against the ground and sky. */
async function horizonContrast(page: Page): Promise<number> {
  const l: number[] = [];
  for (let x = 0; x < 480; x += 40)
    l.push(lum((await page.evaluate(([px]) => window.__universe!.probe(px, 105, 40, 30), [x])) as RGB));
  return Math.max(...l) / Math.max(1e-6, Math.min(...l));
}

test(
  'life-trex-66ma: Tyrannosaurus, ceratopsids and hadrosaurs; gone today',
  { tag: '@smoke' },
  async ({ page }) => {
    const { shown } = await open(page, 'life-trex-66ma');
    const c = (await shown()).creatures;
    expect(c['species:tyrannosaurid']).toBeGreaterThan(0);
    expect(c['species:ceratopsid']).toBeGreaterThan(0);
    expect(c['species:hadrosaur']).toBeGreaterThan(0);
    expect(c['species:sapiens']).toBeUndefined();
    expect(await horizonContrast(page)).toBeGreaterThan(1.3);
    // The same place today: no dinosaurs.
    await page.evaluate(() => window.__universe!.setTime('2025-06-21T17:00:00Z'));
    await settle(page);
    const now = (await shown()).creatures;
    expect(Object.keys(now).filter((k) => /tyrannosaurid|ceratopsid|hadrosaur/.test(k))).toEqual([]);
    expect(await page.evaluate(() => window.__universe!.errors())).toEqual([]);
  },
);

test('life-jurassic-150ma: Stegosaurus and sauropods among cycads, no tyrannosaurs', async ({ page }) => {
  const { shown } = await open(page, 'life-jurassic-150ma');
  const { creatures, plants } = await shown();
  expect(creatures['species:stegosaur']).toBeGreaterThan(0);
  expect(creatures['species:diplodocid']).toBeGreaterThan(0);
  expect(creatures['species:tyrannosaurid']).toBeUndefined();
  expect(plants.grass).toBeUndefined(); // no grasses in the Jurassic
});

test('life-lucy-3ma: Australopithecus with elephants and giraffes, no modern humans', async ({ page }) => {
  const { shown } = await open(page, 'life-lucy-3ma');
  const c = (await shown()).creatures;
  expect(c['species:australopithecus']).toBeGreaterThan(0);
  expect(c['species:elephant']).toBeGreaterThan(0);
  expect(c['species:giraffe']).toBeGreaterThan(0);
  expect(c['species:sapiens']).toBeUndefined();
  expect(await horizonContrast(page)).toBeGreaterThan(1.3);
});

test('life-mammoth-45ka: Neanderthals and mammoths on the steppe', async ({ page }) => {
  const { shown } = await open(page, 'life-mammoth-45ka');
  const { creatures, plants } = await shown();
  expect(creatures['species:neanderthal']).toBeGreaterThan(0);
  expect(creatures['species:mammoth']).toBeGreaterThan(0);
  expect(creatures['species:tyrannosaurid']).toBeUndefined();
  expect(plants.grass).toBeGreaterThan(10);
});
