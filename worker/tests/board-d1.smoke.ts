// The board API on real local D1 (Miniflare through the pinned wrangler),
// run by npm run verify's Worker suite: the whole shared suite again, then
// rows read and written per endpoint on 10,000-row weeks (N1, ENG18), the
// real rate-limit binding and injected D1 limit errors (N19). The Cache API
// itself is exercised by the in-memory stand-in (getPlatformProxy's is a no-op).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { LIMITS } from '../../src/api/limits';
import { boardSuite, expectReason } from './board-suite';
import { DAY, harness, KEYS, memoryCache, W43_START } from './helpers/harness';
import { localD1, type LocalD1 } from './helpers/local-d1';

let d1: LocalD1;
beforeAll(async () => {
  d1 = await localD1();
}, 60_000);
afterAll(async () => {
  await d1?.dispose();
});

// getPlatformProxy's Cache API is a no-op, so the in-memory cache stands in for caches.default here too.
boardSuite('local D1', (c) => ({ db: d1.db, cache: memoryCache(c) }), { clockCache: true, fresh: () => d1.empty() });

const WEEK = '2026-W43';

/** 10,000 visible rows in one week, inserted in one statement (the triggers keep buckets and the count). */
async function fixture(h: ReturnType<typeof harness>, totalSql: string, week = WEEK) {
  await h.raw.prepare("INSERT INTO board_weeks (week, updated_at) VALUES (?1, '2026-10-20T08:00:00.000Z') ON CONFLICT DO NOTHING").bind(week).run();
  await h.raw
    .prepare(`WITH RECURSIVE t(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM t WHERE i < 10000)
INSERT INTO scores (week, player_hash, row_id, name, game_id, payload_sha256, total, points, item_ids, deck_kind, fresh, hidden, seq, created_at)
SELECT ?1, printf('%064d', i), printf('f%011d', i), 'Fixture Name', printf('%022d', i), 'h', ${totalSql}, '[]', '[]', 'random', 1, 0, i, '2026-10-20T08:00:00.000Z' FROM t`)
    .bind(week)
    .run();
  await h.raw.prepare('UPDATE board_weeks SET seq = 10000 WHERE week = ?1').bind(week).run();
  // Rebuild the projection once, as any accepted write would.
  const { rebuild } = await import('../src/projection');
  await h.raw.batch(rebuild(h.raw, week as never, '2026-10-20T08:00:00.000Z'));
}

/** Rows read and written by one request, without the amortized settings read. */
async function measure(h: ReturnType<typeof harness>, send: () => Promise<{ status: number; body: unknown }>) {
  h.db.reset();
  const res = await send();
  const log = h.db.log.filter((e) => !e.sql.includes('FROM settings'));
  return { res, read: log.reduce((s, e) => s + (e.meta?.rows_read ?? 0), 0), written: log.reduce((s, e) => s + (e.meta?.rows_written ?? 0), 0), statements: log.length };
}

