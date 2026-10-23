// v1.2 target contract. Types and constants only; no network or browser code.
// This module is not evidence that the endpoints have been implemented.

export const CONTRACT_VERSION = 1;
export const API_PREFIX = '/api/v1';
export const EARLY_YEAR = -4001;
export const MAX_BODY_BYTES = 4096;
/** Weeks kept before the purge; the owner's board read returns at most one best per retained week. */
export const RETAINED_WEEKS = 8;
/** Client-declared smoke context, not authorization; interpreted only in dark mode. */
export const SMOKE_READ_HEADER = 'X-MuseumGuessr-Test';
/** The Turnstile action the widget declares and siteverify must report. */
export const TURNSTILE_ACTION = 'board_submit';

export type BoardMode = 'off' | 'dark' | 'on';
export type Week = `${number}-W${string}`;
export type Ten<T> = readonly [T, T, T, T, T, T, T, T, T, T];
export type Question = 'made' | 'when' | 'kept';
export interface Point { lat: number; lng: number }
export interface Answers { made: Point | null; when: number | null; kept: Point | null }
export type Timeout = Readonly<Record<Question, boolean>>;

/** Canonical fields are serialized in this order; nested fields use made, when, kept.
 * Coordinates use lat, lng. Arrays preserve deck order. Unknown fields are rejected.
 * Retry credentials are outside this payload so a fresh verification token is safe.
 */
export interface ScorePayload {
  game_id: string;
  deck_kind: 'random' | 'challenge' | 'replay';
  fresh: boolean;
  deck_hash: string;
  answers_revs: Ten<number>;
  scoring_version: number;
  item_ids: Ten<string>;
  answers: Ten<Answers>;
  skipped: Ten<boolean>;
  timed_out: Ten<Timeout>;
  board_week: Week | null;
  client_version: number;
  test_assisted: boolean;
}

export const PAYLOAD_FIELDS = [
  'game_id', 'deck_kind', 'fresh', 'deck_hash', 'answers_revs',
  'scoring_version', 'item_ids', 'answers', 'skipped', 'timed_out',
  'board_week', 'client_version', 'test_assisted',
] as const satisfies readonly (keyof ScorePayload)[];

export interface ScoreRequest extends ScorePayload { turnstile_token: string }
export type ReceiptStatus = 'current' | 'replaced' | 'removed';
export type Standing =
  | { kind: 'exact'; rank: number; tied: boolean }
  | { kind: 'percentile'; top_percent: number }
  | { kind: 'distance'; points_to_top_50: number };

/** These fields, and only these fields, can enter the public board cache. */
export interface PublicRow {
  row_id: string;
  name: string;
  total: number;
  rank: number;
  /** UTC date of the submission (YYYY-MM-DD); no time of day. */
  date: string;
}
export interface PublicBoard {
  week: Week;
  resets_at: string;
  count: number;
  cutoff_total: number | null;
  rows: readonly PublicRow[];
  updated_at: string;
}
export interface Best {
  row_id: string;
  total: number;
  standing: Standing | null;
}
export interface WeekBest {
  week: Week;
  row_id: string;
  total: number;
  /** Rank stored when the week closed, or the receipt rank for the current week. */
  rank: number | null;
}
/** Authenticated only. Never put this object in the public cache. */
export interface Receipt {
  game_id: string;
  current_game_id: string | null;
  row_id: string;
  week: Week;
  total: number;
  status: ReceiptStatus;
  /** Null for smoke receipts, never a fabricated public rank. */
  receipt_rank: number | null;
  count: number;
  best: Best | null;
}
export interface ReceiptResponse {
  receipt: Receipt;
  standing: Standing | null;
  final_rank: number | null;
  count: number;
  week: Week;
  resets_at: string;
  cutoff_total: number | null;
}
export interface PersonalBoard {
  name: string;
  best: Best | null;
  /** One weekly best per retained week (at most RETAINED_WEEKS), newest first. */
  weeks: readonly WeekBest[];
}
export interface DeviceBoard extends PublicBoard { personal: PersonalBoard }
/** No public projection or standing; only test-mode context in dark mode. */
export interface DarkBoard { smoke: true; week: Week; resets_at: string }
export interface DarkDeviceBoard extends DarkBoard { personal: PersonalBoard }
/** Optional smoke header, interpreted only in dark mode. */
export interface SmokeReadOptions { smoke?: true }
export type BoardReadOptions = SmokeReadOptions;
export interface DisabledBoard { disabled: true }
export type BoardResponse = PublicBoard | DeviceBoard | DarkBoard | DarkDeviceBoard | DisabledBoard;
export interface ScoreResponse { receipt: Receipt; replaced: boolean; smoke: boolean }
export interface DeleteResponse { removed: true; row_id: string; week: Week }
export interface HealthResponse {
  scoring_version: number;
  pool_hash: string;
  worker_version: string;
  contract_version: number;
  board_mode: BoardMode;
}

