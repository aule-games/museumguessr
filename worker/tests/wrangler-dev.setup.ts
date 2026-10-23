// Starts `wrangler dev` on free local ports for the smoke suite and stops it
// afterwards. No login and no remote bindings: everything runs locally.
// Each instance gets its own local D1 (a temporary --persist-to directory),
// migrated with `wrangler d1 migrations apply --local` and switched to dark
// mode with the board:dark statement file before it starts. The main
// instance uses Cloudflare's always-pass Turnstile test secret, a second
// one the always-fail secret; both accept test keys only because
// TURNSTILE_TEST_KEYS is set here, as in local development.
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    wranglerUrl: string;
    failingUrl: string;
    buildId: string;
    localTriggers: string[];
  }
}

const ROOT = join(import.meta.dirname, '../..');
const WRANGLER = join(ROOT, 'worker/node_modules/.bin/wrangler');
/** Cloudflare's documented Turnstile test secrets (public values, local only). */
export const TEST_SECRETS = { pass: '1x0000000000000000000000000000000AA', fail: '2x0000000000000000000000000000000AA' };

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });

const children: ChildProcess[] = [];
const dirs: string[] = [];
const env = () => ({ ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLOUDFLARE_'))), WRANGLER_SEND_METRICS: 'false', CI: 'true' });

function wrangler(args: string[]) {
  const r = spawnSync(WRANGLER, [...args, '--config', 'wrangler.jsonc'], { cwd: ROOT, env: env(), encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`wrangler ${args.slice(0, 3).join(' ')} failed (${r.status}):\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

/** A migrated local D1 in dark mode, in its own directory. */
function localBoard(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mg-wrangler-dev-'));
  dirs.push(dir);
  wrangler(['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', dir]);
  wrangler(['d1', 'execute', 'DB', '--local', '--persist-to', dir, '--file', 'scripts/sql/board-dark.sql']);
  return dir;
}

async function start(buildId: string, secret: string, dir: string): Promise<string> {
  const [port, inspector] = [await freePort(), await freePort()];
  let log = '';
  const vars = [`WORKER_VERSION:${buildId}`, `TURNSTILE_SECRET:${secret}`, 'TURNSTILE_HOSTNAME:example.com', 'TURNSTILE_TEST_KEYS:1'].flatMap((v) => ['--var', v]);
  const child = spawn(WRANGLER, ['dev', '--config', 'wrangler.jsonc', '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', String(inspector), '--persist-to', dir, ...vars, '--show-interactive-dev-session=false', '--log-level', 'warn'], {
    cwd: ROOT,
    env: env(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  child.stdout?.on('data', (d) => (log += d));
  child.stderr?.on('data', (d) => (log += d));
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 90_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`wrangler dev exited (${child.exitCode}):\n${log}`);
    try {
      if ((await fetch(`${url}/api/v1/health`)).ok) return url;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error(`wrangler dev did not answer within 90 s:\n${log}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

export async function setup(project: TestProject) {
  if (!existsSync(WRANGLER)) throw new Error('wrangler is not installed: run npm ci --prefix worker');
  if (!existsSync(join(ROOT, 'dist/build.txt'))) throw new Error('dist/ is missing: build first (npm run build:e2e)');
  const buildId = readFileSync(join(ROOT, 'dist/build.txt'), 'utf8').trim();
  const [main, failing] = [localBoard(), localBoard()];
  const triggers = JSON.parse(wrangler(['d1', 'execute', 'DB', '--local', '--persist-to', main, '--json', '--command', "SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name"])) as { results: { name: string }[] }[];
  const [url, failingUrl] = await Promise.all([start(buildId, TEST_SECRETS.pass, main), start(buildId, TEST_SECRETS.fail, failing)]);
  project.provide('wranglerUrl', url);
  project.provide('failingUrl', failingUrl);
  project.provide('buildId', buildId);
  project.provide('localTriggers', triggers[0]!.results.map((r) => r.name));
}

export async function teardown() {
  await Promise.all(
    children.map(async (child) => {
      if (child.exitCode !== null) return;
      const done = new Promise((r) => child.once('exit', r));
      child.kill('SIGTERM');
      await Promise.race([done, new Promise((r) => setTimeout(r, 5_000))]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }),
  );
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}
