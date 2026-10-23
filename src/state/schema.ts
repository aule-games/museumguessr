// Versioned saved-state contract (DX18, E6, ENG14, ENG37). Every Pages project
// on the same account shares one origin, so storage keys are namespaced.

import { revalidateSrc, type Src } from '../analytics/channels.ts';
import { STEPS, type Step } from '../analytics/events.ts';
import { DECK } from '../deck/config.ts';
import type { ClockSave, Drafts } from '../game/timer.ts';
import { SCORING_VERSION } from '../scoring/config.ts';
import type { RoundAnswers, RoundResult } from '../scoring/game.ts';
import { isAnswerYear } from '../scoring/years.ts';

export type { RoundAnswers, RoundResult } from '../scoring/game.ts';
export type { ClockSave, Draft, Drafts } from '../game/timer.ts';

/**
 * Bump when the shape or meaning of saved state changes (2: question order
 * made → when → kept, DS35; 3: a game holds its own deck, V1-05; 4: the
 * round clock, drafts, time-ups, test provenance and completion, V12-54).
 */
export const STATE_VERSION = 4;

/**
 * The items hash of the fixed v0 set of 10. A version 2 save is migrated only
 * when it was made against exactly these answers and they are unchanged in
 * the live pool (V1-05); any other version 2 save is dropped.
 */
export const V2_ITEMS_VERSION = '35ca1219';

export const KEYS = {
  save: 'museumguessr:v1:save',
  last: 'museumguessr:v1:last',
  test: 'museumguessr:test',
  /** sessionStorage */
  session: 'museumguessr:v1:session',
  bootFailures: 'museumguessr:v1:boot-failures',
  chunkReload: 'museumguessr:v1:chunk-reload',
  /** The first-visit tour ran (done or skipped); it starts again only from the menu. */
  tour: 'museumguessr:v1:tour',
  /** Every object this device has been shown; never restarts (V1-07). */
  everSeen: 'museumguessr:v1:ever-seen',
  /** The objects shown since the last restart, with the planner's seed (V1-07). */
  seen: 'museumguessr:v1:seen',
  /** The name this device shares in challenge links (V1-20). */
  name: 'museumguessr:v1:name',
  /** sessionStorage: a challenge link read on this tab, until Start (V1-16). */
  challenge: 'museumguessr:v1:challenge',
  /** sessionStorage: a challenge set aside with "Continue my game" (V1-17). */
  waiting: 'museumguessr:v1:waiting-challenge',
  /** sessionStorage: games started in this tab session, for game_start's game_in_tab (V1-27). */
  gamesInTab: 'museumguessr:v1:games-in-tab',
  /** sessionStorage: challenge links whose screen already sent challenge_opened. */
  challengeOpened: 'museumguessr:v1:challenge-opened',
  /** The first timed-out reveal on this device showed its one-time tip (V12-63). */
  timeUpTip: 'museumguessr:v1:time-up-tip',
  /** The last ISO week (UTC, Monday start) in which this device completed a game (V12-132). */
  weekActive: 'museumguessr:v1:week-active',
  /** The board's device key: random 128 bits, sent only as a bearer header to this site's API (N3, V12-81). */
  boardKey: 'museumguessr:v1:board-key',
  /** The board's receipts and pending submissions (G1, ENG23, V12-113). */
  board: 'museumguessr:v1:board',
  /** "Add my games to the board": "off" once the player switched it off; on by default (G3, V12-120). */
  boardAuto: 'museumguessr:v1:board-auto',
  /** This week's last confirmed best and rank, for the start screen without a request (R5, N15, V12-123). */
  boardStanding: 'museumguessr:v1:board-standing',
} as const;

export type Phase = 'answering' | 'reveal';

/** Where a game's deck came from: the device's own draw, a friend's link, or a finished deck played again. */
export type DeckKind = 'random' | 'challenge' | 'replay';
export const DECK_KINDS: readonly DeckKind[] = ['random', 'challenge', 'replay'];

/** A friend's challenge carried by the game: their score to beat and name, each null when the link had none. */
export interface Challenge {
  score: number | null;
  name: string | null;
}

export interface Versions {
  state_version: number;
  scoring_version: number;
  items_version: string;
}

/** How a round ended at time-up (D2, D8): a round that ended by Confirm or a photo skip has none. */
export interface TimeUp {
  /** Questions with no answer and no valid draft at time-up: 0 points, "No answer · time ran out" (not "Skipped"). */
  questions: Step[];
  /** Questions scored from an unconfirmed draft or from the fallback to the last confirmed answer: "Counted at time-up". */
  counted: Step[];
  /** The deadline passed while the player was away (hidden tab, closed page): the reveal says so and skips the hold. */
  away: boolean;
}

