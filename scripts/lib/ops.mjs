// One process runner and one refusal format for the operations scripts
// (M2, N6, N7, ENG24; V12-28, V12-23). Every child process starts here:
// install, build and test children get an environment without any
// CLOUDFLARE_* variable; only wrangler may receive the credentials, read
// from the environment at the moment of the call. Every refusal says what
// failed, why (with the values that matter), the next command and a
// docs/ops.md anchor, and exits with its class's own code.

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { isCredential } from './profile.mjs';

export const OPS_DOCS = 'docs/ops.md';
/** The game's only public address. */
export const SITE_URL = 'https://museumguessr.com/';
export const ZONE = 'museumguessr.com';

/** Distinct exit code per refusal class (M2). 1 stays "unexpected error". */
export const EXIT = Object.freeze({
  usage: 2,
  environment: 3,
  git: 4,
  ci: 5,
  build: 6,
  artifact: 7,
  approval: 8,
  remote: 9,
  live: 10,
  scope: 11,
});

export class Refusal extends Error {
  /** @param {{ kind: keyof typeof EXIT, what: string, why: string, fix: string, anchor: string }} r */
  constructor({ kind, what, why, fix, anchor }) {
    super(what);
    if (!(kind in EXIT)) throw new Error(`unknown refusal class ${kind}`);
    Object.assign(this, { kind, what, why, fix, anchor, exit: EXIT[kind] });
  }
}

export const refuse = (r) => {
  throw new Refusal(r);
};

export function formatRefusal(r) {
  return [`✖ ${r.what}`, `  why: ${r.why}`, `  next: ${r.fix}`, `  docs: ${OPS_DOCS}#${r.anchor}`, `  (exit ${r.exit}: ${r.kind})`].join('\n');
}

/** Run a script body; a refusal prints its block and returns its class's exit code. */
export async function runMain(body, err = process.stderr) {
  try {
    return (await body()) ?? 0;
  } catch (e) {
    if (e instanceof Refusal) {
      err.write(`${formatRefusal(e)}\n`);
      return e.exit;
    }
    throw e;
  }
}

/** The environment of every child except wrangler: no CLOUDFLARE_* value (N6). */
export function cleanEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([k, v]) => !isCredential(k) && v !== undefined));
}

export const wranglerBin = (root) => join(root, 'worker/node_modules/.bin/wrangler');

/**
 * The one runner. run(cmd, args, options) returns { status, stdout, stderr }.
 * options.credentials passes the CLOUDFLARE_* values; only wrangler may ask.
 * options.input is written to the child's stdin (a secret never touches argv).
 * options.stream shows the child's output live instead of capturing it.
 * options.env replaces the base environment (credentials are still removed).
 */
export function createRunner({ root, env = process.env, spawn = spawnSync }) {
  const calls = [];
  return {
    calls,
    run(cmd, args, { credentials = false, input, stream = false, cwd = root, env: base = env } = {}) {
      if (credentials && cmd !== wranglerBin(root)) throw new Error(`only wrangler may receive Cloudflare credentials, not ${cmd}`);
      const childEnv = credentials ? { ...cleanEnv(base), ...Object.fromEntries(Object.entries(env).filter(([k]) => isCredential(k))) } : cleanEnv(base);
      childEnv.WRANGLER_SEND_METRICS = 'false';
      calls.push({ cmd, args, credentials, env: childEnv, input });
      const r = spawn(cmd, args, { cwd, env: childEnv, input, encoding: 'utf8', stdio: stream ? ['pipe', 'inherit', 'inherit'] : 'pipe', maxBuffer: 64 * 1024 * 1024 });
      if (r.error) return { status: 127, stdout: '', stderr: String(r.error.message ?? r.error) };
      return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    },
  };
}

/** git through the runner; returns trimmed stdout or null on failure. */
export function gitOut(runner, args) {
  const r = runner.run('git', args);
  return r.status === 0 ? r.stdout.trim() : null;
}

/** The GitHub owner/name of the origin remote, or null. */
export function originRepo(runner) {
  const url = gitOut(runner, ['remote', 'get-url', 'origin']);
  return url?.match(/github\.com[/:]([^/]+\/[^/.]+?)(?:\.git)?$/)?.[1] ?? null;
}
