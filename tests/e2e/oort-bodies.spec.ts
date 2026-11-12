import { expect, test, type Page } from '@playwright/test';

/**
 * oort bodies at 480x270 potato. Screen positions come from labels (data-x / data-y are the projected
 * anchors): each shell's label sits on its ecliptic circle and each passing star's label at its closest
 * approach, so the probes follow the bookmark geometry. ui=1 for the label layer; the HUD is hidden.
 */
type Rgb = [number, number, number];
const lum = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

async function open(page: Page, bookmark: string): Promise<string[]> {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.goto(`?test=1&q=potato&ui=1&b=${bookmark}`);
  await page.waitForFunction(() => window.__universe !== undefined);
  await page.evaluate(async () => {
    await window.__universe!.ready();
    await window.__universe!.renderFrames(4);
  });
  await page.addStyleTag({ content: '.cz-root { visibility: hidden !important; }' });
  return problems;
}

async function anchor(page: Page, id: string): Promise<{ x: number; y: number }> {
  const label = page.locator(`.cz-label[data-label-id="${id}"]`).first();
  await expect(label).toHaveCount(1);
  return { x: Number(await label.getAttribute('data-x')), y: Number(await label.getAttribute('data-y')) };
}

const probe = (page: Page, x: number, y: number, size: number) =>
  page.evaluate(([px, py, s]) => window.__universe!.probe(px - s / 2, py - s / 2, s, s), [
    x,
    y,
    size,
  ] as const) as Promise<Rgb>;

/** Brightest of the boxes on a ring of `r` px around (x, y). */
async function ring(page: Page, x: number, y: number, r: number, n: number, size: number): Promise<Rgb[]> {
  const out: Rgb[] = [];
  for (let k = 0; k < n; k++) {
    const t = (2 * Math.PI * k) / n;
    out.push(await probe(page, x + r * Math.cos(t), y + r * Math.sin(t), size));
  }
  return out;
}

test('sednoid-orbits: shells around the Sun and four red-orange orbits', async ({ page }) => {
  const problems = await open(page, 'sednoid-orbits');
  await page.screenshot({ path: 'artifacts/oort/sednoid-orbits.png' });
  expect(await page.evaluate(() => window.__universe!.errors())).toEqual([]);
  expect(problems).toEqual([]);
  const stats = await page.evaluate(() => window.__universe!.stats());
  expect(stats.calls).toBeLessThanOrEqual(150);

  // The Sun is at the centre; the 550 and 1,000 AU shells are labelled (the heliopause label, 9 px from
  // the Sun, gives way to the Sun's).
  for (const id of ['gravity-lens', 'au-1000']) {
    const a = await anchor(page, `oort-shell:${id}`);
    expect(Math.abs(a.x - 240) + Math.abs(a.y - 135)).toBeGreaterThan(5);
    // The line passes through the label anchor.
    expect(lum(await probe(page, a.x, a.y, 5))).toBeGreaterThan(0.01);
  }
  // The 1,000 AU ring is a circle about the Sun: most boxes along it are lit, boxes between rings are not.
  const a1000 = await anchor(page, 'oort-shell:au-1000');
  const r = Math.hypot(a1000.x - 240, a1000.y - 135);
  const on = (await ring(page, 240, 135, r, 24, 5)).filter((c) => lum(c) > 0.008).length;
  const off = (await ring(page, 240, 135, 0.82 * r, 24, 5)).filter((c) => lum(c) > 0.008).length;
  expect(on).toBeGreaterThanOrEqual(16);
  expect(on).toBeGreaterThan(off + 8);

  // Sednoid orbit lines: red-orange boxes somewhere in the frame.
  let orange = 0;
  for (let y = 8; y < 270; y += 12)
    for (let x = 8; x < 480; x += 12) {
      const [cr, cg, cb] = await probe(page, x, y, 12);
      if (cr > 0.006 && cr > 2 * cb && cr > 1.3 * cg) orange++;
    }
  expect(orange).toBeGreaterThanOrEqual(12);
});

test('gliese-710-flyby: the star at closest approach on its track, inside the shells', async ({ page }) => {
  const problems = await open(page, 'gliese-710-flyby');
  await page.screenshot({ path: 'artifacts/oort/gliese-710-flyby.png' });
  expect(await page.evaluate(() => window.__universe!.errors())).toEqual([]);
  expect(problems).toEqual([]);
  const stats = await page.evaluate(() => window.__universe!.stats());
  expect(stats.calls).toBeLessThanOrEqual(150);

  const label = page.locator('.cz-label[data-label-id="gliese-710"]');
  await expect(label).toHaveText('Gliese 710 · closest now');
  const star = await anchor(page, 'gliese-710');
  expect(star.x).toBeGreaterThan(40);
  expect(star.x).toBeLessThan(440);
  expect(star.y).toBeGreaterThan(20);
  expect(star.y).toBeLessThan(250);
  // The star is a bright orange point (red above blue).
  const s = await probe(page, star.x, star.y, 3);
  expect(lum(s)).toBeGreaterThan(0.05);
  expect(s[0]).toBeGreaterThan(s[2]);
  // The track runs through it: lit boxes on a ring around the star, on opposite sides.
  const around = await ring(page, star.x, star.y, 40, 32, 4);
  const lit = around.map((c) => lum(c) > 0.006);
  expect(lit.filter(Boolean).length).toBeGreaterThanOrEqual(2);
  expect(lit.some((v, k) => v && (lit[(k + 16) % 32] || lit[(k + 15) % 32] || lit[(k + 17) % 32]))).toBe(
    true,
  );
  // The 10,000 AU shell is drawn and labelled.
  const shell = await anchor(page, 'oort-shell:au-10000');
  expect(lum(await probe(page, shell.x, shell.y, 5))).toBeGreaterThan(0.01);
});
