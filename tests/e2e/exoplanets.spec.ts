import { expect, test } from '@playwright/test';

/** TRAPPIST-1: promoted red-dwarf host drawn as a photosphere, seven planets with labels and orbits. */
type Rgb = [number, number, number];
const lum = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

test('exoplanets: trappist-1 shows the red dwarf and its planets', { tag: '@smoke' }, async ({ page }) => {
  await page.goto('?test=1&q=potato&ui=1&b=trappist-1');
  await page.waitForFunction(() => window.__universe !== undefined);
  await page.evaluate(() => window.__universe!.ready());
  await page.evaluate(() => window.__universe!.renderFrames(4));
  await page.screenshot({ path: 'artifacts/exoplanets/trappist-1.png' });
  expect(await page.evaluate(() => window.__universe!.errors())).toEqual([]);

  // The host sits at the centre of the view: bright and red (Teff about 2500 K).
  const host = (await page.evaluate(() => window.__universe!.probe(236, 131, 8, 8))) as Rgb;
  expect(lum(host)).toBeGreaterThan(0.05);
  expect(host[0]).toBeGreaterThan(1.5 * host[2]);
  // Corners stay dark (no full-screen artefacts).
  expect(lum((await page.evaluate(() => window.__universe!.probe(2, 2, 12, 12))) as Rgb)).toBeLessThan(0.05);

  // Planets are bodies labelled by the UI (artist's impressions), at least a few survive decluttering.
  expect(await page.locator('.cz-label[data-label-id^="exo:trappist-1:"]').count()).toBeGreaterThanOrEqual(3);

  const stats = await page.evaluate(() => window.__universe!.stats());
  expect(stats.calls).toBeLessThanOrEqual(150);
  expect(stats.lines).toBeGreaterThan(0);
});

test('exoplanets: proxima-b promotes the HYG host and labels its planet', async ({ page }) => {
  await page.goto('?test=1&q=potato&ui=1&b=proxima-b');
  await page.waitForFunction(() => window.__universe !== undefined);
  await page.evaluate(() => window.__universe!.ready());
  await page.evaluate(() => window.__universe!.renderFrames(4));
  await page.screenshot({ path: 'artifacts/exoplanets/proxima-b.png' });
  expect(await page.evaluate(() => window.__universe!.errors())).toEqual([]);
  // Proxima Centauri (HYG star, promoted at its Gaia distance) is the red disk at the centre.
  const host = (await page.evaluate(() => window.__universe!.probe(236, 131, 8, 8))) as Rgb;
  expect(lum(host)).toBeGreaterThan(0.05);
  expect(host[0]).toBeGreaterThan(1.5 * host[2]);
  await expect(page.locator('.cz-label[data-label-id="exo:proxima-centauri:b"]')).toHaveCount(1);
  // The star's HYG label is replaced by its promoted body label (never duplicated).
  expect(await page.locator('.cz-label[data-label-id="hip:70890"]').count()).toBeLessThanOrEqual(1);
});
