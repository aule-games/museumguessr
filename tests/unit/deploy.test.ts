import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without types
import { deploy } from '../../scripts/deploy.mjs';
// @ts-expect-error plain ESM helper without types
import { runMain } from '../../scripts/lib/ops.mjs';
import { type Rule, sink, stubRunner } from './helpers/ops-stubs';

const REPO = join(import.meta.dirname, '../..');
const HEAD = 'abc1234def5678abc1234def5678abc1234def56';
const SHA = HEAD.slice(0, 7);
const VERSIONS = { state: 3, scoring: 2, contract: 1, poolHash: 'd8d0b8ec' };
const CREDS = { CLOUDFLARE_API_TOKEN: 'cf-token', CLOUDFLARE_ACCOUNT_ID: 'acct' };
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mg-deploy-'));
  for (const f of ['.nvmrc', 'wrangler.jsonc']) cpSync(join(REPO, f), join(root, f));
  mkdirSync(join(root, 'deploy'));
  const profile = JSON.parse(readFileSync(join(REPO, 'deploy/profile.json'), 'utf8'));
  writeFileSync(join(root, 'deploy/profile.json'), JSON.stringify({ ...profile, VITE_POSTHOG_PROJECT_TOKEN: 'phc_realprojecttoken' }));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const checkRuns = (conclusion = 'success', status = 'completed') => JSON.stringify({ total_count: 1, check_runs: [{ name: 'verify', status, conclusion, started_at: '2026-10-22T10:00:00Z' }] });

/** A healthy machine: everything passes; `over` rules win. The vite stub writes the build like vite would. */
function machine(over: Rule[] = []) {
  const rules: Rule[] = [
    ...over,
    [/^git fetch/, {}],
    [/^git status --porcelain/, { stdout: '' }],
    [/^git rev-parse HEAD/, { stdout: `${HEAD}\n` }],
    [/^git rev-parse origin\/main/, { stdout: `${HEAD}\n` }],
    [/^git remote get-url origin/, { stdout: 'https://github.com/aule-games/museumguessr.git\n' }],
    [/^gh api repos\/aule-games\/museumguessr\/commits\/[0-9a-f]{40}\/check-runs\?check_name=verify$/, { stdout: checkRuns() }],
    [
      /vite\.js build$/,
      (_line, _input, env) => {
        mkdirSync(join(root, 'dist/assets'), { recursive: true });
        writeFileSync(join(root, 'dist/build.txt'), `${env.VITE_BUILD_ID}\n`);
        writeFileSync(join(root, 'dist/assets/index-AbCd1234.js'), 'x');
        writeFileSync(join(root, 'dist/assets/index-AbCd1234.js.map'), '{}');
        return {};
      },
    ],
  ];
  return stubRunner(root, rules, CREDS);
}

async function attempt(args: string[], over: Rule[] = [], options: Record<string, unknown> = {}) {
  const m = machine(over);
  const io = sink();
  const live = { failed: 0, warned: 0, lines: ['✓ build id: the page is build abc1234'] };
  const code = await runMain(
    () => deploy({ root, args, env: { PATH: '/usr/bin', ...CREDS }, runner: m.runner, out: io.out, nodeVersion: '24.20.0', versions: VERSIONS, liveCheckImpl: async () => live, ...options }),
    io.err,
  );
  return { code, out: io.all(), lines: m.lines, calls: m.calls() };
}

const remote = (lines: string[]) => lines.filter((l) => l.startsWith('wrangler'));

