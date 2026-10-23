// The materialized public top 50 (ENG2; V12-99, V12-100). Each week's row
// in board_weeks holds the visible device count (kept by triggers) and the
// top-50 JSON, rebuilt in the same transactional batch as every change that
// can move it. A cache miss reads that one row. Only this public projection
// ever enters caches.default, keyed by week and mode, for at most 60
// seconds and never past Monday 00:00 UTC.

import type { BoardMode, PublicBoard, PublicRow, Week } from '../../src/api/contract.ts';
import { LIMITS } from '../../src/api/limits.ts';
import { bucketEndSql, bucketSql } from './buckets.ts';
import type { BoardCache, Ctx, D1Database, D1PreparedStatement } from './platform.ts';
import { msToReset, resetsAt } from './weeks.ts';

export interface Projection {
  week: Week;
  n: number;
  rows: PublicRow[];
  cutoff: number | null;
  updated_at: string;
}

interface WeekRow {
  n: number;
  top_json: string;
  cutoff_total: number | null;
  updated_at: string;
}

const TOP = LIMITS.boardTop;

/** The week's projection from its one board_weeks row (an empty board when there is none). */
export async function readProjection(db: D1Database, week: Week, now: number): Promise<Projection> {
  const row = await db.prepare('SELECT n, top_json, cutoff_total, updated_at FROM board_weeks WHERE week = ?1').bind(week).first<WeekRow>();
  if (!row) return { week, n: 0, rows: [], cutoff: null, updated_at: new Date(now).toISOString() };
  return { week, n: row.n, rows: JSON.parse(row.top_json) as PublicRow[], cutoff: row.cutoff_total, updated_at: row.updated_at };
}

export const publicBoard = (p: Projection): PublicBoard => ({
  week: p.week,
  resets_at: resetsAt(p.week),
  count: p.n,
  cutoff_total: p.cutoff,
  rows: p.rows,
  updated_at: p.updated_at,
});

/**
 * The rebuild statement: the first 50 visible rows by total, then earlier
 * submission; equal totals share a rank (RANK over the 50, which hold every
 * higher total). `condition` is extra SQL that must hold (bound by the
 * caller from ?3 on); the projection then refreshes the cutoff.
 */
export function rebuildSql(condition = 'TRUE'): string {
  return `UPDATE board_weeks SET
  top_json = (SELECT COALESCE(json_group_array(json_object('row_id', row_id, 'name', name, 'total', total, 'rank', rnk, 'date', substr(created_at, 1, 10)) ORDER BY total DESC, seq), '[]')
    FROM (SELECT row_id, name, total, seq, created_at, RANK() OVER (ORDER BY total DESC) AS rnk
      FROM (SELECT row_id, name, total, seq, created_at FROM scores WHERE week = ?1 AND hidden = 0 ORDER BY total DESC, seq LIMIT ${TOP}))),
  updated_at = ?2
WHERE week = ?1 AND (${condition})`;
}

/** Sets the cutoff (the 50th listed total, null below 50 rows) from the rebuilt JSON. */
export const CUTOFF_SQL = `UPDATE board_weeks SET cutoff_total = CASE WHEN json_array_length(top_json) >= ${TOP} THEN json_extract(top_json, '$[${TOP - 1}].total') END WHERE week = ?1`;

/** Unconditional rebuild of one week (delete, hide, unhide). */
export function rebuild(db: D1Database, week: Week, nowIso: string): D1PreparedStatement[] {
  return [db.prepare(rebuildSql()).bind(week, nowIso), db.prepare(CUTOFF_SQL).bind(week)];
}

/** Exact rank of a total among a week's visible rows, as SQL over buckets and one bucket's rows (`x` is the total). */
export function exactRankSql(week: string, x: string): string {
  return `(1 + COALESCE((SELECT SUM(b.n) FROM score_buckets b WHERE b.week = ${week} AND b.bucket > ${bucketSql(x)}), 0)
    + (SELECT COUNT(*) FROM scores o WHERE o.week = ${week} AND o.hidden = 0 AND o.total > ${x} AND o.total < ${bucketEndSql(x)}))`;
}

// ----- the Cache API copy -----

const cacheKey = (origin: string, week: Week, mode: BoardMode) => `${origin}/api/v1/board/__public/${week}/${mode}`;

/** The public board for this week: the cached copy, or the projection row (then cached in the background). */
export async function cachedPublicBoard(ctx: Ctx, db: () => D1Database, origin: string, week: Week, mode: BoardMode): Promise<PublicBoard> {
  const cache = ctx.cache;
  const key = cacheKey(origin, week, mode);
  if (cache) {
    const hit = await cache.match(key).catch(() => undefined);
    if (hit) return (await hit.json()) as PublicBoard;
  }
  const board = publicBoard(await readProjection(db(), week, ctx.now()));
  const ttl = Math.min(LIMITS.publicCacheSeconds, Math.floor(msToReset(ctx.now()) / 1000));
  if (cache && ttl >= 1) {
    const copy = new Response(JSON.stringify(board), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `max-age=${ttl}` } });
    ctx.waitUntil(cache.put(key, copy).catch(() => {}));
  }
  return board;
}

/** Drops this location's cached copy of a week (delete, hide, unhide); other locations expire within 60 s. */
export async function dropCachedBoard(cache: BoardCache | null, origin: string, week: Week): Promise<void> {
  if (!cache) return;
  await Promise.all((['on', 'dark', 'off'] as const).map((m) => cache.delete(cacheKey(origin, week, m)).catch(() => false)));
}
