// Main-bundle size budget (V1-02). The entry chunk, gzipped at level 9, must
// stay within a fixed byte budget: its size when the v1 deck work began
// (51,008 bytes on 2026-10-16) plus 25%. If the item pool pushes it over,
// move the item data into a lazy chunk rather than raising the budget.

import { gzipSync } from 'node:zlib';

export const MAIN_BUNDLE_GZIP_BUDGET = 64_000;
const MAIN_BUNDLE = /^assets\/index-[\w-]{8}\.js$/;

/**
 * Checks the deployed file list for the main bundle and its gzip size.
 * `read` returns a file's bytes by its dist-relative path.
 * Returns null when the bundle is within budget, otherwise { where, problem }.
 */
export function mainBundleProblem(files, read, budget = MAIN_BUNDLE_GZIP_BUDGET) {
  const main = files.filter((f) => MAIN_BUNDLE.test(f));
  if (main.length !== 1) return { where: 'assets/index-*.js', problem: `expected one main bundle, found ${main.length}` };
  const size = gzipSync(read(main[0]), { level: 9 }).length;
  if (size > budget) return { where: main[0], problem: `main bundle is ${size} bytes gzipped, over the ${budget}-byte budget` };
  return null;
}