/** Timing evidence for round_completed (ENG9), kept in the save so a reload never changes it. */
export interface RoundTiming {
  /** Whole seconds left when the round ended; null for an untimed round. */
  seconds_left: number | null;
  /** Time the answer controls were usable (the clock only runs while they are). */
  active_ms: number;
  /** Round opened → photo and controls ready; null when they never were. */
  ready_ms: number | null;
}

/** Test provenance and completion, shared by the active game and its finished snapshot (ENG5, N4). */
export interface Provenance {
  /** Started in test mode, or touched by any test control; never cleared (ENG5). */
  test_assisted: boolean;
  /** Wall-clock ms when the round-10 reveal was first shown; null before (N4). */
  finished_at: number | null;
  /** The server's ISO week frozen at completion, or null; never inferred from the device clock (N4). */
  board_week: string | null;
}

export interface GameState extends Versions, Provenance {
  game_id: string;
  /** A random per-game reference for analytics, never reused across games and never sent to the board (ENG9). */
  game_ref: string;
  /** Write counter for cross-tab safety (ENG30). */
  rev: number;
  /** Channel captured at game start (PH3). */
  src: Src;
  item_ids: string[];
  deck_kind: DeckKind;
  /** `itemsVersion` over the deck's items in deck order; the save is valid while it matches the live pool. */
  deck_hash: string;
  /** No deck item was on this device's seen list when the deck was committed. */
  fresh: boolean;
  /** Per round: the item was not on this device's seen list when the deck was committed. */
  first_seen: boolean[];
  challenge: Challenge | null;
  /** 0-based round index. */
  round: number;
  step: Step;
  phase: Phase;
  answers: RoundAnswers[];
  results: (RoundResult | null)[];
  /** Ledger of events already handed to analytics: `${game_id}:${event}:${round}:${step}` (ENG14, R3). */
  sent: string[];
  finished: boolean;
  /** The current round's clock; null before it starts and on the reveal (V12-44). */
  clock: ClockSave | null;
  /** The current round's unconfirmed edits, saved as they change (ENG7). */
  drafts: Drafts;
  /** Per round: how it ended at time-up, or null. */
  timed_out: (TimeUp | null)[];
  /** Per round: timing evidence for round_completed, or null before the round ends. */
  timing: (RoundTiming | null)[];
}

/** A finished game, kept next to the active save for "Review your 10" (ENG37). */
export interface FinishedSnapshot extends Versions, Provenance {
  game_id: string;
  item_ids: string[];
  deck_kind: DeckKind;
  deck_hash: string;
  challenge: Challenge | null;
  answers: RoundAnswers[];
  results: RoundResult[];
  total: number;
  timed_out: (TimeUp | null)[];
}

export function currentVersions(itemsVersion: string): Versions {
  return { state_version: STATE_VERSION, scoring_version: SCORING_VERSION, items_version: itemsVersion };
}

/** The live item pool, as the saved-state parser needs it. */
export interface Pool {
  /** `itemsVersion` over these items in this order, or null when an id is not in the pool. */
  deckHash(ids: readonly string[]): string | null;
}

