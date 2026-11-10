import { expect, test } from '@playwright/test';
import type { UniverseTestApiExtras } from '../../src/app/test-api';

/**
 * Sweep: every registered bookmark renders without a shader, asset or runtime error. Not part of
 * the smoke run (it visits about ninety views); run it before a release with
 * `pnpm e2e -- tests/e2e/sweep.spec.ts`. A documented exception to the four-bookmarks-per-spec
 * rule: nothing is screenshotted or probed beyond "something was drawn and nothing failed".
 */
const CHUNKS = 6;

for (let chunk = 0; chunk < CHUNKS; chunk++) {
  test(`sweep ${chunk + 1}/${CHUNKS}: bookmarks render without errors`, async ({ page }) => {
    test.setTimeout(900_000);
    const problems: string[] = [];
    page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
    await page.goto('?test=1&q=potato');
    await page.waitForFunction(() => window.__universe !== undefined);
    await page.evaluate(() => window.__universe!.ready());
    const all = await page.evaluate(() =>
      (window.__universe as unknown as UniverseTestApiExtras).bookmarks(),
    );
    expect(all.length).toBeGreaterThan(80);
    const mine = all.filter((_, i) => i % CHUNKS === chunk);
    const failures: string[] = [];
    for (const id of mine) {
      const result = await page.evaluate(async (bookmark) => {
        const u = window.__universe!;
        const before = u.errors().length;
        await u.goto(bookmark);
        await u.ready();
        await u.renderFrames(2);
        await u.ready();
        await u.renderFrames(2);
        const s = u.stats();
        return { errors: u.errors().slice(before), calls: s.calls };
      }, id);
      if (result.errors.length) failures.push(`${id}: ${result.errors.join(' | ').slice(0, 300)}`);
      if (!(result.calls > 0)) failures.push(`${id}: nothing was drawn`);
    }
    expect(failures).toEqual([]);
    expect(problems).toEqual([]);
  });
}
