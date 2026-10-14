// The game core: a pure reducer (state, action) → { state, effects } (ENG24).
// It owns transitions, step locks, idempotent submits and the event ledger.
// UI, map, storage and analytics are adapters that run the effects.

import type { Src } from '../analytics/channels.ts';
import { EVENTS, STEPS, type EventName, type FeedbackQ, type Step } from '../analytics/events.ts';
import type { LatLng } from '../scoring/geo.ts';
import { scoreDistance, scoreYear } from '../scoring/score.ts';
import {
  currentVersions,
  type FinishedSnapshot,
  type GameState,
  type RoundAnswers,
  type RoundResult,
} from './schema.ts';

/** The answer key the reducer needs for one item. */
export interface AnswerKey {
  id: string;
  kept: LatLng;
  keptFullMarksKm: number;
  made: LatLng;
  madeFullMarksKm: number;
  start: number;
  end: number;
}

export type Action =
  | { type: 'start'; gameId: string; src: Src; itemsVersion: string }
  | { type: 'confirm'; round: number; step: Step; value: LatLng | number }
  | { type: 'skip'; round: number }
  | { type: 'next'; round: number }
  | { type: 'pulse'; q: FeedbackQ; a: string }
  | { type: 'copied'; method: 'clipboard' | 'manual'; total: number };

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

function scoreRound(a: RoundAnswers, key: AnswerKey): RoundResult {
  const kept = scoreDistance(a.kept, key.kept, key.keptFullMarksKm);
  const made = scoreDistance(a.made, key.made, key.madeFullMarksKm);
  const when = scoreYear(a.when, key.start, key.end);
  return {
    kept: { points: kept.points, km: kept.km },
    made: { points: made.points, km: made.km },
    when: { points: when.points, yearsOff: when.yearsOff },
    points: kept.points + made.points + when.points,
    skipped: false,
  };
}

function withRoundCompleted(state: GameState, effects: Effect[], round: number): GameState {
  const result = state.results[round] as RoundResult;
  return once(state, effects, ledgerKey(state.game_id, EVENTS.roundCompleted, round + 1), EVENTS.roundCompleted, {
    src: state.src,
    round: round + 1,
    skipped: result.skipped,
    answered_count: answeredCount(state),
    points: result.points,
  });
}

export function reduce(state: GameState | null, action: Action, keys: readonly AnswerKey[]): Result {
  const effects: Effect[] = [];

  if (action.type === 'start') {
    const n = keys.length;
    let next: GameState = {
      ...currentVersions(action.itemsVersion),
      game_id: action.gameId,
      rev: (state?.rev ?? 0) + 1,
      src: action.src,
      item_ids: keys.map((k) => k.id),
      round: 0,
      step: 'kept',
      phase: 'answering',
      answers: Array.from({ length: n }, emptyAnswers),
      results: Array.from({ length: n }, () => null),
      sent: [],
      finished: false,
    };
    next = once(next, effects, ledgerKey(next.game_id, EVENTS.gameStart), EVENTS.gameStart, { src: next.src });
    next = once(next, effects, ledgerKey(next.game_id, EVENTS.roundStarted, 1), EVENTS.roundStarted, {
      src: next.src,
      round: 1,
    });
    return { state: next, effects: [{ type: 'save' }, ...effects] };
  }

  if (!state) return { state, effects };

  // Feedback and copying also happen on the end screen, after the game finished.
  if (action.type === 'pulse') return feedback(state, action, effects);
  if (action.type === 'copied') {
    return {
      state,
      effects: [
        { type: 'track', name: EVENTS.resultCopied, props: { src: state.src, total: action.total, method: action.method } },
      ],
    };
  }

  if (state.finished) return { state, effects };

  switch (action.type) {
    case 'confirm': {
      // Idempotent: a double tap or a stale submit for another round or step is ignored (R2).
      if (action.round !== state.round || action.step !== state.step || state.phase !== 'answering') {
        return { state, effects };
      }
      const key = keys[state.round];
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
        { src: state.src, round: state.round + 1, step: action.step },
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

    case 'skip': {
      if (action.round !== state.round || state.phase !== 'answering') return { state, effects };
      const skipped: RoundResult = {
        kept: { points: 0, km: NaN },
        made: { points: 0, km: NaN },
        when: { points: 0, yearsOff: NaN },
        points: 0,
        skipped: true,
      };
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
          step: 'kept',
          phase: 'answering',
        };
        next = once(next, effects, ledgerKey(next.game_id, EVENTS.roundStarted, next.round + 1), EVENTS.roundStarted, {
          src: next.src,
          round: next.round + 1,
        });
        return { state: next, effects: [{ type: 'save' }, ...effects] };
      }
      let next: GameState = { ...state, rev: state.rev + 1, finished: true };
      next = once(next, effects, ledgerKey(next.game_id, EVENTS.gameCompleted), EVENTS.gameCompleted, {
        src: next.src,
        total: totalPoints(next),
        answered_count: answeredCount(next),
      });
      const snapshot: FinishedSnapshot = {
        state_version: next.state_version,
        scoring_version: next.scoring_version,
        items_version: next.items_version,
        game_id: next.game_id,
        item_ids: next.item_ids,
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
