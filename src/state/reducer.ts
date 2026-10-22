// The game core: a pure reducer (state, action) → { state, effects } (ENG24).
// It owns transitions, step locks, idempotent submits and the event ledger.
// UI, map, storage and analytics are adapters that run the effects.

import type { Src } from '../analytics/channels.ts';
import { DECK } from '../deck/config.ts';
import { EVENTS, STEPS, type EventName, type FeedbackQ, type Step } from '../analytics/events.ts';
import {
  activeMs,
  isExpired,
  pauseClock,
  remainingMs,
  resolveTimeUp,
  resumeClock,
  secondsLeft,
  setRemaining,
  startClock,
  stopClock,
  validAnswer,
  type ClockSave,
  type Draft,
} from '../game/timer.ts';
import { scoreRound, skippedRound, type AnswerKey } from '../scoring/game.ts';
import type { LatLng } from '../scoring/geo.ts';
import {
  currentVersions,
  newGameRef,
  type Challenge,
  type DeckKind,
  type FinishedSnapshot,
  type GameState,
  type RoundAnswers,
  type RoundResult,
  type RoundTiming,
} from './schema.ts';

export type { AnswerKey } from '../scoring/game.ts';

/** The deck a game commits to at Start (V1-04, V1-05). */
export interface Deck {
  /** Item ids in round order. */
  ids: string[];
  kind: DeckKind;
  /** `itemsVersion` over the deck's items, in deck order. */
  hash: string;
  /** Per round: the item was not on this device's seen list when the deck was committed. */
  firstSeen: boolean[];
  challenge: Challenge | null;
}

/** Device facts game_start carries (V1-27); the app reads them, the reducer stays pure. */
export interface StartContext {
  /** Games started in this tab session, this one included: 1, 2 or 3+. */
  gameInTab: '1' | '2' | '3+';
  /** How many objects this device had seen before this game: 0, 1-9, 10-19, 20-29 or 30+. */
  seenBefore: '0' | '1-9' | '10-19' | '20-29' | '30+';
}

/** The coarse bucket game_start reports for a seen-list size (V1-27): 30+ means a fourth game or later. */
export function seenBucket(n: number): StartContext['seenBefore'] {
  return n <= 0 ? '0' : n < 10 ? '1-9' : n < 20 ? '10-19' : n < 30 ? '20-29' : '30+';
}

/**
 * Game actions. `now` is the wall-clock time the action happened (Date.now());
 * an action that carries it and arrives after the round's deadline is
 * replaced by the expiry (ENG7), so a late Confirm, Back, draft or resume can
 * never beat the clock.
 */
export type Action =
  | { type: 'start'; gameId: string; gameRef?: string; src: Src; itemsVersion: string; deck: Deck; context?: StartContext; testAssisted?: boolean }
  | { type: 'confirm'; round: number; step: Step; value: LatLng | number; now?: number }
  | { type: 'back'; round: number; step: Step; now?: number }
  | { type: 'draft'; round: number; step: Step; value: Draft; now: number }
  | { type: 'skip'; round: number; now?: number }
  | { type: 'next'; round: number; now?: number }
  | { type: 'clockStart'; round: number; now: number; limitMs: number | null; paused: boolean; readyMs: number }
  | { type: 'clockPause'; round: number; now: number }
  | { type: 'clockResume'; round: number; now: number }
  | { type: 'clockStop'; round: number; now: number }
  | { type: 'clockSet'; round: number; now: number; remainingMs: number; test?: boolean }
  | { type: 'expire'; gameId: string; round: number; now: number; away: boolean }
  | { type: 'revealShown'; gameId: string; round: number; now: number; boardWeek?: string | null }
  | { type: 'testAssist' }
  | { type: 'pulse'; q: FeedbackQ; a: string }
  | { type: 'shared'; method: ShareMethod; kind: 'challenge' | 'reply' };

export type ShareMethod = 'native' | 'whatsapp' | 'x' | 'copy' | 'manual';

export type Effect =
  | { type: 'save' }
  | { type: 'track'; name: EventName; props: Record<string, unknown> }
  | { type: 'snapshot'; snapshot: FinishedSnapshot }
  /** The round-10 reveal opened for the first time: the game is complete (N4); the app updates the weekly marker. */
  | { type: 'completed'; at: number };

export interface Result {
  state: GameState | null;
  effects: Effect[];
}

const emptyAnswers = (): RoundAnswers => ({ kept: null, made: null, when: null });

