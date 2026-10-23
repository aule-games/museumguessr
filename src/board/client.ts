// The board API client (W6, M1, ENG23; V12-82, V12-111). Same-origin only.
// The device key travels only as a bearer header. Every failure becomes an
// error envelope and the page branches on its `reason`, never on the HTTP
// status: a JSON envelope keeps its own reason; a non-JSON 429 from the edge
// is `edge_limited` (Retry-After honoured), a Cloudflare 1027 quota page and
// every other non-JSON or unreadable answer is `unavailable`, told apart by
// body markers. Server values are checked by plain guards before use.

import { canonicalPayload } from '../api/canonical.ts';
import {
  API_PREFIX,
  ERRORS,
  SMOKE_READ_HEADER,
  type ApiError,
  type Best,
  type BoardResponse,
  type DeleteResponse,
  type PersonalBoard,
  type PublicRow,
  type Reason,
  type Receipt,
  type ScorePayload,
  type ScoreResponse,
  type Standing,
  type Week,
  type WeekBest,
} from '../api/contract.ts';

export type Result<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

// ----- guards (plain, no runtime evaluation; V12-129) -----

const WEEK = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;
const ROW = /^[A-Za-z0-9_-]{1,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const int = (v: unknown, min = 0): v is number => Number.isInteger(v) && (v as number) >= min;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length <= max;
export const isWeek = (v: unknown): v is Week => typeof v === 'string' && WEEK.test(v);
const isTime = (v: unknown): v is string => str(v, 40) && Number.isFinite(Date.parse(v));

export function isStanding(v: unknown): v is Standing {
  if (!obj(v)) return false;
  if (v.kind === 'exact') return int(v.rank, 1) && typeof v.tied === 'boolean';
  if (v.kind === 'percentile') return num(v.top_percent) && v.top_percent > 0 && v.top_percent <= 100;
  if (v.kind === 'distance') return int(v.points_to_top_50, 0);
  return false;
}

export const isBest = (v: unknown): v is Best => obj(v) && str(v.row_id, 64) && ROW.test(v.row_id) && int(v.total) && (v.standing === null || isStanding(v.standing));

const isRow = (v: unknown): v is PublicRow => obj(v) && str(v.row_id, 64) && ROW.test(v.row_id) && str(v.name, 80) && int(v.total) && int(v.rank, 1) && str(v.date, 10) && DATE.test(v.date);

const isWeekBest = (v: unknown): v is WeekBest => obj(v) && isWeek(v.week) && str(v.row_id, 64) && ROW.test(v.row_id) && int(v.total) && (v.rank === null || int(v.rank, 1));

export const isPersonal = (v: unknown): v is PersonalBoard =>
  obj(v) && str(v.name, 80) && (v.best === null || isBest(v.best)) && Array.isArray(v.weeks) && v.weeks.length <= 8 && v.weeks.every(isWeekBest);

const isPublic = (v: Record<string, unknown>) =>
  isWeek(v.week) && isTime(v.resets_at) && int(v.count) && (v.cutoff_total === null || int(v.cutoff_total)) && Array.isArray(v.rows) && v.rows.length <= 50 && v.rows.every(isRow) && isTime(v.updated_at);

export function isBoardResponse(v: unknown): v is BoardResponse {
  if (!obj(v)) return false;
  if (v.disabled === true) return true;
  if (v.smoke === true) return isWeek(v.week) && isTime(v.resets_at) && (v.personal === undefined || isPersonal(v.personal));
  return isPublic(v) && (v.personal === undefined || isPersonal(v.personal));
}

export const isReceipt = (v: unknown): v is Receipt =>
  obj(v) &&
  str(v.game_id, 64) &&
  (v.current_game_id === null || str(v.current_game_id, 64)) &&
  str(v.row_id, 64) &&
  ROW.test(v.row_id) &&
  isWeek(v.week) &&
  int(v.total) &&
  (v.status === 'current' || v.status === 'replaced' || v.status === 'removed') &&
  (v.receipt_rank === null || int(v.receipt_rank, 1)) &&
  int(v.count) &&
  (v.best === null || isBest(v.best));

export const isScoreResponse = (v: unknown): v is ScoreResponse => obj(v) && isReceipt(v.receipt) && typeof v.replaced === 'boolean' && typeof v.smoke === 'boolean';

export const isDeleteResponse = (v: unknown): v is DeleteResponse => obj(v) && v.removed === true && str(v.row_id, 64) && isWeek(v.week);

// ----- failures -----

const reasonOf = (v: unknown): v is Reason => typeof v === 'string' && Object.prototype.hasOwnProperty.call(ERRORS, v);

/** An error envelope for a reason, with the contract's retryability. */
export function envelope(reason: Reason, extra: Partial<ApiError> = {}): ApiError {
  return { reason, retryable: ERRORS[reason].retryable, ...extra };
}

/** Seconds from a Retry-After header (seconds or an HTTP date), or undefined. */
export function retryAfter(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined;
  if (/^\d{1,6}$/.test(header.trim())) return Number(header.trim());
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, Math.ceil((at - now) / 1000)) : undefined;
}

