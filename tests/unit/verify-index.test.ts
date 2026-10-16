import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without types
import { collectRows } from '../../scripts/verify.mjs';

const unitReport = (title: string, ancestors: string[]) => ({
  testResults: [{ name: `${process.cwd()}/tests/unit/x.test.ts`, assertionResults: [{ title, ancestorTitles: ancestors, status: 'passed' }] }],
});

describe('[V1-01] the verification index', () => {
  it('picks up release-scoped requirement ids such as V1-01 next to the older forms', () => {
    const rows = collectRows(unitReport('[V1-12] keeps the rule [DS12]', ['[R2] [V1-01] outer']), null);
    expect(rows).toHaveLength(1);
    expect([...rows[0].ids].sort()).toEqual(['DS12', 'R2', 'V1-01', 'V1-12']);
    expect(rows[0].rule).toBe('outer › keeps the rule');
  });
});
