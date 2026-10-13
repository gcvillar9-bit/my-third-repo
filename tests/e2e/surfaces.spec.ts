import { expect, test, type Page } from '@playwright/test';
import { decode } from 'fast-png';

/**
 * surfaces (P2-C) at 480x270 potato: real relief on the Moon (apollo11-2m), Mars (mars-gale-sunset)
 * and Earth (earth-himalaya). Semantic checks: the skyline is not a smooth curve (per-column horizon
 * rows deviate from a quadratic fit), the ground has local contrast (craters, slopes, detail),
 * zero errors and the draw budgets (<= 400 calls, <= 3M triangles).
 */
type RGB = [number, number, number];
const lum = ([r, g, b]: RGB) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

async function open(page: Page, bookmark: string, problems: string[], query = '', name = bookmark) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.goto(`?test=1&q=potato&b=${bookmark}${query}`);
  await page.waitForFunction(() => window.__universe !== undefined);
  await page.evaluate(async () => {
    await window.__universe!.ready();
    await window.__universe!.renderFrames(1);
    await window.__universe!.ready();
    await window.__universe!.renderFrames(1);
    await window.__universe!.ready();
    await window.__universe!.renderFrames(4);
  });
  const png = decode(await page.screenshot({ path: `artifacts/surfaces/${name}.png` }));
  const probe = (x: number, y: number, w: number, h: number) =>
    page.evaluate(([a, b, c, d]) => window.__universe!.probe(a, b, c, d), [
      x,
      y,
      w,
      h,
    ] as const) as Promise<RGB>;
  const stats = await page.evaluate(() => window.__universe!.stats());
  const errors = await page.evaluate(() => window.__universe!.errors());
  return { png, probe, stats, errors };
}

type Img = ReturnType<typeof decode>;

/** Screenshot luminance (display-referred bytes) at (x, y). */
function L(img: Img, x: number, y: number): number {
  const o = (y * img.width + x) * img.channels;
  const d = img.data;
  return 0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2];
}

/** Per column: the row in [y0, y1) with the strongest sky-to-ground luminance edge (2-px step). */
function skyline(img: Img, y0: number, y1: number, step = 4): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let x = 2; x < img.width - 2; x += step) {
    let best = 0;
    let by = -1;
    for (let y = y0; y < y1 - 2; y++) {
      const e = Math.abs(L(img, x, y + 2) - L(img, x, y));
      if (e > best) {
        best = e;
        by = y + 1;
      }
    }
    if (best > 6) out.push({ x, y: by });
  }
  return out;
}

/** RMS residual (px) of the skyline about its least-squares quadratic. */
function roughness(pts: { x: number; y: number }[]): number {
  // Normal equations for y = a + b t + c t^2, t = x / width.
  const S = [0, 0, 0, 0, 0];
  const T = [0, 0, 0];
  for (const { x, y } of pts) {
    const t = x / 480;
    for (let k = 0; k < 5; k++) S[k] += t ** k;
    for (let k = 0; k < 3; k++) T[k] += y * t ** k;
  }
  const m = [
    [S[0], S[1], S[2], T[0]],
    [S[1], S[2], S[3], T[1]],
    [S[2], S[3], S[4], T[2]],
  ];
  for (let i = 0; i < 3; i++)
    for (let j = i + 1; j < 3; j++) {
      const f = m[j][i] / m[i][i];
      for (let k = i; k < 4; k++) m[j][k] -= f * m[i][k];
    }
  const c = m[2][3] / m[2][2];
  const b = (m[1][3] - m[1][2] * c) / m[1][1];
  const a = (m[0][3] - m[0][1] * b - m[0][2] * c) / m[0][0];
  let e = 0;
  for (const { x, y } of pts) {
    const t = x / 480;
    e += (y - (a + b * t + c * t * t)) ** 2;
  }
  return Math.sqrt(e / pts.length);
}

/** Mean absolute difference between horizontally adjacent pixels over a region (local contrast). */
function texture(img: Img, x0: number, y0: number, w: number, h: number): number {
  let s = 0;
  let m = 0;
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w - 1; x++) {
      s += Math.abs(L(img, x + 1, y) - L(img, x, y));
      m += L(img, x, y);
    }
  return s / Math.max(m, 1);
}

function budgets(stats: { calls: number; triangles: number }) {
  expect(stats.calls).toBeLessThanOrEqual(400);
  expect(stats.triangles).toBeLessThanOrEqual(3e6);
}

