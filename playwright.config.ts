import { defineConfig, devices } from '@playwright/test';

// E2E runs against the production build (ENG3, PH9). The production host is
// mapped to a local HTTPS server; PostHog and tile hosts are mapped to a
// closed port so a missed route can never reach them. The board's tests
// (tests/e2e/board.spec.ts) run against the board-test build in dist-board/,
// served on the next port, with every /api/ request mocked (V12-128).
const PORT = Number(process.env.E2E_PORT ?? 4443);
const BOARD_PORT = Number(process.env.E2E_BOARD_PORT ?? PORT + 1);
const BOARD_SPEC = /board\.spec\.ts/;
export const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';

// the parameter shadows PORT on purpose: each build has its own server
const browser = (PORT: number) => ({
  ...devices['Desktop Chrome'],
  userAgent: CHROME_UA,
  launchOptions: {
    args: [
      `--host-resolver-rules=MAP museumguessr.com 127.0.0.1:${PORT}, MAP eu.i.posthog.com 127.0.0.1:9, MAP tiles.openfreemap.org 127.0.0.1:9, MAP challenges.cloudflare.com 127.0.0.1:9`,
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
  },
});
const chromium = browser(PORT);
const board = browser(BOARD_PORT);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e.json' }]],
  use: {
    baseURL: 'https://museumguessr.com/',
    ignoreHTTPSErrors: true,
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node tests/e2e/serve.mjs',
      url: `https://127.0.0.1:${PORT}/build.txt`,
      ignoreHTTPSErrors: true,
      reuseExistingServer: !process.env.CI,
      stdout: 'ignore',
    },
    {
      command: 'node tests/e2e/serve.mjs',
      url: `https://127.0.0.1:${BOARD_PORT}/build.txt`,
      env: { E2E_PORT: String(BOARD_PORT), E2E_DIST: 'dist-board' },
      ignoreHTTPSErrors: true,
      reuseExistingServer: !process.env.CI,
      stdout: 'ignore',
    },
  ],
  projects: [
    { name: 'phone', use: { ...chromium, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: false }, testIgnore: BOARD_SPEC },
    { name: 'phone-landscape', use: { ...chromium, viewport: { width: 844, height: 390 } }, grep: /@layout/, testIgnore: BOARD_SPEC },
    { name: 'desktop', use: { ...chromium, viewport: { width: 1280, height: 800 } }, grep: /@layout|@desktop/, testIgnore: BOARD_SPEC },
    { name: 'phone-small', use: { ...chromium, viewport: { width: 375, height: 667 } }, grep: /@layout/, testIgnore: BOARD_SPEC },
    { name: 'phone-inapp', use: { ...chromium, viewport: { width: 390, height: 664 } }, grep: /@layout/, testIgnore: BOARD_SPEC },
    // the board-test build (VITE_BOARD_UI on): the board's own tests, on the same five viewports
    { name: 'board-phone', use: { ...board, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: false }, testMatch: BOARD_SPEC },
    { name: 'board-phone-landscape', use: { ...board, viewport: { width: 844, height: 390 } }, grep: /@layout/, testMatch: BOARD_SPEC },
    { name: 'board-desktop', use: { ...board, viewport: { width: 1280, height: 800 } }, grep: /@layout|@desktop/, testMatch: BOARD_SPEC },
    { name: 'board-phone-small', use: { ...board, viewport: { width: 375, height: 667 } }, grep: /@layout/, testMatch: BOARD_SPEC },
    { name: 'board-phone-inapp', use: { ...board, viewport: { width: 390, height: 664 } }, grep: /@layout/, testMatch: BOARD_SPEC },
  ],
});
