import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without types
import { LAZY_SCREENS, itemRecordsProblem, lazyScreenProblems, mainBundleProblem } from '../../scripts/lib/budget.mjs';

const MAIN = 'assets/index-AbCd1234.js';

describe('[V1-02] the main bundle size budget', () => {
  it('passes a main bundle within its gzip budget', () => {
    const files = [MAIN, 'assets/posthog-AbCd1234.js'];
    expect(mainBundleProblem(files, () => Buffer.from('x'.repeat(10_000)), 1_000)).toBeNull();
  });

  it('fails once the gzipped main bundle grows past the budget', () => {
    // Random bytes barely compress, so 2,000 of them stay well over 1,000 gzipped.
    const problem = mainBundleProblem([MAIN], () => randomBytes(2_000), 1_000);
    expect(problem?.where).toBe(MAIN);
    expect(problem?.problem).toMatch(/over the 1000-byte budget/);
  });

  it('fails when the main bundle is missing or doubled', () => {
    expect(mainBundleProblem(['assets/posthog-AbCd1234.js'], () => Buffer.alloc(0))?.problem).toMatch(/found 0/);
    expect(mainBundleProblem([MAIN, 'assets/index-ZyXw9876.js'], () => Buffer.alloc(0))?.problem).toMatch(/found 2/);
  });

  it('keeps the item records in their own lazy chunk, out of the main bundle', () => {
    const files = [MAIN, 'assets/items-AbCd1234.js'];
    const caption = 'Gold mask with a striped headcloth';
    expect(itemRecordsProblem(files, () => Buffer.from('const core = [];'), [caption])).toBeNull();
    expect(itemRecordsProblem(files, () => Buffer.from(`const r = {"caption":"${caption}"};`), [caption])?.problem).toMatch(/contains the item caption/);
    expect(itemRecordsProblem([MAIN], () => Buffer.alloc(0), [caption])?.problem).toMatch(/found 0/);
  });
});

describe('[V1-02] the lazy screen chunks', () => {
  const markers = Object.values(LAZY_SCREENS as Record<string, string>);
  const chunk = (text: string) => Buffer.from(text);

  it('keeps the reveal, the tour, the menu overlays, the share block and the end screen out of the main bundle [V1-02]', () => {
    const files = [MAIN, 'assets/reveal-AbCd1234.js', 'assets/end-AbCd1234.js'];
    const read = (f: string) => chunk(f === MAIN ? 'const app = import(`./end-AbCd1234.js`);' : markers.map((m) => `"data-test":\`${m}\``).join(','));
    expect(lazyScreenProblems(files, read)).toEqual([]);
    const leaked = lazyScreenProblems(files, (f: string) => chunk(f === MAIN ? '"data-test":`tour-progress`' : markers.join(',')));
    expect(leaked.map((p: { problem: string }) => p.problem)).toEqual(['the tour code (tour-progress) is in the main bundle']);
  });

  it('the main bundle loads no other chunk statically, so the budget covers all the first screen needs [V1-02]', () => {
    const files = [MAIN, 'assets/overlay-AbCd1234.js'];
    const read = (f: string) => chunk(f === MAIN ? 'import{a as e}from"./overlay-AbCd1234.js";' : markers.join(','));
    expect(lazyScreenProblems(files, read).map((p: { problem: string }) => p.problem)).toEqual([
      'the main bundle imports assets/overlay-AbCd1234.js statically, so that chunk loads with every page outside the budget',
    ]);
  });

  it('fails when no chunk carries a lazy screen, so a renamed marker cannot pass unnoticed [V1-02]', () => {
    const problems = lazyScreenProblems([MAIN, 'assets/end-AbCd1234.js'], () => chunk(''), { end: 'end-total' });
    expect(problems.map((p: { problem: string }) => p.problem)).toEqual(['no chunk carries the end code (end-total)']);
  });
});