/** Cloudflare's "error code: 1027" quota page (the Workers daily limit), not an edge rate limit. */
export const QUOTA_MARKERS = [/error code:?\s*1027/i, /error\s*1027/i, /\b1027\b[^<]{0,80}(rate limited|daily|limit)/i];
export const isQuotaPage = (body: string) => QUOTA_MARKERS.some((re) => re.test(body));

/**
 * The envelope for a failed response (M1, ENG23): a JSON envelope keeps its
 * reason; a non-JSON 429 is the edge's rate limit unless its body is the 1027
 * quota page; anything else unreadable is `unavailable`.
 */
export function failure(status: number, contentType: string | null, body: string, retryAfterHeader: string | null, now = Date.now()): ApiError {
  if (/json/i.test(contentType ?? '')) {
    try {
      const v = JSON.parse(body) as unknown;
      if (obj(v) && reasonOf(v.reason)) {
        const e: ApiError = { reason: v.reason, retryable: typeof v.retryable === 'boolean' ? v.retryable : ERRORS[v.reason].retryable };
        if (int(v.retry_after)) e.retry_after = v.retry_after;
        if (str(v.request_id, 80)) e.request_id = v.request_id;
        if (isBest(v.best)) e.best = v.best;
        return e;
      }
    } catch {
      // not JSON after all: fall through to the body markers
    }
  }
  if (isQuotaPage(body)) return envelope('unavailable');
  if (status === 429) {
    const after = retryAfter(retryAfterHeader, now);
    return after === undefined ? envelope('edge_limited') : envelope('edge_limited', { retry_after: after });
  }
  return envelope('unavailable');
}

// ----- requests -----

export interface Call {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  key?: string | null;
  /** The JSON body, already serialized. */
  body?: string;
  /** Dark-mode smoke context for a test-assisted game (V12-105); not authorization. */
  smoke?: boolean;
}

export async function call<T>(fetcher: Fetch, c: Call, guard: (v: unknown) => v is T, now: () => number = Date.now): Promise<Result<T>> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (c.key) headers.Authorization = `Bearer ${c.key}`;
  if (c.smoke) headers[SMOKE_READ_HEADER] = '1';
  if (c.body) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetcher(`${API_PREFIX}${c.path}`, {
      method: c.method,
      headers,
      body: c.body,
      credentials: 'same-origin',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    return { ok: false, error: envelope('unavailable') };
  }
  let text = '';
  try {
    text = await res.text();
  } catch {
    return { ok: false, error: envelope('unavailable') };
  }
  if (!res.ok) return { ok: false, error: failure(res.status, res.headers.get('Content-Type'), text, res.headers.get('Retry-After'), now()) };
  try {
    const v = JSON.parse(text) as unknown;
    if (guard(v)) return { ok: true, data: v };
  } catch {
    // an unreadable success is no answer
  }
  return { ok: false, error: envelope('unavailable') };
}

/** The POST body: the canonical payload text (src/api/canonical.ts) with the verification token added last. */
export function scoreBody(payload: ScorePayload, token: string): string {
  return `${canonicalPayload(payload).slice(0, -1)},"turnstile_token":${JSON.stringify(token)}}`;
}

export const api = {
  board: (f: Fetch, key: string | null, smoke = false) => call(f, { method: 'GET', path: '/board', key, smoke }, isBoardResponse),
  submit: (f: Fetch, key: string, payload: ScorePayload, token: string) => call(f, { method: 'POST', path: '/scores', key, body: scoreBody(payload, token) }, isScoreResponse),
  remove: (f: Fetch, key: string, rowId: string) => call(f, { method: 'DELETE', path: `/scores/${encodeURIComponent(rowId)}`, key }, isDeleteResponse),
};
