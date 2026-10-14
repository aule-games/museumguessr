#!/usr/bin/env node
// CI re-check of pushed commits (DX17, ENG5, ENG20): every commit carries the
// GitHub noreply identity and touches only allowlisted paths.
// Usage: node scripts/ci-commits.mjs <before-sha|0000…> <after-sha>

import { execFileSync, spawnSync } from 'node:child_process';
import { isAllowedPath } from './lib/paths.mjs';
import { printProblems } from './lib/report.mjs';

const [before, after = 'HEAD'] = process.argv.slice(2);
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
const known = (sha) => spawnSync('git', ['cat-file', '-e', `${sha}^{commit}`]).status === 0;
// A force push names a `before` commit that no ref holds any more; then every
// commit reachable from `after` is checked.
const range = !before || /^0+$/.test(before) || !known(before) ? [after] : [`${before}..${after}`];
const shas = git('rev-list', ...range).split('\n').filter(Boolean);
const problems = [];
for (const sha of shas) {
  const [ae, ce] = git('show', '-s', '--format=%ae%n%ce', sha).split('\n');
  for (const [role, email] of [['author', ae], ['committer', ce]]) {
    if (!/@users\.noreply\.github\.com$/.test(email ?? '')) {
      problems.push({ where: `commit ${sha.slice(0, 8)}`, problem: `${role} email is not a GitHub noreply address`, why: 'every public commit carries the noreply identity', id: 'ENG5', fix: 'rewrite the unpushed commit with the noreply address', docs: 'docs/release.md#commit-identity' });
    }
  }
  const paths = git('diff-tree', '--no-commit-id', '--name-only', '-r', '--root', sha).split('\n').filter(Boolean);
  for (const p of paths) {
    if (!isAllowedPath(p)) problems.push({ where: `commit ${sha.slice(0, 8)} · ${p}`, problem: 'path is outside the tracked-path allowlist', why: 'private local files must never be committed', id: 'ENG20', fix: 'remove the file from the commit', docs: 'docs/release.md#path-allowlist' });
  }
}
if (problems.length) {
  printProblems(problems);
  process.exit(1);
}
console.log(`ci-commits: ${shas.length} commit(s) OK`);
