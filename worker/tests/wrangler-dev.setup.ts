// Starts `wrangler dev` on free local ports for the smoke suite and stops it
// afterwards. No login and no remote bindings: everything runs locally.
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    wranglerUrl: string;
    buildId: string;
  }
}

const ROOT = join(import.meta.dirname, '../..');
const WRANGLER = join(ROOT, 'worker/node_modules/.bin/wrangler');

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

let child: ChildProcess | null = null;

export async function setup(project: TestProject) {
  if (!existsSync(WRANGLER)) throw new Error('wrangler is not installed: run npm ci --prefix worker');
  if (!existsSync(join(ROOT, 'dist/build.txt'))) throw new Error('dist/ is missing: build first (npm run build:e2e)');
  const buildId = readFileSync(join(ROOT, 'dist/build.txt'), 'utf8').trim();
  const [port, inspector] = [await freePort(), await freePort()];
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLOUDFLARE_')));
  let log = '';
  child = spawn(WRANGLER, ['dev', '--config', 'wrangler.jsonc', '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', String(inspector), '--var', `WORKER_VERSION:${buildId}`, '--show-interactive-dev-session=false', '--log-level', 'warn'], {
    cwd: ROOT,
    env: { ...env, WRANGLER_SEND_METRICS: 'false', CI: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (d) => (log += d));
  child.stderr?.on('data', (d) => (log += d));
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 90_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`wrangler dev exited (${child.exitCode}):\n${log}`);
    try {
      if ((await fetch(`${url}/api/v1/health`)).ok) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error(`wrangler dev did not answer within 90 s:\n${log}`);
    await new Promise((r) => setTimeout(r, 250));
  }
  project.provide('wranglerUrl', url);
  project.provide('buildId', buildId);
}

export async function teardown() {
  if (!child || child.exitCode !== null) return;
  const done = new Promise((r) => child?.once('exit', r));
  child.kill('SIGTERM');
  await Promise.race([done, new Promise((r) => setTimeout(r, 5_000))]);
  if (child.exitCode === null) child.kill('SIGKILL');
}
