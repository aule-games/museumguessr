// Challenge links (V1-16): `?d=<10 ids joined by .>&s=<score>&n=<name>&h=<deck hash>`.
// The ids replay the same 10 objects even after the pool grows; `h` tells the
// receiver whether those objects' answers changed since the link was made,
// in which case the scores are not compared. The screen never claims the
// score was checked: anyone can edit a link.

import { DECK } from '../deck/config.ts';
import { cleanName } from '../game/names.ts';
import { MAX_POINTS } from '../scoring/config.ts';

export const CHALLENGE_PARAMS = ['d', 's', 'n', 'h'] as const;
const ID = /^[0-9]{2,3}$/;
const HASH = /^[0-9a-f]{8}$/;
const MAX_TOTAL = MAX_POINTS * 3 * DECK.size;

export interface ChallengeLink {
  ids: string[];
  /** The friend's total, or null when the link had none or an invalid one. */
  score: number | null;
  /** The friend's name, or null when the link had none or an invalid one. */
  name: string | null;
  /** The deck hash the friend played, or null for a link without one. */
  hash: string | null;
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
  return { kind: 'ok', link: { ids, score, name, hash: HASH.test(h) ? h : null } };
}

export type ShareMedium = 'native' | 'whatsapp' | 'x' | 'copy' | 'manual';
export type ShareKind = 'challenge' | 'reply';

/** A challenge link for this deck and score, tagged for the share channel. */
export function challengeUrl(base: string, link: { ids: readonly string[]; score: number; name: string | null; hash: string }, medium: ShareMedium, kind: ShareKind): string {
  const q = new URLSearchParams({ d: link.ids.join('.'), s: String(link.score) });
  if (link.name) q.set('n', link.name);
  q.set('h', link.hash);
  q.set('utm_source', 'share');
  q.set('utm_medium', medium === 'manual' ? 'copy' : medium);
  q.set('utm_campaign', kind);
  return `${base}?${q.toString()}`;
}
