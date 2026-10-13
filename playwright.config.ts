import { defineConfig, devices } from '@playwright/test';

/**
 * Headless e2e on CPU-rendered WebGL2 (SwiftShader). Always run through `pnpm e2e`
 * (flock-serialised across worktrees). Port comes from E2E_PORT (slot A 4173, slot B 4174).
 *
 * Server: production build + `vite preview` by default (deterministic, same subpath as Pages).
 * Set E2E_SERVER=dev for a faster local loop on the Vite dev server.
 */
const PORT = Number(process.env.E2E_PORT ?? 4173);
const BASE_PATH = '/my-third-repo/';
const HOST = '127.0.0.1';
const useDevServer = process.env.E2E_SERVER === 'dev' && !process.env.CI;

const serverCommand = useDevServer
  ? `pnpm exec vite --host ${HOST} --port ${PORT} --strictPort`
  : `pnpm exec vite build --logLevel warn && pnpm exec vite preview --host ${HOST} --port ${PORT} --strictPort`;

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'artifacts/test-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI
    ? [['list'], ['html', { outputFolder: 'artifacts/report', open: 'never' }]]
    : [['line']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://${HOST}:${PORT}${BASE_PATH}`,
    viewport: { width: 480, height: 270 },
    deviceScaleFactor: 1,
    screenshot: 'only-on-failure',
    trace: 'off',
    launchOptions: {
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  projects: [{ name: 'chromium' }],
  webServer: {
    command: serverCommand,
    url: `http://${HOST}:${PORT}${BASE_PATH}`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: { BASE: BASE_PATH },
  },
});
