// Automatic board entry (W6, G1, ENG14, ENG23, N3, N4; V12-80, V12-81,
// V12-108, V12-111, V12-113, V12-114, V12-119, V12-139). DOM-free: the
// network, the clock, the lock, Turnstile and analytics are injected.
//
// When a finished game's end card shows: the device key is read or created
// under its lock; one bearer board read learns the server's week, its mode
// and this device's standing; then an eligible game that has no record yet
// is stored as a pending submission before its first POST, verified by
// Turnstile (a fresh token every attempt) and sent with the key read again.
// A retryable answer keeps it pending with Retry-After or bounded backoff,
// at most five automatic attempts; a refusal or a receipt settles it.
// Pending submissions of other games are retried on load and when a card
// shows, independent of the game on screen. Background work never moves
// focus. Normal end-card traffic is one bearer GET and one POST.

import { type BoardResponse, type DeviceBoard, type PersonalBoard, type PublicBoard, type ScoreResponse, type Week } from '../api/contract.ts';
import { weekStart } from '../api/week.ts';
import { EVENTS } from '../analytics/events.ts';
import type { KV } from '../storage/guarded.ts';
import { api, type Fetch, type Result } from './client.ts';
import { cardView, type CardView, type Mode, type Verify } from './card.ts';
import { ensureKey, fingerprint, readKey } from './key.ts';
import { boardName } from './names.ts';
import { eligibility, scorePayload, type FinishedGame } from './payload.ts';
import { writeStanding } from './standing-line.ts';
import { MAX_AUTO_ATTEMPTS, autoAddOn, duePending, markRemoved, readBoard, updateRecord, type GameRecord, type Outcome } from './store.ts';

export interface Verifier {
  /**
   * A fresh Turnstile token. `interactive(true)` when the widget needs the
   * player, `false` once it no longer does. Rejects when the widget does not
   * load within ten seconds or fails.
   */
  token(on: { interactive(open: boolean): void }): Promise<string>;
}

