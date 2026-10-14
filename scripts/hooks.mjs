#!/usr/bin/env node
// Git hooks (DX17, ENG4, ENG5, ENG20): commit identity, tracked-path
// allowlist, confidential-name scan and the item check. Never bypass them
// with --no-verify (AGENTS.md).
//
// Usage: node scripts/hooks.mjs <pre-commit|commit-msg <file>|pre-push>

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildMatcher, loadDenylist } from './lib/denylist.mjs';
import { isAllowedPath } from './lib/paths.mjs';
import { printProblems } from './lib/report.mjs';

const NOREPLY = /@users\.noreply\.github\.com$/;
const ZERO = /^0+$/;
const DOCS = 'docs/release.md';

const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const root = git('rev-parse', '--show-toplevel').trim();

function denylistMatcher() {
  const { path, terms } = loadDenylist(root);
  if (!terms) {
    process.stderr.write(`denylist scan SKIPPED (no file at ${path.startsWith(root) ? '.denylist' : path})\n`);
    return null;
  }
  return { match: buildMatcher(terms), count: terms.length };
}

function emailOf(ident) {
  const m = ident.match(/<([^>]*)>/);
  return m ? m[1] : '';
}

function identityProblems(label, author, committer) {
  const out = [];
  for (const [role, email] of [['author', author], ['committer', committer]]) {
    if (!NOREPLY.test(email)) {
      out.push({
        where: label,
        problem: `${role} email is not a GitHub noreply address`,
        why: 'the repo becomes public and every commit must carry the noreply identity',
        id: 'ENG5',
        fix: 'git config user.email <id>+<user>@users.noreply.github.com, then amend the commit with --reset-author',
        docs: `${DOCS}#commit-identity`,
      });
    }
  }
  return out;
}

function scanText(dl, text, where, problems, lineOf = (n) => n) {
  if (!dl) return;
  for (const hit of dl.match(text)) {
    problems.push({
      where: `${where}:${lineOf(hit.line)}`,
      problem: `confidential term #${hit.term} of ${dl.count} found`,
      why: 'confidential names must never enter tracked files or commit metadata',
      id: 'G2',
      fix: 'remove the term, re-stage and commit again (the term itself is never printed)',
      docs: `${DOCS}#denylist`,
    });
  }
}

function preCommit() {
  const problems = [];
  problems.push(
    ...identityProblems(
      'staged commit',
      emailOf(git('var', 'GIT_AUTHOR_IDENT')),
      emailOf(git('var', 'GIT_COMMITTER_IDENT')),
    ),
  );

  const staged = git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z')
    .split('\0')
    .filter(Boolean);
  for (const p of staged) {
    if (!isAllowedPath(p)) {
      problems.push({
        where: p,
        problem: 'path is outside the tracked-path allowlist',
        why: 'private local directories and files must never be committed',
        id: 'ENG20',
        fix: 'unstage it (git restore --staged <path>), or add a real deliverable to scripts/lib/paths.mjs and its fixture test',
        docs: `${DOCS}#path-allowlist`,
      });
    }
  }

  const dl = denylistMatcher();
  if (dl) {
    for (const p of staged) scanText(dl, p, `path ${p}`, problems);
    const diff = git('diff', '--cached', '--text', '-U0', '--no-color');
    let file = '?';
    let line = 0;
    for (const l of diff.split('\n')) {
      if (l.startsWith('+++ ')) file = l.slice(6);
      else if (l.startsWith('@@')) line = Number(l.match(/\+(\d+)/)?.[1] ?? 0) - 1;
      else if (l.startsWith('+')) {
        line += 1;
        const at = line;
        scanText(dl, l.slice(1), file, problems, () => at);
      }
    }
  }

  const touchesContent = staged.some((p) => p.startsWith('data/') || p.startsWith('images/'));
  if (touchesContent && existsSync(join(root, 'scripts/items.mjs'))) {
    const r = spawnSync(process.execPath, [join(root, 'scripts/items.mjs'), 'check'], {
      cwd: root,
      stdio: 'inherit',
    });
    if (r.status !== 0) {
      problems.push({
        problem: 'items check failed',
        why: 'an item without complete evidence does not ship',
        id: 'E7',
        fix: 'fix the errors printed above, then commit again',
        docs: 'docs/content.md#check-items',
      });
    }
  }
  return problems;
}

function commitMsg(file) {
  const problems = [];
  const dl = denylistMatcher();
  scanText(dl, readFileSync(file, 'utf8'), 'commit message', problems);
  return problems;
}

function prePush() {
  const problems = [];
  const dl = denylistMatcher();
  const input = readFileSync(0, 'utf8');
  for (const line of input.split('\n').filter(Boolean)) {
    const [, localSha, , remoteSha] = line.split(' ');
    if (ZERO.test(localSha)) continue; // branch deletion
    // A new branch, or a force push over a remote commit this clone never
    // fetched: scan everything no remote-tracking ref already holds.
    const known = spawnSync('git', ['cat-file', '-e', `${remoteSha}^{commit}`]).status === 0;
    const range = ZERO.test(remoteSha) || !known ? [localSha, '--not', '--remotes'] : [`${remoteSha}..${localSha}`];
    const shas = git('rev-list', ...range).split('\n').filter(Boolean);
    for (const sha of shas) {
      const meta = git('show', '-s', '--format=%ae%x00%ce%x00%an %cn%n%B', sha);
      const [ae, ce, rest] = meta.split('\0');
      problems.push(...identityProblems(`commit ${sha.slice(0, 8)}`, ae, ce));
      scanText(dl, rest, `commit ${sha.slice(0, 8)} message`, problems);
      if (dl) {
        const patch = git('show', '--text', '--format=', '--no-color', sha);
        scanText(dl, patch, `commit ${sha.slice(0, 8)} patch line`, problems);
      }
    }
  }
  return problems;
}

const [cmd, arg] = process.argv.slice(2);
const run = { 'pre-commit': preCommit, 'commit-msg': () => commitMsg(arg), 'pre-push': prePush }[cmd];
if (!run) {
  process.stderr.write('usage: node scripts/hooks.mjs <pre-commit|commit-msg <file>|pre-push>\n');
  process.exit(2);
}
const problems = run();
if (problems.length) {
  printProblems(problems);
  process.stderr.write(`${cmd}: ${problems.length} problem(s); nothing was ${cmd === 'pre-push' ? 'pushed' : 'committed'}\n`);
  process.exit(1);
}
