#!/usr/bin/env node
// npm run dev:board [-- --reset] [--port <worker port>] [--vite-port <port>]
// (H4, N14; V12-126, V12-127). The local board loop, with no account and no
// real credentials: builds dist/ when it is missing, applies the D1
// migrations to a local database, seeds a higher smoke row for the public
// fixture key so the end fixture meets not_best, starts the local Worker in
// dark mode (npm run worker:dev), waits for /api/v1/health, then starts Vite
// with the board UI on, Cloudflare's always-pass Turnstile test key and /api
// proxied to the Worker. It prints the address and stops both processes when
// either ends or on Ctrl-C. --reset clears the local database first and
// prints the address that forgets the browser's board key.

import { spawn as nodeSpawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WRANGLER_CONFIG } from './lib/jsonc.mjs';
import { cleanEnv, createRunner, refuse, runMain, wranglerBin } from './lib/ops.mjs';
import { DUMMY_SITEKEYS } from './lib/profile.mjs';
import { weekId } from '../src/api/week.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const A = 'local-board-loop';
/** The loop's own local D1 state, apart from npm run worker:dev's default. */
export const PERSIST = '.wrangler/board-loop';
/** The seeded smoke best of the fixture key: above any random-answer game, below a perfect one. */
export const SEED_TOTAL = 29000;
export const HEALTH_TIMEOUT_MS = 60_000;
/** The public fixture key (src/game/fixture.ts, docs/api.md "Local examples"); never a player's credential. */
export const FIXTURE_KEY = 'AAAAAAAAAAAAAAAAAAAAAA';
/** The Worker's player hash: sha256 of the key's text (src/board/names.ts playerHash). */
export const fixtureHash = () => createHash('sha256').update(FIXTURE_KEY).digest('hex');

export function parse(args) {
  const opts = { reset: false, port: '8787', vitePort: '5173' };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const usage = (why) => refuse({ kind: 'usage', what: `dev:board ${args.join(' ')}`.trim(), why, fix: 'npm run dev:board -- [--reset] [--port 8787] [--vite-port 5173]', anchor: A });
    if (flag === '--reset') opts.reset = true;
    else if (flag === '--port' || flag === '--vite-port') {
      const value = args[++i];
      if (!/^\d{4,5}$/.test(value ?? '') || Number(value) > 65535) usage(`${flag} takes a port number`);
      opts[flag === '--port' ? 'port' : 'vitePort'] = value;
    } else usage(`${flag} is not an option`);
  }
  return opts;
}

/**
 * The seed: one higher smoke row for the public fixture key in this week.
 * Every value is computed here and checked against a strict pattern; nothing
 * from the command line reaches the SQL (N7).
 */
