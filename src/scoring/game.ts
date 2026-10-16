// Answer keys and round and game scoring (V1-03, V1-04). The game uses this
// module, and the board server will reuse it, so it imports no Vite APIs:
// it runs anywhere the item data can be read.

import { DISTANCE } from './config.ts';
import type { LatLng } from './geo.ts';
import { madeFullMarksKm, scoreDistance, scoreYear } from './score.ts';
import type { CoreItem } from '../content/items.ts';

/** The answer key for one item: what a round is scored against. */
export interface AnswerKey {
  id: string;
  kept: LatLng;
  keptFullMarksKm: number;
  made: LatLng;
  madeFullMarksKm: number;
  start: number;
  end: number;
}

export interface RoundAnswers {
  kept: LatLng | null;
  made: LatLng | null;
  when: number | null;
}

export interface RoundResult {
  kept: { points: number; km: number };
  made: { points: number; km: number };
  when: { points: number; yearsOff: number };
  points: number;
  skipped: boolean;
}

export function answerKey(it: CoreItem): AnswerKey {
  return {
    id: it.id,
    kept: { lat: it.kept.lat, lng: it.kept.lng },
    keptFullMarksKm: DISTANCE.keptFullMarksKm,
    made: { lat: it.made.lat, lng: it.made.lng },
    madeFullMarksKm: madeFullMarksKm(it.made.precision, it.made.full_marks_km),
    start: it.when.start,
    end: it.when.end,
  };
}

export function scoreRound(a: RoundAnswers, key: AnswerKey): RoundResult {
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

/** A skipped round scores 0 whatever answers it already holds. */
export function skippedRound(): RoundResult {
  return {
    kept: { points: 0, km: NaN },
    made: { points: 0, km: NaN },
    when: { points: 0, yearsOff: NaN },
    points: 0,
    skipped: true,
  };
}

/**
 * Scores a whole game from its answers and skip flags, each round against
 * the key of its own item (`keys[i]` belongs to round i). Throws when the
 * three lists differ in length, so a caller can never score a round against
 * another item's key.
 */
export function scoreGame(
  answers: readonly RoundAnswers[],
  skipped: readonly boolean[],
  keys: readonly AnswerKey[],
): { results: RoundResult[]; total: number } {
  if (answers.length !== keys.length || skipped.length !== keys.length) throw new Error('scoreGame: answers, skips and keys differ in length');
  const results = keys.map((key, i) => (skipped[i] ? skippedRound() : scoreRound(answers[i] as RoundAnswers, key)));
  return { results, total: results.reduce((sum, r) => sum + r.points, 0) };
}
