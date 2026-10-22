import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM verification helper
import { validateManifest, requirementLedger, renderRequirementLedger } from '../../scripts/lib/requirements.mjs';
// @ts-expect-error plain ESM script
import { clearReports, collectRows } from '../../scripts/verify.mjs';

const ref = { file: 'tests/unit/example.test.ts', title: 'states its rule' };
const manifest = (step = 0) => ({
  release: 'v1.2', built_through_step: step, steps: { 0: 'specification', 1: 'hosting' },
  requirements: [{ id: 'V12-01', step: 0, text: 'The rule | its detail', source: ['N16'], replaces: 'Old rule', tests: [ref] }],
});
const row = (status = 'passed') => ({ ...ref, ids: ['V12-01'], status });

describe('requirement evidence', () => {
  it('completed steps require every linked test to pass [V12-01]', () => {
    expect(requirementLedger(manifest(), [row()])[0]).toMatchObject({ status: 'passed', blocking: false });
    for (const evidence of [[], [row('failed')], [row('skipped')], [{ ...row(), ids: [] }]]) {
      expect(requirementLedger(manifest(), evidence)[0].blocking).toBe(true);
    }
    const m = manifest();
    m.requirements[0]!.tests.push({ file: ref.file, title: 'a second required test' });
    expect(requirementLedger(m, [row()])[0].blocking).toBe(true);
  });

  it('future steps stay not built and cannot borrow an unrelated passing test [V12-01]', () => {
    const m = manifest(); m.requirements[0]!.step = 1;
    expect(requirementLedger(m, [row('skipped')])[0]).toMatchObject({ status: 'not built', blocking: false });
    m.built_through_step = 1;
    expect(requirementLedger(m, [{ ...row(), title: 'different test' }])[0].blocking).toBe(true);
    m.requirements[0]!.tests = [];
    expect(requirementLedger(m, [row()])[0].blocking).toBe(true);
  });

  it('the ledger preserves old wording and rejects malformed manifests [V12-01]', () => {
    expect(renderRequirementLedger(requirementLedger(manifest(), [row()])).join('\n')).toContain('The rule \\| its detail | Old rule | passed');
    const m = manifest(); m.requirements.push(m.requirements[0]!);
    expect(validateManifest(m)).toContain('Invalid or duplicate requirement id: V12-01');
    expect(() => requirementLedger({ ...manifest(), built_through_step: 9 }, [])).toThrow('built_through_step');
    const real = JSON.parse(readFileSync(new URL('../../docs/requirements.json', import.meta.url), 'utf8'));
    expect(validateManifest(real)).toEqual([]);
  });

  it('release identifiers are deduplicated across nested unit and browser titles [V12-07]', () => {
    const unit = { testResults: [{ name: `${process.cwd()}/${ref.file}`, assertionResults: [{ title: '[V12-07] parses ids [V12-07]', ancestorTitles: ['[V12-07] parent [DS12]'], status: 'passed' }] }] };
    const browser = { specs: [{ title: '[V12-07] parses ids', file: 'fixture.spec.ts', tests: [{ projectName: 'phone', results: [{ status: 'passed' }] }] }] };
    const rows = collectRows(unit, browser);
    expect(rows[0].ids).toEqual(['V12-07', 'DS12']);
    expect(rows[1].ids).toEqual(['V12-07']);
    expect(rows[0].title).toBe('parses ids');
  });

  it('isolated Worker tests can supply requirement evidence without accepting arbitrary paths [V12-01]', () => {
    const m = manifest();
    m.requirements[0]!.tests = [{ ...ref, file: 'worker/tests/scores.test.ts' }];
    const report = { testResults: [{ name: `${process.cwd()}/worker/tests/scores.test.ts`, assertionResults: [{ title: 'states its rule [V12-01]', status: 'passed' }] }] };
    expect(validateManifest(m)).toEqual([]);
    expect(requirementLedger(m, collectRows(report, null))[0]).toMatchObject({ status: 'passed', blocking: false });
    for (const file of ['worker/src/scores.ts', '../tests/example.ts', 'tests/../src/example.ts', 'tests/unit/../../secret.ts']) {
      m.requirements[0]!.tests = [{ ...ref, file }];
      expect(validateManifest(m)).toContain('V12-01: invalid test reference');
    }
  });

  it('a new verification run cannot reuse stale passing reports [V12-01]', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mg-evidence-'));
    try {
      const stale = join(dir, 'old.json');
      const unrelated = join(dir, 'keep.json');
      writeFileSync(stale, JSON.stringify({ status: 'passed' }));
      writeFileSync(unrelated, 'untouched');
      clearReports([stale, join(dir, 'missing.json')]);
      expect(existsSync(stale)).toBe(false);
      expect(readFileSync(unrelated, 'utf8')).toBe('untouched');
      expect(requirementLedger(manifest(), collectRows(null, null))[0].blocking).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
