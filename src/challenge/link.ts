// Challenge links (V1-16, ENG11):
// `?d=<10 ids joined by .>&s=<score>&n=<name>&h=<deck hash>&r=<rules version>`.
// The ids replay the same 10 objects even after the pool grows; `h` tells the
// receiver whether those objects' answers changed since the link was made,
// and `r` whether the rules (scoring and the round clock) did; either way
// the deck stays playable but the scores are not compared. The screen never
// claims the score was checked: anyone can edit a link.

import { DECK } from '../deck/config.ts';
import { cleanName } from '../game/names.ts';
import { TIMER } from '../game/timer-config.ts';
import { MAX_POINTS, SCORING_VERSION } from '../scoring/config.ts';

export const CHALLENGE_PARAMS = ['d', 's', 'n', 'h', 'r'] as const;
/** Test and development switches never travel in a shared link (N11). */
export const SHARE_DROPPED = ['test', 'fixture', 'clock'] as const;
const ID = /^[0-9]{2,3}$/;
const HASH = /^[0-9a-f]{8}$/;
const RULES = /^[0-9a-z.]{1,24}$/;
const MAX_TOTAL = MAX_POINTS * 3 * DECK.size;

/** The values a challenge's score depends on besides the answers: the scorer and the round clock. */
export interface Rules {
  scoringVersion: number;
  timer: { roundSeconds: number; firstRoundSeconds: number | null; warnSeconds: number };
}

/** "3.60.60.10": scoring version, round seconds, first-round seconds ("u" for an untimed round 1), warning seconds (ENG11). */
export function rulesVersion(r: Rules): string {
  const { roundSeconds, firstRoundSeconds, warnSeconds } = r.timer;
  return [r.scoringVersion, roundSeconds, firstRoundSeconds ?? 'u', warnSeconds].join('.');
}

/** The rules this page plays by, derived from the scoring and timer constants. */
export const RULES_VERSION = rulesVersion({ scoringVersion: SCORING_VERSION, timer: TIMER });

export interface ChallengeLink {
  ids: string[];
  /** The friend's total, or null when the link had none or an invalid one. */
  score: number | null;
  /** The friend's name, or null when the link had none or an invalid one. */
  name: string | null;
  /** The deck hash the friend played, or null for a link without one. */
  hash: string | null;
  /** The rules version the friend played under, or null for a link without one (older links). */
  rules: string | null;
}

/**
 * The friend's score to beat, or null with the reason it cannot be compared:
 * the link was made under other rules (or carries none), or the deck's
 * answers changed since. A link without a score has nothing to compare.
 */
export function scoreToBeat(link: ChallengeLink, liveHash: string | null, rules: string = RULES_VERSION): { score: number | null; rulesChanged: boolean; answersChanged: boolean } {
  if (link.score === null) return { score: null, rulesChanged: false, answersChanged: false };
  const rulesChanged = link.rules !== rules;
  const answersChanged = link.hash !== null && link.hash !== liveHash;
  return { score: rulesChanged || answersChanged ? null : link.score, rulesChanged, answersChanged };
}

export type ParsedChallenge = { kind: 'none' } | { kind: 'broken' } | { kind: 'ok'; link: ChallengeLink };

export function parseChallenge(params: URLSearchParams, known: (id: string) => boolean): ParsedChallenge {
  const d = params.get('d');
  if (d === null) return { kind: 'none' };
  const ids = d.split('.');
  if (ids.length !== DECK.size || new Set(ids).size !== ids.length || !ids.every((id) => ID.test(id) && known(id))) {
    return { kind: 'broken' };
  }
  const s = params.get('s') ?? '';
  const score = /^[0-9]{1,5}$/.test(s) && Number(s) <= MAX_TOTAL ? Number(s) : null;
  const n = params.get('n');
  const name = n === null ? null : cleanName(n);
  const h = params.get('h') ?? '';
  const r = params.get('r') ?? '';
  return { kind: 'ok', link: { ids, score, name, hash: HASH.test(h) ? h : null, rules: RULES.test(r) ? r : null } };
}

export type ShareMedium = 'native' | 'whatsapp' | 'x' | 'copy' | 'manual';
export type ShareKind = 'challenge' | 'reply';

const UTM = ['utm_source', 'utm_medium', 'utm_campaign'] as const;

/**
 * A challenge link for this deck and score, under this page's rules version,
 * tagged for the share channel. Test, fixture and clock switches on the base
 * address are dropped (N11), as are any older challenge or campaign values.
 */
export function challengeUrl(base: string, link: { ids: readonly string[]; score: number; name: string | null; hash: string }, medium: ShareMedium, kind: ShareKind): string {
  const url = new URL(base);
  for (const p of [...SHARE_DROPPED, ...CHALLENGE_PARAMS, ...UTM]) url.searchParams.delete(p);
  const q = new URLSearchParams(url.searchParams);
  q.set('d', link.ids.join('.'));
  q.set('s', String(link.score));
  if (link.name) q.set('n', link.name);
  q.set('h', link.hash);
  q.set('r', RULES_VERSION);
  q.set('utm_source', 'share');
  q.set('utm_medium', medium === 'manual' ? 'copy' : medium);
  q.set('utm_campaign', kind);
  url.search = q.toString();
  return url.toString();
}
