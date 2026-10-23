import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LIMITS } from '../../src/api/limits';
// @ts-expect-error plain ESM helper without types
import { parseJsonc, readWranglerConfig } from '../../scripts/lib/jsonc.mjs';

const ROOT = join(import.meta.dirname, '../..');
const config = readWranglerConfig(ROOT);
const json = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

describe('the Worker configuration (wrangler.jsonc)', () => {
  it('one Worker serves the built site as assets and runs code first only for /api/*, with the asset 404 page for unknown paths [V12-10]', () => {
    expect(config.name).toBe('museumguessr');
    expect(config.main).toBe('worker/src/index.ts');
    expect(existsSync(join(ROOT, config.main))).toBe(true);
    expect(config.assets).toEqual({ directory: './dist', binding: 'ASSETS', run_worker_first: ['/api/*'], not_found_handling: '404-page' });
    expect(config.compatibility_date >= '2025-04-01').toBe(true);
    expect(config.site).toBeUndefined();
  });

  it('the board binds one D1 database with its migrations, three rate limits equal to the limits module and an hourly purge, and keeps secrets out of the file [V12-103] [V12-91] [V12-107]', () => {
    expect(config.d1_databases).toEqual([{ binding: 'DB', database_name: 'museumguessr', database_id: 'set-by-cf-bootstrap', migrations_dir: 'worker/migrations' }]);
    expect(existsSync(join(ROOT, 'worker/migrations/0001_board.sql'))).toBe(true);
    const { windowSeconds, requestsPerIp, newRowsPerIp, submissionsPerKey } = LIMITS.bindings;
    expect(config.ratelimits.map((r: { name: string; simple: unknown }) => [r.name, r.simple])).toEqual([
      ['IP_LIMIT', { limit: requestsPerIp, period: windowSeconds }],
      ['NEW_ROW_LIMIT', { limit: newRowsPerIp, period: windowSeconds }],
      ['KEY_LIMIT', { limit: submissionsPerKey, period: windowSeconds }],
    ]);
    expect(new Set(config.ratelimits.map((r: { namespace_id: string }) => r.namespace_id)).size).toBe(3);
    expect(config.triggers).toEqual({ crons: ['17 * * * *'] });
    expect(config.vars).toEqual({ WORKER_VERSION: 'dev', TURNSTILE_HOSTNAME: 'museumguessr.com' });
    const text = readFileSync(join(ROOT, 'wrangler.jsonc'), 'utf8');
    for (const secret of ['"TURNSTILE_SECRET"', '"BOARD_FORCE_OFF"', 'TURNSTILE_TEST_KEYS"']) expect(text).not.toContain(secret);
    expect(config.secrets).toBeUndefined();
  });

  it('the Worker answers only at the custom domain museumguessr.com [V12-11]', () => {
    expect(config.routes).toEqual([{ pattern: 'museumguessr.com', custom_domain: true }]);
    expect(config.route).toBeUndefined();
  });

  it('workers.dev and preview URLs are disabled [V12-12]', () => {
    expect(config.workers_dev).toBe(false);
    expect(config.preview_urls).toBe(false);
  });

  it('invocation logs stay off in the Worker configuration [V12-112]', () => {
    expect(config.observability).toEqual({ enabled: false, logs: { enabled: false, invocation_logs: false } });
    expect(config.logpush).toBeUndefined();
    expect(config.tail_consumers).toBeUndefined();
  });

  it('wrangler is pinned exactly in the separate Worker package, not in the game install [V12-126]', () => {
    const worker = json('worker/package.json');
    expect(worker.devDependencies.wrangler).toMatch(/^\d+\.\d+\.\d+$/);
    expect(json('worker/package-lock.json').packages['node_modules/wrangler'].version).toBe(worker.devDependencies.wrangler);
    const root = json('package.json');
    expect({ ...root.dependencies, ...root.devDependencies }.wrangler).toBeUndefined();
  });

  it('reads JSON with comments and trailing commas without touching strings', () => {
    expect(parseJsonc('// c\n{ "a": "x//y", /* b */ "b": [1, 2,], }')).toEqual({ a: 'x//y', b: [1, 2] });
  });
});
