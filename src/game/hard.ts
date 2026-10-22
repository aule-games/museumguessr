// "Hard one nailed" (W4, D12): a difficulty-3 round that scores at least
// HARD_NAILED points earns a mark on its reveal, a count on the end screen
// and a tag on the share hook. It never changes the points.

import { HARD_NAILED } from '../scoring/config.ts';
import type { RoundResult } from '../state/schema.ts';

/** Whether a round nailed a hard object; a skipped round never does. */
export function hardNailed(difficulty: number, result: RoundResult | null | undefined): boolean {
  return difficulty === 3 && !!result && !result.skipped && result.points >= HARD_NAILED;
}

/** How many rounds of a game nailed a hard object; `items[i]` belongs to `results[i]`. */
export function hardNailedCount(items: readonly { difficulty: number }[], results: readonly (RoundResult | null | undefined)[]): number {
  return items.reduce((n, it, i) => n + (hardNailed(it.difficulty, results[i]) ? 1 : 0), 0);
}
