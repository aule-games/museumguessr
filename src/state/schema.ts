// Versioned saved-state contract (DX18, E6, ENG14, ENG37). Every Pages project
// on the same account shares one origin, so storage keys are namespaced.

import { revalidateSrc, type Src } from '../analytics/channels.ts';
import type { Step } from '../analytics/events.ts';
import { SCORING_VERSION } from '../scoring/config.ts';
import type { RoundAnswers, RoundResult } from '../scoring/game.ts';

export type { RoundAnswers, RoundResult } from '../scoring/game.ts';

/**
 * Bump when the shape or meaning of saved state changes (2: question order
 * made → when → kept, DS35; 3: a game holds its own deck, V1-05).
 */
export const STATE_VERSION = 3;

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

export interface GameState extends Versions {
  game_id: string;
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
}

/** A finished game, kept next to the active save for "Review your 10" (ENG37). */
export interface FinishedSnapshot extends Versions {
  game_id: string;
  item_ids: string[];
  deck_kind: DeckKind;
  deck_hash: string;
  challenge: Challenge | null;
  answers: RoundAnswers[];
  results: RoundResult[];
  total: number;
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
        (r.when === null || Number.isInteger(r.when)),
    )
  );
}

function resultOk(r: unknown): r is RoundResult {
  return isObj(r) && Number.isFinite(r.points) && typeof r.skipped === 'boolean';
}

const isIdList = (ids: unknown): ids is string[] =>
  Array.isArray(ids) && ids.length > 0 && ids.every((id) => typeof id === 'string') && new Set(ids).size === ids.length;

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
 * used with the live pool (V1-05). A version 3 record is valid while its
 * deck hash still matches the pool, so pool growth keeps it and an answer
 * change drops it. A version 2 record (the fixed v0 set) is migrated as a
 * random, not-fresh deck only when it was made against the recorded v0
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
  if (v.state_version !== STATE_VERSION || v.deck_hash !== hash) return null;
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

/**
 * Parse a saved game. Returns null (start a new game) on a parse error, a
 * version mismatch, an unknown item id or a deck whose answers changed
 * (E6, DX18, V1-05).
 */
export function parseSave(raw: string | null, pool: Pool): GameState | null {
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
  return { ...(v as unknown as GameState), ...deck, state_version: STATE_VERSION, src: revalidateSrc(v.src) };
}

export interface ParsedSnapshot {
  snapshot: FinishedSnapshot;
  /** False when the snapshot no longer matches the live pool or the scoring: show the total only (ENG37). */
  current: boolean;
}

export function parseSnapshot(raw: string | null, pool: Pool): ParsedSnapshot | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!isObj(v) || !Number.isFinite(v.total)) return null;
    const deck = deckFields(v, pool);
    const current =
      !!deck && answersOk(v.answers, deck.item_ids.length) && Array.isArray(v.results) && v.results.every(resultOk);
    const snapshot = { ...(v as unknown as FinishedSnapshot), ...(deck ? { deck_kind: deck.deck_kind, deck_hash: deck.deck_hash, challenge: deck.challenge, state_version: STATE_VERSION } : {}) };
    return { snapshot, current };
  } catch {
    return null;
  }
}
