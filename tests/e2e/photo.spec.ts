import { expect, test } from '@playwright/test';

/** Photo mode: P hides the UI shell, Save PNG produces a non-empty PNG, Esc restores the UI. */
test('photo: P hides the UI and Save PNG exports a non-empty image', { tag: '@smoke' }, async ({ page }) => {
  test.setTimeout(120_000);
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.goto('?test=1&q=potato&ui=1&b=earth-now');
  await page.waitForFunction(() => window.__universe !== undefined);
  await page.evaluate(() => window.__universe!.ready());
  await page.evaluate(() => window.__universe!.renderFrames(4));
  await expect(page.locator('.cz-hud')).toBeVisible();
  await expect(page.locator('.cz-topbar')).toBeVisible();

  await page.keyboard.press('p');
  await page.evaluate(() => window.__universe!.renderFrames(2));
  await expect(page.locator('html')).toHaveAttribute('data-photo', '');
  await expect(page.locator('.cz-hud')).toBeHidden();
  await expect(page.locator('.cz-topbar')).toBeHidden();
  await expect(page.locator('.cz-photo-panel')).toBeVisible();

  const size = await page.evaluate(async () => {
    const panel = document.querySelector<HTMLElement>('.cz-photo-panel')!;
    const btn = [...panel.querySelectorAll('button')].find((b) => b.textContent === 'Save PNG')!;
    btn.click();
    await window.__universe!.renderFrames(1);
    for (let i = 0; i < 100 && !panel.dataset.lastSize; i++) await new Promise((r) => setTimeout(r, 50));
    return Number(panel.dataset.lastSize ?? 0);
  });
  expect(size).toBeGreaterThan(1000);
  await page.screenshot({ path: 'artifacts/photo/photo-mode.png' });

  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__universe!.renderFrames(2));
  await expect(page.locator('html')).not.toHaveAttribute('data-photo', '');
  await expect(page.locator('.cz-hud')).toBeVisible();

  const errors = await page.evaluate(() => window.__universe!.errors());
  expect([...errors, ...problems]).toEqual([]);
});
