import { expect, test } from '@playwright/test';

/**
 * eclipses at 480x270 potato. eclipse-2027-luxor: on the ground in Luxor at mid-totality (fovY 6 deg),
 * the black Moon (radius ~13 px) at the centre, the corona around it, a dark sky.
 */
type RGB = [number, number, number];
const lum = ([r, g, b]: RGB) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

test(
  'eclipse-2027-luxor: dark sky, bright corona ring around a dark disk',
  { tag: '@smoke' },
  async ({ page }) => {
    const problems: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
    });
    page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
    await page.goto('?test=1&q=potato&b=eclipse-2027-luxor');
    await page.waitForFunction(() => window.__universe !== undefined);
    await page.evaluate(async () => {
      await window.__universe!.ready();
      await window.__universe!.renderFrames(1);
      await window.__universe!.ready();
      await window.__universe!.renderFrames(4);
    });
    await page.screenshot({ path: 'artifacts/eclipses/eclipse-2027-luxor.png' });
    const probe = async (x: number, y: number, w: number, h: number) =>
      lum(
        (await page.evaluate(([a, b, c, d]) => window.__universe!.probe(a, b, c, d), [
          x,
          y,
          w,
          h,
        ] as const)) as RGB,
      );
    const stats = await page.evaluate(() => window.__universe!.stats());
    const errors = await page.evaluate(() => window.__universe!.errors());
    expect(errors).toEqual([]);
    expect(problems).toEqual([]);
    const centre = await probe(234, 129, 12, 12);
    // Ring samples 15-21 px from the centre (just outside the Moon's limb) on four sides.
    const ring = [
      await probe(219, 132, 6, 6),
      await probe(255, 132, 6, 6),
      await probe(237, 114, 6, 6),
      await probe(237, 150, 6, 6),
    ];
    const ringMean = ring.reduce((a, b) => a + b, 0) / ring.length;
    const corners = Math.max(await probe(0, 0, 40, 30), await probe(440, 240, 40, 30));
    expect(ringMean).toBeGreaterThan(0.05);
    expect(Math.min(...ring)).toBeGreaterThan(2 * centre);
    expect(centre).toBeLessThan(0.3 * ringMean);
    expect(corners).toBeLessThan(0.25 * ringMean); // dark sky
    expect(stats.calls).toBeLessThanOrEqual(150);
  },
);
