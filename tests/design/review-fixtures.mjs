// Fixtures for the built-screen matrix's v1.2 states (V12-160): saved games
// with a chosen deck, finished games, a scripted board API and a Turnstile
// stand-in. Like tests/e2e/board.spec.ts, nothing here reaches a network:
// every /api/ request is answered by BoardMock, and Turnstile is a stub.
import { readFileSync } from 'node:fs';
import { itemsVersion } from '../../src/content/version.ts';
import { MATERIALS, QUALITIES, THINGS } from '../../src/board/name-words.ts';
import { SCORING_VERSION } from '../../src/scoring/config.ts';
import { STATE_VERSION } from '../../src/state/schema.ts';

export const ITEMS = JSON.parse(readFileSync(new URL('../../data/items.json', import.meta.url), 'utf8')).items;
const byId = new Map(ITEMS.map((it) => [it.id, it]));
export const item = (id) => byId.get(id);

/** Ten pool ids in a chosen order, the first ones given, then the rest of the pool. */
export function deckOf(first) {
  const rest = ITEMS.map((it) => it.id).filter((id) => !first.includes(id));
  return [...first, ...rest].slice(0, 10);
}

/** The first pool object of each difficulty (1 Easy, 2 Medium, 3 Hard). */
export const byDifficulty = (d) => ITEMS.find((it) => it.difficulty === d).id;

/** The deck hash, with any capture-only date overrides (`{ id: { start, end } }`) the page also sees. */
const hash = (ids, dates = {}) => itemsVersion(ids.map((id) => (dates[id] ? { ...item(id), when: { ...item(id).when, ...dates[id] } } : item(id))));

/**
 * An object whose dates begin before the year control's 4000 BCE stop, for
 * the reveal's broken axis (D11). The pool's own, when it has one; else a
 * donor object (the oldest with no date note and a unique date pair) whose dates the capture
 * rewrites in the built bundle and item chunk, so scoring, the deck hash
 * and the reveal all agree.
 */
export function earlyObject() {
  const real = ITEMS.find((it) => it.when.start < -4000);
  if (real) return { id: real.id, fixture: null };
  const unique = (it) => ITEMS.filter((o) => o.when.start === it.when.start && o.when.end === it.when.end).length === 1;
  const donor = [...ITEMS].sort((a, b) => a.when.start - b.when.start).find((it) => it.when.start < 0 && !it.when.note && unique(it));
  return { id: donor.id, fixture: { from: { start: donor.when.start, end: donor.when.end }, start: -9500, end: -9000, label: 'capture fixture: 9500–9000 BC' } };
}