export const ERRORS = {
  invalid: { status: 400, retryable: false, copy: 'board.invalid', analytics: 'invalid' },
  too_large: { status: 413, retryable: false, copy: 'board.invalid', analytics: 'too_large' },
  replay: { status: 422, retryable: false, copy: 'board.notRankedReplay', analytics: 'replay' },
  duplicate: { status: 409, retryable: false, copy: 'board.duplicate', analytics: 'duplicate' },
  turnstile_failed: { status: 403, retryable: true, copy: 'board.verificationFailed', analytics: 'turnstile_failed' },
  rate_limited: { status: 429, retryable: true, copy: 'board.pending', analytics: 'rate_limited' },
  update_page: { status: 409, retryable: false, copy: 'board.updatePage', analytics: 'update_page' },
  try_later: { status: 503, retryable: true, copy: 'board.pending', analytics: 'try_later' },
  board_disabled: { status: 503, retryable: true, copy: 'board.unavailable', analytics: 'board_disabled' },
  server: { status: 500, retryable: true, copy: 'board.unavailable', analytics: 'server' },
  not_best: { status: 409, retryable: false, copy: 'board.notBest', analytics: 'not_best' },
  removed: { status: 410, retryable: false, copy: 'board.removed', analytics: 'removed' },
  week_closed: { status: 409, retryable: false, copy: 'board.lastWeek', analytics: 'week_closed' },
  edge_limited: { status: 429, retryable: true, copy: 'board.pending', analytics: 'edge_limited' },
  unavailable: { status: 503, retryable: true, copy: 'board.unavailable', analytics: 'unavailable' },
  not_found: { status: 404, retryable: false, copy: 'board.hidden', analytics: 'not_found' },
} as const;
export type Reason = keyof typeof ERRORS;
export interface ApiError {
  reason: Reason;
  retryable: boolean;
  /** Seconds until the next allowed attempt. */
  retry_after?: number;
  request_id?: string;
  best?: Best;
}

export const ENDPOINTS = [
  { method: 'GET', path: '/api/v1/board', auth: 'none', request: 'BoardReadOptions', success: 'PublicBoard | DarkBoard | DisabledBoard', errors: ['invalid', 'unavailable', 'server'] },
  { method: 'GET', path: '/api/v1/board', auth: 'bearer', request: 'BoardReadOptions', success: 'DeviceBoard | DarkDeviceBoard | DisabledBoard', errors: ['invalid', 'rate_limited', 'unavailable', 'server'] },
  { method: 'POST', path: '/api/v1/scores', auth: 'bearer', request: 'ScoreRequest', success: 'ScoreResponse', errors: ['invalid', 'too_large', 'replay', 'duplicate', 'turnstile_failed', 'rate_limited', 'update_page', 'try_later', 'board_disabled', 'not_best', 'removed', 'week_closed', 'unavailable', 'server'] },
  { method: 'GET', path: '/api/v1/scores/<row_id>', auth: 'bearer', request: 'SmokeReadOptions', success: 'ReceiptResponse', errors: ['invalid', 'duplicate', 'not_found', 'rate_limited', 'unavailable', 'server'] },
  { method: 'DELETE', path: '/api/v1/scores/<row_id>', auth: 'bearer', request: 'none', success: 'DeleteResponse', errors: ['invalid', 'duplicate', 'not_found', 'rate_limited', 'unavailable', 'server'] },
  { method: 'GET', path: '/api/v1/health', auth: 'none', request: 'none', success: 'HealthResponse', errors: ['unavailable', 'server'] },
] as const satisfies readonly {
  method: 'GET' | 'POST' | 'DELETE'; path: string; auth: 'none' | 'bearer';
  request: string; success: string; errors: readonly Reason[];
}[];