describe('npm run deploy', () => {
  it('refuses a dirty tree, a HEAD that is not origin/main, a red or missing verify check and a build id that differs from HEAD [V12-15]', async () => {
    const dirty = await attempt(['--yes'], [[/^git status --porcelain/, { stdout: ' M src/app.ts\n?? notes.txt\n' }]]);
    expect(dirty.code).toBe(4);
    expect(dirty.out).toContain('the working tree has 2 uncommitted change(s)');
    expect(dirty.out).toContain('changed: src/app.ts, notes.txt');

    const ahead = await attempt(['--yes'], [[/^git rev-parse origin\/main/, { stdout: 'fff0000aaaa\n' }], [/^git rev-list --left-right --count/, { stdout: '0\t2\n' }]]);
    expect(ahead.code).toBe(4);
    expect(ahead.out).toContain('HEAD abc1234 is not origin/main fff0000');
    expect(ahead.out).toContain('HEAD is 2 commit(s) ahead of and 0 behind origin/main');

    const red = await attempt(['--yes'], [[/^gh api/, { stdout: checkRuns('failure') }]]);
    expect(red.code).toBe(5);
    expect(red.out).toContain('the verify check for abc1234 is failure');
    expect(red.out).toContain(`see https://github.com/aule-games/museumguessr/commit/${HEAD}/checks`);
    const running = await attempt(['--yes'], [[/^gh api/, { stdout: checkRuns('', 'in_progress') }]]);
    expect(running.out).toContain('the verify check for abc1234 is in_progress');
    const none = await attempt(['--yes'], [[/^gh api/, { stdout: JSON.stringify({ total_count: 0, check_runs: [] }) }]]);
    expect(none.out).toContain('no verify check has run for abc1234');

    const wrongId = await attempt(['--yes'], [[/vite\.js build$/, () => (mkdirSync(join(root, 'dist'), { recursive: true }), writeFileSync(join(root, 'dist/build.txt'), 'e2e\n'), {})]]);
    expect(wrongId.code).toBe(6);
    expect(wrongId.out).toContain('the build id is e2e, HEAD is abc1234');

    for (const r of [dirty, ahead, red, running, none, wrongId]) expect(remote(r.lines)).toEqual([]);
  });

  it('installs the locked dependencies with Node 24, builds the deploy profile, moves source maps aside and checks the exact artifact before anything remote [V12-16]', async () => {
    const old = await attempt([], [], { nodeVersion: '22.11.0' });
    expect(old.code).toBe(3);
    expect(old.out).toContain('Node 22.11.0 is not Node 24');
    expect(old.lines).toEqual([]);

    const ok = await attempt(['--yes']);
    expect(ok.code).toBe(0);
    const order = ok.lines.map((l) => l.replace(/ --no-audit --no-fund/, ''));
    const at = (re: RegExp) => order.findIndex((l) => re.test(l));
    expect(at(/^git fetch/)).toBe(0);
    expect(at(/^npm ci --ignore-scripts$/)).toBeGreaterThan(at(/^gh api/));
    expect(at(/^npm ci --prefix worker --ignore-scripts$/)).toBeGreaterThan(at(/^npm ci --ignore-scripts$/));
    expect(at(/vite\.js build$/)).toBeGreaterThan(at(/^npm ci --prefix worker/));
    expect(at(/check-build\.mjs$/)).toBeGreaterThan(at(/vite\.js build$/));
    expect(at(/release-scan\.mjs --dist dist$/)).toBeGreaterThan(at(/check-build\.mjs$/));
    expect(at(/^wrangler deploy/)).toBeGreaterThan(at(/release-scan\.mjs --dist dist$/));
    const build = ok.calls.find((c) => /vite\.js build$/.test(c.line))!;
    expect(build.env).toMatchObject({ BASE_PATH: '/', VITE_SITE_URL: 'https://museumguessr.com/', VITE_BUILD_PURPOSE: 'deploy', VITE_BUILD_ID: SHA, VITE_POSTHOG_PROJECT_TOKEN: 'phc_realprojecttoken' });
    expect(existsSync(join(root, 'dist/assets/index-AbCd1234.js.map'))).toBe(false);
    expect(existsSync(join(root, `node_modules/.cache/deploy/${SHA}/sourcemaps/assets/index-AbCd1234.js.map`))).toBe(true);
    expect(ok.out).toContain('1 source map(s) moved');

    const failedCheck = await attempt(['--yes'], [[/check-build\.mjs$/, { status: 1 }]]);
    expect(failedCheck.code).toBe(7);
    expect(failedCheck.out).toContain('check-build failed on the deploy build');
    expect(remote(failedCheck.lines)).toEqual([]);

    const placeholder = JSON.parse(readFileSync(join(REPO, 'deploy/profile.json'), 'utf8'));
    writeFileSync(join(root, 'deploy/profile.json'), JSON.stringify(placeholder));
    const notReady = await attempt(['--yes']);
    expect(notReady.code).toBe(6);
    expect(notReady.out).toContain('the deploy profile is not ready: VITE_POSTHOG_PROJECT_TOKEN');
    expect(notReady.lines.some((l) => /vite\.js build$/.test(l))).toBe(false);
  });

  it('applies remote migrations only with a D1 binding, then deploys page and API in one wrangler deploy whose message records SHA, state, scoring, contract and migrations [V12-17]', async () => {
    const plain = await attempt(['--yes']);
    expect(remote(plain.lines)).toEqual([`wrangler deploy --config wrangler.jsonc --message ${SHA} state:3 scoring:2 contract:1 migrations:0 --var WORKER_VERSION:${SHA}`]);
    expect(plain.out).toContain('board switch before: off (the board arrives in step 3)');

    const config = readFileSync(join(root, 'wrangler.jsonc'), 'utf8').replace('"workers_dev": false,', '"workers_dev": false, "d1_databases": [{ "binding": "DB", "database_name": "museumguessr", "database_id": "x", "migrations_dir": "migrations" }],');
    writeFileSync(join(root, 'wrangler.jsonc'), config);
    mkdirSync(join(root, 'migrations'));
    for (const f of ['0001_scores.sql', '0002_receipts.sql']) writeFileSync(join(root, 'migrations', f), '-- sql');
    const withDb = await attempt(['--yes']);
    expect(remote(withDb.lines)).toEqual([
      'wrangler d1 migrations apply DB --remote --config wrangler.jsonc',
      `wrangler deploy --config wrangler.jsonc --message ${SHA} state:3 scoring:2 contract:1 migrations:2 --var WORKER_VERSION:${SHA}`,
    ]);
    const failed = await attempt(['--yes'], [[/^wrangler d1 migrations apply/, { status: 1 }]]);
    expect(failed.code).toBe(9);
    expect(failed.out).toContain('remote D1 migrations failed; nothing was deployed');
    expect(failed.out).toContain('npm run deploy -- --yes again at the same SHA');
    expect(remote(failed.lines)).toEqual(['wrangler d1 migrations apply DB --remote --config wrangler.jsonc']);
  });

  it('a confidential term in the built output stops the deploy before any remote write [V12-29]', async () => {
    const hit = await attempt(['--yes'], [[/release-scan\.mjs --dist dist$/, { status: 1 }]]);
    expect(hit.code).toBe(7);
    expect(hit.out).toContain('the release scan found a confidential term in dist/');
    expect(remote(hit.lines)).toEqual([]);
    const noList = await attempt(['--yes'], [[/release-scan\.mjs --dist dist$/, { status: 2 }]]);
    expect(noList.out).toContain('the release scan of dist/ could not run');
    expect(remote(noList.lines)).toEqual([]);
  });

  it('install, build and check children get no Cloudflare credentials; only wrangler does [V12-23]', async () => {
    const ok = await attempt(['--yes']);
    for (const c of ok.calls) {
      const cf = Object.keys(c.env).filter((k) => k.startsWith('CLOUDFLARE_'));
      if (c.cmd === 'wrangler') expect(cf.sort(), c.line).toEqual(['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN']);
      else expect(cf, c.line).toEqual([]);
    }
    expect(ok.calls.filter((c) => c.credentials).map((c) => c.cmd)).toEqual(['wrangler']);
  });

  it('without --yes it runs every local check, prints the exact URL and deploys nothing; a failed live check names the rollback [V12-28]', async () => {
    const dry = await attempt([]);
    expect(dry.code).toBe(0);
    expect(dry.out).toContain(`To publish build ${SHA} at https://museumguessr.com/: npm run deploy -- --yes`);
    expect(remote(dry.lines)).toEqual([]);
    const noToken = await runMain(() => deploy({ root, args: ['--yes'], env: { PATH: '/usr/bin' }, runner: machine().runner, out: () => {}, nodeVersion: '24.1.0' }), sink().err);
    expect(noToken).toBe(3);
    const badArg = await attempt(['--force']);
    expect(badArg.code).toBe(2);
    const live = await attempt(['--yes'], [], { liveCheckImpl: async () => ({ failed: 2, warned: 0, lines: ['✖ health: /api/v1/health answered 500'] }) });
    expect(live.code).toBe(10);
    expect(live.out).toContain('live check: 2 check(s) failed after deploying abc1234');
    expect(live.out).toContain('next: npm run rollback -- --yes to the previous deployment, or fix forward');
    expect(live.out).toContain('docs: docs/ops.md#live-check');
  });
});
