import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
    expect(config.d1_databases).toBeUndefined();
    expect(config.site).toBeUndefined();
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
