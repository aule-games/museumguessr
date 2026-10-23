// The wrangler dev suite (ENG17, E1 as revised by ENG13; V12-31): the real
// Workers runtime serves dist/ with wrangler.jsonc, so routing, the asset
// 404 and the _headers file are tested as Cloudflare applies them.
// Step 3 adds the local D1 migrations (applied with wrangler d1 migrations
// apply --local, triggers included) and Turnstile with Cloudflare's test
// secrets: the main instance always passes, a second one always fails.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, inject, it } from 'vitest';
import { CONTRACT_VERSION, type Week } from '../../src/api/contract';
import type { CoreItem } from '../../src/content/core';
import { itemsVersion } from '../../src/content/version';
import { SCORING_VERSION } from '../../src/scoring/config';
import { cspMismatch, parseHeadersFile, SECURITY_HEADERS } from '../../src/security/headers';
import { buildPayload } from './helpers/harness';

const ROOT = join(import.meta.dirname, '../..');
const URL_BASE = inject('wranglerUrl');
const FAILING = inject('failingUrl');
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
  it('health over the Workers runtime reports this build: scoring version, pool hash, contract, the board mode from local D1 and the build id [V12-10] [V12-31]', async () => {
    const res = await get('/api/v1/health');
    expect(res.status).toBe(200);
    const items = JSON.parse(readFileSync(join(ROOT, 'data/items.json'), 'utf8')).items as CoreItem[];
    expect(await res.json()).toEqual({ scoring_version: SCORING_VERSION, pool_hash: itemsVersion(items), worker_version: BUILD_ID, contract_version: CONTRACT_VERSION, board_mode: 'dark' });
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
    for (const path of ['/api/v1/boards', '/api/anything', '/api/v1/scores/a/b']) {
      const res = await get(path, FETCH);
      expect(res.status, path).toBe(404);
      expect(await res.json(), path).toEqual({ reason: 'not_found', retryable: false });
      expectHeaders(res, path);
    }
  });
});

const KEY = 'AAAAAAAAAAAAAAAAAAAAAA';
const TEST_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
const SMOKE = { 'X-MuseumGuessr-Test': '1' };
const api = (base: string, path: string, init: { method?: string; key?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
  fetch(`${base}${path}`, {
    method: init.method ?? 'GET',
    headers: { ...(init.key ? { Authorization: `Bearer ${init.key}` } : {}), ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

describe('the board on wrangler dev with local D1 (dark mode)', () => {
  it('wrangler d1 migrations apply --local creates the bucket triggers [V12-102] [V12-31]', () => {
    expect(inject('localTriggers')).toEqual(['scores_delete', 'scores_insert', 'scores_insert_hidden', 'scores_update']);
  });

  it('an ordinary read is disabled in dark mode; the test header gives the server week, private and uncached [V12-105] [V12-31]', async () => {
    const plain = await api(URL_BASE, '/api/v1/board');
    expect(await plain.json()).toEqual({ disabled: true });
    const dark = await api(URL_BASE, '/api/v1/board', { headers: SMOKE });
    expect(dark.headers.get('Cache-Control')).toBe('private, no-store');
    const body = (await dark.json()) as { smoke: boolean; week: string; resets_at: string };
    expect(body).toMatchObject({ smoke: true });
    expect(body.week).toMatch(/^\d{4}-W\d{2}$/);
    expectHeaders(dark, '/api/v1/board');
  });

  it('with the always-pass test secret a test-assisted game goes through siteverify into smoke rows; a lower one is not_best; the owner sees it with the header [V12-92] [V12-105] [V12-31]', async () => {
    const { week } = (await (await api(URL_BASE, '/api/v1/board', { headers: SMOKE })).json()) as { week: Week };
    const added = await api(URL_BASE, '/api/v1/scores', { method: 'POST', key: KEY, body: buildPayload(21000, week, { test_assisted: true, turnstile_token: TEST_TOKEN }) });
    const receipt = (await added.json()) as { smoke: boolean; receipt: { row_id: string; receipt_rank: null; total: number } };
    expect(added.status, JSON.stringify(receipt)).toBe(201);
    expect(receipt).toMatchObject({ smoke: true, receipt: { total: 21000, receipt_rank: null } });
    const lower = await api(URL_BASE, '/api/v1/scores', { method: 'POST', key: KEY, body: buildPayload(9000, week, { test_assisted: true, turnstile_token: TEST_TOKEN }) });
    expect(lower.status).toBe(409);
    expect(await lower.json()).toMatchObject({ reason: 'not_best', best: { total: 21000 } });
    const mine = (await (await api(URL_BASE, '/api/v1/board', { key: KEY, headers: SMOKE })).json()) as { personal: { best: { total: number; standing: null } } };
    expect(mine.personal.best).toEqual({ row_id: receipt.receipt.row_id, total: 21000, standing: null });
    const ordinary = await api(URL_BASE, '/api/v1/scores', { method: 'POST', key: KEY, body: buildPayload(30000, week, { turnstile_token: TEST_TOKEN }) });
    expect(await ordinary.json()).toMatchObject({ reason: 'board_disabled' });
  });

  it('with the always-fail test secret siteverify refuses: turnstile_failed, retryable, nothing stored [V12-92] [V12-31]', async () => {
    const { week } = (await (await api(FAILING, '/api/v1/board', { headers: SMOKE })).json()) as { week: Week };
    const res = await api(FAILING, '/api/v1/scores', { method: 'POST', key: KEY, body: buildPayload(21000, week, { test_assisted: true, turnstile_token: TEST_TOKEN }) });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ reason: 'turnstile_failed', retryable: true });
    const mine = (await (await api(FAILING, '/api/v1/board', { key: KEY, headers: SMOKE })).json()) as { personal: { best: unknown } };
    expect(mine.personal.best).toBeNull();
  });
});
