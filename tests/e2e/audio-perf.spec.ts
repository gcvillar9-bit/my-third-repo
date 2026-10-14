import { expect, test, type Page } from '@playwright/test';

/**
 * Follow-up features: the performance overlay setting (stats-gl, off by default) and the sound
 * controls (mute button, M key, Sound settings). Audio itself stays disabled in test mode.
 */
async function boot(page: Page): Promise<string[]> {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.goto('?test=1&q=potato&ui=1&b=orion-from-earth');
  await page.waitForFunction(() => window.__universe !== undefined);
  await page.evaluate(() => window.__universe!.ready());
  await page.evaluate(() => window.__universe!.renderFrames(4));
  return problems;
}

const frames = (page: Page, n: number) => page.evaluate((k) => window.__universe!.renderFrames(k), n);

test('perf setting shows and hides the stats overlay', async ({ page }) => {
  const problems = await boot(page);
  await expect(page.locator('.cz-perf-stats')).toHaveCount(0);
  await page.locator('.cz-topbar button[title="Settings"]').click();
  const box = page.locator('.cz-setting', { hasText: 'Show performance stats' }).locator('input');
  await expect(box).not.toBeChecked();
  await box.check();
  await expect
    .poll(async () => {
      await frames(page, 2);
      return (await page.locator('.cz-perf-res').textContent()) ?? '';
    })
    .toContain('res ');
  // The stats-gl container is 0x0 (its canvases are absolutely positioned).
  await expect(page.locator('.cz-perf-stats canvas').first()).toBeVisible();
  await frames(page, 4);
  await page.screenshot({ path: 'artifacts/audio-perf/perf-on.png' });

  await box.uncheck();
  await frames(page, 4);
  await expect(page.locator('.cz-perf-stats')).toHaveCount(0);
  await expect(page.locator('.cz-perf-res')).toHaveCount(0);
  expect(await page.evaluate(() => window.__universe!.errors())).toEqual([]);
  expect(problems).toEqual([]);
});

test('sound controls toggle without errors and audio stays off in test mode', async ({ page }) => {
  const problems = await boot(page);
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-cz-audio', 'test-off');
  const mute = page.locator('.cz-mute-btn');
  await expect(mute).toHaveAttribute('aria-pressed', 'false');
  await mute.click();
  await expect(mute).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('m');
  await expect(mute).toHaveAttribute('aria-pressed', 'false');

  await page.locator('.cz-topbar button[title="Settings"]').click();
  const sound = page.locator('.cz-setting', { hasText: /^Sound/ }).locator('input');
  const volume = page.locator('.cz-setting', { hasText: 'Volume' }).locator('input');
  const silence = page.locator('.cz-setting', { hasText: 'Realistic silence in space' }).locator('input');
  await expect(sound).toBeChecked();
  await sound.uncheck();
  await expect(mute).toHaveAttribute('aria-pressed', 'true');
  await sound.check();
  await volume.fill('0.2');
  await silence.check();
  await frames(page, 4);
  await expect(silence).toBeChecked();
  await expect(html).toHaveAttribute('data-cz-audio', 'test-off');
  expect(await page.evaluate(() => window.__universe!.errors())).toEqual([]);
  expect(problems).toEqual([]);
});
