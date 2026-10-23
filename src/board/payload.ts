// Who ranks and what is sent (W6, G1, ENG5, N4; V12-80, V12-89, V12-108).
// A finished random or challenge game ranks; a replay, a challenge whose ten
// objects this device had all seen before, and a test-assisted game do not.
// The payload is the contract's canonical score payload, built from the
// finished game in the contract's field order: no name, no client total, no
// seconds, no deadline and no completion time ever leave the page.

import { CONTRACT_VERSION, PAYLOAD_FIELDS, type Answers, type Point, type ScorePayload, type Ten, type Timeout, type Week } from '../api/contract.ts';
import { STEPS } from '../analytics/events.ts';
import { normalizeAnswerYear } from '../scoring/years.ts';
import type { DeckKind, RoundAnswers, RoundResult, TimeUp } from '../state/schema.ts';
import { isWeek } from './client.ts';

/** The fields of a finished game the board needs; a finished GameState is one. */
export interface FinishedGame {
  game_id: string;
  game_ref: string;
  src: string;
  deck_kind: DeckKind;
  fresh: boolean;
  first_seen: readonly boolean[];
  deck_hash: string;
  scoring_version: number;
  item_ids: readonly string[];
  answers: readonly RoundAnswers[];
  results: readonly (RoundResult | null)[];
  timed_out: readonly (TimeUp | null)[];
  board_week: string | null;
  test_assisted: boolean;
}

export type Eligibility = 'ok' | 'replay' | 'seen' | 'test';

/** A challenge whose ten objects this device had all seen before ranks like a replay (W6). */
export const allSeen = (g: Pick<FinishedGame, 'deck_kind' | 'first_seen'>) => g.deck_kind === 'challenge' && g.first_seen.length > 0 && g.first_seen.every((f) => !f);

/** Whether a finished game may rank; test provenance wins whatever the current test flag (ENG5). */
export function eligibility(g: Pick<FinishedGame, 'deck_kind' | 'first_seen' | 'test_assisted'>): Eligibility {
  if (g.test_assisted) return 'test';
  if (g.deck_kind === 'replay') return 'replay';
  if (allSeen(g)) return 'seen';
  return 'ok';
}

/** A pin as the contract stores it: latitude bounded, longitude wrapped into -180..180, lat before lng. */
export function point(p: { lat: number; lng: number } | null | undefined): Point | null {
  if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return null;
  const lat = Math.max(-90, Math.min(90, p.lat));
  let lng = ((((p.lng + 180) % 360) + 360) % 360) - 180;
  if (lng === -180 && p.lng > 0) lng = 180;
  return { lat, lng };
}

const ten = <T>(list: T[]): Ten<T> => {
  if (list.length !== 10) throw new Error('a board payload needs exactly ten rounds');
  return list as unknown as Ten<T>;
};

/**
 * The canonical score payload of a finished game (docs/api.md). `revs` are the
 * ten objects' answer revisions in deck order. A timed-out question carries a
 * null answer; a skipped round keeps its flag and scores zero on the server.
 */
export function scorePayload(g: FinishedGame, revs: readonly number[]): ScorePayload {
  const timeouts = g.item_ids.map((_, i) => {
    const out = new Set(g.timed_out[i]?.questions ?? []);
    return Object.fromEntries(STEPS.map((s) => [s, out.has(s)])) as unknown as Timeout;
  });
  const answers = g.item_ids.map((_, i): Answers => {
    const a = g.answers[i];
    const t = timeouts[i]!;
    return {
      made: t.made ? null : point(a?.made),
      when: t.when ? null : normalizeAnswerYear(a?.when ?? null),
      kept: t.kept ? null : point(a?.kept),
    };
  });
  const payload: ScorePayload = {
    game_id: g.game_id,
    // an all-seen challenge is declared as a replay (W6)
    deck_kind: allSeen(g) ? 'replay' : g.deck_kind,
    fresh: g.fresh,
    deck_hash: g.deck_hash,
    answers_revs: ten(revs.map((r) => (Number.isInteger(r) && r > 0 ? r : 1))),
    scoring_version: g.scoring_version,
    item_ids: ten([...g.item_ids]),
    answers: ten(answers),
    skipped: ten(g.item_ids.map((_, i) => g.results[i]?.skipped === true)),
    timed_out: ten(timeouts),
    board_week: isWeek(g.board_week) ? (g.board_week as Week) : null,
    client_version: CONTRACT_VERSION,
    test_assisted: g.test_assisted,
  };
  // the contract's field order (PAYLOAD_FIELDS) is the serialization order
  return Object.fromEntries(PAYLOAD_FIELDS.map((k) => [k, payload[k]])) as unknown as ScorePayload;
}

/** A stored payload read back from the device: the same fields, or null. */
export function isPayload(v: unknown): v is ScorePayload {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  const keys = Object.keys(p);
  return (
    keys.length === PAYLOAD_FIELDS.length &&
    PAYLOAD_FIELDS.every((k) => k in p) &&
    typeof p.game_id === 'string' &&
    Array.isArray(p.item_ids) &&
    p.item_ids.length === 10 &&
    Array.isArray(p.answers) &&
    p.answers.length === 10 &&
    (p.board_week === null || isWeek(p.board_week)) &&
    typeof p.test_assisted === 'boolean'
  );
}
