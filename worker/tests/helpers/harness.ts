// One test harness for the board API: a fixed clock, a D1 binding (node:sqlite
// here, Miniflare's real D1 in the smoke suite), the rate-limit bindings,
// the Cache API, a recorded siteverify, and helpers that build valid
// payloads with exact totals (each placed answer is perfect, 1,000 points;
// each other question timed out, 0 points).
import itemsFile from '../../../data/items.json';
import type { BoardMode, ScorePayload, Ten, Week } from '../../../src/api/contract';
import { CONTRACT_VERSION, TURNSTILE_ACTION } from '../../../src/api/contract';
import { weekId } from '../../../src/api/week';
import { SCORING_VERSION } from '../../../src/scoring/config';
import { normalizeAnswerYear } from '../../../src/scoring/years';
import { createApp } from '../../src/app';
import type { BoardCache, D1Database, Env, RateLimiter } from '../../src/platform';
import { probe } from './probe';

interface PoolItem {
  id: string;
  made: { lat: number; lng: number };
  kept: { lat: number; lng: number };
  when: { start: number; end: number };
}
export const POOL = (itemsFile as unknown as { items: PoolItem[] }).items;

/** Monday 2026-10-19 00:00 UTC is the start of 2026-W43. */
export const W43_START = Date.UTC(2026, 9, 19);
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

export function clock(start = W43_START + 2 * DAY + 10 * HOUR) {
  let t = start;
  return { now: () => t, set: (ms: number) => void (t = ms), advance: (ms: number) => void (t += ms) };
}
export type Clock = ReturnType<typeof clock>;

/** caches.default in memory, honouring max-age against the test clock. */
export function memoryCache(c: Clock): BoardCache & { size(): number } {
  const store = new Map<string, { body: string; headers: [string, string][]; expires: number }>();
  const k = (r: Request | string) => (typeof r === 'string' ? r : r.url);
  return {
    size: () => store.size,
    async match(r) {
      const hit = store.get(k(r));
      if (!hit || hit.expires <= c.now()) return undefined;
      return new Response(hit.body, { headers: hit.headers });
    },
    async put(r, res) {
      const age = Number(/max-age=(\d+)/.exec(res.headers.get('Cache-Control') ?? '')?.[1] ?? 0);
      if (age > 0) store.set(k(r), { body: await res.text(), headers: [...res.headers], expires: c.now() + age * 1000 });
    },
    async delete(r) {
      return store.delete(k(r));
    },
  };
}

/** A rate-limit binding: `limit` requests per key per 60 s of the test clock. */
export function memoryLimiter(c: Clock, limit: number): RateLimiter & { calls: string[] } {
  const seen = new Map<string, number[]>();
  const calls: string[] = [];
  return {
    calls,
    async limit({ key }) {
      calls.push(key);
      const now = c.now();
      const recent = (seen.get(key) ?? []).filter((t) => now - t < 60_000);
      if (recent.length >= limit) {
        seen.set(key, recent);
        return { success: false };
      }
      recent.push(now);
      seen.set(key, recent);
      return { success: true };
    },
  };
}

export type Verify = 'ok' | 'fail' | 'down' | 'test-key' | 'wrong-host' | 'wrong-action';

export interface PlatformParts {
  db: D1Database;
  cache: BoardCache | null;
  limiters?: Partial<Record<'IP_LIMIT' | 'NEW_ROW_LIMIT' | 'KEY_LIMIT', RateLimiter>>;
}

/** Keys: fixed public fixtures, never a real player's credential. */
export const KEYS = ['AAAAAAAAAAAAAAAAAAAAAA', 'BBBBBBBBBBBBBBBBBBBBBA', 'CCCCCCCCCCCCCCCCCCCCCA', 'DDDDDDDDDDDDDDDDDDDDDA'] as const;

let counter = 0;
/** A fresh 128-bit base64url id (22 characters, last one from A/Q/g/w). */
export const freshId = () => {
  counter += 1;
  const body = `${counter.toString(36).padStart(8, '0')}${Math.random().toString(36).slice(2, 15)}`.replace(/[^A-Za-z0-9]/g, 'x');
  return `${body.padEnd(21, 'x').slice(0, 21)}A`;
};

export type PayloadOptions = Partial<ScorePayload> & { turnstile_token?: string; offset?: number };

