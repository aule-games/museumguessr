// Tracked-path allowlist (ENG20, ENG36). Private local directories must never
// be named in tracked files, so anything outside this list is rejected.
// To add a deliverable, add its directory or root file name here and to the
// fixture in tests/unit/paths.test.ts.

export const ALLOWED_DIRS = [
  'src',
  'data',
  'images',
  'public',
  'scripts',
  'tests',
  'docs',
  'analytics',
  '.github',
  '.githooks',
  'worker',
  'deploy',
];

export const ALLOWED_ROOT_FILES = [
  'index.html',
  'vite.config.ts',
  'vitest.config.ts',
  'playwright.config.ts',
  'wrangler.jsonc',
  'eslint.config.mjs',
  'stylelint.config.mjs',
  'tsconfig.json',
  'package.json',
  'package-lock.json',
  '.nvmrc',
  '.gitignore',
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  'DESIGN.md',
];

export function isAllowedPath(path) {
  const p = path.replace(/^\.\//, '');
  if (!p.includes('/')) return ALLOWED_ROOT_FILES.includes(p);
  const top = p.slice(0, p.indexOf('/'));
  return ALLOWED_DIRS.includes(top);
}
