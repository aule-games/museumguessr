// Main-bundle size budget (V1-02). The entry chunk, gzipped at level 9, must
// stay within a fixed byte budget: its size when the v1 deck work began
// (51,008 bytes on 2026-10-16) plus 25%. The item records already load as a
// lazy chunk (`assets/items-*.js`) and only the item core is in the entry
// (scripts/lib/items-core.mjs); the reveal, the tour, the menu overlays and
// the end screen with its share block are lazy chunks too (src/ui/lazy.ts),
// and the entry loads no other chunk statically, so the budget covers
// everything the first screen needs. If the budget fails, find what else
// grew rather than raising it.

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

/**
 * Code only the reveal, the tour, the menu overlays, the share block, the
 * end screen and the weekly board use, each found by a data-test value only
 * that code carries.
 */
export const LAZY_SCREENS = {
  reveal: 'round-score',
  tour: 'tour-progress',
  menu: 'menu-credits',
  share: 'share-block',
  end: 'end-total',
  board: 'board-card',
};

/** A static import of another chunk (dynamic imports use `import(`). */
const STATIC_CHUNK_IMPORT = /\bimport\s*(?:[^'"`()]*?\bfrom\s*)?["']\.\/([\w.-]+\.js)["']/g;

/**
 * The screens the start screen and a round do not need stay out of the main
 * bundle (V1-02): each lazy screen's marker is in some other chunk and not in
 * the main bundle, and the main bundle imports no chunk statically (a
 * shared chunk it needs at once would escape the budget).
 * Returns a list of { where, problem }.
 */
export function lazyScreenProblems(files, read, screens = LAZY_SCREENS) {
  const main = files.find((f) => MAIN_BUNDLE.test(f));
  if (!main) return [{ where: 'assets/index-*.js', problem: 'no main bundle' }];
  const text = read(main).toString('utf8');
  const others = files.filter((f) => f !== main && /^assets\/[\w.-]+\.js$/.test(f)).map((f) => [f, read(f).toString('utf8')]);
  const out = [];
  for (const m of text.matchAll(STATIC_CHUNK_IMPORT)) {
    out.push({ where: main, problem: `the main bundle imports assets/${m[1]} statically, so that chunk loads with every page outside the budget` });
  }
  for (const [screen, marker] of Object.entries(screens)) {
    if (text.includes(marker)) out.push({ where: main, problem: `the ${screen} code (${marker}) is in the main bundle` });
    else if (!others.some(([, t]) => t.includes(marker))) out.push({ where: 'assets/*.js', problem: `no chunk carries the ${screen} code (${marker})` });
  }
  return out;
}
