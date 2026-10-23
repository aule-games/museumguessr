// The parts of the Workers platform the board uses, typed here so the Worker
// needs no ambient package types (V12-129). Real bindings, Miniflare's and
// the tests' node:sqlite stand-in all fit these shapes.

export interface D1Meta {
  changes: number;
  rows_read: number;
  rows_written: number;
  duration?: number;
  last_row_id?: number;
}

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: D1Meta;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

/** A Workers rate-limit binding (wrangler.jsonc "ratelimits"). */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** The Cache API object the board uses (caches.default). */
export interface BoardCache {
  match(request: Request | string): Promise<Response | undefined>;
  put(request: Request | string, response: Response): Promise<void>;
  delete(request: Request | string): Promise<boolean>;
}

/** The assets binding (Workers static assets). */
export interface Assets {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  ASSETS: Assets;
  /** The deployed build's git SHA; npm run deploy sets it with --var. */
  WORKER_VERSION?: string;
  /** The board database (worker/migrations). */
  DB?: D1Database;
  /** 30 requests per 60 s per IPv4 address or IPv6 /64: POST before the known-game lookup, and bearer reads. */
  IP_LIMIT?: RateLimiter;
  /** 5 new device-week rows per 60 s per IP. */
  NEW_ROW_LIMIT?: RateLimiter;
  /** 3 new submissions per 60 s per device key. */
  KEY_LIMIT?: RateLimiter;
  /** Secret: the Turnstile widget secret. */
  TURNSTILE_SECRET?: string;
  /** The hostname siteverify must report for this environment. */
  TURNSTILE_HOSTNAME?: string;
  /** "1" only in local environments: accept Cloudflare's documented test keys. Production refuses them. */
  TURNSTILE_TEST_KEYS?: string;
  /** Secret: any value but "0" forces the board off, even when D1 cannot be read. */
  BOARD_FORCE_OFF?: string;
}

/** What a handler gets besides the request: the environment and the injectable platform parts. */
export interface Ctx {
  env: Env;
  now: () => number;
  cache: BoardCache | null;
  fetch: typeof fetch;
  /** Background work (ExecutionContext.waitUntil when available). */
  waitUntil: (p: Promise<unknown>) => void;
}
