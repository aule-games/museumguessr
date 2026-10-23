// Test doubles for the board's page client: a storage that keeps data (or
// one that does not), a scripted same-origin API, finished games and
// receipts in the contract's shapes.

import type { PublicBoard, Receipt, ScoreResponse, Week } from '../../../src/api/contract';
import type { FinishedGame } from '../../../src/board/payload';
import type { BoardDeps, Verifier } from '../../../src/board/session';
import { guarded, type KV } from '../../../src/storage/guarded';

export function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

/** A store that keeps data; `false` gives the memory-only fallback (storage off). */
export const kv = (persistent = true): KV => guarded(() => (persistent ? memStorage() : null));

export interface Sent {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
  url: string;
}

export type Reply = Response | ((req: Sent) => Response | Promise<Response>);

/** A scripted API: replies per "METHOD /path" are used in order; the last one repeats. */
export function api(routes: Record<string, Reply[]>) {
  const sent: Sent[] = [];
  const used = new Map<string, number>();
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    const u = new URL(url, 'https://museumguessr.com');
    const method = init.method ?? 'GET';
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>));
    const req: Sent = { method, path: u.pathname, headers, body: init.body ? JSON.parse(String(init.body)) : undefined, url };
    sent.push(req);
    const key = `${method} ${u.pathname.replace(/^\/api\/v1/, '').replace(/^\/scores\/.+$/, '/scores/:id')}`;
    const list = routes[key];
    if (!list?.length) throw new Error(`unmocked ${key}`);
    const n = used.get(key) ?? 0;
    used.set(key, n + 1);
    const r = list[Math.min(n, list.length - 1)]!;
    return typeof r === 'function' ? r(req) : r.clone();
  };
  return { fetch, sent, count: (method: string, path: string) => sent.filter((s) => s.method === method && s.path === `/api/v1${path}`).length };
}

export const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
export const html = (status: number, body: string, headers: Record<string, string> = {}) => new Response(body, { status, headers: { 'Content-Type': 'text/html', ...headers } });
export const error = (reason: string, status: number, extra: Record<string, unknown> = {}) => json(status, { reason, retryable: ['turnstile_failed', 'rate_limited', 'try_later', 'board_disabled', 'server', 'edge_limited', 'unavailable'].includes(reason), ...extra });

export const WEEK = '2026-W43' as Week;

export function board(over: Partial<PublicBoard> = {}): PublicBoard {
  return {
    week: WEEK,
    resets_at: '2026-10-26T00:00:00.000Z',
    count: 40,
    cutoff_total: 12000,
    rows: [{ row_id: 'r1', name: 'Quiet Amber Heron', total: 25000, rank: 1, date: '2026-10-20' }],
    updated_at: '2026-10-22T10:00:00.000Z',
    ...over,
  };
}

export const personal = (over: Record<string, unknown> = {}) => ({ name: 'Bold Ochre Lantern', best: null, weeks: [], ...over });

export function receipt(over: Partial<Receipt> = {}): Receipt {
  return { game_id: 'g1', current_game_id: 'g1', row_id: 'row-1', week: WEEK, total: 18240, status: 'current', receipt_rank: 12, count: 40, best: { row_id: 'row-1', total: 18240, standing: { kind: 'exact', rank: 12, tied: false } }, ...over };
}

export const scored = (over: Partial<ScoreResponse> = {}, r: Partial<Receipt> = {}): ScoreResponse => ({ receipt: receipt(r), replaced: false, smoke: false, ...over });

/** A finished, eligible random game of week 2026-W43. */
export function finished(over: Partial<FinishedGame> = {}): FinishedGame {
  const ids = Array.from({ length: 10 }, (_, i) => `item-${i}`);
  return {
    game_id: 'g1',
    game_ref: 'ref-g1-0000000000',
    src: 'none',
    deck_kind: 'random',
    fresh: true,
    first_seen: ids.map(() => true),
    deck_hash: 'abcd1234',
    scoring_version: 3,
    item_ids: ids,
    answers: ids.map(() => ({ kept: { lat: 48.85, lng: 2.35 }, made: { lat: 41.9, lng: 12.5 }, when: 1500 })),
    results: ids.map(() => ({ kept: { points: 900, km: 10 }, made: { points: 600, km: 300 }, when: { points: 324, yearsOff: 40 }, points: 1824, skipped: false })),
    timed_out: ids.map(() => null),
    board_week: WEEK,
    test_assisted: false,
    ...over,
  };
}

/** Turnstile stand-in: always a fresh token, or interactive, or failing. */
export function verifier(mode: 'pass' | 'interactive' | 'fail' = 'pass'): Verifier & { tokens: string[] } {
  const tokens: string[] = [];
  return {
    tokens,
    async token(on) {
      if (mode === 'fail') throw new Error('did not load');
      if (mode === 'interactive') {
        on.interactive(true);
        on.interactive(false);
      }
      const t = `token-${tokens.length + 1}`;
      tokens.push(t);
      return t;
    },
  };
}

/** Deps with a manual clock and timers that run only when asked. */
export function deps(store: KV, fetch: (url: string, init: RequestInit) => Promise<Response>, over: Partial<BoardDeps> = {}) {
  const timers: { fn: () => void; at: number }[] = [];
  const events: { name: string; props: Record<string, unknown> }[] = [];
  let now = Date.parse('2026-10-22T12:00:00Z');
  const d: BoardDeps & { advance(ms: number): Promise<void>; events: typeof events; timers: typeof timers } = {
    kv: store,
    fetch,
    locks: undefined,
    now: () => now,
    verifier: verifier(),
    background: verifier(),
    track: (name, props) => events.push({ name, props }),
    revs: (ids) => ids.map(() => 1),
    setTimer: (fn, ms) => {
      const t = { fn, at: now + ms };
      timers.push(t);
      return t;
    },
    clearTimer: (h) => {
      const i = timers.indexOf(h as (typeof timers)[number]);
      if (i >= 0) timers.splice(i, 1);
    },
    events,
    timers,
    async advance(ms) {
      now += ms;
      for (const t of [...timers].filter((x) => x.at <= now)) {
        timers.splice(timers.indexOf(t), 1);
        t.fn();
      }
      await flush();
    },
    ...over,
  };
  return d;
}

export const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};
