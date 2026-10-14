import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = join(import.meta.dirname, '../../scripts/ci-commits.mjs');
const MISSING = 'aa'.repeat(20);

let repo: string;

function commit(email: string) {
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src/a.ts'), `export const a = '${email}';\n`);
  const id = ['-c', 'user.name=fixture', '-c', `user.email=${email}`, '-c', 'commit.gpgsign=false'];
  execFileSync('git', [...id, 'add', '-A'], { cwd: repo });
  execFileSync('git', [...id, 'commit', '-q', '-m', 'fixture'], { cwd: repo });
}

function check(before: string) {
  const r = spawnSync('node', [SCRIPT, before, 'HEAD'], { cwd: repo, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'ci-commits-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe('[ENG5] [ENG20] CI commit check', () => {
  it('after a force push whose old commit is gone, checks every commit on the branch and passes noreply ones', () => {
    commit('1+fixture@users.noreply.github.com');
    const r = check(MISSING);
    expect(r.out).toContain('ci-commits: 1 commit(s) OK');
    expect(r.code).toBe(0);
  });
  it('after a force push whose old commit is gone, still rejects a personal email', () => {
    commit('someone@example.com');
    const r = check(MISSING);
    expect(r.out).toContain('author email is not a GitHub noreply address');
    expect(r.code).toBe(1);
  });
});
