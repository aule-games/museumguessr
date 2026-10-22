// Deck rules (V1-08, V1-09, W7, ENG12), shared by the planner, its tests and
// the item check. docs/content.md "Pool" and "Spread" explain them in plain words.

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
  /** No Kept city holds more than max(cityCapMin, floor(cityCapRatio × N)) pool objects (W7): 6 at N = 75. */
  cityCapMin: 3,
  cityCapRatio: 0.08,
  /** A deck repeats a Made country at most this many times when the pool allows it (E14, ENG12). */
  maxPerMadeCountry: 2,
  /** Fresh random tie-break retries for the Made-country cap before the planner keeps its best deck (ENG12). */
  countryRetries: 20,
  /** items:check draws this many seeded decks and fails when more than `countryMissShare` of them miss the cap (ENG12). */
  countrySample: 1000,
  countryMissShare: 0.05,
} as const;

/** The Kept-city cap for a pool of `n` objects (W7). */
export function cityCap(n: number): number {
  return Math.max(DECK.cityCapMin, Math.floor(DECK.cityCapRatio * n));
}

export type Difficulty = 1 | 2 | 3;
