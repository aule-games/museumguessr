import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext, Page, Route } from '@playwright/test';
import { SCORING_VERSION } from '../../src/scoring/config';
import { STATE_VERSION } from '../../src/state/schema';
import { expect, playRound, test as base } from './fixtures';

// The weekly board on the page (W6, G1-G5), against the board-test build
// (dist-board/, VITE_BOARD_UI on). Every /api/ request is answered by the
// mock below; anything it does not know fails the test, and so does any
// request to Turnstile's host (fixtures.ts): Turnstile is a stub here.

const items = JSON.parse(readFileSync(join(import.meta.dirname, '../../data/items.json'), 'utf8')).items as { id: string }[];
/** The v0 fixed set: the first ten objects, still a valid deck. */
const IDS = items.slice(0, 10).map((it) => it.id);
const HASH = '35ca1219';
const WEEK = '2026-W43';
const NEXT_WEEK = '2026-W44';

type Json = Record<string, unknown>;
interface Sent {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: Json | null;
}

/** The board API as the Worker answers it, scripted per test. */
class BoardApi {
  sent: Sent[] = [];
  mode: 'on' | 'dark' | 'off' = 'on';
  week = WEEK;
  resets = '2026-10-26T00:00:00.000Z';
  count = 40;
  rows: Json[] = [
    { row_id: 'top-1', name: 'Quiet Amber Heron', total: 27120, rank: 1, date: '2026-10-20' },
    { row_id: 'top-2', name: 'Bold Ochre Lantern', total: 25010, rank: 2, date: '2026-10-21' },
  ];
  best: Json | null = null;
  weeks: Json[] = [];
  /** The answer to the next POST; the default is a confirmed add at #12 of 40. */
  post: (body: Json) => { status: number; body: string; headers?: Record<string, string> } = (body) => ({ status: 201, body: JSON.stringify(this.score(body)) });

  /** A confirmed add of 18,240 at #12; the device's best follows it, as the Worker's does. */
  score(body: Json, over: Json = {}) {
    const total = 18240;
    this.best = { row_id: 'mine', total, standing: { kind: 'exact', rank: 12, tied: false } };
    return {
      receipt: { game_id: body.game_id, current_game_id: body.game_id, row_id: 'mine', week: this.week, total, status: 'current', receipt_rank: 12, count: this.count, best: { row_id: 'mine', total, standing: { kind: 'exact', rank: 12, tied: false } } },
      replaced: false,
      smoke: false,
      ...over,
    };
  }

  posts = () => this.sent.filter((s) => s.method === 'POST');
  reads = () => this.sent.filter((s) => s.method === 'GET');

  async handle(route: Route) {
    const req = route.request();
    const url = new URL(req.url());
    const headers = req.headers();
    const body = req.postData() ? (JSON.parse(req.postData()!) as Json) : null;
    this.sent.push({ method: req.method(), path: url.pathname, headers, body });
    const json = (status: number, v: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(v) });
    const bearer = headers.authorization?.startsWith('Bearer ');
    if (req.method() === 'GET' && url.pathname === '/api/v1/board') {
      if (this.mode === 'off' || (this.mode === 'dark' && headers['x-museumguessr-test'] !== '1')) return json(200, { disabled: true });
      const personal = bearer ? { personal: { name: 'Bold Ochre Lantern', best: this.best, weeks: this.weeks } } : {};
      if (this.mode === 'dark') return json(200, { smoke: true, week: this.week, resets_at: this.resets, ...personal });
      return json(200, { week: this.week, resets_at: this.resets, count: this.count, cutoff_total: 12000, rows: this.rows, updated_at: '2026-10-22T10:00:00.000Z', ...personal });
    }
    if (req.method() === 'POST' && url.pathname === '/api/v1/scores' && bearer) {
      const r = this.post(body ?? {});
      return route.fulfill({ status: r.status, body: r.body, headers: { 'Content-Type': r.body.startsWith('{') ? 'application/json' : 'text/html', ...(r.headers ?? {}) } });
    }
    const del = /^\/api\/v1\/scores\/([\w-]+)$/.exec(url.pathname);
    if (req.method() === 'DELETE' && del && bearer) return json(200, { removed: true, row_id: del[1], week: (this.weeks.find((w) => w.row_id === del[1])?.week as string) ?? this.week });
    return route.fallback();
  }
}