export function ledgerKey(gameId: string, event: string, round: number | string = '', step = ''): string {
  return `${gameId}:${event}:${round}:${step}`;
}

/** The ledger entry of a reveal that visibly opened (N5); not an analytics event name. */
export const REVEAL_SHOWN = 'reveal_shown';

/** The round's reveal has visibly opened at least once. */
export function revealSeen(state: Pick<GameState, 'game_id' | 'sent'>, round: number): boolean {
  return state.sent.includes(ledgerKey(state.game_id, REVEAL_SHOWN, round + 1));
}

/**
 * The current round ended at time-up and its reveal has not been shown: a
 * reload lands on the start screen with "Continue · Round N of 10 (time ran
 * out)" (R1).
 */
export function expiredUnseen(state: GameState): boolean {
  return !state.finished && state.phase === 'reveal' && !!state.timed_out[state.round] && !revealSeen(state, state.round);
}

/** The clock of the current round, if it has started. */
export function roundClock(state: GameState): ClockSave | null {
  return state.clock && state.clock.round === state.round && state.phase === 'answering' ? state.clock : null;
}

export function answeredCount(state: Pick<GameState, 'results'>): number {
  return state.results.filter((r) => r && !r.skipped).length;
}

export function totalPoints(state: Pick<GameState, 'results'>): number {
  return state.results.reduce((sum, r) => sum + (r ? r.points : 0), 0);
}

/** Emit a ledgered event only once per key; the key is recorded before the send (R3). */
function once(
  state: GameState,
  effects: Effect[],
  key: string,
  name: EventName,
  props: Record<string, unknown>,
): GameState {
  if (state.sent.includes(key)) return state;
  effects.push({ type: 'track', name, props });
  return { ...state, sent: [...state.sent, key] };
}

/** A deck is playable when its ids are distinct and every one has an answer key. */
function deckOk(deck: Deck, keys: readonly AnswerKey[]): boolean {
  const ids = deck.ids;
  return (
    ids.length === DECK.size &&
    new Set(ids).size === ids.length &&
    ids.every((id) => keys.some((k) => k.id === id)) &&
    deck.firstSeen.length === ids.length
  );
}

function withRoundCompleted(state: GameState, effects: Effect[], round: number): GameState {
  const result = state.results[round] as RoundResult;
  const timing = state.timing[round] ?? null;
  return once(state, effects, ledgerKey(state.game_id, EVENTS.roundCompleted, round + 1), EVENTS.roundCompleted, {
    game_ref: state.game_ref,
    src: state.src,
    round: round + 1,
    item_id: state.item_ids[round],
    skipped: result.skipped,
    answered_count: answeredCount(state),
    points: result.points,
    made_points: result.made.points,
    when_points: result.when.points,
    kept_points: result.kept.points,
    first_seen: state.first_seen[round] ?? false,
    timed_out: state.timed_out[round]?.questions.length ?? 0,
    seconds_left: timing?.seconds_left ?? null,
    active_ms: timing?.active_ms ?? 0,
    ready_ms: timing?.ready_ms ?? null,
  });
}

/** Timing evidence at the moment a round ends (ENG9); the reveal itself is untimed. */
function timingAt(clock: ClockSave | null, now: number | undefined): RoundTiming {
  if (!clock) return { seconds_left: null, active_ms: 0, ready_ms: null };
  const at = now ?? Date.now();
  return { seconds_left: secondsLeft(clock, at), active_ms: activeMs(clock, at), ready_ms: clock.ready_ms };
}

const withRound = <T>(list: readonly T[], round: number, value: T): T[] => list.map((x, i) => (i === round ? value : x));

/**
 * The round's reveal visibly opened (N5): the one place round_completed is
 * sent. Scoring a round (by Confirm, a photo skip or an expiry in a hidden
 * tab) is not evidence that anyone saw it. The round-10 reveal completes the
 * game: it records finished_at, freezes the board week and sends
 * game_completed (and challenge_completed) once.
 */
