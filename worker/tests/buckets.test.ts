import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_BUCKETS, bucketOf, bucketSql, bucketWidth } from '../src/buckets';
import { MIGRATIONS, sqliteD1 } from './helpers/sqlite-d1';

const W = '2026-W43';

/** Bucket counts from the trigger-kept table and from a full recount of visible rows. */
export function bucketDrift(raw: ReturnType<typeof sqliteD1>['raw'], week = W) {
  const kept = raw.prepare('SELECT bucket, n FROM score_buckets WHERE week = ? ORDER BY bucket').all(week).map((r) => [r.bucket, r.n]);
  const recount = raw.prepare(`SELECT ${bucketSql('total')} AS bucket, COUNT(*) AS n FROM scores WHERE week = ? AND hidden = 0 GROUP BY 1 ORDER BY 1`).all(week).map((r) => [r.bucket, r.n]);
  const n = raw.prepare('SELECT n FROM board_weeks WHERE week = ?').get(week)?.n ?? 0;
  const visible = raw.prepare('SELECT COUNT(*) AS n FROM scores WHERE week = ? AND hidden = 0').get(week)!.n;
  return { kept, recount, n, visible };
}

describe('score buckets', () => {
  it('the TypeScript and SQL bucket functions agree for every total from 0 to 30000: 500 wide below 25000, 100 up to 28000, 25 above [V12-102]', () => {
    const db = sqliteD1();
    const rows = db.raw
      .prepare(`WITH RECURSIVE t(x) AS (SELECT 0 UNION ALL SELECT x + 1 FROM t WHERE x < 30000) SELECT x, ${bucketSql('x')} AS b FROM t`)
      .all() as { x: number; b: number }[];
    expect(rows).toHaveLength(30001);
    for (const { x, b } of rows) if (b !== bucketOf(x)) throw new Error(`total ${x}: SQL ${b}, TypeScript ${bucketOf(x)}`);
    expect([bucketOf(24999), bucketOf(25000), bucketOf(27999), bucketOf(28000), bucketOf(28024), bucketOf(30000)]).toEqual([24500, 25000, 27900, 28000, 28000, 30000]);
    expect([bucketWidth(0), bucketWidth(25000), bucketWidth(28000)]).toEqual([500, 100, 25]);
    expect(ALL_BUCKETS).toHaveLength(161);
    // The migration's triggers use the same expression, written out.
    const migration = readFileSync(join(MIGRATIONS, '0001_board.sql'), 'utf8');
    for (const v of ['NEW.total', 'OLD.total']) expect(migration).toContain(bucketSql(v).slice(1, -1));
  });

  it('the triggers keep visible-score buckets and the week count equal to a full recount through inserts, replacements, hides, unhides and deletes [V12-102]', () => {
    const db = sqliteD1();
    const raw = db.raw;
    raw.prepare("INSERT INTO board_weeks (week, updated_at) VALUES (?, 'x')").run(W);
    const ins = raw.prepare("INSERT INTO scores (week, player_hash, row_id, name, game_id, payload_sha256, total, points, item_ids, deck_kind, fresh, hidden, seq, created_at) VALUES (?, ?, ?, 'n', ?, 'h', ?, '[]', '[]', 'random', 1, ?, ?, 'x')");
    let seed = 7;
    const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % n;
    for (let i = 0; i < 400; i++) ins.run(W, `p${i}`, `r${i}`, `g${i}`, rnd(30001), rnd(10) === 0 ? 1 : 0, i);
    expect(bucketDrift(db.raw).kept).toEqual(bucketDrift(db.raw).recount);
    for (let i = 0; i < 400; i += 3) raw.prepare('UPDATE scores SET total = ?, seq = ? WHERE row_id = ?').run(rnd(30001), 1000 + i, `r${i}`);
    for (let i = 0; i < 400; i += 5) raw.prepare('UPDATE scores SET hidden = 1 - hidden WHERE row_id = ?').run(`r${i}`);
    for (let i = 0; i < 400; i += 7) raw.prepare('DELETE FROM scores WHERE row_id = ?').run(`r${i}`);
    const d = bucketDrift(db.raw);
    expect(d.kept).toEqual(d.recount);
    expect(d.n).toBe(d.visible);
    expect(raw.prepare('SELECT COUNT(*) AS n FROM score_buckets WHERE n <= 0').get()!.n).toBe(0);
    expect(raw.prepare('SELECT seq FROM board_weeks WHERE week = ?').get(W)!.seq).toBe(1399);
  });

  it('a purged week (no board_weeks row) skips per-row bucket upkeep [V12-107]', () => {
    const db = sqliteD1();
    const raw = db.raw;
    raw.prepare("INSERT INTO scores (week, player_hash, row_id, name, game_id, payload_sha256, total, points, item_ids, deck_kind, fresh, hidden, seq, created_at) VALUES (?, 'p', 'r', 'n', 'g', 'h', 100, '[]', '[]', 'random', 1, 0, 1, 'x')").run('2026-W30');
    raw.prepare('DELETE FROM scores WHERE week = ?').run('2026-W30');
    expect(raw.prepare('SELECT COUNT(*) AS n FROM score_buckets').get()!.n).toBe(0);
  });
});