export function serialize(state: GameState | FinishedSnapshot): string {
  return JSON.stringify(state);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isLatLngOrNull = (v: unknown) =>
  v === null || (isObj(v) && Number.isFinite(v.lat) && Number.isFinite(v.lng));

function answersOk(a: unknown, n: number): a is RoundAnswers[] {
  return (
    Array.isArray(a) &&
    a.length === n &&
    a.every(
      (r) =>
        isObj(r) &&
        isLatLngOrNull(r.kept) &&
        isLatLngOrNull(r.made) &&
        (r.when === null || isAnswerYear(r.when)),
    )
  );
}

function resultOk(r: unknown): r is RoundResult {
  return isObj(r) && Number.isFinite(r.points) && typeof r.skipped === 'boolean';
}

const isIdList = (ids: unknown): ids is string[] =>
  Array.isArray(ids) && ids.length === DECK.size && ids.every((id) => typeof id === 'string') && new Set(ids).size === ids.length;

function challengeOk(c: unknown): c is Challenge | null {
  return (
    c === null ||
    (isObj(c) &&
      (c.score === null || (Number.isInteger(c.score) && (c.score as number) >= 0)) &&
      (c.name === null || typeof c.name === 'string'))
  );
}

/**
 * The deck fields of a saved game or snapshot, or null when it cannot be
 * used with the live pool (V1-05). A version 3 or 4 record is valid while
 * its deck hash still matches the pool, so pool growth keeps it and an
 * answer change drops it. A version 2 record (the fixed v0 set) is migrated
 * as a random, not-fresh deck only when it was made against the recorded v0
 * answers and they are unchanged.
 */
function deckFields(
  v: Record<string, unknown>,
  pool: Pool,
): Pick<GameState, 'item_ids' | 'deck_kind' | 'deck_hash' | 'fresh' | 'first_seen' | 'challenge'> | null {
  if (v.scoring_version !== SCORING_VERSION || !isIdList(v.item_ids)) return null;
  const ids = v.item_ids;
  const hash = pool.deckHash(ids);
  if (hash === null) return null;
  if (v.state_version === 2) {
    if (v.items_version !== V2_ITEMS_VERSION || hash !== V2_ITEMS_VERSION) return null;
    return { item_ids: ids, deck_kind: 'random', deck_hash: hash, fresh: false, first_seen: ids.map(() => false), challenge: null };
  }
  if ((v.state_version !== 3 && v.state_version !== STATE_VERSION) || v.deck_hash !== hash) return null;
  if (!DECK_KINDS.includes(v.deck_kind as DeckKind) || !challengeOk(v.challenge ?? null)) return null;
  const firstSeen = v.first_seen ?? ids.map(() => false);
  if (!Array.isArray(firstSeen) || firstSeen.length !== ids.length || !firstSeen.every((f) => typeof f === 'boolean')) return null;
  return {
    item_ids: ids,
    deck_kind: v.deck_kind as DeckKind,
    deck_hash: hash,
    fresh: v.fresh === true,
    first_seen: firstSeen as boolean[],
    challenge: (v.challenge ?? null) as Challenge | null,
  };
}

// ----- version 4 fields (V12-54): every one is checked; one bad field resets the save -----

const isStep = (s: unknown): s is Step => (STEPS as readonly unknown[]).includes(s);
const isMs = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const stepList = (v: unknown): v is Step[] => Array.isArray(v) && v.every(isStep) && new Set(v).size === v.length;

/** A random reference for analytics: 22 base64url characters, like a game id but never linked to one. */
export function newGameRef(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  let bin = '';
  for (const b of random(16)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const REF = /^[A-Za-z0-9_-]{8,64}$/;
const WEEK = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;

function clockOk(c: unknown, round: number, phase: unknown): boolean {
  if (c === null) return true;
  if (!isObj(c) || phase !== 'answering' || c.round !== round) return false;
  if (!(c.limit_ms === null || (Number.isInteger(c.limit_ms) && (c.limit_ms as number) > 0))) return false;
  if (typeof c.paused !== 'boolean' || typeof c.stopped !== 'boolean' || !isMs(c.ready_ms)) return false;
  if (c.stopped && !c.paused) return false;
  // Running: a deadline and no remaining time. Paused or stopped: remaining time and no deadline (N8).
  return c.paused ? c.deadline === null && isMs(c.remaining_ms) : typeof c.deadline === 'number' && Number.isFinite(c.deadline) && c.remaining_ms === null;
}

function draftsOk(d: unknown): boolean {
  if (!isObj(d)) return false;
  return Object.entries(d).every(([step, v]) => {
    if (!isStep(step)) return false;
    if (v === null) return true;
    return step === 'when' ? isAnswerYear(v) : isObj(v) && Number.isFinite(v.lat) && Number.isFinite(v.lng);
  });
}

function timeUpOk(t: unknown): boolean {
  return t === null || (isObj(t) && stepList(t.questions) && stepList(t.counted) && typeof t.away === 'boolean');
}

function timingOk(t: unknown): boolean {
  return (
    t === null ||
    (isObj(t) &&
      (t.seconds_left === null || (Number.isInteger(t.seconds_left) && (t.seconds_left as number) >= 0)) &&
      isMs(t.active_ms) &&
      (t.ready_ms === null || isMs(t.ready_ms)))
  );
}

function provenanceOk(v: Record<string, unknown>): boolean {
  return (
    typeof v.test_assisted === 'boolean' &&
    (v.finished_at === null || (typeof v.finished_at === 'number' && Number.isFinite(v.finished_at))) &&
    (v.board_week === null || (typeof v.board_week === 'string' && WEEK.test(v.board_week)))
  );
}

const perRound = (v: unknown, n: number, ok: (x: unknown) => boolean) => Array.isArray(v) && v.length === n && v.every(ok);

/** The saved record is from a newer page version: leave it untouched (N10) rather than discard it. */
export function isNewerRecord(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const v = JSON.parse(raw) as unknown;
    return isObj(v) && typeof v.state_version === 'number' && v.state_version > STATE_VERSION;
  } catch {
    return false;
  }
}

/**
 * Parse a saved game. Returns null (start a new game) on a parse error, a
 * version mismatch, an unknown item id, a deck whose answers changed or any
 * corrupt field (E6, DX18, V1-05, V12-54). A newer-version save also parses
 * to null; the caller leaves it in storage (see isNewerRecord). An older save
 * (version 2 or 3) gains the version 4 fields: no clock yet, no drafts, no
 * time-ups, not test-assisted, unfinished.
 */
export function parseSave(raw: string | null, pool: Pool, newRef: () => string = () => newGameRef()): GameState | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(v)) return null;
  const deck = deckFields(v, pool);
  if (!deck) return null;
  const n = deck.item_ids.length;
  if (
    typeof v.game_id !== 'string' ||
    typeof v.items_version !== 'string' ||
    !Number.isInteger(v.rev) ||
    !Number.isInteger(v.round) ||
    (v.round as number) < 0 ||
    (v.round as number) >= n ||
    !['kept', 'made', 'when'].includes(v.step as string) ||
    !['answering', 'reveal'].includes(v.phase as string) ||
    !answersOk(v.answers, n) ||
    !Array.isArray(v.results) ||
    v.results.length !== n ||
    !v.results.every((r) => r === null || resultOk(r)) ||
    !Array.isArray(v.sent) ||
    !v.sent.every((s) => typeof s === 'string') ||
    typeof v.finished !== 'boolean'
  ) {
    return null;
  }
  const older = v.state_version !== STATE_VERSION;
  if (older) {
    const migrated = {
      game_ref: newRef(),
      clock: null,
      drafts: {},
      timed_out: deck.item_ids.map(() => null),
      timing: deck.item_ids.map(() => null),
      test_assisted: false,
      finished_at: null,
      board_week: null,
    };
    return { ...(v as unknown as GameState), ...migrated, ...deck, state_version: STATE_VERSION, src: revalidateSrc(v.src) };
  }
  if (
    typeof v.game_ref !== 'string' ||
    !REF.test(v.game_ref) ||
    !clockOk(v.clock, v.round as number, v.phase) ||
    !draftsOk(v.drafts) ||
    !perRound(v.timed_out, n, timeUpOk) ||
    !perRound(v.timing, n, timingOk) ||
    !provenanceOk(v)
  ) {
    return null;
  }
  return { ...(v as unknown as GameState), ...deck, state_version: STATE_VERSION, src: revalidateSrc(v.src) };
}