function revealShown(state: GameState, effects: Effect[], round: number, now: number, boardWeek: string | null | undefined): GameState {
  if (state.round !== round || state.phase !== 'reveal' || !state.results[round] || revealSeen(state, round)) return state;
  let next: GameState = { ...state, sent: [...state.sent, ledgerKey(state.game_id, REVEAL_SHOWN, round + 1)] };
  next = withRoundCompleted(next, effects, round);
  if (round !== next.item_ids.length - 1 || next.finished_at !== null) return next;
  next = { ...next, finished_at: now, board_week: next.board_week ?? boardWeek ?? null };
  next = once(next, effects, ledgerKey(next.game_id, EVENTS.gameCompleted), EVENTS.gameCompleted, {
    game_ref: next.game_ref,
    src: next.src,
    total: totalPoints(next),
    answered_count: answeredCount(next),
  });
  if (next.deck_kind === 'challenge') {
    const score = next.challenge?.score ?? null;
    next = once(next, effects, ledgerKey(next.game_id, EVENTS.challengeCompleted), EVENTS.challengeCompleted, {
      game_ref: next.game_ref,
      src: next.src,
      beat: score === null ? null : totalPoints(next) > score,
    });
  }
  effects.push({ type: 'completed', at: now });
  return next;
}

/**
 * Time is up (ENG7, D2, D8): one idempotent action, applied before any late
 * draft, Confirm, Back or resume. Drafts freeze by the last-valid-value rule;
 * a question with no answer and no valid draft is timed out (0 points, not
 * "skipped"). The result is saved first; the "Time's up" presentation and
 * the reveal come after, and round_completed waits for the reveal (N5).
 */
function expire(state: GameState, effects: Effect[], keys: readonly AnswerKey[], now: number, away: boolean): Result {
  const clock = roundClock(state);
  if (!clock || !isExpired(clock, now)) return { state, effects };
  const id = state.item_ids[state.round];
  const key = keys.find((k) => k.id === id);
  if (!key) return { state, effects };
  const resolved = resolveTimeUp(state.answers[state.round] as RoundAnswers, state.drafts, STEPS);
  const result = scoreRound(resolved.answers, key);
  const next: GameState = {
    ...state,
    rev: state.rev + 1,
    phase: 'reveal',
    clock: null,
    drafts: {},
    answers: withRound(state.answers, state.round, resolved.answers),
    results: withRound(state.results, state.round, result),
    timed_out: withRound(state.timed_out, state.round, { questions: resolved.timedOut, counted: resolved.counted, away }),
    timing: withRound(state.timing, state.round, { seconds_left: 0, active_ms: activeMs(clock, now), ready_ms: clock.ready_ms }),
  };
  return { state: next, effects: [{ type: 'save' }, ...effects] };
}

/** Actions that must lose to a deadline that has already passed (ENG7). */
const LATE_SENSITIVE = new Set<Action['type']>(['confirm', 'back', 'draft', 'skip', 'clockPause', 'clockResume', 'clockStop', 'clockSet']);

/**
 * `keys` holds the answer keys of every item the game may use (the live
 * pool); a round is always scored against the key of its own item id, never
 * by position (V1-04).
 */
