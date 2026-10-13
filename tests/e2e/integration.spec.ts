import { expect, test } from '@playwright/test';

/**
 * Phase-1 integration: default start (earth-now) plus the solar-system palette flow with the UI shell.
 * Test mode has no rAF, so the flight advances through renderFrames (60 frames = 1 s at the fixed step).
 */
test(
  'integration: default start is earth-now, palette "Saturn" arrives within 12 s',
  { tag: '@smoke' },
  async ({ page }) => {
    const problems: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
    });
    page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
    // No b=: boot must fall back to the default bookmark (earth-now, lookAt earth).
    await page.goto('?test=1&q=potato&ui=1');
    await page.waitForFunction(() => window.__universe !== undefined);
    await page.evaluate(() => window.__universe!.ready());
    await page.evaluate(() => window.__universe!.renderFrames(2));
    const hud = page.locator('.cz-hud');
    await expect(hud).toHaveAttribute('data-target', 'earth');

    await page.keyboard.press('/');
    const input = page.locator('.cz-palette-input');
    await expect(input).toBeFocused();
    await page.keyboard.type('Saturn');
    await expect(page.locator('.cz-results li').first()).toContainText('Saturn');
    await page.keyboard.press('Enter');
    await expect(input).toHaveCount(0);

    let seconds = 0;
    let traveling = '1';
    while (seconds < 13 && traveling !== '0') {
      await page.evaluate(() => window.__universe!.renderFrames(60));
      seconds++;
      traveling = (await hud.getAttribute('data-traveling')) ?? '1';
    }
    expect(traveling).toBe('0');
    expect(seconds).toBeLessThanOrEqual(12);
    await expect(hud).toHaveAttribute('data-target', 'saturn');
    await expect(page.locator('.cz-info .cz-info-title')).toContainText('Saturn');

    // Let lazily loaded textures settle, then check Saturn is lit at the centre.
    await page.evaluate(() => window.__universe!.ready());
    await page.evaluate(() => window.__universe!.renderFrames(4));
    await page.screenshot({ path: 'artifacts/integration/palette-saturn.png' });
    const [r, g, b] = await page.evaluate(() => window.__universe!.probe(210, 115, 60, 40));
    expect(0.2126 * r + 0.7152 * g + 0.0722 * b).toBeGreaterThan(0.01);
    const stats = await page.evaluate(() => window.__universe!.stats());
    expect(stats.calls).toBeLessThanOrEqual(150);
    expect(await page.evaluate(() => window.__universe!.errors())).toEqual([]);
    expect(problems).toEqual([]);
  },
);

test('integration: the Sun is a bright point at the centre of sun-from-alpha-cen', async ({ page }) => {
  await page.goto('?test=1&q=potato&b=sun-from-alpha-cen');
  await page.waitForFunction(() => window.__universe !== undefined);
  await page.evaluate(() => window.__universe!.ready());
  await page.evaluate(() => window.__universe!.renderFrames(4));
  const lum = ([r, g, b]: [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // stars.bin has no Sun: solar-system draws it as a photometric point (m 0.47 from alpha Cen A).
  const centre = lum(await page.evaluate(() => window.__universe!.probe(236, 131, 8, 8)));
  const sky = lum(await page.evaluate(() => window.__universe!.probe(60, 40, 40, 40)));
  expect(centre).toBeGreaterThan(0.002);
  expect(centre).toBeGreaterThan(4 * sky);
  expect(await page.evaluate(() => window.__universe!.errors())).toEqual([]);
});
