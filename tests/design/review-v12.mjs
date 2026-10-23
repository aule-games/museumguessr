// The v1.2 states of the built-screen matrix (V12-160, V12-161, V12-162):
// the round clock and its overlays, time-ups, difficulty, the early year
// stop, the keyboard-open year step, every board card state with the board
// overlay and "Your board scores", the start screen's standing line, and the
// 404 page. Time comes from Playwright's clock, never real waiting: a
// section freezes the clock and moves it to the second it wants to show.
// review-built.mjs supplies `kit`: the servers, contexts and the camera.
import { expect } from '@playwright/test';
import { t } from '../../src/copy.ts';
import { confirm, enterYear, mapReady, placePin } from '../e2e/fixtures.ts';
import {
  BoardMock, LAST_WEEK, NEXT_WEEK, WEEK, boardRows, byDifficulty, deckOf, earlyObject, finishedGame, item,
  openEnd, openGame, resetStorage, routeEarlyObject, stubTurnstile,
} from './review-fixtures.mjs';

/** A phone's on-screen keyboard height at each portrait or landscape viewport (desktop has none). */
const KEYBOARD = { '390x844': 336, '375x667': 260, '390x664': 291, '844x390': 190 };

/** Milliseconds left on the round's clock, as the save holds it; null before it starts. */
async function left(page) {
  return page.evaluate(() => {
    const c = JSON.parse(localStorage.getItem('museumguessr:v1:save') ?? 'null')?.clock;
    if (!c) return null;
    return c.paused || c.deadline === null ? c.remaining_ms : c.deadline - Date.now();
  });
}

/** Wait until the round's clock has started and runs. */
async function running(page) {
  await expect.poll(() => left(page), { timeout: 15_000 }).not.toBeNull();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('museumguessr:v1:save') ?? 'null')?.clock?.paused), { timeout: 15_000 }).toBe(false);
}

/** Freeze the clock and move it on until `ms` are left; one check runs, so the face shows that second. */
async function setLeft(kit, page, ms) {
  await kit.freeze(page);
  const l = (await left(page)) ?? 0;
  await page.clock.fastForward(Math.max(0, Math.round(l - ms)));
  await page.clock.runFor(300);
}

/** With the clock frozen: let it run in small steps until `done()` holds. */
async function advanceUntil(page, done, step = 200, max = 25) {
  for (let i = 0; i < max; i++) {
    if (await done()) return;
    await page.clock.runFor(step);
  }
  if (!(await done())) throw new Error('the page did not settle with the clock frozen');
}

