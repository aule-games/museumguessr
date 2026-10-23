// Bundled answer keys and their revisions (V1-answers-rev, ENG10; V12-88,
// V12-89, V12-137). The Worker scores with the same keys and the same
// shared scoring module as the page. A submission names each object's
// answer revision: lower than the server's, or a retired object, means the
// page is out of date (update_page); higher, or an object this Worker does
// not know, means the Worker is behind (try_later); equal rescoring goes on.

import items from '../../data/items.json';
import retired from '../../data/retired.json';
import type { CoreItem } from '../../src/content/core.ts';
import { answersRev } from '../../src/content/revs.ts';
import { answerKey, scoreRound, skippedRound, type AnswerKey } from '../../src/scoring/game.ts';
import type { ScorePayload } from '../../src/api/contract.ts';

interface Entry {
  key: AnswerKey;
  rev: number;
}

type Record = CoreItem & { answers_rev?: number };

export function answerTable(records: readonly Record[]): ReadonlyMap<string, Entry> {
  return new Map(records.map((it) => [it.id, { key: answerKey(it), rev: answersRev(it) }]));
}

const POOL = answerTable((items as unknown as { items: Record[] }).items);

interface RetiredEntry {
  id: string;
  retired: string;
  key?: Record;
}
const RETIRED_ENTRIES = (retired as { ids: RetiredEntry[] }).ids;
const RETIRED: ReadonlySet<string> = new Set(RETIRED_ENTRIES.map((r) => r.id));

/** Days a retired object's answer key stays in the Worker, for diagnostics only. */
export const RETIRED_KEY_DAYS = 14;

/**
 * A retired object's answer key while it is under 14 days retired (null
 * after, or without a recorded key). Only for diagnostics: a submission that
 * names a retired id is refused with update_page whatever this returns.
 */
export function retiredKey(id: string, now: number, entries: readonly RetiredEntry[] = RETIRED_ENTRIES): Entry | null {
  const e = entries.find((r) => r.id === id);
  if (!e?.key) return null;
  const age = now - Date.parse(`${e.retired}T00:00:00Z`);
  return age >= 0 && age < RETIRED_KEY_DAYS * 86_400_000 ? { key: answerKey(e.key), rev: answersRev(e.key) } : null;
}

export type RevisionCheck = 'ok' | 'update_page' | 'try_later';

export function checkRevisions(
  ids: readonly string[],
  revs: readonly number[],
  pool: ReadonlyMap<string, Entry> = POOL,
  gone: ReadonlySet<string> = RETIRED,
): RevisionCheck {
  let later = false;
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    const entry = pool.get(id);
    if (gone.has(id) && !entry) return 'update_page';
    if (!entry) {
      later = true;
      continue;
    }
    if (revs[i]! < entry.rev) return 'update_page';
    if (revs[i]! > entry.rev) later = true;
  }
  return later ? 'try_later' : 'ok';
}

/**
 * Rescore a validated payload: client totals are never trusted; a skipped
 * round and a timed-out question score 0 (V12-89). Throws for an id the
 * revision check has not passed.
 */
export function rescore(p: ScorePayload, pool: ReadonlyMap<string, Entry> = POOL): { total: number; points: number[] } {
  const points = p.item_ids.map((id, i) => {
    const entry = pool.get(id);
    if (!entry) throw new Error('rescore: unknown item');
    if (p.skipped[i]) return skippedRound().points;
    const a = p.answers[i]!;
    const t = p.timed_out[i]!;
    return scoreRound({ made: t.made ? null : a.made, when: t.when ? null : a.when, kept: t.kept ? null : a.kept }, entry.key).points;
  });
  return { total: points.reduce((s, n) => s + n, 0), points };
}