export interface BoardDeps {
  kv: KV;
  fetch: Fetch;
  locks?: LockManager;
  now(): number;
  /** The verifier for the card's own slot; null when none can run (no site key). */
  verifier: Verifier | null;
  /** A verifier for background retries (a hidden slot), which gives up when the widget needs the player. */
  background?: Verifier | null;
  track(name: string, props: Record<string, unknown>): void;
  /** The answer revisions of ten objects, in deck order. */
  revs(ids: readonly string[]): number[];
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

// ----- the last board read, shared by the card, the overlay and the start link -----

export interface Snapshot {
  mode: Exclude<Mode, 'loading'>;
  week: Week | null;
  resets_at: string | null;
  board: PublicBoard | null;
  personal: PersonalBoard | null;
  /** When this page received it (ms), for the overlay's refresh decision. */
  at: number;
}

let last: Snapshot | null = null;
/** The last board read in this page, or null. */
export const lastRead = () => last;

/** The read as the page uses it; a failed read keeps nothing but `unavailable`. */
export function snapshotOf(res: Result<BoardResponse>, now: number): Snapshot {
  if (!res.ok) return { mode: 'unavailable', week: null, resets_at: null, board: null, personal: null, at: now };
  const v = res.data;
  if ('disabled' in v) return { mode: 'disabled', week: null, resets_at: null, board: null, personal: null, at: now };
  const personal = 'personal' in v ? v.personal : null;
  if ('smoke' in v) return { mode: 'smoke', week: v.week, resets_at: v.resets_at, board: null, personal, at: now };
  const p = v as DeviceBoard;
  const board: PublicBoard = { week: p.week, resets_at: p.resets_at, count: p.count, cutoff_total: p.cutoff_total, rows: p.rows, updated_at: p.updated_at };
  return { mode: 'on', week: v.week, resets_at: v.resets_at, board, personal, at: now };
}

/** A board read; the page remembers it, and a confirmed rank refreshes the start screen's line. */
export async function readBoardNow(d: Pick<BoardDeps, 'fetch' | 'now' | 'kv'>, key: string | null, smoke: boolean): Promise<Snapshot> {
  const snap = snapshotOf(await api.board(d.fetch, key, smoke), d.now());
  if (snap.mode !== 'unavailable') last = snap;
  if (key && snap.mode === 'on' && snap.week) {
    const best = snap.personal?.best;
    const rank = best?.standing?.kind === 'exact' ? best.standing.rank : null;
    if (best && rank) writeStanding(d.kv, { week: snap.week, resets_at: snap.resets_at ?? resetOf(snap.week), total: best.total, rank });
    else if (snap.personal) writeStanding(d.kv, null);
  }
  return snap;
}

// ----- week context at round ten (V12-108) -----

let context: Promise<{ week: Week | null }> | null = null;

/**
 * The server's week before the game completes: one anonymous, nonblocking
 * read when round ten opens, deduplicated while in flight. A test-assisted
 * game asks for the dark smoke context explicitly. Null week when there is
 * no answer: the device clock is never asked.
 */
export function weekContext(d: Pick<BoardDeps, 'fetch' | 'now' | 'kv'>, smoke: boolean): Promise<{ week: Week | null }> {
  context ??= readBoardNow(d, null, smoke)
    .then((s) => ({ week: s.week }))
    .finally(() => {
      context = null;
    });
  return context;
}

/** Monday 00:00 UTC after a server week: its reset, derived from the server's week id, not the device clock. */
export const resetOf = (week: Week) => new Date(weekStart(week) + 7 * 86_400_000).toISOString();

// ----- submissions -----

/** Seconds to wait before automatic attempt n+1 (n attempts made): Retry-After, else 5 s, 15 s, 45 s, 135 s, then 5 min. */
export function backoffMs(attempts: number, retryAfter?: number): number {
  if (retryAfter !== undefined) return Math.min(retryAfter, 3600) * 1000;
  return Math.min(300_000, 5000 * 3 ** Math.max(0, attempts - 1));
}

/** Send board_submitted once per game and outcome; retries never repeat an outcome (G5). */
function report(d: BoardDeps, r: GameRecord, outcome: Outcome): GameRecord {
  if (r.sent.includes(outcome)) return r;
  d.track(EVENTS.boardSubmitted, { game_ref: r.game_ref, reason: outcome, auto: true, src: r.src });
  return { ...r, sent: [...r.sent, outcome] };
}

/** Store what a POST answered (or that verification failed) and report it. */
async function settle(d: BoardDeps, gameId: string, res: Result<ScoreResponse> | 'verification', key: string): Promise<GameRecord | null> {
  const fp = await fingerprint(key);
  const now = d.now();
  let removedWeek: Week | null = null;
  const next = updateRecord(d.kv, gameId, (r) => {
    if (!r) return null;
    if (res === 'verification') {
      const attempts = r.attempts + 1;
      return report(d, { ...r, outcome: 'turnstile_failed', attempts, next_at: now + backoffMs(attempts) }, 'turnstile_failed');
    }
    if (res.ok) {
      const rc = res.data.receipt;
      const outcome: Outcome = res.data.replaced ? 'replaced' : 'added';
      const standing = rc.best?.row_id === rc.row_id ? rc.best.standing : null;
      return report(d, {
        ...r,
        status: 'confirmed',
        outcome,
        payload: null,
        receipt: { row_id: rc.row_id, week: rc.week, total: rc.total, status: rc.status, receipt_rank: rc.receipt_rank, count: rc.count, standing, improved: res.data.replaced, smoke: res.data.smoke, fp },
      }, outcome);
    }
    const e = res.error;
    if (e.retryable) {
      const attempts = r.attempts + 1;
      return report(d, { ...r, outcome: e.reason, attempts, next_at: now + backoffMs(attempts, e.retry_after) }, e.reason);
    }
    if (e.reason === 'removed' && r.week) removedWeek = r.week;
    return report(d, { ...r, status: 'refused', outcome: e.reason, payload: null, best: e.best ?? null }, e.reason);
  }, now);
  if (removedWeek) markRemoved(d.kv, removedWeek, now);
  const rc = next?.receipt;
  if (next?.status === 'confirmed' && rc && rc.status === 'current' && !rc.smoke) {
    const rank = rc.standing?.kind === 'exact' ? rc.standing.rank : rc.receipt_rank;
    if (rank) writeStanding(d.kv, { week: rc.week, resets_at: resetOf(rc.week), total: rc.total, rank });
  }
  return next;
}

/** One attempt: a fresh token, the key read again, the POST, the answer stored (N3, ENG14). */
async function attempt(d: BoardDeps, gameId: string, verifier: Verifier | null, on: { interactive(open: boolean): void; verified(): void }): Promise<GameRecord | null> {
  const r = readBoard(d.kv, d.now()).games[gameId];
  if (!r || r.status !== 'pending' || !r.payload) return r ?? null;
  let token: string;
  try {
    if (!verifier) throw new Error('no verifier');
    token = await verifier.token(on);
  } catch {
    const key = readKey(d.kv);
    return key ? settle(d, gameId, 'verification', key) : null;
  }
  on.verified();
  const key = readKey(d.kv) ?? (await ensureKey(d.kv, d.locks));
  const res = await api.submit(d.fetch, key, r.payload, token);
  return settle(d, gameId, res, key);
}

let backgroundRunning = false;

/**
 * Retry other games' pending submissions (on load, and when a card shows),
 * independent of the game on screen. Never moves focus; gives up for this
 * page when verification needs the player.
 */
export async function resumePending(d: BoardDeps, except: string | null = null): Promise<void> {
  if (backgroundRunning || !d.kv.persistent || !readKey(d.kv)) return;
  backgroundRunning = true;
  try {
    for (const r of duePending(readBoard(d.kv, d.now()), d.now())) {
      if (r.game_id === except) continue;
      let needsPlayer = false;
      await attempt(d, r.game_id, d.background ?? null, { interactive: (open) => (needsPlayer ||= open), verified: () => {} });
      if (needsPlayer) break;
    }
  } finally {
    backgroundRunning = false;
  }
}

// ----- the card's session -----

export interface Shown {
  game_id: string;
  total: number;
  /** The finished game, when this page still holds it; null for an old review. */
  game: FinishedGame | null;
}

/**
 * One end card's board work for one finished game. Rebuilding the end screen
 * reattaches to the same session, so no request repeats and the Turnstile
 * widget keeps its place.
 */
export class BoardSession {
  private listeners = new Set<(v: CardView) => void>();
  private started = false;
  private mode: Mode = 'loading';
  private snap: Snapshot | null = null;
  private key: string | null = null;
  private fp: string | null = null;
  private name: string | null = null;
  private posting = false;
  private verify: Verify = 'idle';
  private justConfirmed = false;
  private timer: unknown = null;