async function hide(page, hidden) {
  await page.evaluate((h) => {
    if (h) {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    } else {
      delete document.visibilityState;
      delete document.hidden;
    }
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

const drawn = (page) => expect(page.locator('.map')).toHaveAttribute('data-reveal', 'drawn', { timeout: 8000 });
const dialogOpen = (page) => async () => (await page.locator('dialog[open]').count()) > 0;

/** Answer the round on screen exactly: both places at their coordinates, the year mid-range. */
async function answerExactly(page, id) {
  const it = item(id);
  await placePin(page, it.made.lat, it.made.lng, 2);
  await confirm(page);
  await enterYear(page, Math.round((it.when.start + it.when.end) / 2) || 1);
  await confirm(page);
  await placePin(page, it.kept.lat, it.kept.lng, 2);
  await confirm(page);
}

/** Answer roughly, with the year given (the early stop for -5000). */
async function answerRoughly(page, year) {
  await placePin(page, 41.9, 12.5);
  await confirm(page);
  await enterYear(page, year);
  await confirm(page);
  await placePin(page, 48.86, 2.35);
  await confirm(page);
}

// ---------- the round clock ----------

/**
 * One game, Hard then Medium then Easy objects first: the idle line while
 * the first photo loads, the draining line, the cue in the photo viewer, in
 * the menu and in a dialog, the warning on the round, the "Time's up" hold,
 * a draft counted at time-up with the one-time tip, the previous-answer
 * line, the keyboard-open year step with the cue, an expiry while away, the
 * failed-map pause, and the recap's "Time ran out on n of 3".
 */
export async function timerStates(kit, width, height) {
  const ctx = await kit.newContext(width, height);
  const page = await ctx.newPage();
  const shoot = (state, opts) => kit.shoot(page, state, opts);
  const ids = deckOf([byDifficulty(3), byDifficulty(2), byDifficulty(1)]);
  try {
    await kit.attempt(page, 'timer (round 1)', async () => {
      // the first photo waits until the idle line is captured: the clock starts only once it is ready
      let release;
      const held = new Promise((resolve) => { release = resolve; });
      await ctx.route(new RegExp(`/assets/${ids[0]}-[\\w-]+\\.jpg$`), async (route) => { await held; await route.continue(); });
      await openGame(page, kit.url, ids);
      const line = page.locator('[data-screen=round] .topbar [data-test=clock-line]');
      await mapReady(page);
      await expect(line).toHaveAttribute('data-state', 'idle');
      await shoot('timer-idle');
      release();
      await running(page);
      await placePin(page, 41.9, 12.5);
      await setLeft(kit, page, 30_000);
      await expect(line).toHaveAttribute('data-state', 'running');
      await shoot('timer-draining');
      await kit.thaw(page);
      await page.locator('.photo__open').click();
      await expect(page.locator('.pswp')).toBeVisible();
      await setLeft(kit, page, 8_000);
      await expect(page.locator('.pswp [data-test=clock-cue]')).toBeVisible();
      await shoot('timer-cue-photo-viewer');
      await page.keyboard.press('Escape');
      await advanceUntil(page, async () => (await page.locator('.pswp').count()) === 0);
      await expect(page.locator('.topbar [data-test=clock-cue]')).toBeVisible();
      await shoot('timer-warning');
      await page.locator('[data-test=menu]').click();
      await advanceUntil(page, dialogOpen(page));
      await expect(page.locator('dialog[open] [data-test=clock-cue]')).toBeVisible();
      await shoot('timer-cue-menu');
      await page.locator('[data-test=menu-how]').click();
      await advanceUntil(page, async () => (await page.locator('dialog[open]:not(.dialog--menu)').count()) > 0);
      await shoot('timer-cue-dialog');
      await page.keyboard.press('Escape');
      await advanceUntil(page, async () => !(await dialogOpen(page)()));
      // the "Time's up" hold, which reduced motion skips
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await setLeft(kit, page, 150);
      await expect(page.locator('[data-screen=round].round--timeup')).toBeVisible();
      await shoot('timer-time-up');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await advanceUntil(page, async () => (await page.locator('[data-screen=reveal]').count()) > 0);
      await kit.thaw(page);
      await drawn(page);
      await expect(page.locator('[data-test=time-up-tip]')).toBeVisible();
      await expect(page.locator('[data-test=counted-made]')).toBeVisible();
      await shoot('reveal-time-up-tip');
    });
    await kit.attempt(page, 'timer (round 2)', async () => {
      await page.locator('[data-test=next]').click();
      await expect(page.locator('[data-screen=round][data-round="2"]')).toBeVisible();
      await running(page);
      await placePin(page, 41.9, 12.5);
      await confirm(page);
      await enterYear(page, 1450);
      await confirm(page);
      await expect(page.locator('[data-screen=round][data-step=kept]')).toBeVisible();
      await page.locator('[data-test=back]').click();
      await page.getByLabel('Year', { exact: true }).fill('0');
      await expect(page.locator('[data-test=previous-answer]')).toBeVisible();
      await shoot('when-previous-answer');
      // the keyboard-open year step, cue showing: a simulated visual viewport (V12-71)
      await page.locator('.year__field').focus();
      await setLeft(kit, page, 8_000);
      const keyboard = KEYBOARD[`${width}x${height}`];
      if (keyboard) {
        const visible = height - keyboard;
        await page.evaluate((h) => {
          Object.defineProperty(visualViewport, 'height', { configurable: true, get: () => h });
          visualViewport.dispatchEvent(new Event('resize'));
        }, visible);
        await page.clock.runFor(100);
        await shoot('when-keyboard-hurry', { keyboard: true, clip: { x: 0, y: 0, width, height: visible }, note: `the on-screen keyboard is simulated: the visual viewport is ${keyboard} px shorter; the image shows only what stays above it` });
        await page.evaluate(() => {
          delete visualViewport.height;
          visualViewport.dispatchEvent(new Event('resize'));
        });
        await page.clock.runFor(100);
      }
      await setLeft(kit, page, 150);
      await advanceUntil(page, async () => (await page.locator('[data-screen=reveal]').count()) > 0);
      await kit.thaw(page);
      await drawn(page);
      await expect(page.locator('[data-test=counted-when]')).toBeVisible();
      await shoot('reveal-counted-previous');
    });
    await kit.attempt(page, 'timer (round 3)', async () => {
      await page.locator('[data-test=next]').click();
      await expect(page.locator('[data-screen=round][data-round="3"]')).toBeVisible();
      await running(page);
      await hide(page, true);
      await page.clock.fastForward(70_000);
      await hide(page, false);
      await expect(page.locator('[data-screen=reveal] [data-test=timed-out-away]')).toBeVisible();
      await drawn(page);
      await shoot('reveal-timed-out-away');
    });
    await kit.attempt(page, 'timer (rounds 4 to 10)', async () => {
      await page.locator('[data-test=next]').click();
      await expect(page.locator('[data-screen=round][data-round="4"]')).toBeVisible();
      await mapReady(page);
      await running(page);
      await page.locator('.map__canvas canvas').evaluate((c) => c.dispatchEvent(new Event('webglcontextlost')));
      await page.clock.runFor(3_500);
      await expect(page.locator('[data-test=clock-paused-map]')).toBeVisible();
      await shoot('timer-paused-map');
      await page.reload();
      for (let round = 4; round <= 10; round++) {
        await expect(page.locator(`[data-screen=round][data-round="${round}"]`)).toBeVisible();
        await running(page);
        await page.clock.fastForward(61_000);
        await expect(page.locator(`[data-screen=reveal][data-round="${round}"]`)).toBeVisible();
        await page.locator('[data-test=next]').click();
      }
      await expect(page.locator('[data-screen=end]')).toBeVisible();
      await expect(page.locator('[data-test=recap-timed-out]').first()).toBeVisible();
      await shoot('end-timed-out-recap');
    });
  } finally {
    await ctx.close();
  }
}

// ---------- difficulty, the hard mark, early dates, 404 ----------

export async function ruleStates(kit, width, height) {
  const ctx = await kit.newContext(width, height);
  const page = await ctx.newPage();
  const shoot = (state, opts) => kit.shoot(page, state, opts);
  try {
    for (const [d, word] of [[1, 'easy'], [2, 'medium'], [3, 'hard']]) {
      await kit.attempt(page, `difficulty-${word}`, async () => {
        await openGame(page, kit.url, deckOf([byDifficulty(d)]));
        await mapReady(page);
        await running(page);
        await expect(page.locator('.topbar [data-test=difficulty]')).toHaveAttribute('data-difficulty', String(d));
        await setLeft(kit, page, 40_000);
        await shoot(`difficulty-${word}`);
        await kit.thaw(page);
      });
    }
    await kit.attempt(page, 'reveal-hard-nailed', async () => {
      const id = byDifficulty(3);
      await openGame(page, kit.url, deckOf([id]));
      await answerExactly(page, id);
      await drawn(page);
      await expect(page.locator('[data-test=hard-nailed]')).toBeVisible();
      await shoot('reveal-hard-nailed');
    });
    await kit.attempt(page, 'end-hard-nailed', async () => {
      const hard = byDifficulty(3);
      const g = finishedGame();
      const points = g.save.item_ids.map((id) => (id === hard ? 2650 : 1824));
      await openEnd(page, kit.url, finishedGame({ points }));
      await expect(page.locator('[data-test=hard-count]')).toHaveText(new RegExp(t('hard.one')));
      await shoot('end-hard-nailed');
    });
    await kit.attempt(page, 'not-found', async () => {
      await page.goto(`${kit.url}404.html`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(t('notFound.title'));
      await shoot('not-found');
    });
  } finally {
    await ctx.close();
  }
  // an object dated before the year control's stop: the reveal's broken axis; then a younger
  // object guessed at the stop: its distance is measured from 4000 BCE (D11)
  const early = earlyObject();
  const ectx = await kit.newContext(width, height);
  const problems = [];
  await routeEarlyObject(ectx, early, problems);
  const ep = await ectx.newPage();
  const note = early.fixture
    ? `the pool has no object dated before 4000 BCE yet: this capture rewrites object ${early.id}'s dates to ${-early.fixture.start}–${-early.fixture.end} BCE in the built files, so its wall label and When row are not the real object's`
    : undefined;
  try {
    await kit.attempt(ep, 'reveal-early-axis', async () => {
      const younger = byDifficulty(1);
      const dates = early.fixture ? { [early.id]: { start: early.fixture.start, end: early.fixture.end } } : {};
      await openGame(ep, kit.url, deckOf([early.id, younger]), { dates });
      await answerRoughly(ep, -5000);
      await drawn(ep);
      await ep.locator('[data-test=row-when]').click();
      const axis = ep.locator('[data-test=timeline-broken]');
      await expect(axis).toBeVisible();
      await axis.scrollIntoViewIfNeeded();
      if (problems.length) throw new Error(problems.join('; '));
      await kit.shoot(ep, 'reveal-early-axis', { fold: false, keepScroll: true, note });
      await ep.locator('[data-test=next]').click();
      await expect(ep.locator('[data-screen=round][data-round="2"]')).toBeVisible();
      await answerRoughly(ep, -5000);
      await drawn(ep);
      await ep.locator('[data-test=row-when]').click();
      const distance = ep.locator('[data-test=early-distance]');
      await expect(distance).toBeVisible();
      await distance.scrollIntoViewIfNeeded();
      await kit.shoot(ep, 'reveal-early-distance', { fold: false, keepScroll: true });
    });
  } finally {
    await ectx.close();
  }
}

// ---------- 200% text, v1.2 states of the deploy build ----------

export async function text200States(kit, width, height) {
  const ctx = await kit.newContext(width, height, { text200: true });
  const page = await ctx.newPage();
  const shoot = (state, opts) => kit.shoot(page, `${state}-text200`, opts);
  try {
    await kit.attempt(page, 'difficulty-medium-text200', async () => {
      await openGame(page, kit.url, deckOf([byDifficulty(2)]));
      await mapReady(page);
      await running(page);
      await setLeft(kit, page, 40_000);
      await shoot('difficulty-medium');
      await kit.thaw(page);
    });
    await kit.attempt(page, 'timer-warning-text200', async () => {
      await openGame(page, kit.url, deckOf([byDifficulty(3)]));
      await mapReady(page);
      await running(page);
      await placePin(page, 41.9, 12.5);
      await confirm(page);
      await enterYear(page, -5000);
      await expect(page.locator('[data-test=year-cap]')).toHaveAttribute('data-selected', 'true');
      await shoot('when-early-stop');
      await setLeft(kit, page, 8_000);
      await expect(page.locator('.topbar [data-test=clock-cue]')).toBeVisible();
      await shoot('timer-warning');
      await setLeft(kit, page, 150);
      await advanceUntil(page, async () => (await page.locator('[data-screen=reveal]').count()) > 0);
      await kit.thaw(page);
      await drawn(page);
      await shoot('reveal-timed-out');
    });
    await kit.attempt(page, 'reveal-hard-nailed-text200', async () => {
      const id = byDifficulty(3);
      await openGame(page, kit.url, deckOf([id]));
      await answerExactly(page, id);
      await drawn(page);
      await expect(page.locator('[data-test=hard-nailed]')).toBeVisible();
      await shoot('reveal-hard-nailed');
    });
    await kit.attempt(page, 'end-hard-timed-out-text200', async () => {
      const hard = byDifficulty(3);
      const g = finishedGame();
      const points = g.save.item_ids.map((id) => (id === hard ? 2650 : 1824));
      const timedOut = g.save.item_ids.map((_, i) => (i === 1 ? ['when', 'kept'] : null));
      await openEnd(page, kit.url, finishedGame({ points, timedOut }));
      await expect(page.locator('[data-test=recap-timed-out]')).toHaveText(t('end.timedOut', { n: 2 }));
      await shoot('end-hard-timed-out');
    });
    await kit.attempt(page, 'not-found-text200', async () => {
      await page.goto(`${kit.url}404.html`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(t('notFound.title'));
      await shoot('not-found');
    });
  } finally {
    await ctx.close();
  }
}

// ---------- the weekly board (board-test build, /api/ mocked) ----------

const WAF = '<!DOCTYPE html><html><head><title>Access denied</title></head><body>Error 1015 You are being rate limited</body></html>';
const exact = (rank, tied = false) => ({ kind: 'exact', rank, tied });

/**
 * Every card state of the board-state table that a finished game can reach,
 * the board overlay (top 50 with the You row, the own row below the list,
 * ties, empty, low count, unavailable), "Your board scores" with the switch
 * and its remove dialogs, and the start screen's standing line. At 200%
 * text, a subset (`text200`).
 */
export async function boardStates(kit, width, height, { text200 = false } = {}) {
  const ctx = await kit.newContext(width, height, { origin: kit.boardUrl, text200 });
  const api = new BoardMock();
  // after the context's same-origin route, so this one answers first
  await ctx.route(/\/api\//, (route) => api.handle(route));
  await stubTurnstile(ctx);
  const page = await ctx.newPage();
  const url = kit.boardUrl;
  const suffix = text200 ? '-text200' : '';
  const card = page.locator('[data-test=board-card]');
  const status = page.locator('[data-test=board-status]');
  const shoot = (state, opts) => kit.shoot(page, `${state}${suffix}`, opts);
  const SUBSET = new Set(['board-first-add', 'board-not-best', 'start-standing', 'board-scores']);
  const step = async (name, fn) => {
    if (text200 && !SUBSET.has(name)) return;
    api.reset();
    await kit.attempt(page, `${name}${suffix}`, fn);
  };
  let n = 0;
  const game = (o = {}) => finishedGame({ id: `game-review-board-${String(++n).padStart(4, '0')}`, ...o });
  const end = (g, turnstile = 'pass', extra = {}) => openEnd(page, url, g, { 'review:turnstile': turnstile, ...extra });
  const state = (key) => expect(card).toHaveAttribute('data-state', key);
  const reopen = async () => {
    await page.goto(url);
    await page.locator('[data-test=review]').click();
    await expect(page.locator('[data-screen=end]')).toBeVisible();
  };
  const olderBest = () => {
    api.best = { row_id: 'older-best', total: 15000, standing: exact(20) };
    api.weeks = [{ week: WEEK, row_id: 'older-best', total: 15000, rank: 20 }, { week: LAST_WEEK, row_id: 'older', total: 21000, rank: 4 }];
  };
  const standingSeed = (total, rank) => ({
    'museumguessr:v1:board-key': 'B'.repeat(22),
    'museumguessr:v1:board-standing': JSON.stringify({ week: WEEK, resets_at: api.resets, total, rank }),
  });
  const fromStart = async (total, rank) => {
    await resetStorage(page, url, standingSeed(total, rank));
    await page.goto(url);
    await page.locator('[data-test=start-board]').click();
    await expect(page.locator('dialog[open]')).toBeVisible();
  };
  try {
    // a fresh device: the read, then the first add's disclosure, then Added
    await step('board-first-add', async () => {
      const read = api.holdRead();
      await end(game(), 'hold');
      await expect(card).toHaveAttribute('data-state', 'loading');
      if (!text200) await shoot('board-loading');
      read();
      await state('board.firstAdd');
      await shoot('board-first-add');
      await page.evaluate(() => window.__tsRelease());
      await state('board.added');
      await expect(page.locator('[data-test=board-name]')).toBeVisible();
      await shoot('board-added');
      await page.locator('[data-test=board-view]').click();
      await expect(page.locator('[data-test=board-table]')).toBeVisible();
      await expect(page.locator('[data-test=board-overlay-status]')).toHaveText(t('board.cached'));
      await shoot('board-overlay-cached');
    });
    await step('board-checking', async () => {
      olderBest();
      api.replaced = true;
      await end(game(), 'hold');
      await state('board.checking');
      await shoot('board-checking');
      await page.evaluate(() => window.__tsRelease());
      await state('board.newBest');
      await shoot('board-new-best');
    });
    await step('board-adding', async () => {
      olderBest();
      const post = api.holdPost();
      await end(game());
      await state('board.adding');
      await shoot('board-adding');
      post();
      await state('board.added');
    });
    await step('board-not-best', async () => {
      api.best = { row_id: 'mine', total: 25000, standing: exact(3) };
      api.post = () => ({ status: 409, body: JSON.stringify({ reason: 'not_best', retryable: false, best: { row_id: 'mine', total: 25000, standing: null } }) });
      await end(game());
      await state('board.notBest');
      await shoot('board-not-best');
    });
    await step('board-replaced', async () => {
      await end(game());
      await state('board.added');
      api.best = { row_id: 'mine', total: 25000, standing: exact(3) };
      await reopen();
      await state('board.replaced');
      await shoot('board-replaced');
      api.best = { row_id: 'someone-else', total: 25000, standing: null };
      await reopen();
      await state('board.hidden');
      await shoot('board-hidden');
      api.week = NEXT_WEEK;
      api.best = null;
      api.weeks = [{ week: WEEK, row_id: 'mine', total: 18240, rank: 9 }];
      await reopen();
      await state('board.lastRank');
      await shoot('board-last-rank');
    });
    await step('board-pending', async () => {
      api.post = () => ({ status: 429, body: WAF, headers: { 'Retry-After': '600' } });
      await end(game());
      await state('board.pending');
      await shoot('board-pending');
    });
    await step('board-tap-to-finish', async () => {
      await end(game(), 'interactive');
      await state('board.tapToFinish');
      await expect(page.locator('[data-test=board-slot]')).toHaveClass(/board-card__slot--open/);
      await shoot('board-tap-to-finish', { note: 'the verification check is a same-size stand-in for the real widget' });
    });
    await step('board-verification-failed', async () => {
      await end(game(), 'fail');
      await state('board.verificationFailed');
      await shoot('board-verification-failed');
    });
    await step('board-unavailable', async () => {
      api.post = () => ({ status: 502, body: '<html>Bad gateway</html>' });
      await end(game());
      await state('board.unavailable');
      await shoot('board-unavailable');
    });
    await step('board-sent-unavailable', async () => {
      api.readStatus = 503;
      await end(game());
      await state('board.sentUnavailable');
      await shoot('board-sent-unavailable');
    });
    await step('board-update-page', async () => {
      api.post = () => ({ status: 409, body: JSON.stringify({ reason: 'update_page', retryable: false }) });
      await end(game());
      await state('board.updatePage');
      await shoot('board-update-page');
    });
    await step('board-unknown-week', async () => {
      await end(game({ week: null }));
      await state('board.unknownWeek');
      await shoot('board-unknown-week');
    });
    await step('board-last-week', async () => {
      await end(game({ week: LAST_WEEK }));
      await state('board.lastWeek');
      await shoot('board-last-week');
    });
    await step('board-auto-off', async () => {
      await end(game(), 'pass', { 'museumguessr:v1:board-auto': 'off' });
      await state('board.autoOff');
      await shoot('board-auto-off');
    });
    await step('board-not-ranked', async () => {
      await end(game({ kind: 'replay' }));
      await state('board.notRankedReplay');
      await shoot('board-not-ranked-replay');
      await end(game({ test: true }));
      await state('board.notRankedTest');
      await shoot('board-not-ranked-test');
    });
    await step('board-low-count', async () => {
      api.count = 6;
      api.rows = boardRows(6);
      await end(game());
      await state('board.added');
      await expect(status).toHaveText(t('board.added', { standing: t('board.rankLow', { rank: 12 }) }));
      await shoot('board-added-low-count');
      await page.locator('[data-test=board-view]').click();
      await expect(page.locator('[data-test=board-overlay-status]')).toContainText(t('board.lowCount'));
      await shoot('board-overlay-low-count');
    });
    await step('board-below-top50', async () => {
      api.count = 300;
      api.standing = { kind: 'percentile', top_percent: 23.4 };
      await end(game());
      await state('board.added');
      await shoot('board-added-below-top50');
      api.reset();
      api.count = 300;
      api.standing = { kind: 'distance', points_to_top_50: 1240 };
      await end(game());
      await state('board.added');
      await shoot('board-added-distance');
    });
    // the start screen's standing line and the board overlay opened from it
    await step('start-standing', async () => {
      api.best = { row_id: 'mine', total: 21340, standing: exact(12) };
      api.rows = boardRows(50, { row_id: 'mine', name: 'Bold Ochre Lantern', total: 21340, rank: 12 });
      await resetStorage(page, url, standingSeed(21340, 12));
      await page.goto(url);
      await expect(page.locator('[data-test=start-standing]')).toBeVisible();
      await shoot('start-standing');
      await page.locator('[data-test=start-board]').click();
      const you = page.locator('[data-test=board-you]');
      await expect(you).toBeVisible();
      await shoot('board-overlay-top50');
      await you.scrollIntoViewIfNeeded();
      await shoot('board-overlay-top50-you', { keepScroll: true });
    });
    await step('board-overlay-tied-below', async () => {
      // rows 47 to 50 share one total; this device's equal score was added after them
      const rows = boardRows(50);
      const tie = rows[46].total;
      for (const r of rows.slice(46)) Object.assign(r, { total: tie, rank: 47 });
      api.count = 300;
      api.rows = rows;
      api.best = { row_id: 'mine', total: tie, standing: exact(47, true) };
      await fromStart(tie, 47);
      const own = page.locator('[data-test=board-own]');
      await expect(own).toContainText(t('board.tiedOutside', { rank: 47 }));
      await own.scrollIntoViewIfNeeded();
      await shoot('board-overlay-tied-below', { keepScroll: true });
    });
    await step('board-overlay-below-top50', async () => {
      api.count = 300;
      api.best = { row_id: 'mine', total: 9000, standing: { kind: 'percentile', top_percent: 23.4 } };
      await fromStart(9000, 120);
      const own = page.locator('[data-test=board-own]');
      await expect(own).toContainText(t('board.percentile', { percent: 24 }));
      await own.scrollIntoViewIfNeeded();
      await shoot('board-overlay-below-top50', { keepScroll: true });
    });
    await step('board-overlay-empty', async () => {
      api.count = 0;
      api.rows = [];
      await fromStart(21340, 1);
      await expect(page.locator('[data-test=board-overlay-status]')).toHaveText(t('board.empty'));
      await shoot('board-overlay-empty');
    });
    await step('board-overlay-unavailable', async () => {
      api.readStatus = 503;
      await fromStart(21340, 12);
      await expect(page.locator('[data-test=board-overlay-status]')).toHaveText(t('board.unavailable'));
      await shoot('board-overlay-unavailable');
    });
    // "Your board scores": two weeks, the switch, each remove dialog, Removing…, then nothing left
    await step('board-scores', async () => {
      api.weeks = [{ week: LAST_WEEK, row_id: 'older', total: 21000, rank: 4 }];
      await end(game());
      await state('board.added');
      await page.locator('[data-test=board-view]').click();
      await page.locator('[data-test=board-scores-open]').click();
      const list = page.locator('[data-test=board-scores] li');
      await expect(list).toHaveCount(2);
      await shoot('board-scores');
      const ask = page.locator('[data-test=board-remove-yes]');
      const keep = async () => {
        await page.locator('[data-test=board-keep]').click();
        await expect(ask).toHaveCount(0);
      };
      await list.first().locator('[data-test=board-remove]').click();
      await expect(ask).toBeVisible();
      await shoot('board-remove-this-week');
      await keep();
      if (text200) return;
      await list.nth(1).locator('[data-test=board-remove]').click();
      await expect(ask).toBeVisible();
      await shoot('board-remove-older-week');
      await keep();
      await page.locator('[data-test=board-remove-all]').click();
      await expect(ask).toBeVisible();
      await shoot('board-remove-all');
      await keep();
      await page.locator('[data-test=board-auto]').uncheck();
      await shoot('board-scores-auto-off');
      await page.locator('[data-test=board-auto]').check();
      const removed = api.holdDelete();
      await list.first().locator('[data-test=board-remove]').click();
      await ask.click();
      await expect(page.locator('[data-test=board-remove-status]')).toHaveText(t('board.removing'));
      await shoot('board-removing');
      removed();
      await expect(list).toHaveCount(1);
      await shoot('board-scores-removed');
      await page.locator('[data-test=board-remove-all]').click();
      await ask.click();
      await expect(page.locator('[data-test=board-scores-status]')).toHaveText(t('board.noScores'));
      await shoot('board-scores-empty');
      await page.keyboard.press('Escape');
      await state('board.removed');
      await shoot('board-removed');
    });
  } finally {
    await ctx.close();
  }
}