type TurnstileMode = 'pass' | 'interactive' | 'fail';

const test = base.extend<{ board: BoardApi; turnstile: TurnstileMode; persistCalls: void }>({
  turnstile: ['pass', { option: true }],
  // after the recorder, whose deny-all route then catches anything this mock leaves (V12-128)
  board: async ({ context, turnstile, recorder }, use) => {
    void recorder;
    const api = new BoardApi();
    await context.route(/^https:\/\/museumguessr\.com\/api\//, (route) => api.handle(route));
    await stubTurnstile(context, turnstile);
    await use(api);
  },
  persistCalls: [
    async ({ context }, use) => {
      await context.addInitScript(() => {
        const w = window as unknown as { __persist: number };
        w.__persist = 0;
        if (navigator.storage) Object.defineProperty(navigator.storage, 'persist', { configurable: true, value: async () => (w.__persist += 1) > 0 });
      });
      await use();
    },
    { auto: true },
  ],
});

/** A stand-in for Turnstile's API: a fresh token per execute, or an interactive check, or an error. */
async function stubTurnstile(context: BrowserContext, mode: TurnstileMode) {
  await context.addInitScript((m) => {
    const log = { renders: 0, executes: 0, resets: 0, actions: [] as string[] };
    (window as unknown as { __ts: typeof log }).__ts = log;
    let opts: Record<string, (t?: string) => void> & { action?: string } = {};
    let host: HTMLElement | null = null;
    (window as unknown as { turnstile: unknown }).turnstile = {
      render(el: HTMLElement, o: typeof opts) {
        log.renders += 1;
        log.actions.push(String(o.action));
        opts = o;
        host = el;
        return 'w1';
      },
      execute() {
        log.executes += 1;
        const n = log.executes;
        if (m === 'fail') return void setTimeout(() => opts['error-callback']!(), 10);
        if (m === 'interactive') {
          setTimeout(() => {
            opts['before-interactive-callback']!();
            const box = document.createElement('button');
            box.type = 'button';
            box.textContent = 'Verify you are human';
            box.dataset.test = 'turnstile-box';
            box.addEventListener('click', () => {
              box.remove();
              opts['after-interactive-callback']!();
              opts.callback!(`token-${n}`);
            });
            host?.append(box);
          }, 10);
          return;
        }
        setTimeout(() => opts.callback!(`token-${n}`), 10);
      },
      reset() {
        log.resets += 1;
      },
      remove() {},
    };
  }, mode);
}

const row = (points: number) => ({ made: { points: 600, km: 120 }, when: { points: 300, yearsOff: 15 }, kept: { points: points - 900, km: 3 }, points, skipped: false });

/** A finished game on this device, as the end screen saves it, so "Review your 10" opens its end screen. */
function finishedGame(o: { id?: string; kind?: 'random' | 'challenge' | 'replay'; test?: boolean; week?: string | null; seen?: boolean } = {}) {
  const id = o.id ?? 'game-board-0000000001';
  const total = 18240;
  const answers = IDS.map(() => ({ kept: { lat: 48.85, lng: 2.35 }, made: { lat: 41.9, lng: 12.5 }, when: 1500 }));
  const results = IDS.map((_, i) => row(i === 0 ? total - 1824 * 9 : 1824));
  const common = {
    state_version: STATE_VERSION,
    scoring_version: SCORING_VERSION,
    items_version: HASH,
    game_id: id,
    item_ids: IDS,
    deck_kind: o.kind ?? 'random',
    deck_hash: HASH,
    challenge: o.kind === 'challenge' ? { score: 20000, name: null } : null,
    answers,
    timed_out: IDS.map(() => null),
    test_assisted: o.test ?? false,
    finished_at: Date.now(),
    board_week: o.week === undefined ? WEEK : o.week,
  };
  const save = {
    ...common,
    game_ref: `ref${id}`.slice(0, 30),
    rev: 40,
    src: 'none',
    fresh: !o.seen,
    first_seen: IDS.map(() => !o.seen),
    round: 9,
    step: 'kept',
    phase: 'reveal',
    results,
    sent: [],
    finished: true,
    clock: null,
    drafts: {},
    timing: IDS.map(() => ({ seconds_left: 30, active_ms: 20000, ready_ms: 100 })),
  };
  return { save, snapshot: { ...common, results, total } };
}

async function seed(page: Page, game: ReturnType<typeof finishedGame>, extra: Record<string, string> = {}) {
  await page.goto('./');
  await page.evaluate(
    ([g, more]) => {
      localStorage.setItem('museumguessr:v1:save', JSON.stringify(g.save));
      localStorage.setItem('museumguessr:v1:last', JSON.stringify(g.snapshot));
      localStorage.setItem('museumguessr:v1:ever-seen', JSON.stringify(g.save.item_ids));
      for (const [k, v] of Object.entries(more)) localStorage.setItem(k, v);
    },
    [game, extra] as const,
  );
}

/** Seed a finished game and open its end screen ("Review your 10"). */
async function openEnd(page: Page, game = finishedGame(), query = '') {
  await seed(page, game);
  await page.goto(`./${query}`);
  await page.locator('[data-test=review]').click();
  await expect(page.locator('[data-screen=end]')).toBeVisible();
}

const status = (page: Page) => page.locator('[data-test=board-status]');
const store = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('museumguessr:v1:board') ?? '{"games":{}}') as { games: Record<string, { status: string; outcome: string }> });

