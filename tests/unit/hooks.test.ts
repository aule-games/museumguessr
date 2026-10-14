import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = join(import.meta.dirname, '../../scripts/hooks.mjs');
const ID = ['-c', 'user.name=fixture', '-c', 'user.email=1+fixture@users.noreply.github.com', '-c', 'commit.gpgsign=false'];
const MISSING = 'aa'.repeat(20);

let dir: string;
let repo: string;

function commit(content: string) {
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src/a.ts'), content);
  execFileSync('git', [...ID, 'add', '-A'], { cwd: repo });
  execFileSync('git', [...ID, 'commit', '-q', '--no-verify', '-m', 'fixture'], { cwd: repo });
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
}

/** Runs the pre-push hook for a push of `localSha` over a remote commit this clone never fetched. */
function prePushOverUnknown(localSha: string) {
  const denylist = join(dir, 'denylist');
  writeFileSync(denylist, 'Zebra Holdings\n');
  const r = spawnSync('node', [SCRIPT, 'pre-push'], {
    cwd: repo,
    encoding: 'utf8',
    input: `refs/heads/main ${localSha} refs/heads/main ${MISSING}\n`,
    env: { ...process.env, MG_DENYLIST: denylist },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hooks-test-'));
  repo = join(dir, 'repo');
  mkdirSync(repo);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('[DX17] [ENG4] pre-push hook', () => {
  it('a force push over a remote commit this clone never fetched scans every new commit and lets a clean one through', () => {
    const r = prePushOverUnknown(commit('export const a = 1;\n'));
    expect(r.out).not.toContain('Invalid revision range');
    expect(r.code).toBe(0);
  });
  it('a force push over a remote commit this clone never fetched still blocks a confidential term', () => {
    const r = prePushOverUnknown(commit('// built at zebra-holdings\n'));
    expect(r.out).toContain('confidential term #1 of 1');
    expect(r.out).not.toMatch(/zebra/i);
    expect(r.code).toBe(1);
  });
});
