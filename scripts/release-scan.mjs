#!/usr/bin/env node
// Release scan (G2, DX10, DX22, ENG7): before and after the repository goes
// public, look for confidential terms everywhere the public can see them:
// every blob in every ref (pull-request refs included), image and binary
// metadata, commit messages and identities, branch and tag names, and on
// GitHub the description, topics, pull requests, issues and workflow names.
// Terms are never printed; a hit is "term #k of N" plus a location.
//
// Usage:
//   node scripts/release-scan.mjs                 scan the GitHub repo named by `origin`
//   node scripts/release-scan.mjs --github <owner/name>
//   node scripts/release-scan.mjs --local [--repo <dir>]   local history only (pre-publish)
//   node scripts/release-scan.mjs --candidate             a single-commit export of HEAD: what
//                                                          the fresh public repository will hold
//   options: --denylist <path> (default .denylist or $MG_DENYLIST)
//
// Prerequisites: git, exiftool ($MG_EXIFTOOL overrides the path) and, unless
// --local, an authenticated gh. Exit 0: complete, 0 hits. 1: hits or
// problems. 2: scan incomplete (a missing tool, failed authentication or an
// unreadable object); no zero-hit line is printed then.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMatcher, loadDenylist } from './lib/denylist.mjs';
import { printProblems } from './lib/report.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DOCS = 'docs/release.md#release-scan';
const NOREPLY = /@users\.noreply\.github\.com$/;
const BINARY_OK = /^(images|public)\/|\.(woff2?|ttf|otf)$/;

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const candidate = args.includes('--candidate');
const local = candidate || args.includes('--local');
const repoDir = opt('--repo') ?? ROOT;
if (opt('--denylist')) process.env.MG_DENYLIST = opt('--denylist');
const exiftool = process.env.MG_EXIFTOOL || 'exiftool';
const rerun = `node scripts/release-scan.mjs ${args.join(' ')}`.trim();

const problems = [];
const say = (line) => process.stdout.write(`${line}\n`);

class Incomplete extends Error {
  constructor(stage, problem, fix) {
    super(problem);
    this.stage = stage;
    this.fix = fix;
  }
}

function run(cmd, argv, opts = {}) {
  const r = spawnSync(cmd, argv, { encoding: opts.encoding ?? 'utf8', maxBuffer: 512 * 1024 * 1024, cwd: opts.cwd });
  if (r.error) throw new Incomplete(opts.stage ?? cmd, `${cmd} could not run (${r.error.code ?? r.error.message})`, opts.fix);
  if (r.status !== 0) throw new Incomplete(opts.stage ?? cmd, `${cmd} ${argv[0]} failed (exit ${r.status})`, opts.fix);
  return r.stdout;
}

function finish(code, line) {
  if (problems.length) printProblems(problems);
  if (line) say(line);
  if (code !== 0) process.stderr.write(`rerun: ${rerun}\n`);
  process.exit(code);
}