test.describe('[W6] the weekly board on the end screen', () => {
  test('a finished game goes on the board with no click: round ten asks the week, the end card shows its status [V12-80] [V12-108] [V12-139]', async ({ page, board, recorder }) => {
    // round ten of a game in progress, its first nine rounds played
    const g = finishedGame({ id: 'game-board-roundten-01', week: null });
    const save = {
      ...g.save,
      finished: false,
      finished_at: null,
      board_week: null,
      round: 9,
      step: 'made',
      phase: 'answering',
      answers: g.save.answers.map((a, i) => (i === 9 ? { kept: null, made: null, when: null } : a)),
      results: g.save.results.map((r, i) => (i === 9 ? null : r)),
      timing: g.save.timing.map((t, i) => (i === 9 ? null : t)),
    };
    await page.goto('./');
    await page.evaluate((s) => localStorage.setItem('museumguessr:v1:save', JSON.stringify(s)), save);
    // a reload in the same tab goes straight back to the round
    await page.goto('./');
    await expect(page.locator('[data-screen=round][data-step=made]')).toBeVisible();
    // one anonymous read when round ten opens, without a key
    await expect.poll(() => board.reads().length).toBe(1);
    expect(board.reads()[0]!.headers.authorization).toBeUndefined();
    expect(await page.evaluate(() => localStorage.getItem('museumguessr:v1:board-key'))).toBeNull();
    await playRound(page);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('museumguessr:v1:save') ?? '{}').board_week)).toBe(WEEK);
    await page.locator('[data-test=next]').click();
    await expect(page.locator('[data-screen=end]')).toBeVisible();
    await expect(status(page)).toHaveText('Added: #12 of 40 this week');
    await expect(page.locator('[data-test=board-name]')).toHaveText(/^You appear as \w+ \w+ \w+$/);
    // one bearer read and one POST: the canonical payload with the server's week, the key only in the header
    expect(board.posts()).toHaveLength(1);
    expect(board.reads().filter((r) => r.headers.authorization)).toHaveLength(1);
    const post = board.posts()[0]!;
    const key = await page.evaluate(() => localStorage.getItem('museumguessr:v1:board-key'));
    expect(post.headers.authorization).toBe(`Bearer ${key}`);
    expect(post.body).toMatchObject({ game_id: 'game-board-roundten-01', deck_kind: 'random', board_week: WEEK, test_assisted: false, client_version: 1, turnstile_token: 'token-1' });
    expect(Object.keys(post.body!)).not.toContain('total');
    expect(await page.evaluate(() => (window as unknown as { __ts: { actions: string[] } }).__ts.actions)).toEqual(['board_submit']);
    // the board never opens by itself
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await recorder.idle(page);
    expect(recorder.of('board_submitted').map((e) => e.properties)).toEqual([expect.objectContaining({ reason: 'added', auto: true, src: 'none' })]);
    expect(JSON.stringify(recorder.events)).not.toContain(key!);
  });

  test('Share stays the first action after the score and the only filled primary; Play another 10 comes before the board card @layout [V12-116]', async ({ page, board }) => {
    await openEnd(page);
    await expect(status(page)).toHaveText('Added: #12 of 40 this week');
    const summary = page.locator('.end__summary');
    await expect(page.locator('[data-screen=end] .btn--primary')).toHaveCount(1);
    await expect(page.locator('[data-screen=end] .btn--primary')).toHaveAttribute('data-test', 'share');
    const order = await summary.evaluate((el) => [...el.querySelectorAll('button.btn, [data-test=board-card]')].map((b) => (b as HTMLElement).dataset.test));
    expect(order.slice(0, 3)).toEqual(['share', 'play-another', 'board-card']);
    // the first focusable action after the score is Share (the name disclosure is a link, not an action)
    const actions = await summary.evaluate((el) => [...el.querySelectorAll<HTMLElement>('button:not([hidden]), a[href]')].filter((b) => b.classList.contains('btn')).map((b) => b.dataset.test));
    expect(actions[0]).toBe('share');
    // total, tier and Share are above the fold on portrait phones; the card may sit below it
    const { width: vw, height: vh } = page.viewportSize()!;
    if (vw < 900 && vh > vw) {
      for (const sel of ['[data-test=end-total]', '.end__tier', '[data-test=share]']) {
        const box = await page.locator(sel).boundingBox();
        expect(box!.y + box!.height, sel).toBeLessThanOrEqual(vh);
      }
    }
    if (vw === 390 && vh === 844) {
      const another = await page.locator('[data-test=play-another]').boundingBox();
      expect(another!.y + another!.height).toBeLessThanOrEqual(vh);
    }
    expect(board.posts()).toHaveLength(1);
  });

  test('a game that does not beat this week\'s best is refused and keeps nothing to send; the card names both totals [V12-117]', async ({ page, board }) => {
    board.best = { row_id: 'mine', total: 25000, standing: { kind: 'exact', rank: 3, tied: false } };
    board.post = () => ({ status: 409, body: JSON.stringify({ reason: 'not_best', retryable: false, best: { row_id: 'mine', total: 25000, standing: null } }) });
    await openEnd(page);
    await expect(status(page)).toHaveText('Your best this week: 25,000 (#3 of 40 this week) · this game 18,240');
    await expect(page.locator('.board-card__note')).toHaveText("Ties and lower scores don't replace your best");
    const rec = (await store(page)).games['game-board-0000000001'] as unknown as { status: string; payload: unknown };
    expect(rec).toMatchObject({ status: 'refused', payload: null });
  });

  test('an interactive check opens the slot and says "Tap to finish adding", and the add completes once the player taps [V12-115]', async ({ page, board, context }) => {
    await stubTurnstile(context, 'interactive');
    await openEnd(page);
    await expect(status(page)).toHaveText('Tap to finish adding');
    await expect(page.locator('[data-test=board-slot]')).toHaveClass(/board-card__slot--open/);
    expect(board.posts()).toHaveLength(0);
    await page.locator('[data-test=turnstile-box]').click();
    await expect(status(page)).toHaveText('Added: #12 of 40 this week');
    await expect(page.locator('[data-test=board-slot]')).not.toHaveClass(/board-card__slot--open/);
  });

  test('verification that fails shows "Verification couldn\'t load" with Retry, and Retry asks again [V12-115]', async ({ page, board, context }) => {
    await stubTurnstile(context, 'fail');
    await openEnd(page);
    await expect(status(page)).toHaveText("Verification couldn't load");
    await expect(page.locator('[data-test=board-retry]')).toHaveText('Retry');
    expect(board.posts()).toHaveLength(0);
    await page.locator('[data-test=board-retry]').click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __ts: { executes: number; resets: number } }).__ts)).toMatchObject({ executes: 2, resets: 1 });
  });

  test('the edge\'s 429 page keeps the score pending to retry; the 1027 quota page reads as unavailable with Retry; a retry sends a fresh token [V12-111] [V12-114]', async ({ page, board }) => {
    const waf = '<!DOCTYPE html><html><head><title>Access denied</title></head><body>Error 1015 You are being rate limited</body></html>';
    const quota = '<!DOCTYPE html><html><body><span>Error code: 1027</span> This website has been temporarily rate limited</body></html>';
    let n = 0;
    board.post = (body) => {
      n += 1;
      if (n === 1) return { status: 429, body: waf, headers: { 'Retry-After': '1' } };
      if (n === 2) return { status: 429, body: quota };
      return { status: 201, body: JSON.stringify(board.score(body)) };
    };
    await openEnd(page);
    await expect(status(page)).toHaveText('Saved on this device; waiting to retry');
    expect((await store(page)).games['game-board-0000000001']).toMatchObject({ status: 'pending', outcome: 'edge_limited' });
    // Retry-After passes: the automatic retry meets the quota page
    await expect(status(page)).toHaveText('The board is unavailable right now', { timeout: 15_000 });
    await page.locator('[data-test=board-retry]').click();
    await expect(status(page)).toHaveText('Added: #12 of 40 this week');
    const tokens = board.posts().map((p) => p.body!.turnstile_token);
    expect(new Set(tokens).size).toBe(3);
  });

  test('switching "Add my games to the board" off stops the next automatic add [V12-120] [V12-121]', async ({ page, board }) => {
    await openEnd(page);
    await expect(status(page)).toHaveText('Added: #12 of 40 this week');
    await page.locator('[data-test=board-view]').click();
    await page.locator('[data-test=board-scores-open]').click();
    const toggle = page.locator('[data-test=board-auto]');
    await expect(toggle).toBeChecked();
    await expect(toggle).toHaveAttribute('role', 'switch');
    await toggle.uncheck();
    expect(await page.evaluate(() => localStorage.getItem('museumguessr:v1:board-auto'))).toBe('off');
    // the next finished game is not sent
    await openEnd(page, finishedGame({ id: 'game-board-0000000002' }));
    await expect(status(page)).toHaveText('Automatic board entry is off');
    expect(board.posts()).toHaveLength(1);
  });

  test('persistent storage is asked for only when the player opens the board, never on display or a successful add; opening it counts a view [V12-122] [V12-134]', async ({ page, board, recorder }) => {
    await openEnd(page);
    await expect(status(page)).toHaveText('Added: #12 of 40 this week');
    expect(await page.evaluate(() => (window as unknown as { __persist: number }).__persist)).toBe(0);
    await page.locator('[data-test=board-view]').click();
    await expect(page.locator('[data-test=board-table]')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __persist: number }).__persist)).toBe(1);
    await recorder.idle(page);
    expect(recorder.of('board_viewed')).toHaveLength(1);
    expect(board.posts()).toHaveLength(1);
  });

  test('the board lists ranks and totals in tabular figures with headers; this device\'s row is "You" with aria-current, and a cached list says so [V12-124] [V12-119]', async ({ page, board }) => {
    await openEnd(page);
    await expect(status(page)).toHaveText('Added: #12 of 40 this week');
    await page.locator('[data-test=board-view]').click();
    const table = page.locator('[data-test=board-table]');
    await expect(table.locator('thead th')).toHaveText(['Rank', 'Name', 'Score']);
    await expect(table.locator('[data-test=board-row]')).toHaveCount(2);
    // the list was read before this add: the receipt's rank shows, labelled as a cached list
    await expect(page.locator('[data-test=board-overlay-status]')).toHaveText('Updated a minute ago');
    const you = table.locator('[data-test=board-you]');
    await expect(you).toHaveAttribute('aria-current', 'true');
    await expect(you).toContainText('#12 of 40 this week');
    await expect(you).toContainText('You');
    await expect(you).toContainText('18,240');
    expect(await table.locator('td.board-table__total').first().evaluate((el) => getComputedStyle(el).fontVariantNumeric)).toContain('tabular-nums');
    expect(board.posts()).toHaveLength(1);
  });

  test('a test game reads "Not ranked (test game)" after ?test=0 and is never sent; a replay and an all-seen challenge are not ranked [V12-80]', async ({ page, board }) => {
    await openEnd(page, finishedGame({ test: true }), '?test=0');
    await expect(status(page)).toHaveText('Not ranked (test game)');
    await openEnd(page, finishedGame({ id: 'game-board-replay-0001', kind: 'replay' }));
    await expect(status(page)).toHaveText('Not ranked (replay)');
    await openEnd(page, finishedGame({ id: 'game-board-seen-00001', kind: 'challenge', seen: true }));
    await expect(status(page)).toHaveText('Not ranked (all objects seen before)');
    expect(board.posts()).toHaveLength(0);
  });

  test('Remove and Remove all confirm with the relative reset time, show Removing… then Removed, and return focus [V12-121]', async ({ page, board }) => {
    board.resets = new Date(Date.now() + 2.4 * 86_400_000).toISOString();
    board.best = { row_id: 'mine', total: 18240, standing: { kind: 'exact', rank: 12, tied: false } };
    board.weeks = [
      { week: WEEK, row_id: 'mine', total: 18240, rank: 12 },
      { week: '2026-W42', row_id: 'older', total: 21000, rank: 4 },
    ];
    await openEnd(page);
    await expect(status(page)).toHaveText('Added: #12 of 40 this week');
    await page.locator('[data-test=board-view]').click();
    await page.locator('[data-test=board-scores-open]').click();
    const list = page.locator('[data-test=board-scores] li');
    await expect(list).toHaveCount(2);
    await expect(list.first()).toContainText('This week · 18,240 · #12');
    await list.first().locator('[data-test=board-remove]').click();
    await expect(page.locator('dialog[open]').last()).toContainText("Remove this week's score? You can't add another score from this browser until the board resets in 2 days.");
    await page.locator('[data-test=board-remove-yes]').click();
    await expect(list).toHaveCount(1);
    await expect(page.locator('[data-test=board-remove]').first()).toBeFocused();
    expect(board.sent.filter((s) => s.method === 'DELETE').map((s) => s.path)).toEqual(['/api/v1/scores/mine']);
    await page.locator('[data-test=board-remove-all]').click();
    await page.locator('[data-test=board-remove-yes]').click();
    await expect(page.locator('[data-test=board-scores-status]')).toHaveText('No board scores from this browser yet');
    expect(board.sent.filter((s) => s.method === 'DELETE').map((s) => s.path)).toEqual(['/api/v1/scores/mine', '/api/v1/scores/older']);
    // the card follows: this week's score was removed
    await page.keyboard.press('Escape');
    await expect(status(page)).toHaveText('You removed your score this week');
  });

  test('two tabs opening their first board card at once end with one device key [V12-81]', async ({ context, board }) => {
    const a = await context.newPage();
    await seed(a, finishedGame());
    const b = await context.newPage();
    await Promise.all([a.goto('./'), b.goto('./')]);
    await Promise.all([a.locator('[data-test=review]').click(), b.locator('[data-test=review]').click()]);
    await expect(status(a)).toHaveText('Added: #12 of 40 this week');
    await expect(status(b)).toHaveText(/Added: #12 of 40 this week/);
    const keys = new Set(board.sent.filter((s) => s.headers.authorization).map((s) => s.headers.authorization));
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe(`Bearer ${await a.evaluate(() => localStorage.getItem('museumguessr:v1:board-key'))}`);
  });

  test('a Sunday 23:59 UTC finish whose POST failed is retried on Monday\'s load and refused as last week [V12-108] [V12-113]', async ({ page, board }) => {
    board.post = () => ({ status: 502, body: '<html>Bad gateway</html>' });
    await openEnd(page);
    await expect(status(page)).toHaveText('The board is unavailable right now');
    expect((await store(page)).games['game-board-0000000001']).toMatchObject({ status: 'pending' });
    // Monday: the server's week moved on; the pending record retries on load, with no card open
    board.week = NEXT_WEEK;
    board.resets = '2026-11-02T00:00:00.000Z';
    board.post = () => ({ status: 409, body: JSON.stringify({ reason: 'week_closed', retryable: false }) });
    // its backoff has passed by Monday
    await page.evaluate(() => {
      const data = JSON.parse(localStorage.getItem('museumguessr:v1:board')!);
      for (const r of Object.values(data.games) as { next_at: number }[]) r.next_at = 0;
      localStorage.setItem('museumguessr:v1:board', JSON.stringify(data));
    });
    await page.goto('./');
    await expect.poll(async () => (await store(page)).games['game-board-0000000001']?.status, { timeout: 15_000 }).toBe('refused');
    await page.locator('[data-test=review]').click();
    await expect(status(page)).toHaveText('Played last week · the board resets weekly');
  });

  test('the start screen shows the last confirmed standing from the device with no request, and nothing without a receipt [V12-123]', async ({ page, board }) => {
    await page.goto('./');
    await expect(page.locator('[data-screen=start]')).toBeVisible();
    await expect(page.locator('[data-test=start-standing]')).toHaveCount(0);
    const resets = new Date(Date.now() + 2.4 * 86_400_000).toISOString();
    await page.evaluate((r) => localStorage.setItem('museumguessr:v1:board-standing', JSON.stringify({ week: '2026-W43', resets_at: r, total: 21340, rank: 12 })), resets);
    await page.reload();
    await expect(page.locator('[data-test=start-standing]')).toContainText('Your best this week: 21,340 · Last confirmed: #12 · resets in 2 days');
    await page.waitForTimeout(500);
    expect(board.sent).toHaveLength(0);
    await page.locator('[data-test=start-board]').click();
    await expect(page.locator('[data-test=board-table]')).toBeVisible();
  });

  test('without the board in the build there is no card and no Turnstile in the CSP; this build allows Turnstile [V12-125]', async ({ page }) => {
    await page.goto('./');
    const csp = await page.locator('meta[http-equiv=Content-Security-Policy]').getAttribute('content');
    expect(csp).toContain('frame-src https://challenges.cloudflare.com');
    expect(await page.locator('meta[name=board-ui]').getAttribute('content')).toBe('on');
    const deploy = readFileSync(join(import.meta.dirname, '../../dist/index.html'), 'utf8');
    expect(deploy).toContain('<meta name="board-ui" content="off"');
    expect(deploy).not.toContain('challenges.cloudflare.com');
  });

  test('the local end fixture finishes a test-assisted game under the public fixture key and runs the dark smoke path to not_best [V12-127]', async ({ page, board }) => {
    board.mode = 'dark';
    board.post = (body) => {
      expect(body.test_assisted).toBe(true);
      return { status: 409, body: JSON.stringify({ reason: 'not_best', retryable: false, best: { row_id: 'seed', total: 29000, standing: null } }) };
    };
    await page.goto('./?fixture=end-random');
    await expect(page.locator('[data-screen=end]')).toBeVisible({ timeout: 20_000 });
    await expect(status(page)).toHaveText(/^Your best this week: 29,000 \(Not ranked \(test game\)\) · this game [\d,]+$/);
    expect(await page.evaluate(() => localStorage.getItem('museumguessr:v1:board-key'))).toBe('AAAAAAAAAAAAAAAAAAAAAA');
    for (const r of board.reads()) expect(r.headers['x-museumguessr-test']).toBe('1');
    expect(new URL(page.url()).search).toBe('');
  });
});
