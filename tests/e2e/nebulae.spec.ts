import { expect, test, type Page } from '@playwright/test';

/**
 * nebulae at 480x270 potato (semantic probes, no golden images):
 * - m42-telescope: M42 from Earth through 2.5°, north up. θ¹ Ori C sits 1.2 px right and 4.3 px below the
 *   centre; the Huygens region glows around it, brighter to the SW (lower right) than towards the Dark Bay to the
 *   NE (upper left), which catches a flipped registration. Switching the nebula off (?nebulae.enabled=0) leaves
 *   only the panorama and the stars there.
 * - m42-from-20ly: the bowl from 20 ly, the bright core near the centre on black.
 * - trapezium-inside: inside the glowing front, the whole frame lit.
 * - m42-astrophoto: the style switches to Astrophoto on arrival: magenta-red wings and more faint light than the
 *   Realistic style at the same view.
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
    await window.__universe!.renderFrames(4);
  });
  if (!extra) await page.screenshot({ path: `artifacts/nebulae/${bookmark}.png` });
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
  'nebulae: m42-telescope shows the Huygens region the right way round',
  { tag: '@smoke' },
  async ({ page }) => {
    const problems: string[] = [];
    const { probe, stats, errors } = await open(page, 'm42-telescope', problems);
    expect(errors).toEqual([]);
    expect(stats.calls).toBeLessThanOrEqual(150);
    expect(problems).toEqual([]);
    // θ¹ Ori C; 3.5' to the SW (lower right) the brightest nebula, 4' to the NE (upper left) the Dark Bay; far field.
    const [cx, cy] = [241, 139];
    const at = async (p: typeof probe, dx: number, dy: number) =>
      lum(await p(cx + dx - 2, cy + dy - 2, 4, 4));
    const on = {
      core: lum(await probe(cx - 3, cy - 3, 6, 6)),
      sw: await at(probe, 5, 5),
      ne: await at(probe, -8, -4),
    };
    const far = lum(await probe(cx + 120, cy + 60, 12, 12));
    // Without the nebula only the panorama (which holds a blurred M42 of its own) and the star points remain.
    const off: string[] = [];
    const bare = await open(page, 'm42-telescope', off, '&nebulae.enabled=0');
    const swOff = await at(bare.probe, 5, 5);
    const neOff = await at(bare.probe, -8, -4);
    console.log(
      `[nebulae] telescope core ${on.core.toFixed(4)} sw ${on.sw.toFixed(4)}/${swOff.toFixed(4)} ` +
        `ne ${on.ne.toFixed(4)}/${neOff.toFixed(4)} far ${far.toFixed(4)}`,
    );
    expect(on.core).toBeGreaterThan(0.15);
    expect(on.core).toBeGreaterThan(4 * far);
    expect(on.sw - swOff).toBeGreaterThan(0.04); // the nebula's own light SW of the Trapezium
    expect(on.sw - swOff).toBeGreaterThan(3 * Math.max(on.ne - neOff, 1e-4)); // not flipped: the Dark Bay is NE
    expect(off).toEqual([]);
  },
);

test('nebulae: m42-from-20ly shows a bright core on black', async ({ page }) => {
  const problems: string[] = [];
  const { probe, stats, errors } = await open(page, 'm42-from-20ly', problems);
  expect(errors).toEqual([]);
  const centre = await probe(200, 110, 80, 50);
  const corner = await probe(4, 4, 40, 40);
  const off: string[] = [];
  const bare = await open(page, 'm42-from-20ly', off, '&nebulae.enabled=0');
  const centreOff = await bare.probe(200, 110, 80, 50);
  console.log(
    `[nebulae] 20ly centre ${lum(centre).toFixed(4)} corner ${lum(corner).toFixed(4)} without ${lum(centreOff).toFixed(4)}`,
  );
  expect(lum(centre)).toBeGreaterThan(0.03);
  expect(lum(centre)).toBeGreaterThan(10 * lum(corner));
  // The nebula adds a glow around the (star-lit) centre.
  expect(lum(centre) - lum(centreOff)).toBeGreaterThan(0.03);
  expect(lum(centre)).toBeGreaterThan(1.5 * lum(centreOff));
  expect(stats.calls).toBeLessThanOrEqual(150);
  expect(problems).toEqual([]);
  expect(off).toEqual([]);
});

test('nebulae: trapezium-inside is surrounded by the glowing front', async ({ page }) => {
  const problems: string[] = [];
  const { probe, stats, errors } = await open(page, 'trapezium-inside', problems);
  expect(errors).toEqual([]);
  const centre = await probe(160, 90, 160, 90);
  const whole = await probe(0, 0, 480, 270);
  console.log(
    `[nebulae] inside centre ${lum(centre).toFixed(4)} whole ${lum(whole).toFixed(4)} rgb ${whole.map((v) => v.toFixed(3))}`,
  );
  expect(lum(centre)).toBeGreaterThan(0.05);
  expect(lum(whole)).toBeGreaterThan(0.02);
  for (const c of whole) expect(Number.isFinite(c)).toBe(true);
  expect(lum(centre)).toBeLessThan(0.9); // not blown out
  expect(stats.calls).toBeLessThanOrEqual(150);
  expect(problems).toEqual([]);
});

test('nebulae: m42-astrophoto switches the style on and stretches the wings', async ({ page }) => {
  const problems: string[] = [];
  const { probe, errors } = await open(page, 'm42-astrophoto', problems);
  expect(errors).toEqual([]);
  const wings = await probe(300, 160, 120, 90);
  const off: string[] = [];
  const real = await open(page, 'm42-astrophoto', off, '&nebulae.style=realistic');
  const wingsReal = await real.probe(300, 160, 120, 90);
  console.log(
    `[nebulae] astrophoto wings ${wings.map((v) => v.toFixed(4))} realistic ${wingsReal.map((v) => v.toFixed(4))}`,
  );
  expect(lum(wings)).toBeGreaterThan(2 * lum(wingsReal));
  // Magenta-red hydrogen: red and blue above green.
  expect(wings[0]).toBeGreaterThan(1.3 * wings[1]);
  expect(wings[2]).toBeGreaterThan(wings[1]);
  expect(problems).toEqual([]);
  expect(off).toEqual([]);
});