let result = null;
try {
  // ---- stage 1: prerequisites
  const { path: denyPath, terms } = loadDenylist(ROOT);
  if (!terms) throw new Incomplete('prerequisites', `no denylist at ${denyPath === join(ROOT, '.denylist') ? '.denylist' : denyPath}`, 'create the git-excluded .denylist (one term per line) or set MG_DENYLIST');
  if (terms.length === 0) throw new Incomplete('prerequisites', 'the denylist has no terms', 'add the confidential terms to the denylist');
  const match = buildMatcher(terms);
  const N = terms.length;
  run(exiftool, ['-ver'], { stage: 'prerequisites', fix: 'install exiftool (macOS: brew install exiftool; Debian/Ubuntu: apt install libimage-exiftool-perl)' });

  let github = null;
  if (!local) {
    github = opt('--github');
    if (!github) {
      const url = run('git', ['remote', 'get-url', 'origin'], { cwd: repoDir, stage: 'prerequisites', fix: 'pass --github <owner/name> or --local' }).trim();
      github = url.match(/github\.com[/:]([^/]+\/[^/.]+?)(?:\.git)?$/)?.[1] ?? null;
      if (!github) throw new Incomplete('prerequisites', 'origin is not a GitHub repository', 'pass --github <owner/name>, or --local for a pre-publish scan');
    }
    run('gh', ['auth', 'status'], { stage: 'prerequisites', fix: 'run gh auth login' });
  }

  const hit = (stage, where, k) =>
    problems.push({
      where: `${stage}: ${where}`,
      problem: `confidential term #${k} of ${N} found`,
      why: 'confidential names must never be visible in the public repository',
      id: 'G2',
      fix: 'remove it (history rewrite or a fresh repository), then rerun the scan',
      docs: DOCS,
    });
  const scan = (stage, where, text, lineSuffix = true) => {
    for (const h of match(text)) hit(stage, lineSuffix ? `${where}:${h.line}` : where, h.term);
  };

  // ---- stage 2: the repository to scan (a mirror of GitHub, or the local one)
  let dir = repoDir;
  let tmp = null;
  if (candidate) {
    // The publish step pushes one fresh commit of the tracked files (no history).
    tmp = mkdtempSync(join(tmpdir(), 'release-candidate-'));
    dir = join(tmp, 'repo');
    mkdirSync(dir);
    const tar = run('git', ['archive', '--format=tar', 'HEAD'], { cwd: repoDir, encoding: 'buffer', stage: 'candidate', fix: 'run inside the repository' });
    const x = spawnSync('tar', ['-x', '-C', dir], { input: tar });
    if (x.status !== 0) throw new Incomplete('candidate', 'could not unpack the HEAD export', 'check that tar is available');
    const id = ['-c', 'user.name=museumguessr', '-c', 'user.email=1+museumguessr@users.noreply.github.com', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null'];
    for (const argv of [['init', '-q'], ['add', '-A'], [...id, 'commit', '-q', '-m', 'release candidate']]) run('git', argv, { cwd: dir, stage: 'candidate', fix: 'check git' });
  } else if (github) {
    tmp = mkdtempSync(join(tmpdir(), 'release-scan-'));
    dir = join(tmp, 'mirror.git');
    run('gh', ['repo', 'clone', github, dir, '--', '--mirror', '--quiet'], { stage: 'clone', fix: 'check the repository name and gh access' });
  }
  const git = (...argv) => run('git', argv, { cwd: dir, stage: 'git', fix: 'check that the directory is a readable git repository' });

  try {
    // ---- stage 3: ref names
    const refs = git('for-each-ref', '--format=%(refname)').split('\n').filter(Boolean);
    if (refs.length === 0) throw new Incomplete('refs', 'the repository has no refs', 'check the clone');
    const pullRefs = refs.filter((r) => r.startsWith('refs/pull/')).length;
    for (const r of refs) scan('ref names', r, r, false);
    const head = git('rev-parse', 'HEAD').trim();

    // ---- stage 4: commit metadata and identity
    const log = git('log', '--all', '--format=%H%x1f%an <%ae>%x1f%cn <%ce>%x1f%B%x1e');
    let commits = 0;
    for (const rec of log.split('\x1e')) {
      const [sha, author, committer, body] = rec.replace(/^\n/, '').split('\x1f');
      if (!sha) continue;
      commits += 1;
      const short = sha.slice(0, 7);
      scan('commit metadata', `commit ${short} identity`, `${author}\n${committer}`, false);
      scan('commit metadata', `commit ${short} message`, body ?? '');
      for (const [role, ident] of [['author', author], ['committer', committer]]) {
        const email = ident?.match(/<([^>]*)>/)?.[1] ?? '';
        if (!NOREPLY.test(email)) {
          problems.push({ where: `commit ${short}`, problem: `${role} email is not a GitHub noreply address`, why: 'every public commit must carry the noreply identity', id: 'ENG5', fix: 'rewrite the commit identity before publishing', docs: 'docs/release.md#commit-identity' });
        }
      }
    }

    // ---- stage 5: every blob in every ref, binaries through exiftool
    const blobs = new Map();
    for (const line of git('rev-list', '--objects', '--all').split('\n')) {
      const sp = line.indexOf(' ');
      if (sp < 0) continue;
      const sha = line.slice(0, sp);
      const path = line.slice(sp + 1);
      if (!blobs.has(sha)) blobs.set(sha, path);
    }
    const types = git('cat-file', '--batch-check=%(objectname) %(objecttype)', '--batch-all-objects');
    const isBlob = new Set(types.split('\n').filter((l) => l.endsWith(' blob')).map((l) => l.split(' ')[0]));
    const work = mkdtempSync(join(tmpdir(), 'release-scan-blob-'));
    let files = 0;
    try {
      for (const [sha, path] of blobs) {
        if (!isBlob.has(sha)) continue;
        files += 1;
        const buf = run('git', ['cat-file', 'blob', sha], { cwd: dir, encoding: 'buffer', stage: 'blobs', fix: 'the object is unreadable; repair or re-clone the repository' });
        const where = `${path} (blob ${sha.slice(0, 7)})`;
        scan('files', path, path, false);
        if (buf.subarray(0, 8000).includes(0)) {
          if (!BINARY_OK.test(path)) {
            problems.push({ where: `files: ${where}`, problem: 'binary file outside images/, public/ and fonts', why: 'binaries elsewhere cannot be reviewed as text', id: 'ENG7', fix: 'remove it or move it under images/ or public/', docs: DOCS });
          }
          const file = join(work, sha);
          writeFileSync(file, buf);
          const meta = run(exiftool, ['-a', '-G1', '-s', '-q', file], { stage: 'metadata', fix: 'check that exiftool can read the file' });
          scan('image metadata', where, meta, false);
          rmSync(file);
        } else {
          for (const h of match(buf.toString('utf8'))) hit('files', `${path}:${h.line} (blob ${sha.slice(0, 7)})`, h.term);
        }
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
    }

    // ---- stage 6: GitHub surfaces
    if (github) {
      const gh = (...argv) => run('gh', argv, { stage: 'github', fix: 'check gh access to the repository' });
      scan('github', 'repository description and topics', gh('repo', 'view', github, '--json', 'name,description,homepageUrl,repositoryTopics'), false);
      scan('github', 'pull requests', gh('pr', 'list', '--repo', github, '--state', 'all', '--limit', '1000', '--json', 'number,title,body,headRefName'), false);
      scan('github', 'issues', gh('issue', 'list', '--repo', github, '--state', 'all', '--limit', '1000', '--json', 'number,title,body'), false);
      scan('github', 'workflow names', gh('workflow', 'list', '--repo', github, '--all', '--json', 'name'), false);
    }

    say(`scanned: ${refs.length} refs (${pullRefs} pull-request refs), ${commits} commits, ${files} files${github ? `, GitHub ${github}` : ''}`);
    const at = head.slice(0, 7);
    if (problems.length) result = [1, `denylist check: ${N} terms, ${problems.length} problem(s) (commit ${at})`];
    else if (github) result = [0, `denylist check: ${N} terms, 0 hits (commit ${at}, incl. PR refs)`];
    else if (candidate) result = [0, `denylist check (publish candidate: HEAD as one commit, GitHub not scanned): ${N} terms, 0 hits`];
    else result = [0, `denylist check (local only, GitHub not scanned): ${N} terms, 0 hits (commit ${at})`];
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
} catch (e) {
  if (!(e instanceof Incomplete)) throw e;
  problems.push({ where: e.stage, problem: e.message, why: 'every stage must run before the scan can pass', id: 'DX22', fix: e.fix, docs: DOCS });
  result = [2, 'scan incomplete'];
}
finish(...result);
