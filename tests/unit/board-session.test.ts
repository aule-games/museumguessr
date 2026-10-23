import { afterEach, describe, expect, it } from 'vitest';
import { EVENTS } from '../../src/analytics/events';
import type { CardView } from '../../src/board/card';
import { readKey } from '../../src/board/key';
import { BoardSession, backoffMs, resumePending, weekContext } from '../../src/board/session';
import { readStanding } from '../../src/board/standing-line';
import { MAX_AUTO_ATTEMPTS, readBoard, setAutoAdd } from '../../src/board/store';
import { KEYS } from '../../src/state/schema';
import { api, board, deps, error, finished, flush, html, json, kv, personal, scored, verifier } from './helpers/board';

const sessions: BoardSession[] = [];
function session(d: ReturnType<typeof deps>, game = finished(), total = 18240) {
  const s = new BoardSession(d, { game_id: game.game_id, total, game });
  sessions.push(s);
  const views: CardView[] = [];
  s.subscribe((v) => views.push(v));
  return { s, views, last: () => views[views.length - 1]! };
}
afterEach(() => {
  for (const s of sessions.splice(0)) s.dispose();
});

const okBoard = (over = {}) => json(200, { ...board(), personal: personal(over) });

describe('automatic board entry', () => {
  it('an eligible finished game is stored as a pending submission before its first POST, then confirmed with no click [V12-80] [V12-113]', async () => {
    const store = kv();
    let pendingAtPost: unknown = null;
    const a = api({
      'GET /board': [okBoard()],
      'POST /scores': [
        () => {
          pendingAtPost = readBoard(store).games.g1?.status;
          return json(201, scored());
        },
      ],
    });
    const d = deps(store, a.fetch);
    const { s, last } = session(d);
    await s.start();
    expect(pendingAtPost).toBe('pending');
    const rec = readBoard(store).games.g1!;
    expect(rec).toMatchObject({ status: 'confirmed', outcome: 'added', payload: null, receipt: { row_id: 'row-1', receipt_rank: 12 } });
    expect(last().status).toBe('Added: #12 of 40 this week');
    expect(last().name).toMatch(/^You appear as \w+ \w+ \w+$/);
    // the POST carried the canonical payload, a fresh token and the key in the header only
    const post = a.sent.find((x) => x.method === 'POST')!;
    expect((post.body as Record<string, unknown>).turnstile_token).toBe('token-1');
    expect(post.headers.Authorization).toBe(`Bearer ${readKey(store)}`);
    // the start screen's summary now holds the confirmed rank
    expect(readStanding(store)).toMatchObject({ week: '2026-W43', total: 18240, rank: 12, resets_at: '2026-10-26T00:00:00.000Z' });
  });

  it('normal end-card traffic is one bearer board read and one POST; reopening the card repeats neither [V12-139]', async () => {
    const a = api({ 'GET /board': [okBoard()], 'POST /scores': [json(201, scored())] });
    const store = kv();
    const d = deps(store, a.fetch);
    const { s } = session(d);
    await s.start();
    await s.start();
    // a rebuilt end screen opens a new card for the same game: the record is settled
    const again = session(d).s;
    await again.start();
    expect(a.count('POST', '/scores')).toBe(1);
    expect(a.sent.filter((x) => x.method === 'GET' && x.headers.Authorization).length).toBe(2);
    expect(a.sent.filter((x) => x.method === 'GET' && !x.headers.Authorization).length).toBe(0);
  });

  it('a not-best game is refused with the current best, keeps no payload and shows both totals [V12-117]', async () => {
    const a = api({ 'GET /board': [okBoard()], 'POST /scores': [error('not_best', 409, { best: { row_id: 'row-1', total: 25000, standing: { kind: 'exact', rank: 3, tied: false } } })] });
    const d = deps(kv(), a.fetch);
    const { s, last } = session(d);
    await s.start();
    expect(readBoard(d.kv).games.g1).toMatchObject({ status: 'refused', outcome: 'not_best', payload: null });
    expect(last().status).toBe('Your best this week: 25,000 (#3 of 40 this week) · this game 18,240');
  });

  it('retryable answers stay pending with Retry-After or bounded backoff; automatic attempts stop after five and Retry still sends [V12-114]', async () => {
    const a = api({ 'GET /board': [okBoard()], 'POST /scores': [error('rate_limited', 429, { retry_after: 20 }), html(429, '<html>Error 1015 You are being rate limited</html>'), error('try_later', 503), json(503, { reason: 'server', retryable: true }), html(503, 'error code: 1027'), json(201, scored())] });
    const d = deps(kv(), a.fetch);
    const { s, last } = session(d);
    await s.start();
    expect(readBoard(d.kv).games.g1).toMatchObject({ status: 'pending', outcome: 'rate_limited', attempts: 1 });
    expect(last().status).toBe('Saved on this device; waiting to retry');
    // nothing before Retry-After
    await d.advance(19_000);
    expect(a.count('POST', '/scores')).toBe(1);
    await d.advance(1_000);
    expect(a.count('POST', '/scores')).toBe(2);
    expect(readBoard(d.kv).games.g1).toMatchObject({ outcome: 'edge_limited', attempts: 2 });
    for (let i = 0; i < 3; i++) await d.advance(backoffMs(readBoard(d.kv).games.g1!.attempts));
    expect(readBoard(d.kv).games.g1).toMatchObject({ status: 'pending', outcome: 'unavailable', attempts: MAX_AUTO_ATTEMPTS });
    expect(last()).toMatchObject({ status: 'The board is unavailable right now', action: 'retry' });
    // automatic attempts are spent: time alone sends nothing more
    await d.advance(3_600_000);
    expect(a.count('POST', '/scores')).toBe(5);
    expect(d.timers).toEqual([]);
    // the pending data stayed; an explicit Retry sends it with a fresh token
    await s.retry();
    expect(a.count('POST', '/scores')).toBe(6);
    expect(readBoard(d.kv).games.g1).toMatchObject({ status: 'confirmed' });
    const tokens = a.sent.filter((x) => x.method === 'POST').map((x) => (x.body as { turnstile_token: string }).turnstile_token);
    expect(new Set(tokens).size).toBe(6);
    expect(backoffMs(1)).toBe(5000);
    expect(backoffMs(9)).toBe(300_000);
  });

  it('the key is read again before every POST, and the receipt keeps the fingerprint of the key that made it [V12-81]', async () => {
    const store = kv();
    const a = api({ 'GET /board': [okBoard()], 'POST /scores': [error('try_later', 503), json(201, scored())] });
    const d = deps(store, a.fetch);
    const { s } = session(d);
    await s.start();
    const first = readKey(store)!;
    // another tab replaced the key in the meantime (a reset)
    store.set(KEYS.boardKey, 'BBBBBBBBBBBBBBBBBBBBBB');
    await s.retry();
    const posts = a.sent.filter((x) => x.method === 'POST');
    expect(posts[0]!.headers.Authorization).toBe(`Bearer ${first}`);
    expect(posts[1]!.headers.Authorization).toBe('Bearer BBBBBBBBBBBBBBBBBBBBBB');
    expect(readBoard(store).games.g1!.receipt!.fp).toMatch(/^[0-9a-f]{16}$/);
  });

  it('verification that does not load says so with Retry; an interactive widget asks the player to tap; every retry gets a fresh token [V12-115]', async () => {
    const a = api({ 'GET /board': [okBoard()], 'POST /scores': [json(201, scored())] });
    const failing = deps(kv(), a.fetch, { verifier: verifier('fail') });
    const one = session(failing);
    await one.s.start();
    expect(one.last()).toMatchObject({ status: "Verification couldn't load", action: 'retry' });
    expect(a.count('POST', '/scores')).toBe(0);
    expect(readBoard(failing.kv).games.g1).toMatchObject({ status: 'pending', outcome: 'turnstile_failed' });

    const interactive = deps(kv(), a.fetch, { verifier: verifier('interactive') });
    const two = session(interactive);
    await two.s.start();
    expect(two.views.some((v) => v.status === 'Tap to finish adding' && v.interactive)).toBe(true);
    expect(two.last().status).toBe('Added: #12 of 40 this week');
  });

  it('a game whose week the server has closed is not sent; a Sunday finish retried on Monday is refused as last week [V12-108]', async () => {
    // finished Sunday 2026-W43, first opened on Monday: the read says W44, nothing is sent
    const monday = api({ 'GET /board': [json(200, { ...board({ week: '2026-W44', resets_at: '2026-11-02T00:00:00.000Z' }), personal: personal() })], 'POST /scores': [error('week_closed', 409)] });
    const d1 = deps(kv(), monday.fetch);
    const one = session(d1);
    await one.s.start();
    expect(monday.count('POST', '/scores')).toBe(0);
    expect(one.last().status).toBe('Played last week · the board resets weekly');
    // finished Sunday, its first POST failed; on Monday the pending retry is refused as week_closed
    const store = kv();
    const sunday = api({ 'GET /board': [okBoard()], 'POST /scores': [html(502, 'bad gateway')] });
    const d2 = deps(store, sunday.fetch);
    await session(d2).s.start();
    expect(readBoard(store).games.g1!.status).toBe('pending');
    const d3 = deps(store, monday.fetch);
    const three = session(d3);
    await three.s.start();
    await three.s.retry();
    expect(readBoard(store).games.g1).toMatchObject({ status: 'refused', outcome: 'week_closed' });
    expect(three.last().status).toBe('Played last week · the board resets weekly');
    // a game with no server week at completion is never sent
    const none = deps(kv(), monday.fetch);
    const four = session(none, finished({ board_week: null }));
    await four.s.start();
    expect(four.last().status).toBe("Couldn't confirm which week this game belongs to");
  });

  it('switching "Add my games to the board" off stops the next automatic add; the board off hides the card and sends nothing [V12-120] [V12-125]', async () => {
    const a = api({ 'GET /board': [okBoard()], 'POST /scores': [json(201, scored())] });
    const d = deps(kv(), a.fetch);
    setAutoAdd(d.kv, false);
    const { s, last } = session(d);
    await s.start();
    expect(a.count('POST', '/scores')).toBe(0);
    expect(last().status).toBe('Automatic board entry is off');
    const off = api({ 'GET /board': [json(200, { disabled: true })] });
    const d2 = deps(kv(), off.fetch);
    const two = session(d2);
    await two.s.start();
    expect(two.last().hidden).toBe(true);
    expect(off.count('POST', '/scores')).toBe(0);
  });

  it('without storage nothing is added and no key is made; the board read is anonymous [V12-117]', async () => {
    const a = api({ 'GET /board': [json(200, board())] });
    const d = deps(kv(false), a.fetch);
    const { s, last } = session(d);
    await s.start();
    expect(last().status).toBe("Your browser isn't keeping data, so this score can't be added");
    expect(a.sent[0]!.headers.Authorization).toBeUndefined();
    expect(a.count('POST', '/scores')).toBe(0);
  });

  it('a test game is sent only to the dark smoke context and still reads as not ranked; in public mode it is not sent [V12-80]', async () => {
    const pub = api({ 'GET /board': [okBoard()] });
    const d = deps(kv(), pub.fetch);
    const one = session(d, finished({ test_assisted: true }));
    await one.s.start();
    expect(pub.count('POST', '/scores')).toBe(0);
    expect(one.last().status).toBe('Not ranked (test game)');
    expect(pub.sent[0]!.headers['X-MuseumGuessr-Test']).toBe('1');
    const dark = api({ 'GET /board': [json(200, { smoke: true, week: '2026-W43', resets_at: '2026-10-26T00:00:00Z', personal: personal() })], 'POST /scores': [json(201, scored({ smoke: true }, { receipt_rank: null, best: null }))] });
    const d2 = deps(kv(), dark.fetch);
    const two = session(d2, finished({ test_assisted: true }));
    await two.s.start();
    expect(dark.count('POST', '/scores')).toBe(1);
    expect(two.last().status).toBe('Added: Not ranked (test game)');
    expect(readStanding(d2.kv)).toBeNull();
  });

  it('board_submitted goes once per game and outcome with auto true and no key, name or row id [V12-134]', async () => {
    const a = api({ 'GET /board': [okBoard()], 'POST /scores': [error('rate_limited', 429, { retry_after: 1 }), error('rate_limited', 429, { retry_after: 1 }), json(201, scored({ replaced: true }))] });
    const d = deps(kv(), a.fetch);
    const { s } = session(d);
    await s.start();
    await d.advance(1000);
    await d.advance(1000);
    const sent = d.events.filter((e) => e.name === EVENTS.boardSubmitted);
    expect(sent.map((e) => e.props.reason)).toEqual(['rate_limited', 'replaced']);
    expect(sent[0]!.props).toEqual({ game_ref: 'ref-g1-0000000000', reason: 'rate_limited', auto: true, src: 'none' });
    const text = JSON.stringify(sent);
    expect(text).not.toContain(readKey(d.kv)!);
    expect(text).not.toContain('row-1');
  });

  it("other games' pending submissions are retried when a card shows, independent of the game on screen [V12-113]", async () => {
    const store = kv();
    const down = api({ 'GET /board': [okBoard()], 'POST /scores': [html(502, 'down')] });
    await session(deps(store, down.fetch), finished({ game_id: 'old' })).s.start();
    expect(readBoard(store).games.old!.status).toBe('pending');
    const up = api({ 'GET /board': [okBoard()], 'POST /scores': [json(201, scored({}, { game_id: 'g1' })), json(201, scored({}, { game_id: 'old', row_id: 'row-1' }))] });
    const d = deps(store, up.fetch);
    // the old record's backoff has passed
    await d.advance(10 * 60_000);
    await session(d).s.start();
    await flush();
    expect(readBoard(store).games.old!.status).toBe('confirmed');
    expect(up.count('POST', '/scores')).toBe(2);
    // and on load, with no card at all
    const store2 = kv();
    await session(deps(store2, down.fetch), finished({ game_id: 'old2' })).s.start();
    const d2 = deps(store2, up.fetch);
    await d2.advance(10 * 60_000);
    await resumePending(d2);
    expect(readBoard(store2).games.old2!.status).toBe('confirmed');
  });
});

describe('week context before completion', () => {
  it('one anonymous read when round ten opens, deduplicated in flight, without a key; a failure gives a null week [V12-108]', async () => {
    let calls = 0;
    const a = api({
      'GET /board': [
        async () => {
          calls += 1;
          await new Promise((r) => setTimeout(r, 5));
          return json(200, board());
        },
      ],
    });
    const d = deps(kv(), a.fetch);
    const [x, y] = await Promise.all([weekContext(d, false), weekContext(d, false)]);
    expect(calls).toBe(1);
    expect(x).toEqual({ week: '2026-W43' });
    expect(y).toEqual(x);
    expect(a.sent[0]!.headers.Authorization).toBeUndefined();
    expect(readKey(d.kv)).toBeNull();
    const down = deps(kv(), api({ 'GET /board': [html(503, 'error code: 1027')] }).fetch);
    expect(await weekContext(down, true)).toEqual({ week: null });
  });
});
