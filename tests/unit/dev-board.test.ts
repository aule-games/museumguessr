import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { playerHash } from '../../src/board/names';
import { FIXTURE_KEY as PAGE_FIXTURE_KEY } from '../../src/game/fixture';
// @ts-expect-error plain ESM script without types
import { devBoard, FIXTURE_KEY, fixtureHash, parse, PERSIST, SEED_TOTAL, seedSql } from '../../scripts/dev-board.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A checkout with the Worker tooling and the item data, with or without a build. */
function checkout(built: boolean) {
  const root = mkdtempSync(join(tmpdir(), 'mg-dev-board-'));
  dirs.push(root);
  mkdirSync(join(root, 'worker/node_modules/.bin'), { recursive: true });
  writeFileSync(join(root, 'worker/node_modules/.bin/wrangler'), '');
  mkdirSync(join(root, 'data'));
  const items = JSON.parse(readFileSync(join(import.meta.dirname, '../../data/items.json'), 'utf8'));
  writeFileSync(join(root, 'data/items.json'), JSON.stringify(items));
  if (built) {
    mkdirSync(join(root, 'dist'));
    writeFileSync(join(root, 'dist/build.txt'), 'abc1234\n');
  }
  return root;
}

class Child extends EventEmitter {
  exitCode: number | null = null;
  killed = false;
  kill() {
    this.killed = true;
    this.exitCode = 0;
    this.emit('close', 0);
    return true;
  }
}

function harness(root: string, healthAfter = 1) {
  const calls: { cmd: string; args: string[] }[] = [];
  const spawned: { args: string[]; env: Record<string, string>; child: Child }[] = [];
  const lines: string[] = [];
  let polls = 0;
  let clock = Date.parse('2026-10-22T12:00:00Z');
  return {
    calls,
    spawned,
    lines,
    deps: {
      root,
      runner: {
        run: (cmd: string, args: string[]) => {
          calls.push({ cmd, args });
          return { status: 0, stdout: '', stderr: '' };
        },
      },
      spawn: (_cmd: string, args: string[], o: { env: Record<string, string> }) => {
        const child = new Child();
        spawned.push({ args, env: o.env, child });
        return child;
      },
      fetcher: async () => {
        polls += 1;
        if (polls <= healthAfter) throw new Error('ECONNREFUSED');
        return { ok: true };
      },
      out: (l: string) => lines.push(l),
      env: { PATH: '/usr/bin', CLOUDFLARE_API_TOKEN: 'never-passed' },
      now: () => clock,
      wait: async (ms: number) => {
        clock += ms;
      },
      signals: { on: () => {} },
    },
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('npm run dev:board', () => {
  it('builds missing assets, migrates and seeds a dark local Worker, waits for health, proxies Vite and stops both processes on exit [V12-126]', async () => {
    const root = checkout(false);
    const h = harness(root, 2);
    const run = devBoard({ ...h.deps, args: ['--port', '8795'] });
    for (let i = 0; i < 20 && h.spawned.length < 2; i++) await settle();
    // the build, then the migrations, then the seed
    expect(h.calls[0]!.args).toEqual(['scripts/build.mjs', '--build-id', 'local']);
    expect(h.calls[1]!.args.slice(0, 6)).toEqual(['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to']);
    expect(h.calls[2]!.args.slice(0, 3)).toEqual(['d1', 'execute', 'DB']);
    const seed = readFileSync(join(root, PERSIST, 'seed.sql'), 'utf8');
    expect(seed).toContain(fixtureHash());
    expect(seed).toContain(`${SEED_TOTAL}`);
    expect(seed).toContain("'2026-W43'");
    // the Worker in dark mode on the loop's own database; Vite only after health answered
    const [worker, vite] = h.spawned;
    expect(worker!.args).toEqual(['scripts/worker-dev.mjs', '--port', '8795', '--persist-to', PERSIST, '--mode', 'dark']);
    expect(vite!.args).toEqual(['node_modules/vite/bin/vite.js', '--port', '5173', '--strictPort']);
    expect(vite!.env).toMatchObject({ MG_API_ORIGIN: 'http://127.0.0.1:8795', VITE_BOARD_UI: 'true', VITE_TURNSTILE_SITEKEY: '1x00000000000000000000AA', VITE_BUILD_PURPOSE: 'board-test' });
    for (const s of h.spawned) expect(Object.keys(s.env).filter((k) => /cloudflare/i.test(k))).toEqual([]);
    expect(h.lines.join('\n')).toContain('http://localhost:5173/?fixture=end-random');
    // Vite ends: the Worker is stopped too
    vite!.child.emit('close', 0);
    expect(await run).toBe(0);
    expect(worker!.child.killed).toBe(true);
  });

  it('--reset clears the local database and prints the address that forgets the browser key; nothing from the command line reaches the SQL [V12-126] [V12-127]', async () => {
    const root = checkout(true);
    mkdirSync(join(root, PERSIST), { recursive: true });
    writeFileSync(join(root, PERSIST, 'old.sqlite'), 'x');
    const h = harness(root, 0);
    const run = devBoard({ ...h.deps, args: ['--reset'] });
    for (let i = 0; i < 20 && h.spawned.length < 2; i++) await settle();
    expect(existsSync(join(root, PERSIST, 'old.sqlite'))).toBe(false);
    expect(h.calls.some((c) => c.args[0] === 'scripts/build.mjs')).toBe(false);
    expect(h.lines.join('\n')).toContain('?fixture=reset-board');
    h.spawned[0]!.child.emit('close', 1);
    await run;
    expect(h.spawned[1]!.child.killed).toBe(true);
    // the arguments are checked, and the seed refuses anything but computed values
    expect(() => parse(['--port', '80; DROP TABLE scores'])).toThrow();
    expect(() => parse(['--mode', 'on'])).toThrow();
    expect(parse(['--reset', '--vite-port', '5199'])).toEqual({ reset: true, port: '8787', vitePort: '5199' });
    const ids = Array.from({ length: 10 }, (_, i) => `item-${i}`);
    expect(() => seedSql({ week: "2026-W43'; --", hash: fixtureHash(), ids, now: '2026-10-22T12:00:00.000Z' })).toThrow();
    expect(() => seedSql({ week: '2026-W43', hash: 'x', ids, now: '2026-10-22T12:00:00.000Z' })).toThrow();
    // the page's fixture and the seed use the same public key and the Worker's player hash
    expect(FIXTURE_KEY).toBe(PAGE_FIXTURE_KEY);
    expect(fixtureHash()).toBe(await playerHash(FIXTURE_KEY));
  });

  it('a local Worker that never answers stops the loop with a refusal and leaves no process behind [V12-126]', async () => {
    const h = harness(checkout(true), Number.POSITIVE_INFINITY);
    await expect(devBoard({ ...h.deps, args: [] })).rejects.toMatchObject({ kind: 'environment' });
    expect(h.spawned).toHaveLength(1);
    expect(h.spawned[0]!.child.killed).toBe(true);
  });
});
