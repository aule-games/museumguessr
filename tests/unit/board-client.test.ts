import { describe, expect, it } from 'vitest';
import { ERRORS } from '../../src/api/contract';
import { canonicalPayload } from '../../src/api/canonical';
import { api as client, failure, isBoardResponse, isScoreResponse, retryAfter, scoreBody } from '../../src/board/client';
import { scorePayload } from '../../src/board/payload';
import { ensureKey, fingerprint, isKey, KEY_LOCK, newKey, readKey } from '../../src/board/key';
import { KEYS } from '../../src/state/schema';
import { api, board, error, finished, html, json, kv, personal, scored } from './helpers/board';

const payload = scorePayload(finished(), Array(10).fill(1));

const QUOTA_PAGE = '<!DOCTYPE html><html><head><title>Worker exceeded resource limits | museumguessr.com | Cloudflare</title></head><body><span class="code-label">Error code: 1027</span><p>This website has been temporarily rate limited</p></body></html>';
const WAF_PAGE = '<!DOCTYPE html><html><head><title>Access denied | museumguessr.com used Cloudflare to restrict access</title></head><body><h1>Error 1015</h1><p>You are being rate limited</p></body></html>';

describe('the board API client', () => {
  it('the page branches on the reason, never the status: a WAF 429 page is edge_limited with Retry-After, a 1027 quota page and any other non-JSON answer are unavailable [V12-111]', () => {
    // two refusals with the same status are told apart by reason
    expect(failure(409, 'application/json', JSON.stringify({ reason: 'not_best', retryable: false, best: { row_id: 'r1', total: 25000, standing: null } }), null)).toMatchObject({ reason: 'not_best', retryable: false, best: { total: 25000 } });
    expect(failure(409, 'application/json', JSON.stringify({ reason: 'duplicate', retryable: false }), null).reason).toBe('duplicate');
    // a JSON envelope's own retry_after is kept
    expect(failure(429, 'application/json; charset=utf-8', JSON.stringify({ reason: 'rate_limited', retryable: true, retry_after: 42 }), null)).toEqual({ reason: 'rate_limited', retryable: true, retry_after: 42 });
    // the edge's own 429 page is not JSON
    expect(failure(429, 'text/html', WAF_PAGE, '30')).toEqual({ reason: 'edge_limited', retryable: true, retry_after: 30 });
    expect(failure(429, 'text/html', WAF_PAGE, null)).toEqual({ reason: 'edge_limited', retryable: true });
    // the quota page says 1027, whatever its status
    expect(failure(429, 'text/html', QUOTA_PAGE, '30').reason).toBe('unavailable');
    expect(failure(503, 'text/html', QUOTA_PAGE, null).reason).toBe('unavailable');
    expect(failure(502, 'text/html', '<html>Bad gateway</html>', null).reason).toBe('unavailable');
    // a JSON body with an unknown reason is not trusted
    expect(failure(400, 'application/json', JSON.stringify({ reason: 'teapot' }), null).reason).toBe('unavailable');
    expect(retryAfter('Wed, 21 Oct 2026 07:28:30 GMT', Date.parse('2026-10-21T07:28:00Z'))).toBe(30);
    expect(retryAfter('soon')).toBeUndefined();
    // every reason has the contract's retryability
    for (const [reason, e] of Object.entries(ERRORS)) expect(failure(e.status, 'application/json', JSON.stringify({ reason }), null)).toMatchObject({ reason, retryable: e.retryable });
  });

  it('the device key goes only in the bearer header: never in the address or a body, and the smoke header only for a test game [V12-82]', async () => {
    const a = api({ 'GET /board': [json(200, { ...board(), personal: personal() })], 'POST /scores': [json(201, scored())], 'DELETE /scores/:id': [json(200, { removed: true, row_id: 'row-1', week: '2026-W43' })] });
    const key = newKey();
    await client.board(a.fetch, key, false);
    await client.board(a.fetch, null, true);
    await client.submit(a.fetch, key, payload, 't');
    await client.remove(a.fetch, key, 'row-1');
    expect(a.sent.map((s) => `${s.method} ${s.path}`)).toEqual(['GET /api/v1/board', 'GET /api/v1/board', 'POST /api/v1/scores', 'DELETE /api/v1/scores/row-1']);
    for (const s of a.sent) {
      expect(s.url).not.toContain(key);
      expect(JSON.stringify(s.body ?? {})).not.toContain(key);
    }
    expect(a.sent[0]!.headers.Authorization).toBe(`Bearer ${key}`);
    expect(a.sent[0]!.headers['X-MuseumGuessr-Test']).toBeUndefined();
    expect(a.sent[1]!.headers.Authorization).toBeUndefined();
    expect(a.sent[1]!.headers['X-MuseumGuessr-Test']).toBe('1');
    // the POST body is the canonical payload text with the token added last
    const body = scoreBody(payload, 'tok');
    expect(body.startsWith(canonicalPayload(payload).slice(0, -1))).toBe(true);
    expect(Object.keys(JSON.parse(body))).toEqual([...Object.keys(JSON.parse(canonicalPayload(payload))), 'turnstile_token']);
  });

  it('an unreachable API, an unreadable success and a malformed board are all unavailable, never trusted [V12-111]', async () => {
    const down = await client.board(async () => {
      throw new TypeError('offline');
    }, null);
    expect(down).toEqual({ ok: false, error: { reason: 'unavailable', retryable: true } });
    const garbled = await client.board(api({ 'GET /board': [html(200, 'not json')] }).fetch, null);
    expect(garbled.ok).toBe(false);
    expect(isBoardResponse({ ...board(), rows: [{ row_id: 'r', name: 'x', total: 1, rank: 1, date: '2026-10-20T10:00:00Z' }] })).toBe(false);
    expect(isBoardResponse({ ...board(), rows: Array.from({ length: 51 }, () => board().rows[0]) })).toBe(false);
    expect(isBoardResponse({ disabled: true })).toBe(true);
    expect(isBoardResponse({ smoke: true, week: '2026-W43', resets_at: '2026-10-26T00:00:00Z' })).toBe(true);
    expect(isScoreResponse(scored())).toBe(true);
    expect(isScoreResponse({ ...scored(), receipt: { ...scored().receipt, week: '2026-43' } })).toBe(false);
    const quota = await client.submit(api({ 'POST /scores': [html(429, QUOTA_PAGE)] }).fetch, newKey(), payload, 't');
    expect(quota).toEqual({ ok: false, error: { reason: 'unavailable', retryable: true } });
    const limited = await client.submit(api({ 'POST /scores': [error('rate_limited', 429, { retry_after: 20 })] }).fetch, newKey(), payload, 't');
    expect(limited).toMatchObject({ ok: false, error: { reason: 'rate_limited', retry_after: 20 } });
  });
});

