import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COPY } from '../../src/copy';

const ROOT = join(import.meta.dirname, '../..');
// Built from pieces, so this file itself never matches.
const SAME = new RegExp(['same', '(10 objects )?', 'for everyone'].join(' ?'), 'i');
const NEW_TEN = new RegExp(['10', 'new', 'objects'].join(' '), 'i');

describe('[V1-14] copy says every game draws its own 10', () => {
  it('neither the copy deck, the README nor the page head says the objects are the same for everyone', () => {
    const files: [string, string][] = [
      ['src/copy.ts', Object.values(COPY).join('\n')],
      ['README.md', readFileSync(join(ROOT, 'README.md'), 'utf8')],
      ['index.html', readFileSync(join(ROOT, 'index.html'), 'utf8')],
    ];
    for (const [name, text] of files) {
      expect(SAME.test(text), name).toBe(false);
      expect(NEW_TEN.test(text), name).toBe(false);
    }
  });

  it('the start line names the live pool size, and README and the page head carry no number', () => {
    expect(COPY['start.meta']).toContain('{total}');
    expect(readFileSync(join(ROOT, 'README.md'), 'utf8').split('\n').slice(0, 6).join(' ')).toMatch(/a new ten every game/i);
    expect(readFileSync(join(ROOT, 'index.html'), 'utf8')).toMatch(/A new ten every game\./);
  });
});