/** Rewrite the donor's dates in the main bundle and the item chunk for this context (see earlyObject). */
export async function routeEarlyObject(context, early, problems) {
  if (!early.fixture) return;
  const { from, start, end, label } = early.fixture;
  await context.route(/\/assets\/(index|items)-[\w-]+\.js$/, async (route) => {
    const res = await route.fetch();
    let n = 0;
    const body = (await res.text()).replace(/when:\{start:(-?[\d.e+]+),end:(-?[\d.e+]+)(,label:`[^`]*`)?/g, (m, s, e, l) => {
      if (Number(s) !== from.start || Number(e) !== from.end) return m;
      n += 1;
      return `when:{start:${start},end:${end}${l ? `,label:\`${label}\`` : ''}`;
    });
    if (n !== 1) problems.push(`the early-object fixture matched ${n} date pairs in ${new URL(route.request().url()).pathname}`);
    await route.fulfill({ response: res, body });
  });
}

export const WEEK = '2026-W43';
export const LAST_WEEK = '2026-W42';
export const NEXT_WEEK = '2026-W44';

const blank = () => ({ kept: null, made: null, when: null });
const row = (points) => ({ made: { points: 600, km: 120 }, when: { points: 300, yearsOff: 15 }, kept: { points: Math.max(0, points - 900), km: 3 }, points, skipped: false });

/** A game in progress at round `round` (0-based), Made step, no clock yet: the page opens straight into it. */
export function gameInProgress(ids, { id = 'game-review-0000000001', round = 0, dates = {} } = {}) {
  return {
    state_version: STATE_VERSION,
    scoring_version: SCORING_VERSION,
    items_version: hash(ids, dates),
    game_id: id,
    game_ref: `ref-${id}`,
    rev: 1,
    src: 'none',
    item_ids: ids,
    deck_kind: 'random',
    deck_hash: hash(ids, dates),
    fresh: true,
    first_seen: ids.map(() => true),
    challenge: null,
    round,
    step: 'made',
    phase: 'answering',
    answers: ids.map((_, i) => (i < round ? { kept: { lat: 48.85, lng: 2.35 }, made: { lat: 41.9, lng: 12.5 }, when: 1500 } : blank())),
    results: ids.map((_, i) => (i < round ? row(1800) : null)),
    sent: [],
    finished: false,
    clock: null,
    drafts: {},
    timed_out: ids.map(() => null),
    timing: ids.map((_, i) => (i < round ? { seconds_left: 30, active_ms: 20000, ready_ms: 100 } : null)),
    test_assisted: false,
    finished_at: null,
    board_week: null,
  };
}

/**
 * A finished game on this device, as the end screen saves it, so "Review
 * your 10" opens its end screen. `points` per round; `timedOut` per round
 * (a list of the questions that ran out, or null).
 */
export function finishedGame(o = {}) {
  const ids = o.ids ?? ITEMS.slice(0, 10).map((it) => it.id);
  const id = o.id ?? 'game-review-0000000001';
  const points = o.points ?? ids.map(() => 1824);
  const results = points.map(row);
  const total = results.reduce((sum, r) => sum + r.points, 0);
  const common = {
    state_version: STATE_VERSION,
    scoring_version: SCORING_VERSION,
    items_version: hash(ids),
    game_id: id,
    item_ids: ids,
    deck_kind: o.kind ?? 'random',
    deck_hash: hash(ids),
    challenge: o.kind === 'challenge' ? { score: 20000, name: null } : null,
    answers: ids.map(() => ({ kept: { lat: 48.85, lng: 2.35 }, made: { lat: 41.9, lng: 12.5 }, when: 1500 })),
    timed_out: ids.map((_, i) => (o.timedOut?.[i] ? { questions: o.timedOut[i], counted: [], away: false } : null)),
    test_assisted: o.test ?? false,
    finished_at: Date.now(),
    board_week: o.week === undefined ? WEEK : o.week,
  };
  const save = {
    ...common,
    game_ref: `ref-${id}`,
    rev: 40,
    src: 'none',
    fresh: !o.seen,
    first_seen: ids.map(() => !o.seen),
    round: ids.length - 1,
    step: 'kept',
    phase: 'reveal',
    results,
    sent: [],
    finished: true,
    clock: null,
    drafts: {},
    timing: ids.map(() => ({ seconds_left: 30, active_ms: 20000, ready_ms: 100 })),
  };
  return { save, snapshot: { ...common, results, total } };
}

/** Clear this origin's storage and write the given keys; the tour counts as seen. */
export async function resetStorage(page, url, entries = {}) {
  await page.goto(`${url}build.txt`);
  await page.evaluate((more) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('museumguessr:v1:tour', 'done');
    for (const [k, v] of Object.entries(more)) localStorage.setItem(k, v);
  }, entries);
}

/** Open a saved game in progress at round 1: Start offers Continue, which opens the round. */
export async function openGame(page, url, ids, { dates = {}, extra = {} } = {}) {
  const save = gameInProgress(ids, { dates });
  await resetStorage(page, url, { 'museumguessr:v1:save': JSON.stringify(save), ...extra });
  await page.goto(url);
  await page.locator('[data-test=continue]').click();
  await page.locator('[data-screen=round][data-step=made]').waitFor();
}

/** Seed a finished game and open its end screen with "Review your 10". */
export async function openEnd(page, url, game, extra = {}) {
  await resetStorage(page, url, {
    'museumguessr:v1:save': JSON.stringify(game.save),
    'museumguessr:v1:last': JSON.stringify(game.snapshot),
    'museumguessr:v1:ever-seen': JSON.stringify(game.save.item_ids),
    ...extra,
  });
  await page.goto(url);
  await page.locator('[data-test=review]').click();
  await page.locator('[data-screen=end]').waitFor();
}

/** Fifty generated names, long ones first among the lower rows, so wrapping shows. */
export function boardRows(count = 50, mine = null) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    const name = `${QUALITIES[(i * 7 + 3) % QUALITIES.length]} ${MATERIALS[(i * 11 + 5) % MATERIALS.length]} ${THINGS[(i * 13 + 1) % THINGS.length]}`;
    rows.push({ row_id: `top-${i + 1}`, name, total: 27120 - i * 173, rank: i + 1, date: '2026-10-20' });
  }
  if (mine) rows.splice(mine.rank - 1, 1, { row_id: mine.row_id, name: mine.name, total: mine.total, rank: mine.rank, date: '2026-10-22' });
  return rows;
}

/** A gate: `wait()` resolves once `open()` is called. */
function gate() {
  let open;
  const promise = new Promise((resolve) => { open = resolve; });
  return { wait: () => promise, open: () => open() };
}

/** The board API as the Worker answers it, scripted per state. */
export class BoardMock {
  constructor() { this.reset(); }

  reset() {
    this.sent = [];
    this.mode = 'on';
    this.week = WEEK;
    this.resets = new Date(Date.now() + 2.4 * 86_400_000).toISOString();
    this.count = 40;
    this.rows = boardRows(50);
    this.best = null;
    this.weeks = [];
    this.readStatus = 200;
    this.readGate = null;
    this.postGate = null;
    this.deleteGate = null;
    /** The receipt's standing and whether the add improved this week's best. */
    this.standing = { kind: 'exact', rank: 12, tied: false };
    this.replaced = false;
    this.post = (body) => ({ status: 201, body: JSON.stringify(this.score(body)) });
  }

  /** Hold the next board read, the next POST or the next DELETE until released. */
  holdRead() { this.readGate = gate(); return this.readGate.open; }
  holdPost() { this.postGate = gate(); return this.postGate.open; }
  holdDelete() { this.deleteGate = gate(); return this.deleteGate.open; }

  /** A confirmed add of 18,240; the device's best follows it, as the Worker's does. */
  score(body) {
    const total = 18240;
    const rank = this.standing.kind === 'exact' ? this.standing.rank : null;
    this.best = { row_id: 'mine', total, standing: this.standing };
    this.weeks = [{ week: this.week, row_id: 'mine', total, rank }, ...this.weeks.filter((w) => w.week !== this.week)];
    return {
      receipt: { game_id: body.game_id, current_game_id: body.game_id, row_id: 'mine', week: this.week, total, status: 'current', receipt_rank: rank, count: this.count, best: { row_id: 'mine', total, standing: this.standing } },
      replaced: this.replaced,
      smoke: false,
    };
  }

  async handle(route) {
    const req = route.request();
    const url = new URL(req.url());
    const headers = req.headers();
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    this.sent.push({ method: req.method(), path: url.pathname });
    const json = (status, v) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(v) });
    const bearer = headers.authorization?.startsWith('Bearer ');
    if (req.method() === 'GET' && url.pathname === '/api/v1/board') {
      if (this.readGate) { const g = this.readGate; this.readGate = null; await g.wait(); }
      if (this.readStatus !== 200) return route.fulfill({ status: this.readStatus, contentType: 'text/html', body: '<html>Service unavailable</html>' });
      if (this.mode === 'off') return json(200, { disabled: true });
      const personal = bearer ? { personal: { name: 'Bold Ochre Lantern', best: this.best, weeks: this.weeks } } : {};
      return json(200, { week: this.week, resets_at: this.resets, count: this.count, cutoff_total: 12000, rows: this.rows, updated_at: new Date(Date.now() - 60_000).toISOString(), ...personal });
    }
    if (req.method() === 'POST' && url.pathname === '/api/v1/scores' && bearer) {
      if (this.postGate) { const g = this.postGate; this.postGate = null; await g.wait(); }
      const r = this.post(body ?? {});
      return route.fulfill({ status: r.status, body: r.body, headers: { 'Content-Type': r.body.startsWith('{') ? 'application/json' : 'text/html', ...(r.headers ?? {}) } });
    }
    const del = /^\/api\/v1\/scores\/([\w-]+)$/.exec(url.pathname);
    if (req.method() === 'DELETE' && del && bearer) {
      if (this.deleteGate) { const g = this.deleteGate; this.deleteGate = null; await g.wait(); }
      const week = this.weeks.find((w) => w.row_id === del[1])?.week ?? this.week;
      this.weeks = this.weeks.filter((w) => w.row_id !== del[1]);
      if (this.best?.row_id === del[1]) this.best = null;
      return json(200, { removed: true, row_id: del[1], week });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{"reason":"not_found"}' });
  }
}

/**
 * A stand-in for Turnstile's API. Its mode is read at each execute from
 * localStorage `review:turnstile`: pass (a token), interactive (a 300×65
 * check the player must press, the real widget's size), fail (an error),
 * or hold (nothing until `window.__tsRelease()`).
 */
export async function stubTurnstile(context) {
  await context.addInitScript(() => {
    let opts = {};
    let host = null;
    let n = 0;
    window.turnstile = {
      render(el, o) { opts = o; host = el; return 'w1'; },
      execute() {
        n += 1;
        const token = `token-${n}`;
        const mode = localStorage.getItem('review:turnstile') ?? 'pass';
        if (mode === 'fail') return void setTimeout(() => opts['error-callback'](), 10);
        if (mode === 'hold') { window.__tsRelease = () => opts.callback(token); return; }
        if (mode === 'interactive') {
          setTimeout(() => {
            opts['before-interactive-callback']();
            const widget = document.createElement('div');
            widget.style.width = '300px';
            widget.style.height = '65px';
            widget.style.display = 'flex';
            widget.style.alignItems = 'center';
            widget.style.border = '1px solid #d0d0d0';
            widget.style.background = '#fafafa';
            widget.style.color = '#222';
            widget.style.font = '14px sans-serif';
            widget.style.boxSizing = 'border-box';
            widget.style.padding = '0 12px';
            widget.textContent = 'Verify you are human (stand-in for the check)';
            host?.append(widget);
          }, 10);
          return;
        }
        setTimeout(() => opts.callback(token), 10);
      },
      reset() {},
      remove() {},
    };
  });
}