export interface ParsedSnapshot {
  snapshot: FinishedSnapshot;
  /** False when the snapshot no longer matches the live pool or the scoring: show the total only (ENG37). */
  current: boolean;
}

/** A finished snapshot; an older one gains the version 4 provenance fields, a corrupt version 4 one is not current. */
export function parseSnapshot(raw: string | null, pool: Pool): ParsedSnapshot | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!isObj(v) || !Number.isFinite(v.total)) return null;
    const deck = deckFields(v, pool);
    const n = deck?.item_ids.length ?? 0;
    const v4 = v.state_version === STATE_VERSION;
    const extrasOk = !v4 || (perRound(v.timed_out, n, timeUpOk) && provenanceOk(v));
    const current =
      !!deck && extrasOk && answersOk(v.answers, n) && Array.isArray(v.results) && v.results.every(resultOk);
    const defaults = { timed_out: Array.from({ length: Array.isArray(v.item_ids) ? v.item_ids.length : 0 }, () => null), test_assisted: false, finished_at: null, board_week: null };
    const base = { ...defaults, ...(v as unknown as FinishedSnapshot) };
    if (!current) Object.assign(base, { timed_out: defaults.timed_out });
    // Test provenance never clears, whatever else about the record is unusable (ENG5).
    base.test_assisted = v.test_assisted === true;
    const snapshot = { ...base, ...(deck ? { deck_kind: deck.deck_kind, deck_hash: deck.deck_hash, challenge: deck.challenge, state_version: STATE_VERSION } : {}) };
    return { snapshot, current };
  } catch {
    return null;
  }
}