describe('the device key', () => {
  it('is 128 random bits in base64url, created once under the named lock even when two cards ask at once [V12-81]', async () => {
    const k = newKey(() => new Uint8Array(16).fill(255));
    expect(k).toBe('_____________________w');
    expect(isKey(newKey())).toBe(true);
    expect(newKey()).not.toBe(newKey());
    // a lock manager that runs one request at a time, as the browser's does
    const names: string[] = [];
    let chain = Promise.resolve<unknown>(undefined);
    const locks = {
      request: (name: string, cb: () => Promise<string>) => {
        names.push(name);
        const run = chain.then(() => new Promise((r) => setTimeout(r, 5))).then(cb);
        chain = run.catch(() => undefined);
        return run;
      },
    } as unknown as LockManager;
    const store = kv();
    const [a, b] = await Promise.all([ensureKey(store, locks), ensureKey(store, locks)]);
    expect(a).toBe(b);
    expect(readKey(store)).toBe(a);
    expect(names).toEqual([KEY_LOCK, KEY_LOCK]);
    // a damaged key is replaced, not used
    store.set(KEYS.boardKey, 'short');
    expect(readKey(store)).toBeNull();
    expect(isKey(await ensureKey(store, undefined))).toBe(true);
    expect(await fingerprint(a)).not.toBe(await fingerprint(newKey()));
    expect(await fingerprint(a)).toMatch(/^[0-9a-f]{16}$/);
  });
});
