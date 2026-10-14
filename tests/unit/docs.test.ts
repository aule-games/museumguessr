import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COPY } from '../../src/copy';

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
