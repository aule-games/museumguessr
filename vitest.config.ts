import { defineConfig } from 'vitest/config';
import { itemsCore } from './scripts/lib/items-core.mjs';

export default defineConfig({
  // src/content/items.ts reads the item core from this virtual module (V1-02).
  plugins: [itemsCore()],
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'worker/tests/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**', 'dist-board/**'],
  },
});
