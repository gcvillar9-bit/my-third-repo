import { expect, test, type Page } from '@playwright/test';
import type { UniverseTestApiExtras } from '../../src/app/test-api';

/**
 * App shell: Explore, tours menu, controls panel, selecting and landing, on-screen flight
 * controls, and a real (non-test) session from the splash to the welcome card. Test mode has no
 * rAF, so flights advance through renderFrames (60 frames = 1 s at the fixed step).
 */
type Cam = Awaited<ReturnType<UniverseTestApiExtras['camera']>>;
const cam = (page: Page) =>
  page.evaluate(() => (window.__universe as unknown as UniverseTestApiExtras).camera()) as Promise<Cam>;
const frames = (page: Page, n: number) =>
  page.evaluate(async (k) => {
    await window.__universe!.ready();
    await window.__universe!.renderFrames(k);
  }, n);

async function open(page: Page, query: string, problems: string[]) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.goto(query);
  await page.waitForFunction(() => window.__universe !== undefined);
  await frames(page, 3);
}

/** Advances the session until `done` holds, at most `seconds` simulated seconds. */
async function until(page: Page, seconds: number, done: () => Promise<boolean>) {
  for (let s = 0; s < seconds; s += 0.5) {
    await page.evaluate(() => window.__universe!.renderFrames(30));
    if (await done()) return s + 0.5;
  }
  return Infinity;
}

