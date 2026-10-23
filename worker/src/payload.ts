// POST step 1 (W6, ENG1; V12-83, V12-06): read at most 4096 streamed bytes,
// then check the request's exact shape with plain guards (no runtime code
// evaluation, V12-129). Unknown fields are refused rather than hashed. A
// timed-out question must carry a null answer; a question that was neither
// skipped nor timed out must carry one (V12-89).

import { canonicalPayload } from '../../src/api/canonical.ts';
import { PAYLOAD_FIELDS, type Answers, type Point, type ScorePayload, type Ten, type Timeout, type Week } from '../../src/api/contract.ts';
import { sha256Hex } from '../../src/api/hash.ts';
import { weekStart } from '../../src/api/week.ts';
import { isAnswerYear } from '../../src/scoring/years.ts';

export const GAME_ID = /^[A-Za-z0-9_-]{21}[AQgw]$/;
const ITEM_ID = /^\d{2,3}$/;
const DECK_HASH = /^[0-9a-f]{8}$/;
const DECK_KINDS = new Set(['random', 'challenge', 'replay']);
const QUESTIONS = ['made', 'when', 'kept'] as const;

/** The body text, or 'too_large' once more than `max` bytes arrive (the stream is cancelled). */
export async function readBody(request: Request, max: number): Promise<string | 'too_large'> {
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > max) return 'too_large';
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return 'too_large';
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(all);
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const exactKeys = (v: Record<string, unknown>, keys: readonly string[]) => {
  const own = Object.keys(v);
  return own.length === keys.length && keys.every((k) => Object.hasOwn(v, k));
};
const ten = (v: unknown): v is unknown[] => Array.isArray(v) && v.length === 10;
const positiveInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;

function point(v: unknown): Point | null | undefined {
  if (v === null) return null;
  if (!isObject(v) || !exactKeys(v, ['lat', 'lng'])) return undefined;
  const { lat, lng } = v;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return undefined;
  return { lat, lng };
}

function answers(v: unknown): Answers | undefined {
  if (!isObject(v) || !exactKeys(v, QUESTIONS)) return undefined;
  const made = point(v.made);
  const kept = point(v.kept);
  const when = v.when;
  if (made === undefined || kept === undefined) return undefined;
  if (when !== null && !isAnswerYear(when)) return undefined;
  return { made, when: when as number | null, kept };
}

function timeout(v: unknown): Timeout | undefined {
  if (!isObject(v) || !exactKeys(v, QUESTIONS)) return undefined;
  if (QUESTIONS.some((q) => typeof v[q] !== 'boolean')) return undefined;
  return { made: v.made as boolean, when: v.when as boolean, kept: v.kept as boolean };
}

/** An ISO week the server can have issued, checked at runtime (year boundaries included). */
export const isWeek = (v: unknown): v is Week => typeof v === 'string' && Number.isFinite(weekStart(v));

export interface ScoreRequestParts {
  payload: ScorePayload;
  token: string;
}

/** The validated request, or null for anything malformed (`invalid`). */
export function parseScoreRequest(value: unknown): ScoreRequestParts | null {
  if (!isObject(value) || !exactKeys(value, [...PAYLOAD_FIELDS, 'turnstile_token'])) return null;
  const v = value;
  if (typeof v.game_id !== 'string' || !GAME_ID.test(v.game_id)) return null;
  if (typeof v.deck_kind !== 'string' || !DECK_KINDS.has(v.deck_kind)) return null;
  if (typeof v.fresh !== 'boolean' || typeof v.test_assisted !== 'boolean') return null;
  if (typeof v.deck_hash !== 'string' || !DECK_HASH.test(v.deck_hash)) return null;
  if (!ten(v.answers_revs) || !v.answers_revs.every(positiveInt)) return null;
  if (!positiveInt(v.scoring_version) || !positiveInt(v.client_version)) return null;
  if (!ten(v.item_ids) || !v.item_ids.every((id) => typeof id === 'string' && ITEM_ID.test(id))) return null;
  if (new Set(v.item_ids).size !== 10) return null;
  if (!ten(v.answers) || !ten(v.skipped) || !ten(v.timed_out)) return null;
  const list = v.answers.map(answers);
  const outs = v.timed_out.map(timeout);
  if (list.some((a) => a === undefined) || outs.some((t) => t === undefined)) return null;
  if (!v.skipped.every((s) => typeof s === 'boolean')) return null;
  for (let i = 0; i < 10; i++) {
    const a = list[i]!;
    const t = outs[i]!;
    for (const q of QUESTIONS) {
      if (t[q] && a[q] !== null) return null;
      if (!v.skipped[i] && !t[q] && a[q] === null) return null;
    }
  }
  if (v.board_week !== null && !isWeek(v.board_week)) return null;
  if (typeof v.turnstile_token !== 'string' || v.turnstile_token.length < 1 || v.turnstile_token.length > 2048) return null;
  const payload: ScorePayload = {
    game_id: v.game_id,
    deck_kind: v.deck_kind as ScorePayload['deck_kind'],
    fresh: v.fresh,
    deck_hash: v.deck_hash,
    answers_revs: v.answers_revs as unknown as Ten<number>,
    scoring_version: v.scoring_version,
    item_ids: v.item_ids as unknown as Ten<string>,
    answers: list as unknown as Ten<Answers>,
    skipped: v.skipped as unknown as Ten<boolean>,
    timed_out: outs as unknown as Ten<Timeout>,
    board_week: v.board_week as Week | null,
    client_version: v.client_version,
    test_assisted: v.test_assisted,
  };
  return { payload, token: v.turnstile_token };
}

/** sha256 of the canonical payload text (the turnstile token is not part of it). */
export const payloadHash = (p: ScorePayload): Promise<string> => sha256Hex(canonicalPayload(p));
