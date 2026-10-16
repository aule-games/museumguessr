// Deck rules (V1-08, V1-09), shared by the planner, its tests and the item
// check. docs/content.md "Decks" explains them in plain words.

export const DECK = {
  /** Rounds per game. */
  size: 10,
  /** Rounds 1-3 are difficulty 1 (protects the 3-round KPI). */
  easyRounds: 3,
  /** At most this many difficulty-3 objects in one deck. */
  maxHard: 3,
  /** Below this pool size a deck is the first 10 objects in file order. */
  poolMinimum: 30,
  /** Backtracking steps for planning several fresh decks at once, before the planner settles for the best single deck. */
  searchBudget: 50_000,
  /** Difficulty-1 objects are at least this share of the pool, difficulty 3 at most `maxHardShare`. */
  minEasyShare: 0.3,
  maxHardShare: 0.3,
} as const;

export type Difficulty = 1 | 2 | 3;