test(
  'shell: Explore lists places by theme and flies there; tours and controls panels open',
  { tag: '@smoke' },
  async ({ page }) => {
    const problems: string[] = [];
    await open(page, '?test=1&q=potato&ui=1&b=orion-from-earth', problems);

    // Explore: every theme with something registered, more than sixty places in all.
    await page.keyboard.press('x');
    const explore = page.locator('.cz-explore');
    await expect(explore).toBeVisible();
    expect(Number(await explore.getAttribute('data-places'))).toBeGreaterThan(60);
    for (const g of [
      'tours',
      'solar-system',
      'sights',
      'earth',
      'deep-time',
      'cities',
      'stars',
      'black-holes',
    ])
      await expect(explore.locator(`section[data-group="${g}"]`)).toHaveCount(1);
    // Nothing kept for regression tests is offered.
    await expect(explore).not.toContainText('(test)');
    await page.screenshot({ path: 'artifacts/shell/explore.png' });

    // The Solar System group is open: fly to the Moon from it.
    await explore.locator('[data-key="moon"]').click();
    const hud = page.locator('.cz-hud');
    const took = await until(page, 13, async () => (await hud.getAttribute('data-traveling')) === '0');
    expect(took).toBeLessThanOrEqual(12);
    await expect(hud).toHaveAttribute('data-target', 'moon');
    await expect(page.locator('.cz-info .cz-info-title')).toHaveText('Moon');
    // The info card carries a description and can land.
    await expect(page.locator('.cz-info .cz-desc')).toContainText('giant impact');
    await expect(page.locator('.cz-info .cz-land-btn')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(explore).toHaveCount(0);

    // Tours menu: five tours; Escape closes it.
    await page.keyboard.press('t');
    const toursMenu = page.locator('.cz-tours');
    await expect(toursMenu.locator('[data-tour]')).toHaveCount(5);
    await expect(toursMenu).toContainText('Grand Tour of the Solar System');
    await page.keyboard.press('Escape');
    await expect(toursMenu).toHaveCount(0);

    // Controls panel.
    await page.keyboard.press('?');
    const help = page.locator('.cz-help-panel');
    await expect(help).toContainText('land on the selected or nearest world');
    await page.keyboard.press('Escape');
    await expect(help).toHaveCount(0);

    // One accuracy chip instead of a row of badges; the list opens on demand.
    const chip = page.locator('.cz-accuracy');
    await expect(chip).toContainText('real data');
    await chip.click();
    await expect(page.locator('.cz-accuracy-panel li').first()).toContainText('planets');

    expect(await page.evaluate(() => window.__universe!.errors())).toEqual([]);
    expect(problems).toEqual([]);
  },
);

test('shell: a click selects the world under it; a drag does not', async ({ page }) => {
  const problems: string[] = [];
  await open(page, '?test=1&q=potato&ui=1&b=moon', problems);

  // The Moon fills the middle of the view: a click on it selects it (empty sky selects nothing).
  await page.mouse.click(20, 135);
  await expect(page.locator('.cz-info')).toHaveCount(0);
  await page.mouse.click(240, 135);
  await expect(page.locator('.cz-info .cz-info-title')).toHaveText('Moon');
  // A drag is a look, not a selection.
  await page.keyboard.press('Escape');
  await expect(page.locator('.cz-info')).toHaveCount(0);
  await page.mouse.move(240, 135);
  await page.mouse.down();
  await page.mouse.move(260, 150, { steps: 3 });
  await page.mouse.up();
  await expect(page.locator('.cz-info')).toHaveCount(0);
  // Orbit lines and labels switch off and on from the keyboard.
  await page.keyboard.press('Shift+L');
  await page.evaluate(() => window.__universe!.renderFrames(1));
  await expect(page.locator('.cz-labels')).toBeHidden();
  await page.keyboard.press('Shift+L');
  await page.evaluate(() => window.__universe!.renderFrames(1));
  await expect(page.locator('.cz-labels')).toBeVisible();
  expect(await page.evaluate(() => window.__universe!.errors())).toEqual([]);
  expect(problems).toEqual([]);
});

test('shell: Land sets down on the Moon and walks; Take off flies again', async ({ page }) => {
  // The descent draws close-range terrain for a few hundred software-rendered frames.
  test.setTimeout(240_000);
  const problems: string[] = [];
  await open(page, '?test=1&q=potato&ui=1&b=moon-low-orbit', problems);

  // Land from the HUD: straight down to eye height, then walk mode with a position readout.
  const hud = page.locator('.cz-hud');
  await hud.locator('.cz-land-btn').click();
  let lowest = Infinity;
  const took = await until(page, 14, async () => {
    const c = await cam(page);
    if (c.altitude !== null) lowest = Math.min(lowest, c.altitude);
    return c.mode === 'walk';
  });
  expect(took).toBeLessThanOrEqual(13);
  await frames(page, 3);
  const c = await cam(page);
  expect(c.mode).toBe('walk');
  expect(c.altitude!).toBeGreaterThan(1.5);
  expect(c.altitude!).toBeLessThan(1.9);
  // Never under the ground on the way down.
  expect(lowest).toBeGreaterThan(1.5);
  await expect(hud).toHaveAttribute('data-mode', 'walk');
  await expect(hud.locator('.cz-hud-pos')).toContainText(/°[NS] .*°[EW] · .* up/);
  await page.screenshot({ path: 'artifacts/shell/landed-moon.png' });

  // Take off again.
  await hud.getByRole('button', { name: 'Take off' }).click();
  await page.evaluate(() => window.__universe!.renderFrames(2));
  expect((await cam(page)).mode).toBe('free');
  expect(await page.evaluate(() => window.__universe!.errors())).toEqual([]);
  expect(problems).toEqual([]);
});

test.describe('touch', () => {
  test.use({ hasTouch: true });

  test('shell: a touch screen gets the stick, and the stick flies the camera', async ({ page }) => {
    const problems: string[] = [];
    await open(page, '?test=1&q=potato&ui=1&b=orion-from-earth', problems);
    // A touch screen (coarse pointer, or the first touch on a hybrid) gets the on-screen controls.
    const stick = page.locator('.cz-stick');
    await page.touchscreen.tap(60, 60);
    await expect(stick).toBeVisible();
    await page.screenshot({ path: 'artifacts/shell/touch-controls.png' });

    const before = await cam(page);
    const box = (await stick.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx, cy - 40, { steps: 2 });
    await page.evaluate(() => window.__universe!.renderFrames(30));
    const pushed = await cam(page);
    await page.mouse.up();
    // Pushed forward: the camera moved along its view direction.
    const moved = Math.hypot(
      pushed.local.x - before.local.x,
      pushed.local.y - before.local.y,
      pushed.local.z - before.local.z,
    );
    expect(moved).toBeGreaterThan(1000);
    // Released: it glides to a stop.
    await page.evaluate(() => window.__universe!.renderFrames(120));
    const a = await cam(page);
    await page.evaluate(() => window.__universe!.renderFrames(5));
    const b = await cam(page);
    expect(Math.hypot(b.local.x - a.local.x, b.local.y - a.local.y, b.local.z - a.local.z)).toBe(0);
    expect(await page.evaluate(() => window.__universe!.errors())).toEqual([]);
    expect(problems).toEqual([]);
  });
});

test(
  'shell: a real session lifts the splash, shows the welcome card and opens Explore from it',
  { tag: '@smoke' },
  async ({ page }) => {
    const problems: string[] = [];
    page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
    // No test flag: the rAF loop, the splash and the first-visit card as a visitor gets them.
    await page.goto('?q=potato');
    await expect(page.locator('#boot')).toBeVisible();
    await expect(page.locator('#boot .boot-title')).toHaveText('COSMOS');
    await expect(page.locator('#boot')).toHaveCount(0, { timeout: 90_000 });
    await expect(page.locator('.cz-topbar')).toBeVisible();
    const card = page.locator('.cz-onboard');
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Explore' }).click();
    await expect(card).toHaveCount(0);
    await expect(page.locator('.cz-explore')).toBeVisible();
    // The chosen quality is remembered for the next visit.
    await page.locator('.cz-topbar button[title="Settings"]').click();
    await page.locator('.cz-quality').selectOption('low');
    expect(await page.evaluate(() => localStorage.getItem('cosmos.quality'))).toBe('low');
    expect(problems).toEqual([]);
  },
);
