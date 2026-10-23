// The board API's behaviour, written once and run on two D1 platforms:
// node:sqlite in `npm test` (worker/tests/board.test.ts) and Miniflare's real
// D1 in the Worker suite of npm run verify (worker/tests/board-d1.smoke.ts).
import { describe, expect, it, vi } from 'vitest';
import { ERRORS, type Reason } from '../../src/api/contract';
import { nameFromHash } from '../../src/board/names';
import { playerHash } from '../src/auth';
import { bucketSql } from '../src/buckets';
import { DAY, harness, type Harness, HOUR, KEYS, memoryLimiter, type PlatformParts, W43_START, type Clock } from './helpers/harness';

export interface SuiteOptions {
  /** The cache honours the test clock (true for the in-memory cache, false for Miniflare's). */
  clockCache: boolean;
  /** Runs before each test (Miniflare empties its tables). */
  fresh?: () => Promise<void>;
}

/** Status, retryability and the envelope's shape for a reason, as the contract table says. */
export function expectReason(res: { status: number; body: Record<string, unknown> }, reason: Reason) {
  expect(res.body, JSON.stringify(res.body)).toMatchObject({ reason, retryable: ERRORS[reason].retryable });
  expect(res.status).toBe(ERRORS[reason].status);
  for (const k of Object.keys(res.body)) expect(['reason', 'retryable', 'retry_after', 'request_id', 'best']).toContain(k);
}

export async function recount(h: Harness, week: string) {
  const kept = await h.q<{ bucket: number; n: number }>('SELECT bucket, n FROM score_buckets WHERE week = ?1 ORDER BY bucket', week);
  const full = await h.q<{ bucket: number; n: number }>(`SELECT ${bucketSql('total')} AS bucket, COUNT(*) AS n FROM scores WHERE week = ?1 AND hidden = 0 GROUP BY 1 ORDER BY 1`, week);
  const n = (await h.q<{ n: number }>('SELECT n FROM board_weeks WHERE week = ?1', week))[0]?.n ?? 0;
  expect(kept, 'buckets equal a full recount').toEqual(full);
  expect(n, 'the week count equals the visible rows').toBe(full.reduce((s, r) => s + r.n, 0));
}

