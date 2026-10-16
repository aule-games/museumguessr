// The game core: a pure reducer (state, action) → { state, effects } (ENG24).
// It owns transitions, step locks, idempotent submits and the event ledger.
// UI, map, storage and analytics are adapters that run the effects.

import type { Src } from '../analytics/channels.ts';
import { EVENTS, STEPS, type EventName, type FeedbackQ, type Step } from '../analytics/events.ts';
import { scoreRound, skippedRound, type AnswerKey } from '../scoring/game.ts';
import type { LatLng } from '../scoring/geo.ts';
import {
  currentVersions,
  type Challenge,
  type DeckKind,
  type FinishedSnapshot,
  type GameState,
  type RoundAnswers,
  type RoundResult,
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

export type Action =
  | { type: 'start'; gameId: string; src: Src; itemsVersion: string; deck: Deck; context?: StartContext }
  | { type: 'confirm'; round: number; step: Step; value: LatLng | number }
  | { type: 'back'; round: number; step: Step }
  | { type: 'skip'; round: number }
  | { type: 'next'; round: number }
  | { type: 'pulse'; q: FeedbackQ; a: string }
  | { type: 'shared'; method: ShareMethod; kind: 'challenge' | 'reply' };

export type ShareMethod = 'native' | 'whatsapp' | 'x' | 'copy' | 'manual';

export type Effect =
  | { type: 'save' }
  | { type: 'track'; name: EventName; props: Record<string, unknown> }
  | { type: 'snapshot'; snapshot: FinishedSnapshot };

export interface Result {
  state: GameState | null;
  effects: Effect[];
}

const emptyAnswers = (): RoundAnswers => ({ kept: null, made: null, when: null });

export function ledgerKey(gameId: string, event: string, round: number | string = '', step = ''): string {
  return `${gameId}:${event}:${round}:${step}`;
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
    ids.length > 0 &&
    new Set(ids).size === ids.length &&
    ids.every((id) => keys.some((k) => k.id === id)) &&
    deck.firstSeen.length === ids.length
  );
}

function withRoundCompleted(state: GameState, effects: Effect[], round: number): GameState {
  const result = state.results[round] as RoundResult;
  return once(state, effects, ledgerKey(state.game_id, EVENTS.roundCompleted, round + 1), EVENTS.roundCompleted, {
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
  });
}

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
    };
    next = once(next, effects, ledgerKey(next.game_id, EVENTS.gameStart), EVENTS.gameStart, {
      src: next.src,
      deck_kind: next.deck_kind,
      ...(action.context ? { game_in_tab: action.context.gameInTab, seen_before: action.context.seenBefore } : {}),
    });
    next = once(next, effects, ledgerKey(next.game_id, EVENTS.roundStarted, 1), EVENTS.roundStarted, {
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

  if (state.finished) return { state, effects };

  switch (action.type) {
    case 'confirm': {
      // Idempotent: a double tap or a stale submit for another round or step is ignored (R2).
      if (action.round !== state.round || action.step !== state.step || state.phase !== 'answering') {
        return { state, effects };
      }
      const id = state.item_ids[state.round];
      const key = keys.find((k) => k.id === id);
      if (!key) return { state, effects };
      const valid =
        action.step === 'when'
          ? typeof action.value === 'number' && Number.isInteger(action.value) && action.value !== 0
          : typeof action.value === 'object' && Number.isFinite(action.value.lat) && Number.isFinite(action.value.lng);
      if (!valid) return { state, effects };

      const answers = state.answers.map((a, i) => (i === state.round ? { ...a, [action.step]: action.value } : a));
      let next: GameState = { ...state, rev: state.rev + 1, answers };
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
          results: next.results.map((r, i) => (i === state.round ? result : r)),
        };
        next = withRoundCompleted(next, effects, state.round);
      }
      return { state: next, effects: [{ type: 'save' }, ...effects] };
    }

    case 'back': {
      // Back reopens the previous step of the current round; its answer stays as the draft (DS36).
      // Nothing is revealed before the last Confirm, so revising is fair.
      const stepIndex = STEPS.indexOf(action.step);
      if (action.round !== state.round || action.step !== state.step || state.phase !== 'answering' || stepIndex < 1) {
        return { state, effects };
      }
      effects.push({ type: 'track', name: EVENTS.stepBack, props: { src: state.src, round: state.round + 1, from: action.step } });
      const next: GameState = { ...state, rev: state.rev + 1, step: STEPS[stepIndex - 1] as Step };
      return { state: next, effects: [{ type: 'save' }, ...effects] };
    }

    case 'skip': {
      if (action.round !== state.round || state.phase !== 'answering') return { state, effects };
      const skipped: RoundResult = skippedRound();
      let next: GameState = {
        ...state,
        rev: state.rev + 1,
        phase: 'reveal',
        results: state.results.map((r, i) => (i === state.round ? skipped : r)),
      };
      next = withRoundCompleted(next, effects, state.round);
      return { state: next, effects: [{ type: 'save' }, ...effects] };
    }

    case 'next': {
      if (action.round !== state.round || state.phase !== 'reveal') return { state, effects };
      const last = state.round === state.item_ids.length - 1;
      if (!last) {
        let next: GameState = {
          ...state,
          rev: state.rev + 1,
          round: state.round + 1,
          step: STEPS[0],
          phase: 'answering',
        };
        next = once(next, effects, ledgerKey(next.game_id, EVENTS.roundStarted, next.round + 1), EVENTS.roundStarted, {
          src: next.src,
          round: next.round + 1,
          item_id: next.item_ids[next.round],
        });
        return { state: next, effects: [{ type: 'save' }, ...effects] };
      }
      let next: GameState = { ...state, rev: state.rev + 1, finished: true };
      next = once(next, effects, ledgerKey(next.game_id, EVENTS.gameCompleted), EVENTS.gameCompleted, {
        src: next.src,
        total: totalPoints(next),
        answered_count: answeredCount(next),
      });
      if (next.deck_kind === 'challenge') {
        const score = next.challenge?.score ?? null;
        next = once(next, effects, ledgerKey(next.game_id, EVENTS.challengeCompleted), EVENTS.challengeCompleted, {
          src: next.src,
          beat: score === null ? null : totalPoints(next) > score,
        });
      }
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
      };
      return { state: next, effects: [{ type: 'save' }, { type: 'snapshot', snapshot }, ...effects] };
    }
  }
  return { state, effects };
}

function feedback(state: GameState, action: { q: FeedbackQ; a: string }, effects: Effect[]): Result {
  const next = once(state, effects, ledgerKey(state.game_id, EVENTS.feedback, action.q), EVENTS.feedback, {
    src: state.src,
    q: action.q,
    a: action.a,
  });
  return next === state ? { state, effects } : { state: { ...next, rev: next.rev + 1 }, effects: [{ type: 'save' }, ...effects] };
}
