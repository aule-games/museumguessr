import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without types
import { mergeUnitReports, notRun, STEPS, workerDepsProblem } from '../../scripts/verify.mjs';

const ROOT = join(import.meta.dirname, '../..');
type Step = { name: string; needs?: string; required?: boolean; skip?: () => string | null };
const steps = STEPS as Step[];
const names = steps.map((s) => s.name);

describe('npm run verify', () => {
  it('runs the Worker type check and unit tests and the wrangler dev suite, and a missing required prerequisite fails the run [V12-31]', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts.typecheck).toBe('tsc -p . && tsc -p worker');
    expect(readFileSync(join(ROOT, 'vitest.config.ts'), 'utf8')).toContain("'worker/tests/**/*.test.ts'");
    const at = (n: string) => names.indexOf(n);
    expect(at('Worker routing suite (wrangler dev)')).toBeGreaterThan(at('build checks'));
    expect(at('Worker routing suite (wrangler dev)')).toBeLessThan(at('browser tests (5 viewports)'));
    const suite = steps[at('Worker routing suite (wrangler dev)')]!;
    expect(suite).toMatchObject({ needs: 'build checks', required: true });
    expect(notRun({ ...suite, skip: () => 'wrangler missing' }, [{ name: 'build checks', status: 'passed' }])).toEqual({ status: 'failed', note: 'missing prerequisite: wrangler missing' });
    expect(notRun({ ...suite, skip: () => null }, [{ name: 'build checks', status: 'passed' }])).toBeNull();
    expect(notRun(suite, [{ name: 'build checks', status: 'failed' }])).toEqual({ status: 'skipped', note: 'build checks did not pass' });
    // The release scans may stay SKIPPED in CI, where there is no denylist.
    const scan = steps.find((s) => s.name === 'release scan (built output)')!;
    expect(notRun({ ...scan, skip: () => 'no denylist' }, [{ name: 'build checks', status: 'passed' }])).toEqual({ status: 'skipped', note: 'no denylist' });
  });

  it('installs the pinned Worker dependencies when they are missing and reports a failed install [V12-31]', () => {
    const root = mkdtempSync(join(tmpdir(), 'mg-verify-'));
    try {
      mkdirSync(join(root, 'worker/node_modules/wrangler'), { recursive: true });
      writeFileSync(join(root, 'worker/package.json'), JSON.stringify({ devDependencies: { wrangler: '4.151.0' } }));
      let installs = 0;
      expect(workerDepsProblem(root, () => (installs++, 1))).toBe('the Worker dependencies could not be installed (npm ci --prefix worker; wrangler 4.151.0)');
      expect(workerDepsProblem(root, () => (installs++, 0))).toBeNull();
      writeFileSync(join(root, 'worker/node_modules/wrangler/package.json'), JSON.stringify({ version: '4.151.0' }));
      expect(workerDepsProblem(root, () => (installs++, 1))).toBeNull();
      expect(installs).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
    expect(mergeUnitReports({ testResults: [1] }, null, { testResults: [2] })).toEqual({ testResults: [1, 2] });
    expect(mergeUnitReports(null, null)).toBeNull();
  });
});
