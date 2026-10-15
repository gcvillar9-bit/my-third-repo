import { expect, test, type Page } from '@playwright/test';

/**
 * sun at 480x270 potato. sun-closeup: 21,000 km above the photosphere looking 50 deg off nadir;
 * granulation fills the frame (cells largest at the bottom), black space above the limb at the top.
 * sun-sunspots: straight down on the biggest simulated bipolar group (leading spot right or left, a
 * fragmented following cluster on the other side, near-black umbrae, pores).
 * sun-halpha-prominences: H-alpha filter on, deep red-orange limb across the lower half with filaments
 * and plage on the disk, a hedgerow prominence above it; the Settings select switches it off and on.
 * eclipse-2027-luxor (eclipses module): reached from the H-alpha view, the filter switched on by arrival
 * goes back off, so totality shows the white-light corona.
 */
type RGB = [number, number, number];
const lum = ([r, g, b]: RGB) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

async function open(page: Page, bookmark: string, problems: string[], extra = '') {
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.goto(`?test=1&q=potato&b=${bookmark}${extra}`);
  await page.waitForFunction(() => window.__universe !== undefined);
  await page.evaluate(async () => {
    await window.__universe!.ready();
    await window.__universe!.renderFrames(1);
    await window.__universe!.ready();
    await window.__universe!.renderFrames(4);
  });
  if (!extra) await page.screenshot({ path: `artifacts/sun/${bookmark}.png` });
  const probe = (x: number, y: number, w: number, h: number) =>
    page.evaluate(([a, b, c, d]) => window.__universe!.probe(a, b, c, d), [
      x,
      y,
      w,
      h,
    ] as const) as Promise<RGB>;
  const stats = await page.evaluate(() => window.__universe!.stats());
  const errors = await page.evaluate(() => window.__universe!.errors());
  return { probe, stats, errors };
}

test(
  'sun-closeup: granulated photosphere with contrast, space above the limb',
  { tag: '@smoke' },
  async ({ page }) => {
    const problems: string[] = [];
    const { probe, stats, errors } = await open(page, 'sun-closeup', problems);
    expect(errors).toEqual([]);
    expect(problems).toEqual([]);
    // A row of 3x3 px samples across the lower frame, where granules span several pixels.
    const row: number[] = [];
    for (let x = 40; x < 440; x += 5) row.push(lum(await probe(x, 228, 3, 3)));
    const mean = row.reduce((a, b) => a + b, 0) / row.length;
    let hp = 0;
    for (let i = 1; i < row.length; i++) hp += Math.abs(row[i] - row[i - 1]);
    hp /= (row.length - 1) * mean;
    expect(mean).toBeGreaterThan(0.08); // bright photosphere
    expect(hp).toBeGreaterThan(0.025); // granulation: neighbouring samples differ by several percent
    const space = lum(await probe(180, 1, 120, 4));
    expect(space).toBeLessThan(0.2 * mean); // above the limb
    expect(stats.calls).toBeLessThanOrEqual(150);
  },
);

test(
  'sun-sunspots: a bipolar group of near-black umbrae in a bright granulated photosphere',
  { tag: '@smoke' },
  async ({ page }) => {
    const problems: string[] = [];
    const { probe, stats, errors } = await open(page, 'sun-sunspots', problems);
    expect(errors).toEqual([]);
    expect(problems).toEqual([]);
    expect(stats.calls).toBeLessThanOrEqual(150);
    const samples: { v: number; x: number }[] = [];
    for (let y = 10; y < 270; y += 10)
      for (let x = 10; x < 480; x += 10) samples.push({ v: lum(await probe(x, y, 2, 2)), x });
    const lums = samples.map((s) => s.v).sort((a, b) => a - b);
    const median = lums[lums.length >> 1];
    expect(median).toBeGreaterThan(0.08); // the photosphere fills the frame
    expect(lums[3]).toBeLessThan(0.18 * median); // near-black umbrae
    expect(lums.filter((v) => v < 0.6 * median).length).toBeLessThan(0.4 * lums.length);
    // Bipolar: spots on both sides of the frame (leading spot and following cluster).
    const dark = samples.filter((s) => s.v < 0.35 * median);
    expect(dark.filter((s) => s.x < 160).length).toBeGreaterThanOrEqual(2);
    expect(dark.filter((s) => s.x > 320).length).toBeGreaterThanOrEqual(2);
  },
);

