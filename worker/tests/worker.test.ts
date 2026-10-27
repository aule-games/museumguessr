import { describe, expect, it, vi } from 'vitest';
import { CONTRACT_VERSION, ERRORS } from '../../src/api/contract';
import { ITEMS_VERSION } from '../../src/content/items';
import { SCORING_VERSION } from '../../src/scoring/config';
import { DEPLOY_HEADERS } from '../../src/security/deploy-headers';
import worker, { type Env, ROUTES } from '../src/index';
import { sqliteD1 } from './helpers/sqlite-d1';

const NOT_FOUND_PAGE = '<!doctype html><h1>Page not found</h1>';

/** A stand-in for the assets binding: the site's files, and the 404 page for anything else. */
function assets(files: Record<string, string> = { '/': '<!doctype html><title>MuseumGuessr</title>', '/build.txt': 'abc1234\n' }) {
  const calls: string[] = [];
  const binding = {
    async fetch(request: Request) {
      const path = new URL(request.url).pathname;
      calls.push(path);
      const body = files[path];
      return body === undefined
        ? new Response(NOT_FOUND_PAGE, { status: 404, headers: { 'Content-Type': 'text/html' } })
        : new Response(body, { status: 200, headers: { 'Content-Type': 'text/html', ETag: '"x"' } });
    },
  };
  return { binding, calls };
}

const call = (path: string, init: RequestInit = {}, env: Partial<Env> = {}) => {
  const { binding, calls } = assets();
  const full = { ASSETS: binding, WORKER_VERSION: 'abc1234', DB: sqliteD1(), ...env } as Env;
  return { response: worker.fetch(new Request(`https://museumguessr.com${path}`, init), full), calls };
};

const expectSecurityHeaders = (response: Response) => {
  for (const [name, value] of Object.entries(DEPLOY_HEADERS)) expect(response.headers.get(name), name).toBe(value);
};

const NAVIGATE = { headers: { Accept: 'text/html', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' } };
const FETCH = { headers: { Accept: '*/*', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty' } };

describe('the Worker routes', () => {
  it('health reports the scoring version, the pool hash the page uses, the build SHA, the contract version and the board off [V12-10]', async () => {
    const { response, calls } = call('/api/v1/health');
    const res = await response;
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({ scoring_version: SCORING_VERSION, pool_hash: ITEMS_VERSION, worker_version: 'abc1234', contract_version: CONTRACT_VERSION, board_mode: 'off' });
    expect(calls).toEqual([]);
    const local = await call('/api/v1/health', {}, { WORKER_VERSION: undefined }).response;
    expect((await local.json()).worker_version).toBe('dev');
    expect(ROUTES.map((r) => `${r.method} ${r.path}`)).toEqual(['GET /api/v1/health', 'GET /api/v1/board', 'POST /api/v1/scores', 'GET /api/v1/scores/<row_id>', 'DELETE /api/v1/scores/<row_id>']);
  });

  it('every other /api/ path answers the not_found envelope with status 404 [V12-10]', async () => {
    for (const [path, init] of [['/api/v1/boards', {}], ['/api/v2/health', {}], ['/api/', {}], ['/api/v1/scores/', {}], ['/api/v1/scores/abc/def', {}], ['/api/v1/health', { method: 'POST', body: '{}' }], ['/api/v1/board', { method: 'POST', body: '{}' }]] as const) {
      const { response, calls } = call(path, init);
      const res = await response;
      expect(res.status, path).toBe(ERRORS.not_found.status);
      expect(await res.json(), path).toEqual({ reason: 'not_found', retryable: false });
      expectSecurityHeaders(res);
      expect(calls, path).toEqual([]);
    }
  });

  it('a non-API path, as navigation or fetch, is answered by the assets binding, so an unknown path gets the 404 page and status 404 [V12-10]', async () => {
    for (const path of ['/wp-login.php', '/random/path', '/.env']) {
      for (const init of [NAVIGATE, FETCH]) {
        const { response, calls } = call(path, init);
        const res = await response;
        expect(res.status, path).toBe(404);
        expect(await res.text(), path).toBe(NOT_FOUND_PAGE);
        expect(calls, path).toEqual([path]);
        expectSecurityHeaders(res);
      }
    }
    const home = await call('/', NAVIGATE).response;
    expect(home.status).toBe(200);
    expect(home.headers.get('ETag')).toBe('"x"');
  });

  it('every Worker response carries nosniff, a Referrer-Policy, a Permissions-Policy and the header CSP with frame-ancestors [V12-170] [V12-13]', async () => {
    for (const path of ['/api/v1/health', '/api/v1/nope', '/missing', '/']) {
      const res = await call(path).response;
      expectSecurityHeaders(res);
      expect(res.headers.get('Content-Security-Policy'), path).toContain("frame-ancestors 'none'");
    }
  });

  it('a failing API route answers the server envelope with a request id and logs only request_id, route and error_name [V12-10]', async () => {
    const original = ROUTES[0]!.handler;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    (ROUTES[0] as { handler: unknown }).handler = () => {
      throw new TypeError('secret detail 203.0.113.9');
    };
    try {
      const res = await call('/api/v1/health').response;
      expect(res.status).toBe(500);
      const body = (await res.json()) as { reason: string; retryable: boolean; request_id: string };
      expect(body).toMatchObject({ reason: 'server', retryable: true });
      expect(body.request_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(spy).toHaveBeenCalledTimes(1);
      const line = JSON.parse(String(spy.mock.calls[0]![0]));
      expect(line).toEqual({ request_id: body.request_id, route: '/api/v1/health', error_name: 'TypeError' });
      expect(String(spy.mock.calls[0]![0])).not.toContain('203.0.113.9');
    } finally {
      (ROUTES[0] as { handler: unknown }).handler = original;
      spy.mockRestore();
    }
  });
});