export function seedSql({ week, hash, ids, now }) {
  if (!/^\d{4}-W\d{2}$/.test(week)) throw new Error(`seed: bad week ${week}`);
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('seed: bad player hash');
  if (ids.length !== 10 || !ids.every((id) => /^[a-z0-9-]{1,80}$/.test(id))) throw new Error('seed: bad item ids');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(now)) throw new Error('seed: bad time');
  const points = JSON.stringify(Array(10).fill(SEED_TOTAL / 10));
  return [
    '-- npm run dev:board: the fixture key\'s higher smoke best (generated, local only).',
    `DELETE FROM smoke_scores WHERE week = '${week}' AND player_hash = '${hash}';`,
    'INSERT INTO smoke_scores (week, player_hash, row_id, game_id, payload_sha256, total, points, item_ids, deck_kind, fresh, created_at)',
    `  VALUES ('${week}', '${hash}', 'seed-fixture-row', 'seed-fixture-game', '${'0'.repeat(64)}', ${SEED_TOTAL}, '${points}', '${JSON.stringify(ids)}', 'random', 0, '${now}');`,
    '',
  ].join('\n');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function devBoard({ root = ROOT, args = [], runner = createRunner({ root }), spawn = nodeSpawn, fetcher = fetch, out = (l) => process.stdout.write(`${l}\n`), env = process.env, now = () => Date.now(), wait = sleep, signals = process }) {
  const opts = parse(args);
  const wrangler = wranglerBin(root);
  if (!existsSync(wrangler)) refuse({ kind: 'environment', what: 'wrangler is not installed in worker/', why: 'the local Worker has its own pinned dependencies', fix: 'npm ci --prefix worker', anchor: A });
  if (!existsSync(join(root, 'dist/build.txt'))) {
    out('dist/ is missing: building it once (npm run build:deploy)');
    const b = runner.run(process.execPath, ['scripts/build.mjs', '--build-id', 'local'], { stream: true });
    if (b.status !== 0) refuse({ kind: 'build', what: 'the build failed', why: `scripts/build.mjs answered ${b.status}`, fix: 'npm run build:deploy, then npm run dev:board again', anchor: A });
  }
  const state = join(root, PERSIST);
  if (opts.reset) {
    rmSync(state, { recursive: true, force: true });
    out(`--reset: cleared the local board database (${PERSIST})`);
  }
  mkdirSync(state, { recursive: true });
  const d1 = (rest, what) => {
    const r = runner.run(wrangler, ['d1', ...rest, '--local', '--persist-to', PERSIST, '--config', WRANGLER_CONFIG]);
    if (r.status !== 0) refuse({ kind: 'environment', what: `${what} failed`, why: `wrangler answered ${r.status}: ${(r.stderr || r.stdout).trim().split('\n').at(-1)?.slice(0, 160) ?? ''}`, fix: 'npm ci --prefix worker, then npm run dev:board -- --reset', anchor: A });
  };
  d1(['migrations', 'apply', 'DB'], 'local D1 migrations');
  const ids = JSON.parse(readFileSync(join(root, 'data/items.json'), 'utf8')).items.slice(0, 10).map((it) => it.id);
  const seedFile = join(state, 'seed.sql');
  writeFileSync(seedFile, seedSql({ week: weekId(now()), hash: fixtureHash(), ids, now: new Date(now()).toISOString() }));
  d1(['execute', 'DB', '--file', seedFile], 'seeding the fixture row');

  const children = [];
  const stopAll = () => {
    for (const c of children) if (c.exitCode === null && !c.killed) c.kill('SIGTERM');
  };
  const worker = spawn(process.execPath, ['scripts/worker-dev.mjs', '--port', opts.port, '--persist-to', PERSIST, '--mode', 'dark'], { cwd: root, env: cleanEnv(env), stdio: 'inherit' });
  children.push(worker);
  let workerGone = false;
  worker.on('close', () => {
    workerGone = true;
  });
  for (const sig of ['SIGINT', 'SIGTERM']) signals.on?.(sig, stopAll);

  const health = `http://127.0.0.1:${opts.port}/api/v1/health`;
  const started = now();
  for (;;) {
    if (workerGone) refuse({ kind: 'environment', what: 'the local Worker stopped before it answered', why: 'npm run worker:dev exited', fix: 'read its output above, then npm run dev:board -- --reset', anchor: A });
    try {
      const r = await fetcher(health);
      if (r.ok) break;
    } catch {
      // not listening yet
    }
    if (now() - started > HEALTH_TIMEOUT_MS) {
      stopAll();
      refuse({ kind: 'environment', what: `${health} did not answer within ${HEALTH_TIMEOUT_MS / 1000} s`, why: 'the local Worker did not start', fix: 'npm run worker:dev on its own to see why', anchor: A });
    }
    await wait(500);
  }

  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', opts.vitePort, '--strictPort'], {
    cwd: root,
    env: { ...cleanEnv(env), MG_API_ORIGIN: `http://127.0.0.1:${opts.port}`, VITE_BOARD_UI: 'true', VITE_TURNSTILE_SITEKEY: DUMMY_SITEKEYS[0], VITE_BUILD_PURPOSE: 'board-test' },
    stdio: 'inherit',
  });
  children.push(vite);
  const page = `http://localhost:${opts.vitePort}/`;
  out(`local board loop (Worker in dark mode on 127.0.0.1:${opts.port}, Vite on ${page})`);
  if (opts.reset) out(`  first open ${page}?fixture=reset-board to forget this browser's board key`);
  out(`  ${page}?fixture=end-random  a finished test game: smoke submission, not_best against the seeded ${SEED_TOTAL.toLocaleString('en-US')}`);
  out(`  ${page}?fixture=end-best    exact answers: a smoke add that beats it`);
  out('  Ctrl-C stops both');
  return new Promise((resolve) => {
    let done = false;
    const finish = (code) => {
      if (done) return;
      done = true;
      stopAll();
      resolve(code ?? 0);
    };
    worker.on('close', finish);
    vite.on('close', finish);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await runMain(() => devBoard({ args: process.argv.slice(2) }));
}
