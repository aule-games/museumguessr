import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The wrangler dev suite (ENG17, V12-31): runs against `wrangler dev`
// serving the built dist/ locally. npm run verify runs it after the build
// checks; it needs the Worker dependencies (npm ci --prefix worker).
export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  test: {
    environment: 'node',
    include: ['worker/tests/**/*.smoke.ts'],
    globalSetup: ['worker/tests/wrangler-dev.setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