test('apollo11-2m: cratered skyline and textured regolith', { tag: '@smoke' }, async ({ page }) => {
  const problems: string[] = [];
  const { png, probe, stats, errors } = await open(page, 'apollo11-2m', problems);
  expect(errors).toEqual([]);
  expect(problems).toEqual([]);
  const ground = lum(await probe(140, 240, 200, 26));
  expect(ground).toBeGreaterThan(0.02);
  const sky = skyline(png, 20, 260);
  expect(sky.length).toBeGreaterThan(60);
  console.log(
    `apollo11-2m skyline rms ${roughness(sky).toFixed(2)} px, texture ${texture(png, 40, 200, 400, 60).toFixed(3)}`,
  );
  expect(roughness(sky)).toBeGreaterThan(0.6);
  expect(texture(png, 40, 200, 400, 60)).toBeGreaterThan(0.01);
  budgets(stats);
});

test('mars-gale-sunset: crater-rim relief against the sunset sky', async ({ page }) => {
  const problems: string[] = [];
  const { png, stats, errors } = await open(page, 'mars-gale-sunset', problems);
  expect(errors).toEqual([]);
  expect(problems).toEqual([]);
  const sky = skyline(png, 100, 268);
  expect(sky.length).toBeGreaterThan(40);
  console.log(`mars-gale-sunset skyline rms ${roughness(sky).toFixed(2)} px`);
  expect(roughness(sky)).toBeGreaterThan(0.6);
  budgets(stats);
});

test('earth-himalaya: ridged mountains under a blue sky', async ({ page }) => {
  const problems: string[] = [];
  const { png, probe, stats, errors } = await open(page, 'earth-himalaya', problems);
  expect(errors).toEqual([]);
  expect(problems).toEqual([]);
  const top = await probe(10, 4, 460, 20);
  expect(top[2]).toBeGreaterThan(top[0]); // blue sky
  const sky = skyline(png, 20, 260);
  expect(sky.length).toBeGreaterThan(40);
  console.log(
    `earth-himalaya skyline rms ${roughness(sky).toFixed(2)} px, texture ${texture(png, 40, 180, 400, 80).toFixed(3)}`,
  );
  expect(roughness(sky)).toBeGreaterThan(0.6);
  expect(texture(png, 40, 180, 400, 80)).toBeGreaterThan(0.01);
  budgets(stats);
});

const TERRARIUM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/**';

test('HD Earth terrain: Terrarium tiles stream from the fixture into the Earth terrain', async ({ page }) => {
  const tiles: string[] = [];
  await page.route(TERRARIUM, (route) => {
    tiles.push(new URL(route.request().url()).pathname);
    return route.fulfill({
      path: 'tests/fixtures/surfaces/terrarium-fixture.png',
      contentType: 'image/png',
      headers: { 'access-control-allow-origin': '*' },
    });
  });
  const problems: string[] = [];
  const { png, stats, errors } = await open(
    page,
    'earth-himalaya',
    problems,
    '&hdterrain=1',
    'earth-himalaya-hd',
  );
  expect(errors).toEqual([]);
  expect(problems).toEqual([]);
  // The 3x3 block around the camera's sub-point (32.3 N 81.3 E) at z9 (7.5 km altitude).
  expect(tiles.length).toBeGreaterThanOrEqual(9);
  expect(tiles).toContain('/elevation-tiles-prod/terrarium/9/371/207.png');
  // The fixture's 6.3 km cones replace the plateau relief: the skyline is still rough terrain.
  expect(roughness(skyline(png, 20, 260))).toBeGreaterThan(0.6);
  budgets(stats);
});

test('HD Earth terrain: unreachable tiles fall back to the baked relief', async ({ page }) => {
  let requests = 0;
  await page.route(TERRARIUM, (route) => {
    requests++;
    return route.abort('connectionrefused');
  });
  const problems: string[] = [];
  const { probe, errors } = await open(
    page,
    'earth-himalaya',
    problems,
    '&hdterrain=1',
    'earth-himalaya-hd-fail',
  );
  expect(requests).toBeGreaterThanOrEqual(9);
  expect(errors).toEqual([]);
  // The browser logs each refused request; nothing else may be reported.
  expect(problems.filter((p) => !/Failed to load resource|ERR_CONNECTION_REFUSED/.test(p))).toEqual([]);
  const ground = await probe(140, 220, 200, 40);
  expect(lum(ground)).toBeGreaterThan(0.02);
});
