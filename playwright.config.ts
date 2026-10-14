import { defineConfig, devices } from '@playwright/test';

// E2E runs against the production build (ENG3, PH9). The production host is
// mapped to a local HTTPS server; PostHog and tile hosts are mapped to a
// closed port so a missed route can never reach them.
const PORT = 4443;
export const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';

const chromium = {
  ...devices['Desktop Chrome'],
  userAgent: CHROME_UA,
  launchOptions: {
    args: [
      `--host-resolver-rules=MAP mert-aktas.github.io 127.0.0.1:${PORT}, MAP eu.i.posthog.com 127.0.0.1:9, MAP tiles.openfreemap.org 127.0.0.1:9`,
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
  },
};

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
    baseURL: 'https://mert-aktas.github.io/museumguessr/',
    ignoreHTTPSErrors: true,
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node tests/e2e/serve.mjs',
    url: `https://127.0.0.1:${PORT}/museumguessr/build.txt`,
    ignoreHTTPSErrors: true,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
  },
  projects: [
    { name: 'phone', use: { ...chromium, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: false } },
    { name: 'phone-landscape', use: { ...chromium, viewport: { width: 844, height: 390 } }, grep: /@layout/ },
    { name: 'desktop', use: { ...chromium, viewport: { width: 1280, height: 800 } }, grep: /@layout|@desktop/ },
    { name: 'phone-small', use: { ...chromium, viewport: { width: 375, height: 667 } }, grep: /@layout/ },
    { name: 'phone-inapp', use: { ...chromium, viewport: { width: 390, height: 664 } }, grep: /@layout/ },
  ],
});
