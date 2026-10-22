// Every scoring constant lives here (DX15). README's worked examples and the
// reveal's reason lines are computed from these values; a unit test fails
// when they drift apart.

export type Precision = 'city' | 'region' | 'country';

/**
 * Bump when a change alters scores, so saved games from older rules reset
 * (3: the "4000 BCE or earlier" year stop, W5).
 */
export const SCORING_VERSION = 3;

export const MAX_POINTS = 1000;

export const DISTANCE = {
  /** Full marks within this distance of the holding museum's city. */
  keptFullMarksKm: 50,
  /** Default full-marks radius per made-place precision; also the cap for an item's own radius. */
  madeFullMarksKm: { city: 50, region: 300, country: 600 } satisfies Record<Precision, number>,
  /** Beyond the full-marks radius, points fall by a factor of e every `decayKm`. */
  decayKm: 1200,
} as const;

export const YEARS = {
  /** Fixed reference for an object's age; never the current date (ENG12). */
  referenceYear: 2000,
  /** Margin in years for a brand-new object (the gentler setting, locked 2026-10-14). */
  toleranceBase: 45,
  /** Extra margin per year of age: older objects get a wider margin. */
  tolerancePerYearOfAge: 0.17,
} as const;

/**
 * Year control bounds and piecewise scale (DS5, DS28): each segment gets an
 * equal share. Every year at or below `min` is the one leftmost stop
 * "4000 BCE or earlier", stored, saved and sent as the sentinel `earlyStop`
 * (W5, ENG10); the scale's own years run from `min + 1` to `max`.
 */
export const SLIDER = {
  earlyStop: -4001,
  min: -4000,
  max: 2025,
  breakpoints: [-4000, 1, 1000, 2025],
  ticks: [-4000, -2000, 1, 500, 1000, 1500, 2025],
} as const;

/**
 * Object dates (W5, W7): a date range may begin as early as `floor`, and at
 * most `maxBeforeStop` pool objects may begin before the year control's
 * early stop (SLIDER.min), so the stop rarely pays.
 */
export const DATES = {
  floor: -40000,
  maxBeforeStop: 3,
} as const;

/** A difficulty-3 round scoring at least this many points is a "hard one nailed" (W4, D12); it never multiplies points. */
export const HARD_NAILED = 2400;

/** Total-score tiers for the end screen (DS7, DS25); lower bound inclusive. */
export const TIERS = [
  { min: 0, name: 'Visitor' },
  { min: 7500, name: 'Docent' },
  { min: 15000, name: 'Curator' },
  { min: 21000, name: 'Keeper' },
  { min: 26000, name: 'Director' },
] as const;

/**
 * Set to true once the founder accepts the constants (ENG42). After that the
 * V3 constant-guess baseline is an items:check warning instead of a failing
 * test, so a reserve swap during the decision window is not blocked.
 */
export const CONSTANTS_LOCKED = true;
