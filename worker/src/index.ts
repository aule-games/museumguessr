// The museumguessr.com Worker (W1, ENG13; V12-10). Workers static assets
// serve the site; only /api/* runs this code first (wrangler.jsonc). Any
// other path that reaches the Worker (an unknown address may) is answered
// by the assets binding, which returns the 404 page with status 404 and
// never touches the board's storage. Every response carries the security
// headers. Step 3 adds the board routes to ROUTES.

import { API_PREFIX, CONTRACT_VERSION, type BoardMode, type HealthResponse } from '../../src/api/contract.ts';
import { SCORING_VERSION } from '../../src/scoring/config.ts';
import { POOL_HASH } from './pool.ts';
import { apiError, json, secured } from './respond.ts';

/** The assets binding (Workers static assets). */
export interface Assets {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  ASSETS: Assets;
  /** The deployed build's git SHA; npm run deploy sets it with --var. */
  WORKER_VERSION?: string;
}

type Handler = (request: Request, env: Env) => Response | Promise<Response>;
interface Route {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  handler: Handler;
}

/** Until step 3 builds the board, its mode is always off. */
const boardMode = async (): Promise<BoardMode> => 'off';

async function health(_request: Request, env: Env): Promise<Response> {
  const body: HealthResponse = {
    scoring_version: SCORING_VERSION,
    pool_hash: POOL_HASH,
    worker_version: env.WORKER_VERSION ?? 'dev',
    contract_version: CONTRACT_VERSION,
    board_mode: await boardMode(),
  };
  return json(body);
}

/** The API routes; step 3 adds GET /board, POST /scores and the receipt routes here. */
export const ROUTES: readonly Route[] = [{ method: 'GET', path: `${API_PREFIX}/health`, handler: health }];

/** A random id for a server error, so a report can be matched to its log line. */
const requestId = () => crypto.randomUUID();

async function api(request: Request, env: Env, url: URL): Promise<Response> {
  const method = request.method === 'HEAD' ? 'GET' : request.method;
  const route = ROUTES.find((r) => r.path === url.pathname && r.method === method);
  if (!route) return apiError('not_found');
  try {
    return await route.handler(request, env);
  } catch (error) {
    // The only log line (docs/api.md "Errors"): request id, route and error name; never a body, IP or key.
    const request_id = requestId();
    console.error(JSON.stringify({ request_id, route: route.path, error_name: error instanceof Error ? error.name : 'unknown' }));
    return apiError('server', { request_id });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return api(request, env, url);
    return secured(await env.ASSETS.fetch(request));
  },
};
