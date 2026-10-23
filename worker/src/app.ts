// The API router (W1, M1, M9; V12-10, V12-111, V12-112). Every error is the
// contract envelope; a refusal carries its own reason, a D1 failure answers
// `unavailable`, and anything else `server`. A 5xx from a failure logs
// exactly { request_id, route, error_name }: never a body, an IP or a key.

import { API_PREFIX, CONTRACT_VERSION, type HealthResponse } from '../../src/api/contract.ts';
import { SCORING_VERSION } from '../../src/scoring/config.ts';
import { getBoard, type Modes } from './board.ts';
import { Refused, StoreError } from './errors.ts';
import { modeReader } from './mode.ts';
import type { BoardCache, Ctx, Env } from './platform.ts';
import { POOL_HASH } from './pool.ts';
import { purge, type PurgeReport } from './purge.ts';
import { apiError, json, secured } from './respond.ts';
import { deleteScore, getReceipt, postScore } from './scores.ts';

export type Handler = (request: Request, ctx: Ctx, modes: Modes) => Response | Promise<Response>;
export interface Route {
  method: 'GET' | 'POST' | 'DELETE';
  /** As docs/api.md writes it; `<row_id>` matches one path segment. */
  path: string;
  handler: Handler;
}

async function health(_request: Request, ctx: Ctx, modes: Modes): Promise<Response> {
  const body: HealthResponse = {
    scoring_version: SCORING_VERSION,
    pool_hash: POOL_HASH,
    worker_version: ctx.env.WORKER_VERSION ?? 'dev',
    contract_version: CONTRACT_VERSION,
    board_mode: await modes.read(ctx),
  };
  return json(body);
}

export const ROUTES: readonly Route[] = [
  { method: 'GET', path: `${API_PREFIX}/health`, handler: health },
  { method: 'GET', path: `${API_PREFIX}/board`, handler: getBoard },
  { method: 'POST', path: `${API_PREFIX}/scores`, handler: postScore },
  { method: 'GET', path: `${API_PREFIX}/scores/<row_id>`, handler: getReceipt },
  { method: 'DELETE', path: `${API_PREFIX}/scores/<row_id>`, handler: (request, ctx) => deleteScore(request, ctx) },
];

const matches = (pattern: string, path: string) => {
  const a = pattern.split('/');
  const b = path.split('/');
  return a.length === b.length && a.every((seg, i) => (seg === '<row_id>' ? b[i] !== '' : seg === b[i]));
};

/** A random id for a server error, so a report can be matched to its log line. */
const requestId = () => crypto.randomUUID();

export interface AppDeps {
  now?: () => number;
  cache?: () => BoardCache | null;
  fetch?: typeof fetch;
}

interface Exec {
  waitUntil(p: Promise<unknown>): void;
}

export function createApp(deps: AppDeps = {}) {
  const modes = modeReader();
  const context = (env: Env, exec?: Exec): Ctx => ({
    env,
    now: deps.now ?? Date.now,
    cache: deps.cache ? deps.cache() : null,
    fetch: deps.fetch ?? ((input, init) => fetch(input, init)),
    waitUntil: exec ? (p) => exec.waitUntil(p) : (p) => void p.catch(() => {}),
  });

  async function api(request: Request, env: Env, url: URL, exec?: Exec): Promise<Response> {
    const method = request.method === 'HEAD' ? 'GET' : request.method;
    const route = ROUTES.find((r) => r.method === method && matches(r.path, url.pathname));
    if (!route) return apiError('not_found');
    try {
      return await route.handler(request, context(env, exec), modes);
    } catch (error) {
      if (error instanceof Refused) return apiError(error.reason, error.extra);
      // The only log line (docs/api.md "Errors"): request id, route and error name; never a body, IP or key.
      const request_id = requestId();
      console.error(JSON.stringify({ request_id, route: route.path, error_name: error instanceof Error ? error.name : 'unknown' }));
      return apiError(error instanceof StoreError ? 'unavailable' : 'server', { request_id });
    }
  }

  return {
    modes,
    async fetch(request: Request, env: Env, exec?: Exec): Promise<Response> {
      const url = new URL(request.url);
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return api(request, env, url, exec);
      return secured(await env.ASSETS.fetch(request));
    },
    async scheduled(_controller: unknown, env: Env, exec?: Exec): Promise<PurgeReport | null> {
      try {
        return await purge(context(env, exec));
      } catch (error) {
        console.error(JSON.stringify({ request_id: requestId(), route: 'scheduled', error_name: error instanceof Error ? error.name : 'unknown' }));
        return null;
      }
    },
  };
}
