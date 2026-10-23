// The board's device-local records (G1, N3, ENG23, R5; V12-113, V12-114,
// V12-123). One record per finished game the board has seen: a pending
// submission keeps its canonical payload until the server confirms or
// refuses it, independent of the game now on screen; a confirmed one keeps
// its receipt with the fingerprint of the key that made it. The start
// screen's standing line reads a separate small summary, so it costs no
// request and no board code in the main bundle.

import type { Best, Reason, ScorePayload, Standing, Week } from '../api/contract.ts';
import { KEYS } from '../state/schema.ts';
import type { KV } from '../storage/guarded.ts';
import { isBest, isStanding, isWeek } from './client.ts';
import { isPayload } from './payload.ts';

/** How a submission ended: a server reason, or a success. */
export type Outcome = Reason | 'added' | 'replaced';

export interface StoredReceipt {
  row_id: string;
  week: Week;
  total: number;
  status: 'current' | 'replaced' | 'removed';
  receipt_rank: number | null;
  count: number;
  standing: Standing | null;
  /** The game improved this device's weekly best ("New best"). */
  improved: boolean;
  /** A dark-mode smoke receipt, never ranked. */
  smoke: boolean;
  /** Fingerprint of the key that made it (N3). */
  fp: string;
}

export interface GameRecord {
  game_id: string;
  /** Analytics only: the game's per-game reference and channel; never sent to the board. */
  game_ref: string;
  src: string;
  week: Week | null;
  total: number;
  test: boolean;
  status: 'pending' | 'confirmed' | 'refused';
  outcome: Outcome | null;
  /** Kept until the server confirms or refuses it (V12-113). */
  payload: ScorePayload | null;
  /** Automatic attempts so far; they stop at MAX_AUTO_ATTEMPTS (V12-114). */
  attempts: number;
  /** Earliest next automatic attempt, ms. */
  next_at: number;
  receipt: StoredReceipt | null;
  /** The weekly best a not_best answer named. */
  best: Best | null;
  /** Analytics outcomes already sent for this game (each reason once). */
  sent: Outcome[];
  /** When the record was made, ms; records older than the retention are dropped. */
  at: number;
}

export interface BoardData {
  games: Record<string, GameRecord>;
  /** Weeks whose score this device removed (only the current week blocks a new entry). */
  removed: Week[];
}

export const MAX_AUTO_ATTEMPTS = 5;
/** Local records follow the server's eight-week retention, plus a week. */
export const RETENTION_MS = 9 * 7 * 86_400_000;

const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const OUTCOMES = new Set(['added', 'replaced', 'invalid', 'too_large', 'replay', 'duplicate', 'turnstile_failed', 'rate_limited', 'update_page', 'try_later', 'board_disabled', 'server', 'not_best', 'removed', 'week_closed', 'edge_limited', 'unavailable', 'not_found']);
const isOutcome = (v: unknown): v is Outcome => typeof v === 'string' && OUTCOMES.has(v);

function receiptOk(r: unknown): r is StoredReceipt {
  return (
    obj(r) &&
    typeof r.row_id === 'string' &&
    isWeek(r.week) &&
    Number.isInteger(r.total) &&
    ['current', 'replaced', 'removed'].includes(r.status as string) &&
    (r.receipt_rank === null || Number.isInteger(r.receipt_rank)) &&
    Number.isInteger(r.count) &&
    (r.standing === null || isStanding(r.standing)) &&
    typeof r.improved === 'boolean' &&
    typeof r.smoke === 'boolean' &&
    typeof r.fp === 'string'
  );
}

function recordOk(r: unknown): r is GameRecord {
  return (
    obj(r) &&
    typeof r.game_id === 'string' &&
    typeof r.game_ref === 'string' &&
    typeof r.src === 'string' &&
    (r.week === null || isWeek(r.week)) &&
    Number.isInteger(r.total) &&
    typeof r.test === 'boolean' &&
    ['pending', 'confirmed', 'refused'].includes(r.status as string) &&
    (r.outcome === null || isOutcome(r.outcome)) &&
    (r.payload === null || isPayload(r.payload)) &&
    (r.status !== 'pending' || r.payload !== null) &&
    Number.isInteger(r.attempts) &&
    Number.isFinite(r.next_at) &&
    (r.receipt === null || receiptOk(r.receipt)) &&
    (r.best === null || isBest(r.best)) &&
    Array.isArray(r.sent) &&
    r.sent.every(isOutcome) &&
    Number.isFinite(r.at)
  );
}

/** The stored records; a damaged record is dropped, the rest survive. */
export function readBoard(kv: KV, now = Date.now()): BoardData {
  const empty: BoardData = { games: {}, removed: [] };
  let v: unknown;
  try {
    v = JSON.parse(kv.get(KEYS.board) ?? 'null');
  } catch {
    return empty;
  }
  if (!obj(v)) return empty;
  const games: Record<string, GameRecord> = {};
  if (obj(v.games)) {
    for (const [id, r] of Object.entries(v.games)) {
      if (recordOk(r) && r.game_id === id && now - r.at < RETENTION_MS) games[id] = r;
    }
  }
  const removed = Array.isArray(v.removed) ? v.removed.filter(isWeek) : [];
  return { games, removed };
}

export function writeBoard(kv: KV, data: BoardData) {
  kv.set(KEYS.board, JSON.stringify(data));
}

/** Read, change and write one record (other tabs' records are kept). */
export function updateRecord(kv: KV, gameId: string, change: (r: GameRecord | null) => GameRecord | null, now = Date.now()): GameRecord | null {
  const data = readBoard(kv, now);
  const next = change(data.games[gameId] ?? null);
  if (next) data.games[gameId] = next;
  else delete data.games[gameId];
  writeBoard(kv, data);
  return next;
}

export function markRemoved(kv: KV, week: Week, now = Date.now()) {
  const data = readBoard(kv, now);
  if (!data.removed.includes(week)) data.removed.push(week);
  for (const r of Object.values(data.games)) if (r.receipt?.week === week) r.receipt = { ...r.receipt, status: 'removed' };
  writeBoard(kv, data);
}

/** Pending submissions due for an automatic attempt. */
export function duePending(data: BoardData, now: number): GameRecord[] {
  return Object.values(data.games).filter((r) => r.status === 'pending' && r.attempts < MAX_AUTO_ATTEMPTS && r.next_at <= now);
}

// ----- the switch (G3) -----

/** "Add my games to the board": on unless the player switched it off. */
export const autoAddOn = (kv: KV) => kv.get(KEYS.boardAuto) !== 'off';

export function setAutoAdd(kv: KV, on: boolean) {
  if (on) kv.remove(KEYS.boardAuto);
  else kv.set(KEYS.boardAuto, 'off');
}
