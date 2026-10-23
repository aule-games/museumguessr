// The cron run (N2; V12-107). Every hour, except within two hours of the
// Monday 00:00 UTC reset, it deletes a bounded chunk of each table's rows
// older than the eight retained weeks, so a large week goes over several
// runs. The week's board_weeks row and its buckets go first, in one
// statement each, so the score triggers skip per-row bucket upkeep for the
// rest. It also writes final ranks once for each closed week's listed 50.

import type { Week } from '../../src/api/contract.ts';
import { LIMITS } from '../../src/api/limits.ts';
import { weekStart } from '../../src/api/week.ts';
import { store } from './errors.ts';
import type { Ctx } from './platform.ts';
import { currentWeek, msToReset, oldestRetained } from './weeks.ts';

const HOUR = 3_600_000;

/** True within the quiet hours on either side of the weekly reset. */
export function nearReset(now: number): boolean {
  const quiet = LIMITS.purgeQuietHours * HOUR;
  return msToReset(now) < quiet || now - weekStart(currentWeek(now)) < quiet;
}

const CHUNK = (table: string, key: string) => `DELETE FROM ${table} WHERE (${key}) IN (SELECT ${key} FROM ${table} WHERE week < ?1 LIMIT ?2)`;

export const PURGE_TABLES = [
  ['scores', 'week, player_hash'],
  ['receipts', 'game_id'],
  ['tombstones', 'week, player_hash, smoke'],
  ['smoke_scores', 'week, player_hash'],
  ['moderation', 'id'],
] as const;

export interface PurgeReport {
  skipped: boolean;
  deleted: Record<string, number>;
  rowsWritten: number;
  closed: Week[];
}

export async function purge(ctx: Ctx): Promise<PurgeReport> {
  const now = ctx.now();
  const report: PurgeReport = { skipped: false, deleted: {}, rowsWritten: 0, closed: [] };
  if (nearReset(now)) return { ...report, skipped: true };
  const db = store(ctx);
  const oldest = oldestRetained(now);
  const statements = [
    db.prepare('DELETE FROM board_weeks WHERE week < ?1').bind(oldest),
    db.prepare('DELETE FROM score_buckets WHERE week < ?1').bind(oldest),
    ...PURGE_TABLES.map(([table, key]) => db.prepare(CHUNK(table, key)).bind(oldest, LIMITS.purgeChunkRows)),
  ];
  const results = await db.batch(statements);
  const names = ['board_weeks', 'score_buckets', ...PURGE_TABLES.map(([t]) => t)];
  results.forEach((r, i) => {
    report.deleted[names[i]!] = r.meta.changes;
    report.rowsWritten += r.meta.rows_written ?? 0;
  });

  // Final ranks of closed weeks: the listed rows of the frozen projection, once.
  const open = await db
    .prepare('SELECT week FROM board_weeks WHERE closed = 0 AND week < ?1 AND week >= ?2')
    .bind(currentWeek(now), oldest)
    .all<{ week: Week }>();
  for (const { week } of open.results) {
    const done = await db.batch([
      db
        .prepare(`UPDATE scores SET final_rank = (SELECT j.value ->> 'rank' FROM board_weeks w, json_each(w.top_json) j WHERE w.week = scores.week AND j.value ->> 'row_id' = scores.row_id)
WHERE week = ?1 AND hidden = 0 AND row_id IN (SELECT j.value ->> 'row_id' FROM board_weeks w, json_each(w.top_json) j WHERE w.week = ?1)`)
        .bind(week),
      db.prepare('UPDATE board_weeks SET closed = 1 WHERE week = ?1').bind(week),
    ]);
    report.rowsWritten += done.reduce((s, r) => s + (r.meta.rows_written ?? 0), 0);
    report.closed.push(week);
  }
  return report;
}
