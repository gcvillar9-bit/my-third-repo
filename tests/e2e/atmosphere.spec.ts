import { expect, test, type Page } from '@playwright/test';

/**
 * atmosphere at 480x270 potato. mars-gale-sunset: camera 2 m above Gale crater, Sun 3 deg above the
 * horizon at screen centre-bottom (about x 240, y 156), blue aureole around it, butterscotch sky away.
 */
type RGB = [number, number, number];
const lum = ([r, g, b]: RGB) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

async function open(page: Page, bookmark: string, problems: string[]) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.goto(`?test=1&q=potato&b=${bookmark}`);
  await page.waitForFunction(() => window.__universe !== undefined);
  await page.evaluate(async () => {
    await window.__universe!.ready();
    await window.__universe!.renderFrames(1);
    await window.__universe!.ready();
    await window.__universe!.renderFrames(4);
  });
  await page.screenshot({ path: `artifacts/atmosphere/${bookmark}.png` });
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
  'mars-gale-sunset: blue sky around the low Sun, butterscotch away from it',
  { tag: '@smoke' },
  async ({ page }) => {
    const problems: string[] = [];
    const { probe, stats, errors } = await open(page, 'mars-gale-sunset', problems);
    expect(errors).toEqual([]);
    expect(problems).toEqual([]);
    const nearSun: RGB = await probe(225, 115, 30, 25);
    const away: RGB = await probe(10, 10, 60, 30);
    const ground: RGB = await probe(200, 240, 80, 20);
    expect(lum(nearSun)).toBeGreaterThan(0.02);
    expect(nearSun[2]).toBeGreaterThan(1.08 * nearSun[0]); // blue aureole 15-40 px above the Sun
    expect(away[0]).toBeGreaterThan(away[2]); // butterscotch away from it
    expect(lum(nearSun)).toBeGreaterThan(lum(away));
    expect(lum(ground)).toBeLessThan(lum(away)); // dim ground at sunset
    expect(stats.calls).toBeLessThanOrEqual(150);
  },
);

/**
 * Planet stripe regression (owner report: screen-aligned stripes on Earth from ~18,000 km on medium).
 * Medium marches the atmosphere at half resolution and upsamples it. The reference is medium itself with a
 * per-pixel march (the module's test-only `?atmosphere.march=full`), so only the half-resolution path differs
 * and no other module's preset knobs (terrain error, surface detail) set the floor. Over the lit disc of
 * earth-now (Earth from 3 radii), the half - full luminance difference is averaged per row and per column,
 * high-passed by a 31 px moving mean, and its RMS taken relative to the disc mean: stripes and grids show up
 * there, while smooth differences and per-pixel texture detail do not. Before the fix (depth fetched on the
 * corner between four pixels) medium vs ultra gave 12.5% / 2.5% (rows / columns).
 *
 * Exception to the 480x270 potato rule (documented in docs/modules/atmosphere.md): the metric needs a large
 * disc for its 31 px high-pass, so it runs at 1134x620 on medium; two page loads fit well inside 120 s.
 */
// Measured here: 0.125% / 0.197% (rows / columns), ~33 s for both loads; the limit is twice the worse axis.
const BANDING_LIMIT = 0.004;
const W = 1134;
const H = 620;

/** Linear luminance of the final canvas, bottom row first (WebGL readPixels order). */
async function frameLuminance(page: Page, query: string): Promise<number[]> {
  await page.goto(`?test=1&q=medium&b=earth-now${query}`);
  await page.waitForFunction(() => window.__universe !== undefined);
  const out = await page.evaluate(async () => {
    const u = window.__universe!;
    await u.ready();
    await u.renderFrames(1);
    await u.ready();
    await u.renderFrames(4);
    const gl = document.querySelector('canvas')!.getContext('webgl2')!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const Y: number[] = new Array(w * h);
    for (let i = 0; i < w * h; i++)
      Y[i] =
        0.2126 * lin(px[4 * i] / 255) + 0.7152 * lin(px[4 * i + 1] / 255) + 0.0722 * lin(px[4 * i + 2] / 255);
    return { Y, w, h, errors: u.errors() };
  });
  const tag = query ? 'full' : 'half';
  await page.screenshot({ path: `artifacts/atmosphere/earth-now-medium-${tag}-${W}x${H}.png` });
  expect(out.errors).toEqual([]);
  expect([out.w, out.h]).toEqual([W, H]);
  return out.Y;
}

/** Row and column banding of a - b over the lit disc (fractions of the disc mean luminance). */
function banding(a: number[], b: number[]): { rows: number; cols: number; discPx: number } {
  let max = 0;
  for (const v of b) max = Math.max(max, v);
  const lit = (i: number) => a[i] > 0.03 * max && b[i] > 0.03 * max;
  // Disc mask: lit in both frames and 4 px inside the lit region (no limb or terminator edge).
  const R = 4;
  const mask = new Uint8Array(W * H);
  for (let y = R; y < H - R; y++)
    for (let x = R; x < W - R; x++) {
      let ok = true;
      for (let d = -R; d <= R && ok; d++) ok = lit(y * W + x + d) && lit((y + d) * W + x);
      mask[y * W + x] = ok ? 1 : 0;
    }
  let sum = 0;
  let n = 0;
  for (let i = 0; i < W * H; i++) if (mask[i]) ((sum += b[i]), n++);
  const rms = (lines: number, len: number, at: (l: number, k: number) => number) => {
    const mean: number[] = [];
    for (let l = 0; l < lines; l++) {
      let s = 0;
      let c = 0;
      for (let k = 0; k < len; k++) {
        const i = at(l, k);
        if (mask[i]) ((s += a[i] - b[i]), c++);
      }
      mean.push(c >= 32 ? s / c : NaN);
    }
    let ss = 0;
    let m = 0;
    mean.forEach((v, l) => {
      if (Number.isNaN(v)) return;
      let s = 0;
      let c = 0;
      for (let d = -15; d <= 15; d++) {
        const u = mean[l + d];
        if (u !== undefined && !Number.isNaN(u)) ((s += u), c++);
      }
      ss += (v - s / c) ** 2;
      m++;
    });
    return Math.sqrt(ss / Math.max(m, 1)) / (sum / Math.max(n, 1));
  };
  return {
    rows: rms(H, W, (y, x) => y * W + x),
    cols: rms(W, H, (x, y) => y * W + x),
    discPx: n,
  };
}

test.describe('planet stripes', () => {
  test.use({ viewport: { width: W, height: H } });

  test('earth-now on medium: half-resolution atmosphere without stripes (vs per pixel)', async ({ page }) => {
    test.setTimeout(120_000);
    const t0 = Date.now();
    const problems: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
    });
    page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
    const half = await frameLuminance(page, '');
    const full = await frameLuminance(page, '&atmosphere.march=full');
    expect(problems).toEqual([]);
    const b = banding(half, full);
    console.log(
      `[atmosphere] earth-now ${W}x${H} medium half - per-pixel banding: rows ${(100 * b.rows).toFixed(3)}%, ` +
        `columns ${(100 * b.cols).toFixed(3)}% over ${b.discPx} px (${((Date.now() - t0) / 1e3).toFixed(1)} s)`,
    );
    expect(b.discPx).toBeGreaterThan(40_000); // the lit half of the disc
    expect(b.rows).toBeLessThan(BANDING_LIMIT);
    expect(b.cols).toBeLessThan(BANDING_LIMIT);
  });
});
