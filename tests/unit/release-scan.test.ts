import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = join(import.meta.dirname, '../../scripts/release-scan.mjs');
const ID = ['-c', 'user.name=fixture', '-c', 'user.email=1+fixture@users.noreply.github.com', '-c', 'commit.gpgsign=false'];

let dir: string;
let repo: string;
let fakeExif: string;

/** A stand-in for exiftool: prints a file's readable bytes, as its metadata output would. */
const FAKE_EXIFTOOL = `#!/usr/bin/env node
const fs = require('node:fs');
const a = process.argv.slice(2);
if (a.includes('-ver')) { console.log('13.00'); process.exit(0); }
console.log(fs.readFileSync(a[a.length - 1], 'latin1').replace(/[^\\x20-\\x7e\\n]/g, ' '));
`;

function commit(files: Record<string, string | Buffer>, message: string) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(repo, path, '..'), { recursive: true });
    writeFileSync(join(repo, path), content);
  }
  execFileSync('git', [...ID, 'add', '-A'], { cwd: repo });
  execFileSync('git', [...ID, 'commit', '-q', '-m', message], { cwd: repo });
}

function scan(terms: string[] | null, env: Record<string, string> = {}, mode = '--local') {
  const denylist = join(dir, 'denylist');
  if (terms) writeFileSync(denylist, `# fixture terms\n${terms.join('\n')}\n`);
  const r = spawnSync('node', [SCRIPT, mode, '--repo', repo, '--denylist', denylist], {
    encoding: 'utf8',
    env: { ...process.env, MG_EXIFTOOL: fakeExif, ...env },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'scan-test-'));
  repo = join(dir, 'repo');
  mkdirSync(repo);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  fakeExif = join(dir, 'exiftool');
  writeFileSync(fakeExif, FAKE_EXIFTOOL);
  chmodSync(fakeExif, 0o755);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('[DX10] [DX22] [ENG7] release scan', () => {
  it('finds a planted term in a file and a commit message, in another spelling, and never prints it', () => {
    commit({ 'README.md': 'Play it.\nBuilt at ZEBRA-HOLDINGS in Işıklar.\n' }, 'first');
    commit({ 'src/a.ts': 'export const a = 1;\n' }, 'notes from zebra_holdings');
    const r = scan(['Zebra Holdings', 'ışıklar']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('files: README.md:2 (blob');
    expect(r.out).toMatch(/commit metadata: commit [0-9a-f]{7} message:1/);
    expect(r.out).toContain('term #1 of 2');
    expect(r.out).toContain('term #2 of 2');
    expect(r.out.toLowerCase()).not.toMatch(/zebra|holdings|ışık|isik/);
    expect(r.out).toContain('rerun: node scripts/release-scan.mjs');
    expect(r.out).not.toContain('0 hits');
  });

  it('reads image metadata and rejects binaries outside images/ and public/', () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]), Buffer.from('tEXtComment\0zebra holdings')]);
    commit({ 'images/01.png': png, 'tools/blob.bin': Buffer.from([0, 1, 2, 3]) }, 'add files');
    const r = scan(['zebra holdings']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('image metadata: images/01.png');
    expect(r.out).toContain('files: tools/blob.bin');
    expect(r.out).toContain('binary file outside images/, public/ and fonts');
  });

  it('passes a clean repository, with the exempt username and site URL, and prints the local-only line', () => {
    commit({ 'README.md': 'Play at https://aule-games.github.io/museumguessr/ (by mert-aktas).\n' }, 'clean');
    const r = scan(['aktas']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/denylist check \(local only, GitHub not scanned\): 1 terms, 0 hits \(commit [0-9a-f]{7}\)/);
  });

  it('a name removed since stays in history (--local fails) but not in the publish candidate (--candidate passes)', () => {
    commit({ 'README.md': 'made at zebra holdings\n' }, 'first');
    commit({ 'README.md': 'made here\n' }, 'second');
    expect(scan(['zebra holdings']).code).toBe(1);
    const r = scan(['zebra holdings'], {}, '--candidate');
    expect(r.code).toBe(0);
    expect(r.out).toContain('publish candidate: HEAD as one commit');
  });

  it('flags a commit whose email is not a noreply address', () => {
    writeFileSync(join(repo, 'a.txt'), 'a\n');
    execFileSync('git', ['-c', 'user.name=x', '-c', 'user.email=someone@example.com', 'add', '-A'], { cwd: repo });
    execFileSync('git', ['-c', 'user.name=x', '-c', 'user.email=someone@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'x'], { cwd: repo });
    const r = scan(['zebra']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('author email is not a GitHub noreply address');
  });

  it('without exiftool the scan is incomplete: non-zero, and no zero-hit line', () => {
    commit({ 'README.md': 'clean\n' }, 'clean');
    const r = scan(['zebra'], { MG_EXIFTOOL: join(dir, 'missing-exiftool') });
    expect(r.code).toBe(2);
    expect(r.out).toContain('scan incomplete');
    expect(r.out).toContain('install exiftool');
    expect(r.out).not.toContain('0 hits');
  });

  it('without a denylist the scan is incomplete', () => {
    commit({ 'README.md': 'clean\n' }, 'clean');
    const r = scan(null);
    expect(r.code).toBe(2);
    expect(r.out).toContain('no denylist');
  });
});
