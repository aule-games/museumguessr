import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without types
import { namesBlock } from '../../scripts/names.mjs';
// @ts-expect-error plain ESM helper without types
import { EXIT, runMain } from '../../scripts/lib/ops.mjs';
import { sink } from './helpers/ops-stubs';

const REPO = join(import.meta.dirname, '../..');
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mg-names-'));
  mkdirSync(join(root, 'src/board'), { recursive: true });
  for (const f of ['name-words.ts', 'name-blocklist.json']) cpSync(join(REPO, 'src/board', f), join(root, 'src/board', f));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const entries = () => (JSON.parse(readFileSync(join(root, 'src/board/name-blocklist.json'), 'utf8')) as { entries: string[] }).entries;
const run = async (...args: string[]) => {
  const io = sink();
  const code = await runMain(() => namesBlock({ root, args, out: io.out }), io.err);
  return { code, text: io.all() };
};

describe('npm run names:block', () => {
  it('adds a whole name or a word pair once, lower-cased, and says that only names containing it change [V12-109]', async () => {
    expect(await run('block', 'Quiet Amber Heron')).toMatchObject({ code: 0, text: expect.stringContaining('every other name stays the same') });
    expect(await run('block', 'amber   HERON')).toMatchObject({ code: 0 });
    expect(await run('block', 'Amber Heron')).toMatchObject({ code: 0, text: expect.stringContaining('already blocked') });
    expect(entries()).toEqual(['quiet amber heron', 'amber heron']);
  });

  it('refuses anything that is not a run of name words in name order, so hostile text never reaches the file [V12-110]', async () => {
    for (const bad of ["Amber'); DROP TABLE scores; --", 'Heron Amber', 'Quiet Amber Heron Fox', 'Purple Heron', '', 'Amber\nHeron', 'Ämber Heron']) {
      const r = await run('block', bad);
      expect(r.code, bad).toBe(EXIT.usage);
      expect(r.text, bad).toMatch(/✖ .*\n {2}why: .*\n {2}next: .*\n {2}docs: docs\/ops\.md#board-names/);
    }
    expect((await run('block')).code).toBe(EXIT.usage);
    expect((await run('unblock', 'Amber Heron')).code).toBe(EXIT.usage);
    expect(entries()).toEqual([]);
  });
});
