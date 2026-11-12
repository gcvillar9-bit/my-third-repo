import { expect, test } from '@playwright/test';

/**
 * Cosmic Zoom in test mode: ?tour= starts it after boot and ?tourspeed=60 plays it 60x faster, so one
 * frame of the fixed 1/60 s test step is 1 s of tour time and a stop (flight + caption) takes about
 * 15 frames. The loop looks at the tour every 5 frames, which is every 5 s of tour time.
 *
 * Keep the frame count low. Software rendering (CI) needs about half a second for each of these views,
 * and the work queues in the GPU process: renderFrames returns at once and the next step that needs the
 * pixels (the screenshot) waits for all of it. At 20x with 15 frames per look (the same tour times) this
 * test drew about 125 frames and used 100 s of its 120 s on CI, so a slower runner ran out of time.
 */
test(
  'tours: Cosmic Zoom changes captions and moves the camera through 3+ stops',
  { tag: '@smoke' },
  async ({ page }) => {
    test.setTimeout(120_000);
    const problems: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
    });
    page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
    await page.goto('?test=1&q=potato&ui=1&b=earth-now&tour=cosmic-zoom&tourspeed=60');
    await page.waitForFunction(() => window.__universe !== undefined);
    await page.evaluate(() => window.__universe!.ready());
    await page.evaluate(() => window.__universe!.renderFrames(4));
    await expect(page.locator('.cz-tour')).toBeVisible();

    const targets = new Set<string>();
    const captions = new Set<string>();
    const frames = new Set<string>();
    for (let i = 0; i < 40 && (targets.size < 4 || captions.size < 3 || frames.size < 3); i++) {
      await page.evaluate(() => window.__universe!.renderFrames(5));
      const s = await page.evaluate(() => {
        const el = document.querySelector<HTMLElement>('.cz-tour');
        const api = window.__universe as unknown as { camera?: () => { frame: string } };
        return {
          target: el?.dataset.target ?? '',
          caption: document.querySelector('.cz-caption')?.textContent ?? '',
          frame: api.camera?.().frame ?? '',
        };
      });
      if (s.target) targets.add(s.target);
      if (s.caption) captions.add(s.caption);
      if (s.frame) frames.add(s.frame);
    }
    await page.screenshot({ path: 'artifacts/tours/tour-cosmic-zoom.png' });
    expect([...targets].slice(0, 3)).toEqual(['apollo11-2m', 'moon-low-orbit', 'earth-limb-400km']);
    expect(captions.size).toBeGreaterThanOrEqual(3);
    expect(frames.size, [...frames].join(', ')).toBeGreaterThanOrEqual(3);

    // Esc leaves the tour and clears the caption.
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__universe!.renderFrames(2));
    await expect(page.locator('.cz-tour')).toHaveCount(0);
    await expect(page.locator('.cz-caption')).toHaveCount(0);

    const errors = await page.evaluate(() => window.__universe!.errors());
    expect([...errors, ...problems]).toEqual([]);
  },
);

/**
 * Integration (Phase 5): with the galaxies and cosmic-web modules merged, the tour must fly through
 * m31-approach, virgo-cluster, great-attractor and cosmic-web-500mpc (in that order) and end back home without errors.
 */
test('tours: Cosmic Zoom reaches the galaxy and cosmic-web stops and ends at home', async ({ page }) => {
  test.setTimeout(120_000);
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.goto('?test=1&q=potato&ui=1&b=earth-now&tour=cosmic-zoom&tourspeed=100');
  await page.waitForFunction(() => window.__universe !== undefined);
  await page.evaluate(() => window.__universe!.ready());
  await page.evaluate(() => window.__universe!.renderFrames(4));
  await expect(page.locator('.cz-tour')).toBeVisible();

  const targets: string[] = [];
  let shot = false;
  for (let i = 0; i < 80; i++) {
    await page.evaluate(() => window.__universe!.renderFrames(6));
    const target = await page.evaluate(
      () => document.querySelector<HTMLElement>('.cz-tour')?.dataset.target ?? null,
    );
    if (target === null) break; // overlay removed: the tour has ended
    if (target && targets[targets.length - 1] !== target) targets.push(target);
    if (!shot && target === 'virgo-cluster') {
      await page.screenshot({ path: 'artifacts/tours/tour-virgo-caption.png' });
      shot = true;
    }
  }
  const galaxyStops = targets.filter((t) =>
    ['m31-approach', 'virgo-cluster', 'great-attractor', 'cosmic-web-500mpc'].includes(t),
  );
  expect(galaxyStops, targets.join(', ')).toEqual([
    'm31-approach',
    'virgo-cluster',
    'great-attractor',
    'cosmic-web-500mpc',
  ]);
  expect(targets[targets.length - 1]).toBe('earth-now');
  await expect(page.locator('.cz-tour')).toHaveCount(0);
  const errors = await page.evaluate(() => window.__universe!.errors());
  expect([...errors, ...problems]).toEqual([]);
});
