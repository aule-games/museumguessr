import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COPY } from '../../src/copy';
// @ts-expect-error plain ESM script without types
import { ANCHOR } from '../../scripts/lib/pool-rules.mjs';

const ROOT = join(import.meta.dirname, '../..');

describe('[DS2] [DX24] the screen spec names real copy keys', () => {
  it('every `key` in docs/screen-spec.md exists in src/copy.ts (a trailing .* matches a prefix)', () => {
    const spec = readFileSync(join(ROOT, 'docs/screen-spec.md'), 'utf8');
    const keys = Object.keys(COPY);
    const refs = [...new Set([...spec.matchAll(/`([a-z]\w*\.[\w.*]+)`/g)].map((m) => m[1] as string))];
    const missing = refs.filter((r) => (r.endsWith('.*') ? !keys.some((k) => k.startsWith(r.slice(0, -1))) : !keys.includes(r)));
    expect(refs.length).toBeGreaterThan(50);
    expect(missing).toEqual([]);
  });
});

describe('[DX5] [V1-12] item-check errors link to real content-guide sections', () => {
  it('every docs anchor used by the items CLI and its pool rules is a heading in docs/content.md', () => {
    const guide = readFileSync(join(ROOT, 'docs/content.md'), 'utf8');
    const headings = new Set([...guide.matchAll(/^## (.+)$/gm)].map((m) => (m[1] as string).toLowerCase().replace(/ /g, '-')));
    const cli = readFileSync(join(ROOT, 'scripts/items.mjs'), 'utf8');
    // The anchor is the last argument of each one-line problem(...) call.
    const used = cli
      .split('\n')
      .filter((l) => l.includes('problem('))
      .map((l) => [...l.matchAll(/'([a-z][a-z-]*)'\)/g)].at(-1)?.[1])
      .filter((a): a is string => !!a);
    used.push(...Object.values(ANCHOR as Record<string, string>));
    expect(used.length).toBeGreaterThan(20);
    expect([...new Set(used)].filter((a) => !headings.has(a))).toEqual([]);
  });
});
