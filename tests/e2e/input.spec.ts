import { expect, test, type Page } from '@playwright/test';
import type { UniverseTestApiExtras } from '../../src/app/test-api';

/**
 * Input regression (owner report, P4-P): "when I click with my trackpad to move my sight it
 * sometimes just throws me back to the same spot" (walking at #b=apollo11-2m). Runs a live
 * session (?test=1&live=1: rAF loop, mouse input and URL sync on, view from the #b= hash) and
 * checks that clicks, drags, pointer sequences and hashchange events never restore the bookmark
 * pose once the user has moved.
 */
type Cam = Awaited<ReturnType<UniverseTestApiExtras['camera']>>;

const cam = (page: Page) =>
  page.evaluate(() => (window.__universe as unknown as UniverseTestApiExtras).camera()) as Promise<Cam>;
const dist = (a: Cam, b: Cam) => Math.hypot(a.local.x - b.local.x, a.local.y - b.local.y, a.local.z - b.local.z);
/** Rotation angle between two camera orientations, rad. */
const angle = (a: Cam, b: Cam) => {
  const d = Math.abs(a.quat.x * b.quat.x + a.quat.y * b.quat.y + a.quat.z * b.quat.z + a.quat.w * b.quat.w);
  return 2 * Math.acos(Math.min(1, d));
};
/** Lets the rAF loop run a few real frames. */
const frames = (page: Page, n = 6) =>
  page.evaluate(
    (k) =>
      new Promise<void>((done) => {
        let i = 0;
        const f = () => (++i >= k ? done() : requestAnimationFrame(f));
        requestAnimationFrame(f);
      }),
    n,
  );

/** Radial (vertical) and horizontal parts of a displacement in the body-fixed frame, m. */
const split = (a: Cam, b: Cam) => {
  const ra = Math.hypot(a.local.x, a.local.y, a.local.z);
  const rb = Math.hypot(b.local.x, b.local.y, b.local.z);
  const d = dist(a, b);
  return { vertical: rb - ra, horizontal: Math.sqrt(Math.max(0, d * d - (rb - ra) ** 2)) };
};

async function openLive(page: Page, bookmark: string, problems: string[]) {
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.goto(`?test=1&live=1&q=potato#b=${bookmark}`);
  await page.waitForFunction(() => window.__universe !== undefined);
  await page.evaluate(() => window.__universe!.ready());
  await frames(page);
  // Let the walker land and the terrain converge (ground height refines as tiles arrive).
  let prev = await cam(page);
  for (let i = 0; i < 8; i++) {
    await frames(page, 10);
    const c = await cam(page);
    if (dist(c, prev) < 0.005) break;
    prev = c;
  }
}

test('apollo11-2m walking: clicks and drags never snap the view back', async ({ page }) => {
  const problems: string[] = [];
  await openLive(page, 'apollo11-2m', problems);
  const c0 = await cam(page);
  expect(c0.mode).toBe('walk');
  // Idle walker stays put (it used to fall through the coarse LOD under the feet and get thrown
  // back up when the tile refined).
  await frames(page, 12);
  const idle = await cam(page);
  expect(Math.abs(split(c0, idle).vertical)).toBeLessThan(0.01);
  // Standing at eye height on the relief actually drawn (the bookmark used to start ~560 m up).
  expect(idle.altitude).toBeGreaterThan(1.5);
  expect(idle.altitude).toBeLessThan(2.1);
  // The applied bookmark hash is replaced by the live state at once.
  await expect.poll(() => page.evaluate(() => location.hash)).not.toContain('b=');
  const box = (await page.locator('canvas').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // A click without movement does not move or turn the camera.
  await page.mouse.click(cx, cy);
  await frames(page);
  const c1 = await cam(page);
  expect(dist(c1, c0)).toBeLessThan(0.05);
  expect(angle(c1, c0)).toBeLessThan(1e-3);

  // A drag turns the view (trackpad press-and-move in small steps).
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(cx + i * 10, cy + i * 2);
  await page.mouse.up();
  await frames(page);
  const c2 = await cam(page);
  expect(angle(c2, c0)).toBeGreaterThan(0.2); // 80 px of drag at ~0.004 rad/px

  // Walk forward a little.
  await page.keyboard.down('KeyW');
  await frames(page, 20);
  await page.keyboard.up('KeyW');
  await frames(page);
  const c3 = await cam(page);
  expect(dist(c3, c0)).toBeGreaterThan(0.05);

  // Wait for the URL sync, then: taps, tap-and-hold, sub-pixel drags, a hashchange event and a
  // pointerup arriving without a pointerdown. None of them may restore an earlier pose.
  await page.waitForTimeout(1200);
  await frames(page);
  const before = await cam(page);
  for (let i = 0; i < 4; i++) {
    await page.mouse.click(cx + 30 * i - 45, cy - 20);
    await page.mouse.down();
    await page.mouse.move(cx + 30 * i - 44, cy - 20);
    await page.mouse.up();
  }
  await page.mouse.move(cx, cy);
  await page.mouse.up();
  await page.evaluate(() => window.dispatchEvent(new HashChangeEvent('hashchange')));
  await page.evaluate(() => {
    // A stale history entry or tab restore bringing an earlier hash back.
    history.replaceState(null, '', location.hash);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  await frames(page, 10);
  const after = await cam(page);
  expect(dist(after, before)).toBeLessThan(0.05);
  expect(angle(after, before)).toBeLessThan(0.04); // only the four 1 px drags
  expect(angle(after, c0)).toBeGreaterThan(0.2);
  expect(dist(after, c0)).toBeGreaterThan(0.05); // not thrown back to the bookmark spot
  expect(after.mode).toBe('walk');
  expect(problems).toEqual([]);
  expect(await page.evaluate(() => window.__universe!.errors())).toEqual([]);
});

test('free flight: a lost pointerup does not leave the view turning', async ({ page }) => {
  const problems: string[] = [];
  await openLive(page, 'moon-low-orbit', problems);
  const box = (await page.locator('canvas').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 20, cy);
  // The button is released outside the page (no pointerup reaches the canvas): the next move
  // arrives with no button pressed and must end the drag instead of turning the view.
  await page.evaluate(() => {
    const c = document.querySelector('canvas')!;
    c.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 400, clientY: 200, buttons: 0 }));
  });
  await frames(page);
  const a = await cam(page);
  expect(a.frame).toBeTruthy();
  await page.evaluate(() => {
    const c = document.querySelector('canvas')!;
    for (let i = 0; i < 5; i++)
      c.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 10 + 50 * i, clientY: 30, buttons: 0 }));
  });
  await frames(page);
  const b = await cam(page);
  expect(b.frame).toBe(a.frame);
  expect(angle(a, b)).toBeLessThan(1e-3);
  await page.mouse.up();
  expect(problems).toEqual([]);
});
