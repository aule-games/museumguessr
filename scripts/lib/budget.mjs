// Main-bundle size budget (V1-02). The entry chunk, gzipped at level 9, must
// stay within a fixed byte budget: its size when the v1 deck work began
// (51,008 bytes on 2026-10-16) plus 25%. The item records already load as a
// lazy chunk (`assets/items-*.js`) and only the item core is in the entry
// (scripts/lib/items-core.mjs); if the budget fails, find what else grew
// rather than raising it.

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

/**
 * The item records stay out of the main bundle (V1-02): no item caption may
 * appear in it, and one `assets/items-*.js` chunk must hold them.
 * Returns null when they do, otherwise { where, problem }.
 */
export function itemRecordsProblem(files, read, captions) {
  const chunks = files.filter((f) => /^assets\/items-[\w-]{8}\.js$/.test(f));
  if (chunks.length !== 1) return { where: 'assets/items-*.js', problem: `expected one item records chunk, found ${chunks.length}` };
  const main = files.find((f) => MAIN_BUNDLE.test(f));
  const text = main ? read(main).toString('utf8') : '';
  const leaked = captions.find((c) => text.includes(JSON.stringify(c).slice(1, -1)));
  if (leaked !== undefined) return { where: main, problem: `the main bundle contains the item caption "${leaked}"` };
  return null;
}
