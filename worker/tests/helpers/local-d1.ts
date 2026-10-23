// Real local D1 (and the rate-limit binding) from the pinned
// wrangler's getPlatformProxy: Miniflare in this process, no account and no
// remote bindings. It reports meta.rows_read and meta.rows_written the way
// D1 bills them. wrangler is loaded by path so the root type check and
// `npm test` never need the Worker's dependencies.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { D1Database, RateLimiter } from '../../src/platform';
import { migrationSql } from './sqlite-d1';

const ROOT = join(import.meta.dirname, '../../..');
const WRANGLER = join(ROOT, 'worker/node_modules/wrangler/wrangler-dist/cli.js');

interface Proxy {
  env: { DB: D1Database; IP_LIMIT: RateLimiter };
  dispose(): Promise<void>;
}

const TABLES = ['settings', 'board_weeks', 'scores', 'receipts', 'tombstones', 'score_buckets', 'smoke_scores', 'moderation'];

export async function localD1() {
  const wrangler = (await import(pathToFileURL(WRANGLER).href)) as {
    getPlatformProxy(o: object): Promise<Proxy>;
    unstable_splitSqlQuery(sql: string): string[];
  };
  const dir = mkdtempSync(join(tmpdir(), 'mg-local-d1-'));
  const configPath = join(dir, 'wrangler.json');
  writeFileSync(
    configPath,
    JSON.stringify({
      name: 'museumguessr-board-test',
      compatibility_date: '2026-10-01',
      d1_databases: [{ binding: 'DB', database_name: 'board-test', database_id: 'board-test' }],
      ratelimits: [{ name: 'IP_LIMIT', namespace_id: '1201', simple: { limit: 30, period: 60 } }],
    }),
  );
  const proxy = await wrangler.getPlatformProxy({ configPath, persist: false, remoteBindings: false, envFiles: [] });
  const db = proxy.env.DB;
  for (const sql of migrationSql()) {
    const statements = wrangler.unstable_splitSqlQuery(sql);
    await db.batch(statements.map((s) => db.prepare(s)));
  }
  return {
    db,
    ipLimit: proxy.env.IP_LIMIT,
    async empty() {
      await db.batch(TABLES.map((t) => db.prepare(`DELETE FROM ${t}`)));
    },
    async dispose() {
      await proxy.dispose();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export type LocalD1 = Awaited<ReturnType<typeof localD1>>;
