#!/usr/bin/env node
// npm run worker:dev [-- --port <n>] [--persist-to <dir>] [--mode off|dark|on]
// (H4, N14; V12-126, V12-127). The local Worker: applies the D1 migrations
// to the local database, writes the local board mode (dark by default, so
// test-assisted games exercise the full submit path into smoke rows), then
// runs wrangler dev on 127.0.0.1 serving dist/ with Cloudflare's always-pass
// Turnstile test secret. No login and nothing remote; children never see a
// CLOUDFLARE_* value. npm run dev:board builds on it.

import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WRANGLER_CONFIG } from './lib/jsonc.mjs';
import { cleanEnv, createRunner, refuse, runMain, wranglerBin } from './lib/ops.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const A = 'local-board-loop';
/** Cloudflare's documented always-pass Turnstile test secret: a public value, local only. */
export const TEST_SECRET = '1x0000000000000000000000000000000AA';

export function parse(args) {
  const opts = { port: '8787', mode: 'dark', persist: null };
  for (let i = 0; i < args.length; i += 2) {
    const [flag, value] = [args[i], args[i + 1]];
    const bad = (why) => refuse({ kind: 'usage', what: `worker:dev ${flag ?? ''} ${value ?? ''}`.trim(), why, fix: 'npm run worker:dev -- [--port 8787] [--persist-to .wrangler/state] [--mode dark]', anchor: A });
    if (value === undefined) bad('every option needs a value');
    if (flag === '--port' && /^\d{4,5}$/.test(value) && Number(value) <= 65535) opts.port = value;
    else if (flag === '--mode' && ['off', 'dark', 'on'].includes(value)) opts.mode = value;
    else if (flag === '--persist-to' && /^(?!-)[\w./-]{1,200}$/.test(value)) opts.persist = value;
    else bad(`${flag} takes ${flag === '--port' ? 'a port number' : flag === '--mode' ? 'off, dark or on' : flag === '--persist-to' ? 'a plain directory path' : 'nothing: unknown option'}`);
  }
  return opts;
}

export async function workerDev({ root = ROOT, args = [], runner = createRunner({ root }), out = (l) => process.stdout.write(`${l}\n`), env = process.env, spawn = nodeSpawn }) {
  const opts = parse(args);
  const wrangler = wranglerBin(root);
  if (!existsSync(wrangler)) refuse({ kind: 'environment', what: 'wrangler is not installed in worker/', why: 'the Worker has its own pinned dependencies', fix: 'npm ci --prefix worker', anchor: A });
  if (!existsSync(join(root, 'dist/build.txt'))) refuse({ kind: 'build', what: 'dist/ is missing', why: 'wrangler dev serves the built site', fix: 'npm run build:e2e (npm run dev:board builds it for you)', anchor: A });
  const local = ['--local', ...(opts.persist ? ['--persist-to', opts.persist] : [])];
  const step = (args_, what) => {
    const r = runner.run(wrangler, [...args_, '--config', WRANGLER_CONFIG]);
    if (r.status !== 0) refuse({ kind: 'environment', what: `${what} failed`, why: `wrangler answered ${r.status}: ${(r.stderr || r.stdout).trim().split('\n').at(-1)?.slice(0, 160) ?? ''}`, fix: 'npm ci --prefix worker, then npm run worker:dev again', anchor: A });
  };
  step(['d1', 'migrations', 'apply', 'DB', ...local], 'local D1 migrations');
  step(['d1', 'execute', 'DB', ...local, '--file', join(root, `scripts/sql/board-${opts.mode}.sql`)], `local board mode ${opts.mode}`);
  const build = readFileSync(join(root, 'dist/build.txt'), 'utf8').trim();
  const vars = [`WORKER_VERSION:${build}`, `TURNSTILE_SECRET:${TEST_SECRET}`, 'TURNSTILE_HOSTNAME:example.com', 'TURNSTILE_TEST_KEYS:1'];
  const argv = ['dev', '--config', WRANGLER_CONFIG, '--ip', '127.0.0.1', '--port', opts.port, ...(opts.persist ? ['--persist-to', opts.persist] : []), ...vars.flatMap((v) => ['--var', v])];
  out(`local Worker (board ${opts.mode}) on http://127.0.0.1:${opts.port}/ ; Ctrl-C stops it`);
  return new Promise((resolve) => {
    const child = spawn(wrangler, argv, { cwd: root, env: { ...cleanEnv(env), WRANGLER_SEND_METRICS: 'false' }, stdio: 'inherit' });
    child.on('close', (code) => resolve(code ?? 0));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await runMain(() => workerDev({ args: process.argv.slice(2) }));
}
