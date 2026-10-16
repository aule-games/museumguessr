import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without types
import { itemRecordsProblem, mainBundleProblem } from '../../scripts/lib/budget.mjs';

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
