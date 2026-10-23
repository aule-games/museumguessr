// A best's current standing within a bounded read (ENG18; V12-101, V12-98).
// Exact from the public top 50 when the row is listed or tied with the
// 50th; otherwise from the bucket counts on the shorter side of the row's
// bucket plus a capped scan inside that bucket. When the scan is capped the
// standing is a top-half percentile (computed from the worst rank the
// counts allow) or the distance to the top 50, never a made-up exact rank.

import type { Standing, Week } from '../../src/api/contract.ts';
import { LIMITS } from '../../src/api/limits.ts';
import { ALL_BUCKETS, bucketOf, bucketWidth } from './buckets.ts';
import type { D1Database } from './platform.ts';
import type { Projection } from './projection.ts';

/** Bucket rows read at most: the shorter side of 161 buckets, plus the row's own bucket. */
export const MAX_BUCKET_ROWS = Math.ceil((ALL_BUCKETS.length - 1) / 2) + 1;

export interface RankedRow {
  row_id: string;
  total: number;
  hidden: number;
}

const tiedSql = 'SELECT COUNT(*) AS n FROM (SELECT 1 FROM scores WHERE week = ?1 AND hidden = 0 AND total = ?2 LIMIT 2)';

async function hasTie(db: D1Database, week: Week, total: number): Promise<boolean> {
  const r = await db.prepare(tiedSql).bind(week, total).first<{ n: number }>();
  return (r?.n ?? 0) > 1;
}

/**
 * The standing of a visible best this week. `scanRows` is what is left of
 * the read budget for rows inside the best's own bucket.
 */
export async function standingOf(db: D1Database, p: Projection, best: RankedRow, scanRows: number): Promise<Standing | null> {
  if (best.hidden) return null;
  const top = LIMITS.boardTop;
  const listed = p.rows.find((r) => r.row_id === best.row_id);
  if (listed) {
    const tied = p.rows.some((r) => r.row_id !== best.row_id && r.total === best.total) || (p.n > p.rows.length && best.total === p.cutoff && (await hasTie(db, p.week, best.total)));
    return { kind: 'exact', rank: listed.rank, tied };
  }
  if (p.cutoff !== null && best.total >= p.cutoff && p.rows.length >= top) {
    // Tied with the 50th listed total, outside the listed rows: the same rank.
    const rank = p.rows.find((r) => r.total === best.total)?.rank ?? p.rows[top - 1]!.rank;
    return { kind: 'exact', rank, tied: true };
  }
  if (p.n === 0) return null;

  // Bucket counts on the side with fewer possible buckets.
  const own = bucketOf(best.total);
  const above = ALL_BUCKETS.filter((b) => b > own).length;
  const readAbove = above < ALL_BUCKETS.length - 1 - above;
  const rows = await db
    .prepare(readAbove
      ? 'SELECT bucket, n FROM score_buckets WHERE week = ?1 AND bucket >= ?2 ORDER BY bucket LIMIT ?3'
      : 'SELECT bucket, n FROM score_buckets WHERE week = ?1 AND bucket <= ?2 ORDER BY bucket DESC LIMIT ?3')
    .bind(p.week, own, MAX_BUCKET_ROWS)
    .all<{ bucket: number; n: number }>();
  const inOwn = rows.results.find((r) => r.bucket === own)?.n ?? 0;
  const side = rows.results.reduce((s, r) => s + (r.bucket === own ? 0 : r.n), 0);
  const aboveBuckets = readAbove ? side : p.n - side - inOwn;

  // Rows of the own bucket with a higher total, capped.
  const cap = Math.max(0, scanRows);
  const scan = cap
    ? await db
        .prepare('SELECT COUNT(*) AS n FROM (SELECT 1 FROM scores WHERE week = ?1 AND hidden = 0 AND total > ?2 AND total < ?3 LIMIT ?4)')
        .bind(p.week, best.total, own + bucketWidth(best.total), cap)
        .first<{ n: number }>()
    : { n: 0 };
  const higherInOwn = scan?.n ?? 0;
  if (cap && higherInOwn < cap) {
    const rank = aboveBuckets + higherInOwn + 1;
    return { kind: 'exact', rank, tied: await hasTie(db, p.week, best.total) };
  }
  const worst = aboveBuckets + Math.max(inOwn, 1);
  const topPercent = Math.max(1, Math.ceil((100 * worst) / p.n));
  if (topPercent <= 50) return { kind: 'percentile', top_percent: topPercent };
  return p.cutoff !== null ? { kind: 'distance', points_to_top_50: Math.max(1, p.cutoff - best.total) } : null;
}