test('sun-halpha-prominences: red disk with filaments and plage, prominence above the limb', async ({
  page,
}) => {
  const problems: string[] = [];
  const { probe, stats, errors } = await open(page, 'sun-halpha-prominences', problems);
  expect(errors).toEqual([]);
  expect(problems).toEqual([]);
  expect(stats.calls).toBeLessThanOrEqual(150);
  const disk = await probe(200, 250, 80, 15);
  expect(lum(disk)).toBeGreaterThan(0.05);
  expect(disk[0]).toBeGreaterThan(3 * disk[2]); // R >> B
  expect(disk[0]).toBeGreaterThan(4 * disk[1]); // deep red-orange, not salmon
  // The limb crosses the frame centre around y = 117; the prominence rises above it.
  const sky = lum(await probe(0, 0, 40, 20));
  let best = 0;
  for (let y = 45; y < 106; y += 4)
    for (let x = 150; x < 330; x += 6) best = Math.max(best, lum(await probe(x, y, 3, 3)));
  expect(best).toBeGreaterThan(0.03);
  expect(best).toBeGreaterThan(5 * sky + 0.01);
  // On the disk: dark filaments / spots and bright plage around active regions.
  const d: number[] = [];
  for (let y = 165; y < 266; y += 10)
    for (let x = 6; x < 474; x += 12) {
      const v = lum(await probe(x, y, 3, 3));
      if (v > 0.01) d.push(v);
    }
  d.sort((a, b) => a - b);
  const dm = d[d.length >> 1];
  expect(d[0]).toBeLessThan(0.6 * dm);
  expect(d[d.length - 1]).toBeGreaterThan(1.25 * dm);
});

test('sun-halpha-prominences: the Solar filter setting switches H-alpha off and on', async ({ page }) => {
  const problems: string[] = [];
  const { probe, errors } = await open(page, 'sun-halpha-prominences', problems, '&ui=1');
  expect(errors).toEqual([]);
  // The bookmark switched the 'Solar filter' setting on; Settings switches it off and on again.
  await page.locator('.cz-topbar button[title="Settings"]').click();
  const filter = page.locator('.cz-setting', { hasText: 'Solar filter' }).locator('select');
  await expect(filter).toHaveValue('halpha');
  const at = [100, 215, 60, 20] as const; // disk, left of the settings panel
  const red = await probe(...at);
  expect(red[0]).toBeGreaterThan(3 * red[2]);
  const sky = lum(await probe(0, 0, 40, 20));
  await filter.selectOption('off');
  await page.evaluate(() => window.__universe!.renderFrames(4));
  const white = await probe(...at);
  expect(lum(white)).toBeGreaterThan(0.05);
  expect(white[0]).toBeLessThan(1.5 * white[2]); // white light
  // Pre-exposed: the prominence above the limb vanishes next to the white-light disk.
  const above = lum(await probe(225, 60, 30, 20));
  expect(above).toBeLessThan(2 * sky + 0.004);
  await filter.selectOption('halpha');
  await page.evaluate(() => window.__universe!.renderFrames(4));
  const again = await probe(...at);
  expect(again[0]).toBeGreaterThan(3 * again[2]);
  expect(await page.evaluate(() => window.__universe!.errors())).toEqual([]);
  expect(problems).toEqual([]);
});

test('sun-halpha-prominences then eclipse-2027-luxor: the arrival filter goes back off for totality', async ({
  page,
}) => {
  const problems: string[] = [];
  const { probe, errors } = await open(page, 'sun-halpha-prominences', problems, '&ui=1');
  expect(errors).toEqual([]);
  await page.locator('.cz-topbar button[title="Settings"]').click();
  const filter = page.locator('.cz-setting', { hasText: 'Solar filter' }).locator('select');
  await expect(filter).toHaveValue('halpha');
  await page.evaluate(async () => {
    await window.__universe!.goto('eclipse-2027-luxor');
    await window.__universe!.ready();
    await window.__universe!.renderFrames(4);
  });
  await expect(filter).toHaveValue('off');
  // The white-light corona around the Moon (eclipses.spec ring samples), not a red H-alpha ring.
  const centre = await probe(234, 129, 12, 12);
  const ring = [
    await probe(219, 132, 6, 6),
    await probe(255, 132, 6, 6),
    await probe(237, 114, 6, 6),
    await probe(237, 150, 6, 6),
  ];
  const mean = [0, 1, 2].map((k) => ring.reduce((a, c) => a + c[k], 0) / ring.length) as RGB;
  expect(lum(mean)).toBeGreaterThan(0.05);
  expect(Math.min(...ring.map(lum))).toBeGreaterThan(2 * lum(centre));
  expect(mean[0]).toBeLessThan(1.6 * mean[2]);
  expect(await page.evaluate(() => window.__universe!.errors())).toEqual([]);
  expect(problems).toEqual([]);
});