  constructor(
    private d: BoardDeps,
    readonly shown: Shown,
  ) {}

  /** The card's current view. */
  view(): CardView {
    const data = readBoard(this.d.kv, this.d.now());
    const record = data.games[this.shown.game_id] ?? null;
    const g = this.shown.game;
    const anyReceipt = Object.values(data.games).some((r) => r.receipt && r.receipt.fp === this.fp);
    return cardView({
      storage: this.d.kv.persistent,
      mode: this.mode,
      serverWeek: this.snap?.week ?? null,
      count: this.snap?.board?.count ?? 0,
      game: g ? { eligibility: eligibility(g), week: (g.board_week as Week | null) ?? null, total: this.shown.total } : null,
      auto: autoAddOn(this.d.kv),
      record,
      ownReceipt: !!record?.receipt && record.receipt.fp === this.fp,
      justConfirmed: this.justConfirmed,
      personal: this.snap?.personal ?? null,
      removedWeeks: data.removed,
      posting: this.posting,
      verify: this.verify,
      firstAdd: !anyReceipt && !(this.snap?.personal?.weeks.length || this.snap?.personal?.best),
      name: this.name,
    });
  }

  subscribe(fn: (v: CardView) => void): () => void {
    this.listeners.add(fn);
    fn(this.view());
    return () => this.listeners.delete(fn);
  }

  private emit() {
    const v = this.view();
    for (const fn of this.listeners) fn(v);
  }