export function boardSuite(label: string, make: (c: Clock) => PlatformParts, options: SuiteOptions) {
  const setup = async (mode: 'on' | 'dark' | 'off' | null = 'on', extra: Parameters<typeof harness>[1] = {}) => {
    await options.fresh?.();
    const h = harness(make, extra);
    if (mode) await h.setMode(mode);
    return h;
  };

  describe(`the board API (${label})`, () => {
    describe('POST /api/v1/scores', () => {
      it('a first eligible game is added: 201, a current receipt with its exact rank, and the public board lists it under the generated name [V12-80] [V12-82]', async () => {
        const h = await setup();
        const res = await h.post(KEYS[0], h.payload(20000));
        expect(res.status).toBe(201);
        expect(res.body.receipt).toMatchObject({ status: 'current', total: 20000, receipt_rank: 1, count: 1, week: h.week() });
        expect(res.body).toMatchObject({ replaced: false, smoke: false });
        expect(res.headers.get('Cache-Control')).toBe('private, no-store');
        const board = await h.board();
        expect(board.body.rows).toEqual([{ row_id: res.body.receipt.row_id, name: nameFromHash(await playerHash(KEYS[0])), total: 20000, rank: 1, date: '2026-10-21' }]);
        const stored = await h.q('SELECT player_hash FROM scores');
        expect(stored).toEqual([{ player_hash: await playerHash(KEYS[0]) }]);
        expect(JSON.stringify(await h.q('SELECT * FROM scores'))).not.toContain(KEYS[0]);
      });

      it('nothing is written to D1 for any answer before step 7: invalid, too large, rate limited, disabled, duplicate, removed, replay, update_page, try_later, week_closed and not_best [V12-83] [V12-90]', async () => {
        const h = await setup();
        const first = await h.post(KEYS[0], h.payload(20000));
        expect(first.status).toBe(201);
        const cases: [string, () => Promise<{ status: number; body: Record<string, unknown> }>, Reason][] = [
          ['malformed JSON', () => h.call('POST', '/api/v1/scores', { key: KEYS[1], raw: '{' }), 'invalid'],
          ['no key', () => h.post(null, h.payload(20000)), 'invalid'],
          ['a bad key', () => h.call('POST', '/api/v1/scores', { body: h.payload(20000), headers: { Authorization: 'Bearer nope' } }), 'invalid'],
          ['too large', () => h.call('POST', '/api/v1/scores', { key: KEYS[1], raw: `{"x":"${'a'.repeat(5000)}"}` }), 'too_large'],
          ['another device with a known game', () => h.post(KEYS[1], { ...h.payload(20000), game_id: first.body.receipt.game_id }), 'duplicate'],
          ['a replay deck', () => h.post(KEYS[1], h.payload(20000, { deck_kind: 'replay' })), 'replay'],
          ['a test game in public mode', () => h.post(KEYS[1], h.payload(20000, { test_assisted: true })), 'replay'],
          ['an older contract', () => h.post(KEYS[1], h.payload(20000, { client_version: 2 })), 'update_page'],
          ['another scoring version', () => h.post(KEYS[1], h.payload(20000, { scoring_version: 2 })), 'update_page'],
          ['a newer answer revision', () => h.post(KEYS[1], h.payload(20000, { answers_revs: [2, 1, 1, 1, 1, 1, 1, 1, 1, 1] })), 'try_later'],
          ['last week', () => h.post(KEYS[1], h.payload(20000, { board_week: '2026-W42' })), 'week_closed'],
          ['no week', () => h.post(KEYS[1], h.payload(20000, { board_week: null })), 'week_closed'],
          ['not higher than the best', () => h.post(KEYS[0], h.payload(20000)), 'not_best'],
          ['lower than the best', () => h.post(KEYS[0], h.payload(3000)), 'not_best'],
        ];
        for (const [what, send, reason] of cases) {
          h.db.reset();
          const verifies = h.siteverify.calls.length;
          const res = await send();
          expectReason(res, reason);
          expect(h.db.writes(), `${what}: D1 writes`).toBe(0);
          expect(h.siteverify.calls.length, `${what}: siteverify`).toBe(verifies);
        }
        const notBest = await h.post(KEYS[0], h.payload(5000));
        expect(notBest.body.best).toEqual({ row_id: first.body.receipt.row_id, total: 20000, standing: null });
        await h.setMode('off');
        h.db.reset();
        expectReason(await h.post(KEYS[1], h.payload(20000)), 'board_disabled');
        expect(h.db.writes()).toBe(0);
      });

      it('a known game returns its own receipt without verification or a per-key charge; a changed payload or another device gets duplicate [V12-85] [V12-96]', async () => {
        const h = await setup();
        const p = h.payload(20000);
        const first = await h.post(KEYS[0], p);
        const keyCalls = (h.limiters.KEY_LIMIT as ReturnType<typeof memoryLimiter>).calls.length;
        const verifies = h.siteverify.calls.length;
        for (let i = 0; i < 5; i++) {
          const again = await h.post(KEYS[0], { ...p, turnstile_token: `fresh-${i}` });
          expect(again.status).toBe(200);
          expect(again.body.receipt).toEqual(first.body.receipt.status === 'current' ? { ...first.body.receipt, best: { ...first.body.receipt.best, standing: null } } : first.body.receipt);
        }
        expect((h.limiters.KEY_LIMIT as ReturnType<typeof memoryLimiter>).calls.length).toBe(keyCalls);
        expect(h.siteverify.calls.length).toBe(verifies);
        expectReason(await h.post(KEYS[0], { ...p, fresh: false }), 'duplicate');
        const other = await h.post(KEYS[1], p);
        expectReason(other, 'duplicate');
        expect(JSON.stringify(other.body)).not.toContain(first.body.receipt.row_id);
      });

      it('the IP window allows 30 requests a minute, counts known retries and bearer reads, keys IPv6 by /64 and refuses before any D1 read [V12-84]', async () => {
        const h = await setup();
        const p = h.payload(20000);
        expect((await h.post(KEYS[0], p)).status).toBe(201);
        for (let i = 0; i < 28; i++) expect((await h.post(KEYS[0], p)).status).toBe(200);
        expect((await h.board(KEYS[0])).status).toBe(200);
        h.db.reset();
        const limited = await h.post(KEYS[0], p);
        expectReason(limited, 'rate_limited');
        expect(limited.body.retry_after).toBe(60);
        expect(limited.headers.get('Retry-After')).toBe('60');
        expect(h.db.log).toEqual([]);
        expectReason(await h.board(KEYS[0]), 'rate_limited');
        expect((await h.board()).status).toBe(200);
        // Another IPv4 address has its own window; addresses in one IPv6 /64 share one.
        expect((await h.post(KEYS[0], p, { ip: '198.51.100.1' })).status).toBe(200);
        for (let i = 0; i < 30; i++) expect((await h.post(KEYS[0], p, { ip: `2001:db8:1:2::${i.toString(16)}` })).status).toBe(200);
        expectReason(await h.post(KEYS[0], p, { ip: '2001:db8:1:2:ffff::1' }), 'rate_limited');
        expect((await h.post(KEYS[0], p, { ip: '2001:db8:1:3::1' })).status).toBe(200);
        h.clock.advance(61_000);
        expect((await h.post(KEYS[0], p)).status).toBe(200);
      });

      it('three new submissions per key and five new device-week rows per IP each minute, then siteverify; 30 devices behind one IP all get in through retries [V12-91]', async () => {
        const h = await setup();
        const statuses: number[] = [];
        for (const t of [10000, 11000, 12000, 13000]) statuses.push((await h.post(KEYS[0], h.payload(t))).status);
        expect(statuses).toEqual([201, 201, 201, 429]);
        h.clock.advance(61_000);
        // 30 devices on one shared address, each retrying after retry_after like the page's pending path.
        const keys = Array.from({ length: 30 }, (_, i) => `${String(i).padStart(2, '0')}AAAAAAAAAAAAAAAAAAAA`.slice(0, 21) + 'A');
        const pending = new Map(keys.map((k, i) => [k, h.payload(1000 * (i + 1))]));
        let rounds = 0;
        while (pending.size && rounds < 20) {
          rounds += 1;
          for (const [k, p] of [...pending]) {
            const res = await h.post(k, p, { ip: '192.0.2.50' });
            if (res.status === 201 || res.status === 200) pending.delete(k);
            else {
              expectReason(res, 'rate_limited');
              break;
            }
          }
          h.clock.advance(61_000);
        }
        expect(pending.size).toBe(0);
        expect((await h.board()).body.count).toBe(31);
        await recount(h, h.week());
      });

      it('siteverify must report success, this environment\'s hostname and the board action, gets the client IP, and test keys pass only where allowed [V12-92]', async () => {
        const h = await setup();
        for (const [result, reason] of [['fail', 'turnstile_failed'], ['wrong-host', 'turnstile_failed'], ['wrong-action', 'turnstile_failed'], ['test-key', 'turnstile_failed'], ['down', 'unavailable']] as const) {
          h.siteverify.result = result;
          h.db.reset();
          expectReason(await h.post(KEYS[0], h.payload(20000)), reason);
          expect(h.db.writes(), result).toBe(0);
          h.clock.advance(61_000);
        }
        h.siteverify.result = 'ok';
        expect((await h.post(KEYS[0], h.payload(20000), { ip: '198.51.100.9' })).status).toBe(201);
        const sent = h.siteverify.calls.at(-1)!;
        expect(Object.fromEntries(sent)).toEqual({ secret: 'test-secret', response: 'token', remoteip: '198.51.100.9' });
        const local = await setup('on', { env: { TURNSTILE_TEST_KEYS: '1', TURNSTILE_HOSTNAME: 'example.com' } });
        local.siteverify.result = 'test-key';
        expect((await local.post(KEYS[1], local.payload(20000))).status).toBe(201);
        const noSecret = await setup('on', { env: { TURNSTILE_SECRET: undefined } });
        expectReason(await noSecret.post(KEYS[2], noSecret.payload(20000)), 'unavailable');
      });

      it('replacing a best keeps its row id and hidden state, takes the new game and hash, resets the tie order and creation time, and marks the old receipt replaced [V12-94] [V12-95]', async () => {
        const h = await setup();
        const pa = h.payload(20000);
        const a = await h.post(KEYS[0], pa);
        await h.post(KEYS[1], h.payload(26000));
        const before = (await h.q<{ seq: number; created_at: string }>('SELECT seq, created_at FROM scores WHERE row_id = ?1', a.body.receipt.row_id))[0]!;
        await h.raw.prepare('UPDATE scores SET hidden = 1 WHERE row_id = ?1').bind(a.body.receipt.row_id).run();
        h.clock.advance(HOUR);
        const b = await h.post(KEYS[0], h.payload(26000));
        expect(b.status).toBe(201);
        expect(b.body).toMatchObject({ replaced: true, receipt: { row_id: a.body.receipt.row_id, status: 'current', total: 26000 } });
        const row = (await h.q<Record<string, unknown>>('SELECT * FROM scores WHERE row_id = ?1', a.body.receipt.row_id))[0]!;
        expect(row).toMatchObject({ hidden: 1, game_id: b.body.receipt.game_id, total: 26000 });
        expect(row.seq).toBeGreaterThan(before.seq);
        expect(row.created_at).not.toBe(before.created_at);
        expect((await h.q('SELECT game_id, status FROM receipts ORDER BY created_at, game_id'))).toEqual(expect.arrayContaining([{ game_id: a.body.receipt.game_id, status: 'replaced' }, { game_id: b.body.receipt.game_id, status: 'current' }]));
        // The old game's retry now shows it was replaced and names the current game.
        const old = await h.post(KEYS[0], pa);
        expect(old.status).toBe(200);
        expect(old.body.receipt).toMatchObject({ game_id: a.body.receipt.game_id, status: 'replaced', current_game_id: b.body.receipt.game_id, total: 20000 });
        await recount(h, h.week());
      });

      it('two submissions from one key in either order end with the higher best, consistent receipts and buckets that equal a recount [V12-93]', async () => {
        for (const order of [[20000, 25000], [25000, 20000]]) {
          const h = await setup();
          const [p1, p2] = order.map((t) => h.payload(t));
          const gate = h.db.holdNextBatch();
          const first = h.post(KEYS[0], p1!);
          await gate.reached;
          const second = await h.post(KEYS[0], p2!);
          gate.release();
          const one = await first;
          expect(second.status, `${order}: the second request runs first`).toBe(201);
          if (order[0]! < order[1]!) expectReason(one, 'not_best');
          else expect(one.status).toBe(201);
          const rows = await h.q<{ total: number; game_id: string }>('SELECT total, game_id FROM scores');
          expect(rows).toEqual([{ total: 25000, game_id: (order[0] === 25000 ? p1 : p2)!.game_id }]);
          const receipts = await h.q<{ game_id: string; status: string }>("SELECT game_id, status FROM receipts WHERE status = 'current'");
          expect(receipts).toEqual([{ game_id: (order[0] === 25000 ? p1 : p2)!.game_id, status: 'current' }]);
          await recount(h, h.week());
        }
      });

      it('a delete racing a replacement leaves the week removed, with every receipt removed, and a duplicate during a replacement returns the same receipt [V12-93] [V12-97]', async () => {
        const h = await setup();
        const a = await h.post(KEYS[0], h.payload(20000));
        // The replacement reaches its batch, the delete runs, then the replacement's batch runs.
        const gate = h.db.holdNextBatch();
        const replacement = h.post(KEYS[0], h.payload(25000));
        await gate.reached;
        expect((await h.remove(KEYS[0], a.body.receipt.row_id)).status).toBe(200);
        gate.release();
        expectReason(await replacement, 'removed');
        expect(await h.q('SELECT * FROM scores')).toEqual([]);
        expect((await h.q<{ status: string }>('SELECT status FROM receipts')).map((r) => r.status)).toEqual(['removed']);
        await recount(h, h.week());
        // The other order: the replacement wins, then the delete removes it and its receipt.
        const h2 = await setup();
        const b = await h2.post(KEYS[0], h2.payload(20000));
        const p = h2.payload(25000);
        expect((await h2.post(KEYS[0], p)).status).toBe(201);
        expect((await h2.remove(KEYS[0], b.body.receipt.row_id)).status).toBe(200);
        const retry = await h2.post(KEYS[0], p);
        expect(retry.status).toBe(200);
        expect(retry.body.receipt).toMatchObject({ status: 'removed', current_game_id: null, best: null });
        // A duplicate of the same game while it replaces the best: one write, one receipt.
        const h3 = await setup();
        await h3.post(KEYS[0], h3.payload(20000));
        const q = h3.payload(25000);
        const g = h3.db.holdNextBatch();
        const one = h3.post(KEYS[0], q);
        await g.reached;
        const two = await h3.post(KEYS[0], q);
        g.release();
        const first = await one;
        expect([first.status, two.status].sort()).toEqual([200, 201]);
        expect(first.body.receipt.game_id).toBe(two.body.receipt.game_id);
        expect(await h3.q("SELECT COUNT(*) AS n FROM receipts WHERE status = 'current'")).toEqual([{ n: 1 }]);
        await recount(h3, h3.week());
      });

      it('a removed device-week refuses new submissions as removed before any other check, and an older week\'s removal does not block this week [V12-86] [V12-97]', async () => {
        const h = await setup();
        const a = await h.post(KEYS[0], h.payload(20000));
        expect((await h.remove(KEYS[0], a.body.receipt.row_id)).body).toEqual({ removed: true, row_id: a.body.receipt.row_id, week: h.week() });
        expectReason(await h.post(KEYS[0], h.payload(29000)), 'removed');
        expectReason(await h.post(KEYS[0], h.payload(29000, { answers_revs: [9, 1, 1, 1, 1, 1, 1, 1, 1, 1] })), 'removed');
        // Next week the same device can add again; removing last week's row leaves this week alone.
        h.clock.advance(7 * DAY);
        const c = await h.post(KEYS[0], h.payload(15000));
        expect(c.status).toBe(201);
        const old = await h.post(KEYS[1], h.payload(10000));
        h.clock.advance(7 * DAY);
        expect((await h.remove(KEYS[1], old.body.receipt.row_id)).status).toBe(200);
        expect((await h.post(KEYS[1], h.payload(11000))).status).toBe(201);
      });
    });

    describe('weeks', () => {
      it('only the server week ranks: an old or missing board_week is week_closed, and a known retry keeps its week and score after Monday [V12-108] [V12-95]', async () => {
        const h = await setup('on', { start: W43_START + 7 * DAY - 60_000 });
        const p = h.payload(20000);
        const sunday = await h.post(KEYS[0], p);
        expect(sunday.body.receipt.week).toBe('2026-W43');
        h.clock.set(W43_START + 7 * DAY);
        expect(h.week()).toBe('2026-W44');
        const retry = await h.post(KEYS[0], p);
        expect(retry.status).toBe(200);
        expect(retry.body.receipt).toMatchObject({ week: '2026-W43', total: 20000, status: 'current' });
        expectReason(await h.post(KEYS[0], h.payload(25000, { board_week: '2026-W43' })), 'week_closed');
        expect((await h.post(KEYS[0], h.payload(25000))).status).toBe(201);
      });

      it('the Monday 00:00 UTC rollover: the cached board, pending retries, receipt ranks and the purge all move to the new week together [V12-131]', async () => {
        const h = await setup('on', { start: W43_START + 7 * DAY - 30_000 });
        const a = await h.post(KEYS[0], h.payload(20000));
        const b = await h.post(KEYS[1], h.payload(24000));
        const warm = await h.board();
        expect(warm.body).toMatchObject({ week: '2026-W43', count: 2 });
        const pending = h.payload(26000);
        h.clock.set(W43_START + 7 * DAY);
        const fresh = await h.board();
        expect(fresh.body).toMatchObject({ week: '2026-W44', count: 0, rows: [], resets_at: '2026-11-02T00:00:00.000Z' });
        expectReason(await h.post(KEYS[2], pending), 'week_closed');
        expect((await h.receipt(KEYS[0], a.body.receipt.row_id)).body).toMatchObject({ week: '2026-W43', standing: null, final_rank: null, count: 2 });
        expect((await h.scheduled())?.skipped).toBe(true);
        h.clock.set(W43_START + 7 * DAY + 3 * HOUR);
        const run = await h.scheduled();
        expect(run).toMatchObject({ skipped: false, closed: ['2026-W43'] });
        expect((await h.receipt(KEYS[1], b.body.receipt.row_id)).body).toMatchObject({ final_rank: 1 });
        expect((await h.receipt(KEYS[0], a.body.receipt.row_id)).body).toMatchObject({ final_rank: 2 });
        const mine = await h.board(KEYS[0]);
        expect(mine.body.personal.weeks).toEqual([{ week: '2026-W43', row_id: a.body.receipt.row_id, total: 20000, rank: 2 }]);
        expect(mine.body.personal.best).toBeNull();
      });
    });

    describe('GET /api/v1/board', () => {
      it('equal totals share a rank, earlier submissions list first, only 50 rows are public and the cutoff is the 50th total [V12-98]', async () => {
        const h = await setup();
        const week = h.week();
        await h.raw.prepare("INSERT INTO board_weeks (week, updated_at) VALUES (?1, '2026-10-20T00:00:00.000Z')").bind(week).run();
        const ins = h.raw.prepare("INSERT INTO scores (week, player_hash, row_id, name, game_id, payload_sha256, total, points, item_ids, deck_kind, fresh, hidden, seq, created_at) VALUES (?1, ?2, ?3, 'Some Name', ?4, 'h', ?5, '[]', '[]', 'random', 1, 0, ?6, '2026-10-20T08:00:00.000Z')");
        const rows = Array.from({ length: 60 }, (_, i) => ins.bind(week, `p${i}`, `row${String(i).padStart(9, '0')}`, `g${i}`, i < 3 ? 29000 : 20000 - (i % 7) * 10, i + 1));
        await h.raw.batch(rows);
        // Any accepted write rebuilds the projection; this one ties the 50th.
        await h.post(KEYS[0], h.payload(28000));
        const board = (await h.board()).body;
        expect(board.rows).toHaveLength(50);
        expect(board.count).toBe(61);
        expect(board.rows.slice(0, 4).map((r: { rank: number; total: number }) => [r.rank, r.total])).toEqual([[1, 29000], [1, 29000], [1, 29000], [4, 28000]]);
        const ranks = board.rows.map((r: { rank: number }) => r.rank);
        expect(ranks).toEqual([...ranks].sort((x: number, y: number) => x - y));
        for (let i = 1; i < 50; i++) {
          const [prev, cur] = [board.rows[i - 1], board.rows[i]];
          if (prev.total === cur.total) expect(cur.rank).toBe(prev.rank);
          else expect(cur.rank).toBe(i + 1);
        }
        expect(board.cutoff_total).toBe(board.rows[49].total);
        expect(Object.keys(board.rows[0]).sort()).toEqual(['date', 'name', 'rank', 'row_id', 'total']);
        expect(board.rows[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      });

      it('the bearer read adds the device part uncached and private: name, this week\'s best with its standing, at most eight weekly bests newest first, no game ids [V12-95] [V12-96] [V12-100]', async () => {
        const h = await setup('on', { start: W43_START - 9 * 7 * DAY + DAY });
        const added: string[] = [];
        for (let w = 0; w < 10; w++) {
          const res = await h.post(KEYS[0], h.payload(10000 + w * 1000));
          expect(res.status).toBe(201);
          added.push(res.body.receipt.row_id);
          h.clock.advance(7 * DAY);
        }
        h.clock.advance(-7 * DAY);
        await h.post(KEYS[1], h.payload(25000));
        const anon = await h.board();
        expect(anon.headers.get('Cache-Control')).toBe('no-store');
        expect(anon.body.personal).toBeUndefined();
        const res = await h.board(KEYS[0]);
        expect(res.headers.get('Cache-Control')).toBe('private, no-store');
        const personal = res.body.personal;
        expect(personal.name).toBe(nameFromHash(await playerHash(KEYS[0])));
        expect(personal.best).toEqual({ row_id: added[9], total: 19000, standing: { kind: 'exact', rank: 2, tied: false } });
        expect(personal.weeks).toHaveLength(8);
        expect(personal.weeks.map((w: { total: number }) => w.total)).toEqual([19000, 18000, 17000, 16000, 15000, 14000, 13000, 12000]);
        expect(personal.weeks[0]).toEqual({ week: h.week(), row_id: added[9], total: 19000, rank: 1 });
        const text = JSON.stringify(res.body) + JSON.stringify(anon.body);
        const games = await h.q<{ game_id: string }>('SELECT game_id FROM receipts');
        for (const { game_id } of games) expect(text).not.toContain(game_id);
        expect(text).not.toContain(await playerHash(KEYS[0]));
        expect(Object.keys(res.body).sort()).toEqual(['count', 'cutoff_total', 'personal', 'resets_at', 'rows', 'updated_at', 'week']);
      });

      it('the mode is read before any cache or ranking access: off and ordinary dark reads are disabled, missing settings mean off, unreadable settings mean unavailable [V12-99] [V12-103]', async () => {
        const h = await setup(null);
        expect((await h.board()).body).toEqual({ disabled: true });
        expect((await h.call('GET', '/api/v1/health')).body.board_mode).toBe('off');
        await h.setMode('dark');
        expect((await h.board()).body).toEqual({ disabled: true });
        expect((await h.board(KEYS[0])).body).toEqual({ disabled: true });
        await h.setMode('on');
        expect((await h.board()).body).toMatchObject({ week: h.week(), count: 0 });
        h.app.modes.clear();
        h.db.failWhen((sql) => sql.includes('settings'));
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
          const down = await h.board();
          expectReason(down, 'unavailable');
          expect(down.body.request_id).toMatch(/^[0-9a-f-]{36}$/);
          expectReason(await h.post(KEYS[0], h.payload(20000)), 'unavailable');
          expectReason(await h.call('GET', '/api/v1/health'), 'unavailable');
          const line = JSON.parse(String(spy.mock.calls[0]![0]));
          expect(line).toEqual({ request_id: down.body.request_id, route: '/api/v1/board', error_name: 'D1Error' });
        } finally {
          spy.mockRestore();
          h.db.failWhen(null);
        }
      });

      it('BOARD_FORCE_OFF wins over the stored mode and needs no D1 read, even when D1 is out of quota; "0" leaves the board alone [V12-104]', async () => {
        const h = await setup('on', { env: { BOARD_FORCE_OFF: '1' } });
        h.db.failWhen(() => true);
        h.db.reset();
        expect((await h.board()).body).toEqual({ disabled: true });
        expect((await h.call('GET', '/api/v1/health')).body.board_mode).toBe('off');
        expectReason(await h.post(KEYS[0], h.payload(20000)), 'board_disabled');
        expect(h.db.log).toEqual([]);
        h.db.failWhen(null);
        const on = await setup('on', { env: { BOARD_FORCE_OFF: '0' } });
        expect((await on.call('GET', '/api/v1/health')).body.board_mode).toBe('on');
      });

      it('delete drops this location\'s cached board at once, and on → dark → off with a warm cache never serves the public list [V12-99] [V12-97]', async () => {
        const h = await setup();
        const a = await h.post(KEYS[0], h.payload(20000));
        await h.post(KEYS[1], h.payload(21000));
        expect((await h.board()).body.count).toBe(2);
        await h.post(KEYS[2], h.payload(22000));
        expect((await h.board()).body.count, 'the warm copy still answers').toBe(2);
        expect((await h.remove(KEYS[0], a.body.receipt.row_id)).status).toBe(200);
        const after = (await h.board()).body;
        expect(after.count).toBe(2);
        expect(after.rows.map((r: { row_id: string }) => r.row_id)).not.toContain(a.body.receipt.row_id);
        await h.setMode('dark');
        h.db.reset();
        expect((await h.board()).body).toEqual({ disabled: true });
        expect(h.db.log.filter((e) => !e.sql.includes('settings'))).toEqual([]);
        await h.setMode('off');
        expect((await h.board()).body).toEqual({ disabled: true });
      });

      it('a cache miss reads only the week\'s projection row, and the copy lives at most 60 seconds and never past Monday 00:00 UTC [V12-99] [V12-100]', async () => {
        const h = await setup('on', { start: W43_START + 7 * DAY - 20_000 });
        await h.post(KEYS[0], h.payload(20000));
        await h.board();
        h.db.reset();
        await h.board();
        expect(h.db.log.map((e) => e.sql), 'a warm read touches no table').toEqual([]);
        if (options.clockCache) {
          h.clock.advance(21_000);
          h.db.reset();
          const next = await h.board();
          expect(next.body.week).toBe('2026-W44');
          expect(h.db.log.map((e) => e.sql)).toEqual(['SELECT n, top_json, cutoff_total, updated_at FROM board_weeks WHERE week = ?1']);
          const reads = () => h.db.log.filter((e) => !e.sql.includes('settings')).length;
          h.clock.advance(59_000);
          h.db.reset();
          await h.board();
          expect(reads()).toBe(0);
          h.clock.advance(2_000);
          h.db.reset();
          await h.board();
          expect(reads()).toBe(1);
        }
      });
    });

    describe('receipts and removal', () => {
      it('the receipt GET answers only the owner: another device gets duplicate, hidden and removed rows not_found, unknown rows not_found [V12-96] [V12-97]', async () => {
        const h = await setup();
        const a = await h.post(KEYS[0], h.payload(20000));
        const id = a.body.receipt.row_id;
        const mine = await h.receipt(KEYS[0], id);
        expect(mine.status).toBe(200);
        expect(mine.headers.get('Cache-Control')).toBe('private, no-store');
        expect(mine.body).toMatchObject({ receipt: { game_id: a.body.receipt.game_id, current_game_id: a.body.receipt.game_id, status: 'current', receipt_rank: 1 }, standing: { kind: 'exact', rank: 1 }, count: 1, week: h.week() });
        expectReason(await h.receipt(KEYS[1], id), 'duplicate');
        expectReason(await h.receipt(KEYS[0], 'AAAAAAAAAAAA'), 'not_found');
        expectReason(await h.call('GET', `/api/v1/scores/${id}`), 'invalid');
        expectReason(await h.receipt(KEYS[0], 'bad id!'), 'invalid');
        await h.raw.prepare('UPDATE scores SET hidden = 1 WHERE row_id = ?1').bind(id).run();
        expectReason(await h.receipt(KEYS[0], id), 'not_found');
        await h.raw.prepare('UPDATE scores SET hidden = 0 WHERE row_id = ?1').bind(id).run();
        expectReason(await h.remove(KEYS[1], id), 'duplicate');
        expect((await h.remove(KEYS[0], id)).status).toBe(200);
        expect((await h.remove(KEYS[0], id)).body, 'a repeated delete answers the same').toEqual({ removed: true, row_id: id, week: h.week() });
        expectReason(await h.receipt(KEYS[0], id), 'not_found');
        expectReason(await h.remove(KEYS[1], id), 'duplicate');
        expectReason(await h.remove(KEYS[0], 'AAAAAAAAAAAA'), 'not_found');
      });

      it('delete clears the stored name, points and item ids, keeps only the tombstone and receipt metadata, and works with the board off [V12-97] [V12-135]', async () => {
        const h = await setup();
        const a = await h.post(KEYS[0], h.payload(20000));
        await h.setMode('off');
        expect((await h.remove(KEYS[0], a.body.receipt.row_id)).status).toBe(200);
        expect(await h.q('SELECT * FROM scores')).toEqual([]);
        const tomb = await h.q('SELECT * FROM tombstones');
        expect(tomb).toEqual([{ week: h.week(), player_hash: await playerHash(KEYS[0]), smoke: 0, row_id: a.body.receipt.row_id, removed_at: '2026-10-21T10:00:00.000Z' }]);
        const all = JSON.stringify(await h.q('SELECT * FROM receipts')) + JSON.stringify(tomb);
        expect(all).not.toContain(nameFromHash(await playerHash(KEYS[0])));
        expect(all).not.toContain('"points"');
      });

      it('the database never holds a raw pin, an IP address, a user agent or a key [V12-135]', async () => {
        const h = await setup();
        const p = h.payload(30000);
        await h.post(KEYS[0], p, { ip: '198.51.100.77', headers: { 'User-Agent': 'UniqueAgent/9.9' } });
        const tables = await h.q<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations'");
        let dump = '';
        for (const { name } of tables) dump += JSON.stringify(await h.q(`SELECT * FROM ${name}`));
        for (const secret of ['198.51.100.77', 'UniqueAgent', KEYS[0], String(p.answers[0]!.made!.lat)]) expect(dump, secret).not.toContain(secret);
      });
    });

    describe('dark mode', () => {
      it('test-assisted games run the full path into smoke rows, never into buckets, counts or the public board; ordinary games are disabled [V12-105]', async () => {
        const h = await setup('dark');
        expectReason(await h.post(KEYS[0], h.payload(20000)), 'board_disabled');
        const res = await h.post(KEYS[0], h.payload(20000, { test_assisted: true }));
        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({ smoke: true, replaced: false, receipt: { status: 'current', receipt_rank: null, count: 0 } });
        expectReason(await h.post(KEYS[0], h.payload(15000, { test_assisted: true })), 'not_best');
        const better = await h.post(KEYS[0], h.payload(26000, { test_assisted: true }));
        expect(better.body).toMatchObject({ replaced: true, receipt: { row_id: res.body.receipt.row_id } });
        expect(h.siteverify.calls).toHaveLength(2);
        expect(await h.q('SELECT COUNT(*) AS n FROM scores')).toEqual([{ n: 0 }]);
        expect(await h.q('SELECT COUNT(*) AS n FROM score_buckets')).toEqual([{ n: 0 }]);
        expect(await h.q('SELECT COUNT(*) AS n FROM board_weeks')).toEqual([{ n: 0 }]);
      });

      it('the test header gives week context and the owner\'s smoke bests, private, with null ranks; it changes nothing in on or off mode [V12-105]', async () => {
        const h = await setup('dark');
        const smoke = { 'X-MuseumGuessr-Test': '1' };
        const res = await h.post(KEYS[0], h.payload(20000, { test_assisted: true }));
        const anon = await h.board(null, { headers: smoke });
        expect(anon.body).toEqual({ smoke: true, week: h.week(), resets_at: '2026-10-26T00:00:00.000Z' });
        expect(anon.headers.get('Cache-Control')).toBe('private, no-store');
        const mine = await h.board(KEYS[0], { headers: smoke });
        expect(mine.body.personal).toEqual({ name: nameFromHash(await playerHash(KEYS[0])), best: { row_id: res.body.receipt.row_id, total: 20000, standing: null }, weeks: [{ week: h.week(), row_id: res.body.receipt.row_id, total: 20000, rank: null }] });
        const rec = await h.receipt(KEYS[0], res.body.receipt.row_id, { headers: smoke });
        expect(rec.body).toMatchObject({ standing: null, final_rank: null, count: 0, cutoff_total: null, receipt: { receipt_rank: null } });
        expectReason(await h.receipt(KEYS[0], res.body.receipt.row_id), 'not_found');
        expect((await h.board(null, { headers: { 'X-MuseumGuessr-Test': 'yes' } })).body).toEqual({ disabled: true });
        await h.setMode('on');
        expect((await h.board(null, { headers: smoke })).body).toMatchObject({ count: 0, rows: [] });
        expectReason(await h.post(KEYS[1], h.payload(20000, { test_assisted: true }), { headers: smoke }), 'replay');
        expectReason(await h.receipt(KEYS[0], res.body.receipt.row_id, { headers: smoke }), 'not_found');
        await h.setMode('off');
        expect((await h.board(null, { headers: smoke })).body).toEqual({ disabled: true });
      });

      it('a dark test submission, then on: a real game from the same device the same week ranks normally [V12-105] [V12-106]', async () => {
        const h = await setup('dark');
        const smoke = await h.post(KEYS[0], h.payload(27000, { test_assisted: true }));
        expect((await h.remove(KEYS[0], smoke.body.receipt.row_id)).status).toBe(200);
        await h.setMode('on');
        const real = await h.post(KEYS[0], h.payload(12000));
        expect(real.status).toBe(201);
        expect(real.body.receipt).toMatchObject({ receipt_rank: 1, count: 1 });
        expect((await h.board()).body.rows).toHaveLength(1);
      });
    });

    describe('purge', () => {
      it('the cron purge deletes rows older than eight weeks in bounded chunks, skips the hours around the reset and keeps the eight retained weeks [V12-107]', async () => {
        const h = await setup('on', { start: W43_START - 10 * 7 * DAY + DAY });
        const ids: string[] = [];
        for (let w = 0; w < 11; w++) {
          ids.push((await h.post(KEYS[0], h.payload(10000 + w * 1000))).body.receipt.row_id);
          h.clock.advance(7 * DAY);
        }
        h.clock.set(W43_START + 2 * DAY);
        const report = await h.scheduled();
        expect(report).toMatchObject({ skipped: false, deleted: { scores: 3, receipts: 3, board_weeks: 3 } });
        const weeks = (await h.q<{ week: string }>('SELECT week FROM scores ORDER BY week')).map((r) => r.week);
        expect(weeks).toEqual(['2026-W36', '2026-W37', '2026-W38', '2026-W39', '2026-W40', '2026-W41', '2026-W42', '2026-W43']);
        expect((await h.q('SELECT COUNT(*) AS n FROM score_buckets WHERE week < ?1', '2026-W36'))).toEqual([{ n: 0 }]);
        expect(await h.scheduled()).toMatchObject({ deleted: { scores: 0 } });
        h.clock.set(W43_START + 7 * DAY - HOUR);
        expect(await h.scheduled()).toMatchObject({ skipped: true });
      });
    });
  });
}