/** A valid request whose rescored total is exactly `total` (a multiple of 1,000) for `week`. */
export function buildPayload(total: number, week: Week | null, over: PayloadOptions = {}) {
  if (total % 1000 !== 0 || total < 0 || total > 30000) throw new Error('payload totals are multiples of 1,000');
  const start = over.offset ?? 0;
  const items = POOL.slice(start, start + 10);
  let left = total / 1000;
  const answers = items.map((it) => {
    const take = Math.min(3, left);
    left -= take;
    return {
      made: take >= 1 ? { lat: it.made.lat, lng: it.made.lng } : null,
      when: take >= 2 ? normalizeAnswerYear(it.when.start) : null,
      kept: take >= 3 ? { lat: it.kept.lat, lng: it.kept.lng } : null,
    };
  });
  const timed = answers.map((a) => ({ made: a.made === null, when: a.when === null, kept: a.kept === null }));
  const { offset: _offset, turnstile_token, ...rest } = over;
  void _offset;
  return {
    game_id: freshId(),
    deck_kind: 'random' as const,
    fresh: true,
    deck_hash: '0a1b2c3d',
    answers_revs: items.map(() => 1) as unknown as Ten<number>,
    scoring_version: SCORING_VERSION,
    item_ids: items.map((it) => it.id) as unknown as Ten<string>,
    answers: answers as unknown as ScorePayload['answers'],
    skipped: items.map(() => false) as unknown as Ten<boolean>,
    timed_out: timed as unknown as ScorePayload['timed_out'],
    board_week: week,
    client_version: CONTRACT_VERSION,
    test_assisted: false,
    ...rest,
    turnstile_token: turnstile_token ?? 'token',
  };
}

export function harness(make: (c: Clock) => PlatformParts, options: { start?: number; env?: Partial<Env> } = {}) {
  const c = clock(options.start);
  const parts = make(c);
  const db = probe(parts.db);
  const limiters = {
    IP_LIMIT: parts.limiters?.IP_LIMIT ?? memoryLimiter(c, 30),
    NEW_ROW_LIMIT: parts.limiters?.NEW_ROW_LIMIT ?? memoryLimiter(c, 5),
    KEY_LIMIT: parts.limiters?.KEY_LIMIT ?? memoryLimiter(c, 3),
  };
  const siteverify = { result: 'ok' as Verify, calls: [] as URLSearchParams[] };
  const fakeFetch = (async (_url: string, init: RequestInit) => {
    siteverify.calls.push(new URLSearchParams(String(init.body)));
    const r = siteverify.result;
    if (r === 'down') throw new TypeError('network down');
    const body =
      r === 'fail' ? { success: false, 'error-codes': ['invalid-input-response'] }
      : r === 'test-key' ? { success: true, hostname: 'example.com', metadata: { result_with_testing_key: true } }
      : { success: true, hostname: r === 'wrong-host' ? 'evil.example' : 'museumguessr.com', action: r === 'wrong-action' ? 'other' : TURNSTILE_ACTION };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  const env: Env = {
    ASSETS: { fetch: async () => new Response('asset', { status: 404 }) },
    WORKER_VERSION: 'test',
    DB: db.db,
    ...limiters,
    TURNSTILE_SECRET: 'test-secret',
    TURNSTILE_HOSTNAME: 'museumguessr.com',
    ...options.env,
  };
  const pending: Promise<unknown>[] = [];
  const app = createApp({ now: c.now, cache: () => parts.cache, fetch: fakeFetch });
  const exec = { waitUntil: (p: Promise<unknown>) => void pending.push(p) };

  async function call(method: string, path: string, init: { key?: string | null; body?: unknown; raw?: string; headers?: Record<string, string>; ip?: string } = {}) {
    const headers: Record<string, string> = { 'CF-Connecting-IP': init.ip ?? '203.0.113.7', ...init.headers };
    if (init.key) headers.Authorization = `Bearer ${init.key}`;
    const body = init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body));
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await app.fetch(new Request(`https://museumguessr.com${path}`, { method, headers, body }), env, exec);
    await Promise.all(pending.splice(0));
    const text = await res.text();
    return { status: res.status, headers: res.headers, text, body: text ? JSON.parse(text) : null };
  }

  const week = (): Week => weekId(c.now());

  const payload = (total: number, over: PayloadOptions = {}) => buildPayload(total, week(), over);

  async function setMode(mode: BoardMode | null) {
    const raw = parts.db;
    if (mode === null) await raw.prepare('DELETE FROM settings').run();
    else await raw.prepare("INSERT INTO settings (id, board_mode, updated_at) VALUES (1, ?1, '2026-10-01T00:00:00Z') ON CONFLICT (id) DO UPDATE SET board_mode = excluded.board_mode").bind(mode).run();
    app.modes.clear();
  }

  const q = async <T = Record<string, unknown>>(sql: string, ...values: unknown[]) => (await parts.db.prepare(sql).bind(...values).all<T>()).results;

  return {
    clock: c,
    app,
    env,
    db,
    raw: parts.db,
    cache: parts.cache,
    limiters,
    siteverify,
    call,
    post: (key: string | null, body: unknown, init: { ip?: string; headers?: Record<string, string> } = {}) => call('POST', '/api/v1/scores', { key, body, ...init }),
    board: (key?: string | null, init: { ip?: string; headers?: Record<string, string> } = {}) => call('GET', '/api/v1/board', { key: key ?? null, ...init }),
    receipt: (key: string, rowId: string, init: { headers?: Record<string, string> } = {}) => call('GET', `/api/v1/scores/${rowId}`, { key, ...init }),
    remove: (key: string, rowId: string) => call('DELETE', `/api/v1/scores/${rowId}`, { key }),
    payload,
    setMode,
    week,
    q,
    scheduled: () => app.scheduled(null, env, exec),
  };
}

export type Harness = ReturnType<typeof harness>;
