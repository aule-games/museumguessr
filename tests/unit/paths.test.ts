import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without types
import { isAllowedPath } from '../../scripts/lib/paths.mjs';

describe('[ENG20] [ENG36] tracked-path allowlist', () => {
  it.each([
    'src/main.ts',
    'data/items.json',
    'images/01.jpg',
    'public/favicon.svg',
    'scripts/items.mjs',
    'tests/unit/x.test.ts',
    'docs/analytics.md',
    'analytics/queries/kpi.sql',
    '.github/workflows/verify.yml',
    '.githooks/pre-commit',
    'worker/src/index.ts',
    'worker/package.json',
    'deploy/profile.json',
    'wrangler.jsonc',
    'index.html',
    'vite.config.ts',
    'package.json',
    'package-lock.json',
    'README.md',
    'AGENTS.md',
    'CLAUDE.md',
    'DESIGN.md',
  ])('accepts %s', (p) => expect(isAllowedPath(p)).toBe(true));
  it.each(['plans/notes.md', '.tool/settings.json', '.cache-dir/x', '.denylist', 'AGENTS.local.md', '.writer', '.agent-clone/DESIGN.md', 'notes.txt', '.wrangler/state/x', 'wrangler.toml', '.dev.vars'])(
    'rejects %s',
    (p) => expect(isAllowedPath(p)).toBe(false),
  );
});