export function reduce(state: GameState | null, action: Action, keys: readonly AnswerKey[]): Result {
  const effects: Effect[] = [];

  if (action.type === 'start') {
    const deck = action.deck;
    if (!deckOk(deck, keys)) return { state, effects };
    const n = deck.ids.length;
    let next: GameState = {
      ...currentVersions(action.itemsVersion),
      game_id: action.gameId,
      game_ref: action.gameRef ?? newGameRef(),
      rev: (state?.rev ?? 0) + 1,
      src: action.src,
      item_ids: [...deck.ids],
      deck_kind: deck.kind,
      deck_hash: deck.hash,
      fresh: deck.firstSeen.every(Boolean),
      first_seen: [...deck.firstSeen],
      challenge: deck.challenge,
      round: 0,
      step: STEPS[0],
      phase: 'answering',
      answers: Array.from({ length: n }, emptyAnswers),
      results: Array.from({ length: n }, () => null),
      sent: [],
      finished: false,
      clock: null,
      drafts: {},
      timed_out: Array.from({ length: n }, () => null),
      timing: Array.from({ length: n }, () => null),
      test_assisted: action.testAssisted === true,
      finished_at: null,
      board_week: null,
    };
    next = once(next, effects, ledgerKey(next.game_id, EVENTS.gameStart), EVENTS.gameStart, {
      game_ref: next.game_ref,
      src: next.src,
      deck_kind: next.deck_kind,
      ...(action.context ? { game_in_tab: action.context.gameInTab, seen_before: action.context.seenBefore } : {}),
    });
    next = once(next, effects, ledgerKey(next.game_id, EVENTS.roundStarted, 1), EVENTS.roundStarted, {
      game_ref: next.game_ref,
      src: next.src,
      round: 1,
      item_id: next.item_ids[0],
    });
    return { state: next, effects: [{ type: 'save' }, ...effects] };
  }

  if (!state) return { state, effects };

  // Feedback and sharing also happen on the end screen, after the game finished.
  if (action.type === 'pulse') return feedback(state, action, effects);
  if (action.type === 'shared') {
    // Every share is sent; first_in_game marks one per game, for the share rate (V1-27).
    const key = ledgerKey(state.game_id, EVENTS.resultShared);
    const first = !state.sent.includes(key);
    const props = { src: state.src, total: totalPoints(state), method: action.method, kind: action.kind, first_in_game: first };
    effects.push({ type: 'track', name: EVENTS.resultShared, props });
    if (!first) return { state, effects };
    return { state: { ...state, rev: state.rev + 1, sent: [...state.sent, key] }, effects: [{ type: 'save' }, ...effects] };
  }
  if (action.type === 'testAssist') {
    // Test provenance sticks to the game, finished or not (ENG5).
    if (state.test_assisted) return { state, effects };
    return { state: { ...state, rev: state.rev + 1, test_assisted: true }, effects: [{ type: 'save' }] };
  }

  if (state.finished) return { state, effects };

  // The deadline wins over anything that arrives after it (ENG7).
  if (LATE_SENSITIVE.has(action.type) && 'now' in action && typeof action.now === 'number' && action.round === state.round) {
    const clock = roundClock(state);
    if (clock && isExpired(clock, action.now)) return expire(state, effects, keys, action.now, false);
  }

  switch (action.type) {
    case 'expire': {
      if (action.gameId !== state.game_id || action.round !== state.round) return { state, effects };
      return expire(state, effects, keys, action.now, action.away);
    }

    case 'revealShown': {
      if (action.gameId !== state.game_id) return { state, effects };
      const next = revealShown(state, effects, action.round, action.now, action.boardWeek);
      return next === state ? { state, effects } : { state: { ...next, rev: next.rev + 1 }, effects: [{ type: 'save' }, ...effects] };
    }

    case 'clockStart': {
      if (action.round !== state.round || state.phase !== 'answering' || roundClock(state)) return { state, effects };
      const clock = startClock(state.round, action.limitMs, action.now, action.paused, action.readyMs);
      return { state: { ...state, rev: state.rev + 1, clock }, effects: [{ type: 'save' }] };
    }

    case 'clockPause':
    case 'clockResume':
    case 'clockStop':
    case 'clockSet': {
      const clock = action.round === state.round ? roundClock(state) : null;
      if (!clock) return { state, effects };
      const next =
        action.type === 'clockPause'
          ? pauseClock(clock, action.now)
          : action.type === 'clockResume'
            ? resumeClock(clock, action.now)
            : action.type === 'clockStop'
              ? stopClock(clock, action.now)
              : setRemaining(clock, action.now, action.remainingMs);
      const assisted = action.type === 'clockSet' && action.test === true;
      if (next === clock && !(assisted && !state.test_assisted)) return { state, effects };
      return { state: { ...state, rev: state.rev + 1, clock: next, test_assisted: state.test_assisted || assisted }, effects: [{ type: 'save' }] };
    }

    case 'draft': {
      // Drafts, including empty and invalid edits, are saved as they change (ENG7, D8).
      if (action.round !== state.round || action.step !== state.step || state.phase !== 'answering') return { state, effects };
      const value = action.value === null || validAnswer(action.step, action.value) ? action.value : null;
      const prev = state.drafts[action.step];
      if (prev !== undefined && JSON.stringify(prev) === JSON.stringify(value)) return { state, effects };
      return { state: { ...state, rev: state.rev + 1, drafts: { ...state.drafts, [action.step]: value } }, effects: [{ type: 'save' }] };
    }

    case 'confirm': {
      // Idempotent: a double tap or a stale submit for another round or step is ignored (R2).
      if (action.round !== state.round || action.step !== state.step || state.phase !== 'answering') {
        return { state, effects };
      }
      const id = state.item_ids[state.round];
      const key = keys.find((k) => k.id === id);
      if (!key) return { state, effects };
      if (!validAnswer(action.step, action.value)) return { state, effects };

      const answers = state.answers.map((a, i) => (i === state.round ? { ...a, [action.step]: action.value } : a));
      // A confirmed answer replaces that question's draft.
      const drafts = { ...state.drafts };
      delete drafts[action.step];
      let next: GameState = { ...state, rev: state.rev + 1, answers, drafts };
      next = once(
        next,
        effects,
        ledgerKey(state.game_id, EVENTS.stepCompleted, state.round + 1, action.step),
        EVENTS.stepCompleted,
        { src: state.src, round: state.round + 1, step: action.step, item_id: state.item_ids[state.round] },
      );
      const stepIndex = STEPS.indexOf(action.step);
      if (stepIndex < STEPS.length - 1) {
        next = { ...next, step: STEPS[stepIndex + 1] as Step };
      } else {
        const result = scoreRound(answers[state.round] as RoundAnswers, key);
        next = {
          ...next,
          phase: 'reveal',
          clock: null,
          drafts: {},
          results: next.results.map((r, i) => (i === state.round ? result : r)),
          timing: withRound(next.timing, state.round, timingAt(roundClock(state), action.now)),
        };
      }
      return { state: next, effects: [{ type: 'save' }, ...effects] };
    }

    case 'back': {
      // Back reopens the previous step of the current round; its answer stays as the draft (DS36).
      // Nothing is revealed before the last Confirm, so revising is fair. Back never stops the clock.
      const stepIndex = STEPS.indexOf(action.step);
      if (action.round !== state.round || action.step !== state.step || state.phase !== 'answering' || stepIndex < 1) {
        return { state, effects };
      }
      effects.push({ type: 'track', name: EVENTS.stepBack, props: { src: state.src, round: state.round + 1, from: action.step } });
      const next: GameState = { ...state, rev: state.rev + 1, step: STEPS[stepIndex - 1] as Step };
      return { state: next, effects: [{ type: 'save' }, ...effects] };
    }

    case 'skip': {
      // The photo-failure path (N9): unanswered questions are skipped, never timed out.
      if (action.round !== state.round || state.phase !== 'answering') return { state, effects };
      const skipped: RoundResult = skippedRound();
      const next: GameState = {
        ...state,
        rev: state.rev + 1,
        phase: 'reveal',
        clock: null,
        drafts: {},
        results: state.results.map((r, i) => (i === state.round ? skipped : r)),
        timing: withRound(state.timing, state.round, timingAt(roundClock(state), action.now)),
      };
      return { state: next, effects: [{ type: 'save' }, ...effects] };
    }

    case 'next': {
      if (action.round !== state.round || state.phase !== 'reveal') return { state, effects };
      // Next is pressed on the reveal, so the reveal was shown even if nothing recorded it yet.
      let shown = revealShown(state, effects, state.round, action.now ?? Date.now(), null);
      const last = state.round === state.item_ids.length - 1;
      if (!last) {
        shown = {
          ...shown,
          rev: state.rev + 1,
          round: state.round + 1,
          step: STEPS[0],
          phase: 'answering',
          clock: null,
          drafts: {},
        };
        shown = once(shown, effects, ledgerKey(shown.game_id, EVENTS.roundStarted, shown.round + 1), EVENTS.roundStarted, {
          game_ref: shown.game_ref,
          src: shown.src,
          round: shown.round + 1,
          item_id: shown.item_ids[shown.round],
        });
        return { state: shown, effects: [{ type: 'save' }, ...effects] };
      }
      const next: GameState = { ...shown, rev: state.rev + 1, finished: true };
      const snapshot: FinishedSnapshot = {
        state_version: next.state_version,
        scoring_version: next.scoring_version,
        items_version: next.items_version,
        game_id: next.game_id,
        item_ids: next.item_ids,
        deck_kind: next.deck_kind,
        deck_hash: next.deck_hash,
        challenge: next.challenge,
        answers: next.answers,
        results: next.results as RoundResult[],
        total: totalPoints(next),
        timed_out: next.timed_out,
        test_assisted: next.test_assisted,
        finished_at: next.finished_at,
        board_week: next.board_week,
      };
      return { state: next, effects: [{ type: 'save' }, { type: 'snapshot', snapshot }, ...effects] };
    }
  }
  return { state, effects };
}

/** Time left on the current round's clock at `now`, or null when it has not started. */
export function clockRemaining(state: GameState, now: number): number | null {
  const clock = roundClock(state);
  return clock ? remainingMs(clock, now) : null;
}

function feedback(state: GameState, action: { q: FeedbackQ; a: string }, effects: Effect[]): Result {
  const next = once(state, effects, ledgerKey(state.game_id, EVENTS.feedback, action.q), EVENTS.feedback, {
    src: state.src,
    q: action.q,
    a: action.a,
  });
  return next === state ? { state, effects } : { state: { ...next, rev: next.rev + 1 }, effects: [{ type: 'save' }, ...effects] };
}
