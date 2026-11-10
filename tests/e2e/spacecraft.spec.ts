import { expect, test, type Page } from '@playwright/test';

/** Spacecraft: models at their bookmarks, lit and in place, with labels, markers and draw budgets. */
type Rgb = [number, number, number];
const lum = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Opens a bookmark; without the UI it also takes the screenshot (the HUD would cover the craft). */
async function open(page: Page, bookmark: string, ui = false): Promise<void> {
  await page.goto(`?test=1&q=potato&b=${bookmark}${ui ? '&ui=1' : ''}`);
  await page.waitForFunction(() => window.__universe !== undefined);
  await page.evaluate(() => window.__universe!.ready());
  await page.evaluate(() => window.__universe!.renderFrames(4));
  if (!ui) await page.screenshot({ path: `artifacts/spacecraft/${bookmark}.png` });
  expect(await page.evaluate(() => window.__universe!.errors())).toEqual([]);
}

const probe = (page: Page, x: number, y: number, w: number, h: number) =>
  page.evaluate(([px, py, pw, ph]) => window.__universe!.probe(px, py, pw, ph), [x, y, w, h]) as Promise<Rgb>;

/** Anchor (CSS px) of a visible label, or null. */
const label = (page: Page, id: string) =>
  page.evaluate((labelId) => {
    const n = [...document.querySelectorAll<HTMLElement>(`.cz-label[data-label-id="${labelId}"]`)].find(
      (e) => e.style.display !== 'none',
    );
    return n ? { x: Number(n.dataset.x), y: Number(n.dataset.y) } : null;
  }, id);

test('spacecraft: the ISS over the sunlit limb of Earth', { tag: '@smoke' }, async ({ page }) => {
  await open(page, 'iss-over-earth');
  // Black space above, sunlit Earth (blue ocean, white cloud) below.
  expect(lum(await probe(page, 0, 0, 160, 60))).toBeLessThan(0.03);
  const earth = await probe(page, 0, 210, 480, 60);
  expect(lum(earth)).toBeGreaterThan(0.2);
  expect(earth[2]).toBeGreaterThan(earth[0]);
  // Sunlit truss, radiators and modules stand out against the dim limb either side of them.
  const station = lum(await probe(page, 160, 120, 120, 30));
  const flanks = (lum(await probe(page, 80, 120, 40, 30)) + lum(await probe(page, 280, 120, 80, 30))) / 2;
  expect(station).toBeGreaterThan(0.15);
  expect(station).toBeGreaterThan(1.8 * flanks);
  const stats = await page.evaluate(() => window.__universe!.stats());
  expect(stats.calls).toBeLessThanOrEqual(100);
  expect(stats.triangles).toBeLessThanOrEqual(300_000);
  expect(stats.lines).toBeGreaterThan(0);

  // With the UI: the station is a labelled body in the middle of the view.
  await open(page, 'iss-over-earth', true);
  const at = await label(page, 'iss');
  expect(at).not.toBeNull();
  expect(Math.abs(at!.x - 240)).toBeLessThan(60);
  expect(Math.abs(at!.y - 135)).toBeLessThan(45);
});

test('spacecraft: Webb shows its gold mirror above the sunshield', async ({ page }) => {
  await open(page, 'jwst-l2');
  // Gold segments: lit (by the fill light: this side never sees the Sun) and clearly warmer than grey.
  const mirror = await probe(page, 205, 65, 70, 55);
  expect(lum(mirror)).toBeGreaterThan(0.05);
  expect(mirror[0]).toBeGreaterThan(1.3 * mirror[2]);
  // The silver sunshield below it: lit and neutral.
  const shield = await probe(page, 170, 182, 140, 26);
  expect(lum(shield)).toBeGreaterThan(0.05);
  expect(shield[0]).toBeLessThan(1.3 * shield[2]);
  expect(shield[2]).toBeLessThan(1.3 * shield[0]);
  // Deep space around it.
  expect(lum(await probe(page, 0, 0, 120, 100))).toBeLessThan(0.02);
  expect(lum(await probe(page, 400, 0, 80, 270))).toBeLessThan(0.02);
  const stats = await page.evaluate(() => window.__universe!.stats());
  expect(stats.calls).toBeLessThanOrEqual(70);
});

test('spacecraft: Voyager 1 looks back at a star-like Sun', async ({ page }) => {
  await open(page, 'voyager1-looking-back');
  // The Sun, far right, is the brightest thing in the frame; the craft on the left, seen from its
  // shadowed side, is lit but dim.
  const sunLum = lum(await probe(page, 405, 124, 24, 24));
  const craftLum = lum(await probe(page, 94, 85, 90, 100));
  expect(sunLum).toBeGreaterThan(0.5);
  expect(craftLum).toBeGreaterThan(0.01);
  expect(craftLum).toBeLessThan(0.5 * sunLum);
  const stats = await page.evaluate(() => window.__universe!.stats());
  expect(stats.calls).toBeLessThanOrEqual(70);
  expect(stats.triangles).toBeLessThanOrEqual(30_000);
  expect(stats.lines).toBeGreaterThan(100); // planet orbits plus the probes' paths

  // With the UI: craft in the foreground on the left, the Sun far to the right at the same height.
  await open(page, 'voyager1-looking-back', true);
  const craft = await label(page, 'voyager1');
  const sun = await label(page, 'sun');
  expect(craft).not.toBeNull();
  expect(sun).not.toBeNull();
  expect(sun!.x - craft!.x).toBeGreaterThan(150);
  expect(Math.abs(sun!.y - craft!.y)).toBeLessThan(40);
  // Other probes carry the module's far labels (the UI labels spacecraft only within 3000 radii).
  const ids = ['voyager2', 'newhorizons', 'pioneer10', 'pioneer11'];
  const others = await Promise.all(ids.map((id) => label(page, id)));
  expect(others.filter(Boolean).length).toBeGreaterThanOrEqual(1);
});

test('spacecraft: Hubble over Earth', async ({ page }) => {
  await open(page, 'hubble-over-earth');
  // Black space on the left, sunlit Earth on the right.
  expect(lum(await probe(page, 0, 0, 120, 150))).toBeLessThan(0.03);
  const earth = await probe(page, 320, 60, 140, 150);
  expect(lum(earth)).toBeGreaterThan(0.12);
  expect(earth[2]).toBeGreaterThan(earth[0]);
  // The silver tube: bright and neutral.
  const tube = await probe(page, 230, 104, 20, 60);
  expect(lum(tube)).toBeGreaterThan(0.25);
  expect(tube[2]).toBeLessThan(1.3 * tube[0]);
  const stats = await page.evaluate(() => window.__universe!.stats());
  expect(stats.calls).toBeLessThanOrEqual(100);
  expect(stats.triangles).toBeLessThanOrEqual(300_000);
});