  /** Start once: key, one board read, then the submission when one is due. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const smoke = this.shown.game?.test_assisted === true;
    if (this.d.kv.persistent) {
      this.key = await ensureKey(this.d.kv, this.d.locks);
      this.fp = await fingerprint(this.key);
      this.name = await boardName(this.key);
      this.emit();
    }
    this.snap = await readBoardNow(this.d, this.key, smoke);
    this.mode = this.snap.mode;
    this.emit();
    await this.submitIfDue(false);
    void resumePending(this.d, this.shown.game_id);
  }

  /** The record to send, created from the finished game before its first POST (V12-113). */
  private prepare(): GameRecord | null {
    const now = this.d.now();
    const data = readBoard(this.d.kv, now);
    const existing = data.games[this.shown.game_id];
    if (existing) return existing;
    const g = this.shown.game;
    if (!g || !this.d.kv.persistent || !autoAddOn(this.d.kv) || this.mode === 'disabled') return null;
    const kind = eligibility(g);
    if (kind !== 'ok' && !(kind === 'test' && this.mode === 'smoke')) return null;
    const week = g.board_week as Week | null;
    if (!week || (this.snap?.week && week !== this.snap.week) || data.removed.includes(week)) return null;
    const record: GameRecord = {
      game_id: g.game_id,
      game_ref: g.game_ref,
      src: g.src,
      week,
      total: this.shown.total,
      test: g.test_assisted,
      status: 'pending',
      outcome: null,
      payload: scorePayload(g, this.d.revs(g.item_ids)),
      attempts: 0,
      next_at: now,
      receipt: null,
      best: null,
      sent: [],
      at: now,
    };
    return updateRecord(this.d.kv, g.game_id, () => record, now);
  }

  private async submitIfDue(explicit: boolean): Promise<void> {
    if (this.posting || this.mode === 'disabled') return;
    const r = this.prepare();
    if (!r || r.status !== 'pending') return;
    if (!explicit && (r.attempts >= MAX_AUTO_ATTEMPTS || r.next_at > this.d.now())) {
      this.schedule(r);
      return;
    }
    this.posting = true;
    this.verify = 'checking';
    this.emit();
    const next = await attempt(this.d, r.game_id, this.d.verifier, {
      interactive: (open) => {
        this.verify = open ? 'interactive' : 'checking';
        this.emit();
      },
      verified: () => {
        this.verify = 'idle';
        this.emit();
      },
    });
    this.posting = false;
    this.verify = next?.status === 'pending' && next.outcome === 'turnstile_failed' ? 'failed' : 'idle';
    if (next?.status === 'confirmed') this.justConfirmed = true;
    this.emit();
    if (next?.status === 'pending') this.schedule(next);
  }

  /** The next automatic attempt, while this page is open (V12-114). */
  private schedule(r: GameRecord) {
    if (r.attempts >= MAX_AUTO_ATTEMPTS) return;
    if (this.timer !== null) this.d.clearTimer(this.timer);
    this.timer = this.d.setTimer(() => {
      this.timer = null;
      void this.submitIfDue(false);
    }, Math.max(0, r.next_at - this.d.now()));
  }

  /** The card's Retry: a fresh attempt now, or a fresh read when only the list failed. */
  async retry(): Promise<void> {
    const r = readBoard(this.d.kv, this.d.now()).games[this.shown.game_id];
    if (r?.status === 'pending') {
      this.verify = 'idle';
      await this.submitIfDue(true);
      return;
    }
    this.mode = 'loading';
    this.emit();
    this.snap = await readBoardNow(this.d, this.key, this.shown.game?.test_assisted === true);
    this.mode = this.snap.mode;
    this.justConfirmed = this.justConfirmed && this.mode === 'unavailable';
    this.emit();
    await this.submitIfDue(true);
  }

  /** Something else changed the device's records (a removal, the switch): redraw. */
  refresh() {
    this.emit();
  }

  dispose() {
    if (this.timer !== null) this.d.clearTimer(this.timer);
    this.timer = null;
    this.listeners.clear();
  }
}