describe('rows read and written on real D1 (N1)', () => {
  const shapes = [
    ['concentrated', '28000 + (i * 7919) % 500'],
    ['all-equal', '20000'],
  ] as const;

  for (const [shape, totalSql] of shapes) {
    it(`on a 10,000-row ${shape} week the personal read scans at most 100 rows, a cache miss 1, a not-best POST about 2 and writes nothing [V12-101] [V12-130] [V12-100]`, async () => {
      await d1.empty();
      const h = harness((c) => ({ db: d1.db, cache: memoryCache(c) }));
      await h.setMode('on');
      await fixture(h, totalSql);
      const added = await measure(h, () => h.post(KEYS[0], h.payload(28000)));
      expect(added.res.status).toBe(201);
      const notBest = await measure(h, () => h.post(KEYS[0], h.payload(27000)));
      expectReason(notBest.res as never, 'not_best');
      const miss = await measure(h, () => h.board());
      const warm = await measure(h, () => h.board());
      const personal = await measure(h, () => h.board(KEYS[0]));
      const receipt = await measure(h, () => h.receipt(KEYS[0], (added.res.body as { receipt: { row_id: string } }).receipt.row_id));
      const removal = await measure(h, () => h.remove(KEYS[0], (added.res.body as { receipt: { row_id: string } }).receipt.row_id));
      const table = { added, notBest, miss, warm, personal, receipt, removal };
      console.log(`rows on a ${shape} week:`, JSON.stringify(Object.fromEntries(Object.entries(table).map(([k, v]) => [k, { read: v.read, written: v.written }]))));
      expect(miss.read).toBeLessThanOrEqual(2);
      expect(warm.read).toBe(0);
      expect(notBest.written).toBe(0);
      expect(notBest.read).toBeLessThanOrEqual(3);
      expect(personal.read).toBeLessThanOrEqual(LIMITS.personalReadRows);
      expect(receipt.read).toBeLessThanOrEqual(LIMITS.personalReadRows + 1);
      expect((personal.res.body as { personal: { best: { standing: unknown } } }).personal.best.standing).not.toBeNull();
      expect(added.read).toBeLessThanOrEqual(1500);
      expect(added.written).toBeLessThanOrEqual(20);
    }, 60_000);
  }

  it('standing on large weeks: exact for the listed and for ties with the 50th, otherwise a top-half percentile or the points to the top 50, never a guessed rank [V12-101]', async () => {
    await d1.empty();
    const h = harness((c) => ({ db: d1.db, cache: memoryCache(c) }));
    await h.setMode('on');
    await fixture(h, '28000 + (i * 7919) % 500');
    const low = await h.post(KEYS[0], h.payload(28000));
    expect(low.body.receipt.receipt_rank).toBeGreaterThan(9000);
    const mine = (await h.board(KEYS[0])).body.personal.best.standing;
    expect(mine.kind).toBe('distance');
    expect(mine.points_to_top_50).toBeGreaterThan(0);
    const high = await h.post(KEYS[1], h.payload(29000));
    expect((await h.board(KEYS[1])).body.personal.best.standing).toEqual({ kind: 'exact', rank: 1, tied: false });
    expect(high.body.receipt.receipt_rank).toBe(1);
    await d1.empty();
    const eq = harness((c) => ({ db: d1.db, cache: memoryCache(c) }));
    await eq.setMode('on');
    await fixture(eq, '20000');
    const tie = await eq.post(KEYS[2], eq.payload(20000));
    expect(tie.body.receipt.receipt_rank).toBe(1);
    expect((await eq.board(KEYS[2])).body.personal.best.standing).toEqual({ kind: 'exact', rank: 1, tied: true });
  }, 60_000);

  it('the purge deletes a 10,000-row old week in bounded chunks over several runs, writing at most a chunk per table per run [V12-107] [V12-130]', async () => {
    await d1.empty();
    const h = harness((c) => ({ db: d1.db, cache: memoryCache(c) }), { start: W43_START + 9 * 7 * DAY + 3 * DAY });
    await h.setMode('on');
    await fixture(h, '(i * 31) % 30001', WEEK);
    const runs: { deleted: number; written: number }[] = [];
    for (let i = 0; i < 30; i++) {
      const report = (await h.scheduled())!;
      runs.push({ deleted: report.deleted.scores!, written: report.rowsWritten });
      if (!report.deleted.scores) break;
    }
    console.log('purge runs for a 10,000-row week:', JSON.stringify(runs.slice(0, 3)), `… ${runs.length} runs`);
    expect(runs.length).toBe(Math.ceil(10000 / LIMITS.purgeChunkRows) + 1);
    for (const r of runs) expect(r.deleted).toBeLessThanOrEqual(LIMITS.purgeChunkRows);
    expect(await h.q('SELECT COUNT(*) AS n FROM scores')).toEqual([{ n: 0 }]);
    expect(await h.q('SELECT COUNT(*) AS n FROM score_buckets')).toEqual([{ n: 0 }]);
  }, 120_000);
});

describe('real bindings and failures', () => {
  it('the rate-limit binding refuses the 31st request a minute from one address [V12-84]', async () => {
    await d1.empty();
    const h = harness((c) => ({ db: d1.db, cache: memoryCache(c), limiters: { IP_LIMIT: d1.ipLimit } }));
    await h.setMode('on');
    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 20}`;
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await h.board(KEYS[0], { ip })).status);
    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(statuses[30]).toBe(429);
  });

  it('a D1 limit error mid-submission answers unavailable and leaves nothing half-written, so the page keeps its pending game [V12-131] [V12-111]', async () => {
    await d1.empty();
    const h = harness((c) => ({ db: d1.db, cache: memoryCache(c) }));
    await h.setMode('on');
    const p = h.payload(20000);
    h.db.failWhen((sql) => sql.startsWith('INSERT INTO scores'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expectReason(await h.post(KEYS[0], p), 'unavailable');
    } finally {
      spy.mockRestore();
      h.db.failWhen(null);
    }
    expect(await h.q('SELECT COUNT(*) AS n FROM receipts')).toEqual([{ n: 0 }]);
    h.clock.advance(61_000);
    expect((await h.post(KEYS[0], p)).status).toBe(201);
  });
});
