// The wrangler dev suite (ENG17, E1 as revised by ENG13; V12-31): the real
// Workers runtime serves dist/ with wrangler.jsonc, so routing, the asset
// 404 and the _headers file are tested as Cloudflare applies them.
// Step 3 adds Turnstile (Cloudflare's dummy keys) and the local D1
// migrations to this suite.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, inject, it } from 'vitest';
import { CONTRACT_VERSION } from '../../src/api/contract';
import type { CoreItem } from '../../src/content/core';
import { itemsVersion } from '../../src/content/version';
import { SCORING_VERSION } from '../../src/scoring/config';
import { cspMismatch, parseHeadersFile, SECURITY_HEADERS } from '../../src/security/headers';

const ROOT = join(import.meta.dirname, '../..');
const URL_BASE = inject('wranglerUrl');
const BUILD_ID = inject('buildId');
const dist = (f: string) => readFileSync(join(ROOT, 'dist', f), 'utf8');
const HEADERS = parseHeadersFile(dist('_headers')).get('/*')!;
const NAVIGATE = { Accept: 'text/html,application/xhtml+xml', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' };
const FETCH = { Accept: '*/*', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty' };
const get = (path: string, headers: Record<string, string> = {}) => fetch(`${URL_BASE}${path}`, { headers, redirect: 'manual' });

const expectHeaders = (res: Response, where: string) => {
  expect(Object.keys(HEADERS).sort(), 'the _headers file names the security headers').toEqual(Object.keys(SECURITY_HEADERS).sort());
  for (const [name, value] of Object.entries(HEADERS)) expect(res.headers.get(name), `${where}: ${name}`).toBe(value);
};

describe('wrangler dev serving dist/', () => {
  it('health over the Workers runtime reports this build: scoring version, pool hash, contract, board off and the build id [V12-10] [V12-31]', async () => {
    const res = await get('/api/v1/health');
    expect(res.status).toBe(200);
    const items = JSON.parse(readFileSync(join(ROOT, 'data/items.json'), 'utf8')).items as CoreItem[];
    expect(await res.json()).toEqual({ scoring_version: SCORING_VERSION, pool_hash: itemsVersion(items), worker_version: BUILD_ID, contract_version: CONTRACT_VERSION, board_mode: 'off' });
    expectHeaders(res, '/api/v1/health');
  });

  it('/wp-login.php and an unknown path, as navigation and as fetch, get the 404 page with status 404 and the security headers [V12-10] [V12-170] [V12-31]', async () => {
    const page = dist('404.html');
    for (const path of ['/wp-login.php', '/random/path']) {
      for (const [kind, headers] of [['navigation', NAVIGATE], ['fetch', FETCH]] as const) {
        const res = await get(path, headers);
        expect(res.status, `${path} as ${kind}`).toBe(404);
        expect(await res.text(), `${path} as ${kind}`).toBe(page);
        expectHeaders(res, `${path} as ${kind}`);
      }
    }
  });

  it('the page and its assets carry the _headers values, and the header CSP equals the meta CSP plus frame-ancestors [V12-13] [V12-170] [V12-31]', async () => {
    const res = await get('/', NAVIGATE);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toBe(dist('index.html'));
    expectHeaders(res, '/');
    const meta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)![1]!.replace(/&#39;/g, "'");
    expect(cspMismatch(res.headers.get('Content-Security-Policy')!, meta)).toEqual([]);
    const script = html.match(/src="(\/assets\/index-[\w-]+\.js)"/)![1]!;
    const asset = await get(script, FETCH);
    expect(asset.status).toBe(200);
    expectHeaders(asset, script);
    expect(asset.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect((await get('/build.txt', FETCH)).status).toBe(200);
  });

  it('every other API path answers the not_found envelope with status 404 and the security headers [V12-10] [V12-31]', async () => {
    for (const path of ['/api/v1/board', '/api/anything']) {
      const res = await get(path, FETCH);
      expect(res.status, path).toBe(404);
      expect(await res.json(), path).toEqual({ reason: 'not_found', retryable: false });
      expectHeaders(res, path);
    }
  });
});
