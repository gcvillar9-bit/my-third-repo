import { expect, test, type Page } from '@playwright/test';

/**
 * HD Earth imagery (earth/hd-imagery.ts): with ?hdimagery=1 the GIBS Blue Marble tiles around the
 * camera are fetched and blended into the day map. Tiles are routed to a solid magenta fixture, so the
 * ground turns magenta; refused tiles keep the base map without errors.
 */
type RGB = [number, number, number];
const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/**';

async function open(page: Page, extra: string) {
  const problems: string[] = [];
  page.on('console', (msg) => {
    // A refused tile is a network error by design in the fallback test; nothing else may fail.
    if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text()))
      problems.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.goto(`?test=1&q=potato${extra}&b=earth-himalaya`);
  await page.waitForFunction(() => window.__universe !== undefined);
  await page.evaluate(async () => {
    for (let i = 0; i < 6; i++) {
      await window.__universe!.ready();
      await window.__universe!.renderFrames(1);
    }
    await window.__universe!.ready();
    await window.__universe!.renderFrames(4);
  });
  const ground = (await page.evaluate(() => window.__universe!.probe(140, 200, 200, 50))) as RGB;
  expect(await page.evaluate(() => window.__universe!.errors())).toEqual([]);
  expect(problems).toEqual([]);
  const stats = await page.evaluate(() => window.__universe!.stats());
  expect(stats.calls).toBeLessThanOrEqual(150);
  expect(stats.programs).toBeLessThanOrEqual(60);
  return ground;
}

test('HD imagery: GIBS tiles stream into the day map near the ground', async ({ page }) => {
  const urls: string[] = [];
  await page.route(GIBS, (route) => {
    urls.push(new URL(route.request().url()).pathname);
    return route.fulfill({
      path: 'tests/fixtures/earth/gibs-magenta.jpeg',
      contentType: 'image/jpeg',
      headers: { 'access-control-allow-origin': '*' },
    });
  });
  const [r, g, b] = await open(page, '&hdimagery=1');
  await page.screenshot({ path: 'artifacts/earth/earth-himalaya-hd-imagery.png' });
  // A 4x4 block at level 7 (2.25 degree tiles) around 32.3 N 81.3 E.
  expect(urls.length).toBe(16);
  expect(urls.every((u) => /BlueMarble_NextGeneration\/default\/500m\/7\/\d+\/\d+\.jpeg$/.test(u))).toBe(
    true,
  );
  expect(r).toBeGreaterThan(1.5 * g);
  expect(b).toBeGreaterThan(1.3 * g);
});

test('HD imagery: refused tiles keep the base map', async ({ page }) => {
  let n = 0;
  await page.route(GIBS, (route) => {
    n++;
    return route.abort('connectionrefused');
  });
  const [r, g, b] = await open(page, '&hdimagery=1');
  expect(n).toBeGreaterThan(0);
  // Not magenta: the base map's rock and snow.
  expect(r).toBeLessThan(1.5 * g);
  expect(b).toBeLessThan(1.3 * g + 0.02);
});
