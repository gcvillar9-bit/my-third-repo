import { expect, test, type Page } from '@playwright/test';
import type { UniverseTestApiExtras } from '../../src/app/test-api';

/**
 * Phase-2 integration specs (DESIGN 7): every material compiles on the main Phase-2 views, and a
 * round trip Earth -> Saturn -> Earth returns textures and geometries to their baseline (+-5%).
 * The 1 mm jitter spec lives in terrain.spec.ts.
 */
function watch(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  return problems;
}

async function settle(page: Page) {
  await page.evaluate(async () => {
    await window.__universe!.ready();
    await window.__universe!.renderFrames(1);
    await window.__universe!.ready();
    await window.__universe!.renderFrames(4);
  });
}

async function visit(page: Page, id: string) {
  await page.evaluate((b) => window.__universe!.goto(b), id);
  await settle(page);
}

test('compile-all: every material on the Phase-2 views compiles without errors', async ({ page }) => {
  test.setTimeout(120_000);
  const problems = watch(page);
  await page.goto('?test=1&q=potato&b=earth-dawn-400km');
  await page.waitForFunction(() => window.__universe !== undefined);
  await settle(page);
  let programs = 0;
  for (const id of ['earth-dawn-400km', 'apollo11-2m', 'mars-gale-sunset', 'saturn']) {
    if (id !== 'earth-dawn-400km') await visit(page, id);
    programs = await page.evaluate(() =>
      (window.__universe as unknown as UniverseTestApiExtras).compileAll(),
    );
    await page.evaluate(() => window.__universe!.renderFrames(1));
    expect(await page.evaluate(() => window.__universe!.errors()), id).toEqual([]);
  }
  expect(programs).toBeGreaterThan(5);
  expect(problems).toEqual([]);
});

test('leak: Earth -> Saturn -> Earth round trips do not grow textures or geometries (+-5%)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems = watch(page);
  await page.goto('?test=1&q=potato&b=earth-now');
  await page.waitForFunction(() => window.__universe !== undefined);
  await settle(page);
  const start = await page.evaluate(() => window.__universe!.stats());
  const trip = async () => {
    await visit(page, 'saturn');
    await visit(page, 'earth-now');
    await page.evaluate(() => window.__universe!.renderFrames(30));
    return page.evaluate(() => window.__universe!.stats());
  };
  // The first trip loads Saturn's maps and meshes, which stay cached (the ResourceBudget evicts only
  // under memory pressure); the baseline is Earth after that trip. Further trips must not grow.
  const base = await trip();
  const back = await trip();
  const back2 = await trip();
  console.log(
    `leak: start ${JSON.stringify(start)}\nbase ${JSON.stringify(base)}\nback ${JSON.stringify(back2)}`,
  );
  for (const s of [back, back2]) {
    expect(Math.abs(s.textures - base.textures)).toBeLessThanOrEqual(Math.max(1, 0.05 * base.textures));
    expect(Math.abs(s.geometries - base.geometries)).toBeLessThanOrEqual(Math.max(1, 0.05 * base.geometries));
    expect(s.gpuBytes).toBeLessThanOrEqual(1.05 * base.gpuBytes);
  }
  expect(await page.evaluate(() => window.__universe!.errors())).toEqual([]);
  expect(problems).toEqual([]);
});
