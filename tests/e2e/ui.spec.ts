import { expect, test } from '@playwright/test';

/**
 * UI shell (?ui=1 in test mode): palette → goto. Test mode has no rAF, so the flight advances
 * through renderFrames (60 frames = 1 s of real time at the fixed test step).
 */
test(
  'ui palette: type a body name, Enter, camera arrives within 12 s',
  { tag: '@smoke' },
  async ({ page }) => {
    const problems: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
    });
    page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
    await page.goto('?test=1&q=potato&ui=1&b=orion-from-earth');
    await page.waitForFunction(() => window.__universe !== undefined);
    await page.evaluate(() => window.__universe!.ready());
    await page.evaluate(() => window.__universe!.renderFrames(2));

    // Shell pieces are present.
    await expect(page.locator('.cz-hud')).toBeVisible();
    await expect(page.locator('.cz-timebar .cz-date')).toContainText('2026-01-01');
    await expect(page.locator('.cz-crumbs')).toContainText('Solar System');

    await page.keyboard.press('/');
    const input = page.locator('.cz-palette-input');
    await expect(input).toBeFocused();
    await page.keyboard.type('Debug sph');
    await expect(page.locator('.cz-results li').first()).toContainText('Debug sphere');
    await page.keyboard.press('Enter');
    await expect(input).toHaveCount(0);

    const hud = page.locator('.cz-hud');
    let seconds = 0;
    let traveling = '1';
    while (seconds < 13 && traveling !== '0') {
      await page.evaluate(() => window.__universe!.renderFrames(60));
      seconds++;
      traveling = (await hud.getAttribute('data-traveling')) ?? '1';
    }
    expect(traveling).toBe('0');
    expect(seconds).toBeLessThanOrEqual(12);
    await expect(hud).toHaveAttribute('data-target', 'debug-sphere');
    await expect(page.locator('.cz-info .cz-info-title')).toHaveText('Debug sphere');
    await page.evaluate(() => window.__universe!.renderFrames(2));
    await page.screenshot({ path: 'artifacts/ui/palette-debug-sphere.png' });

    // The sphere fills the centre of the view after arrival (lit side is screen-left).
    const [r, g, b] = await page.evaluate(() => window.__universe!.probe(150, 115, 60, 40));
    expect(0.2126 * r + 0.7152 * g + 0.0722 * b).toBeGreaterThan(0.01);
    expect(await page.evaluate(() => window.__universe!.errors())).toEqual([]);
    expect(problems).toEqual([]);
  },
);
