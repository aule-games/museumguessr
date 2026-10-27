import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { confirm, enterYear, expect, mapReady, placePin, playRound, start, test } from './fixtures';

// The 60-second round clock (W3). Time is driven by Playwright's clock: it is
// installed before the page loads and flows normally until a test jumps it.

type Clock = { round: number; deadline: number | null; remaining_ms: number | null; paused: boolean; stopped: boolean; limit_ms: number | null };
type Save = { round: number; phase: string; clock: Clock | null; sent: string[]; timed_out: ({ questions: string[]; counted: string[]; away: boolean } | null)[]; test_assisted: boolean };

const save = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('museumguessr:v1:save') ?? 'null') as unknown) as Promise<Save | null>;

/** Milliseconds left on the round's clock, as the save holds it; null before the clock starts. */
async function left(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const c = (JSON.parse(localStorage.getItem('museumguessr:v1:save') ?? 'null') as { clock: Clock | null } | null)?.clock;
    if (!c) return null;
    return c.paused || c.deadline === null ? c.remaining_ms : c.deadline - Date.now();
  });
}

async function clockRunning(page: Page) {
  await expect.poll(() => left(page), { timeout: 15_000 }).not.toBeNull();
  await expect.poll(async () => (await save(page))?.clock?.paused, { timeout: 15_000 }).toBe(false);
}

/** Jump the clock until `ms` remain (one tick fires, like a laptop lid opening). */
async function jumpTo(page: Page, ms: number) {
  const l = (await left(page)) ?? 0;
  await page.clock.fastForward(Math.max(0, Math.round(l - ms)));
}

const revealShown = (s: Save | null) => !!s?.sent.some((k) => k.includes(':reveal_shown:'));

async function hide(page: Page, hidden: boolean) {
  await page.evaluate((h) => {
    if (h) {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    } else {
      delete (document as unknown as Record<string, unknown>).visibilityState;
      delete (document as unknown as Record<string, unknown>).hidden;
    }
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

test.describe('[W3] the round clock', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.install();
  });

  test('the clock starts when the photo and map are ready; the line runs and pauses with the map; the failed map says so [V12-41] [V12-42]', async ({ page }) => {
    await start(page);
    const line = page.locator('[data-screen=round] .topbar [data-test=clock-line]');
    await mapReady(page);
    await clockRunning(page);
    await expect(line).toHaveAttribute('data-state', 'running');
    // a map context loss pauses the clock, even at two seconds left (ENG8)
    await jumpTo(page, 2_000);
    const canvas = page.locator('.map__canvas canvas');
    await canvas.evaluate((c) => c.dispatchEvent(new Event('webglcontextlost')));
    await expect(line).toHaveAttribute('data-state', 'paused');
    const paused = await left(page);
    expect(paused).toBeGreaterThan(1_000);
    await page.clock.runFor(2_000);
    expect(await left(page)).toBe(paused);
    await canvas.evaluate((c) => c.dispatchEvent(new Event('webglcontextrestored')));
    await expect(line).toHaveAttribute('data-state', 'running');
    await canvas.evaluate((c) => c.dispatchEvent(new Event('webglcontextlost')));
    await page.clock.runFor(3_500);
    await expect(page.locator('.map')).toHaveAttribute('data-state', 'failed');
    await expect(page.locator('[data-test=clock-paused-map]')).toHaveText('The clock is paused until the map works');
    await page.clock.runFor(10_000);
    await expect(page.locator('[data-screen=round]')).toBeVisible();
  });

  test('a reload with 30 s left reopens the round with about 30 s; a reload after the deadline lands on Start, whose Continue opens the reveal [V12-52]', async ({ page, recorder }) => {
    await start(page);
    await clockRunning(page);
    await jumpTo(page, 30_000);
    await page.reload();
    await expect(page.locator('[data-screen=round][data-round="1"]')).toBeVisible();
    const after = (await left(page)) ?? 0;
    expect(after).toBeGreaterThan(25_000);
    expect(after).toBeLessThanOrEqual(30_000);

    // the page is closed past the deadline: nothing ticks until it loads again
    await clockRunning(page);
    const now = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(now + 1_000);
    await page.clock.setSystemTime(now + 1_000 + after + 20_000);
    await page.reload();
    await page.clock.resume();
    await expect(page.locator('[data-test=continue]')).toHaveText('Continue · Round 1 of 10 (time ran out)');
    // the expiry is saved, but no reveal was seen yet (N5)
    expect(revealShown(await save(page))).toBe(false);
    await recorder.idle(page);
    expect(recorder.of('round_completed')).toHaveLength(0);
    await page.locator('[data-test=continue]').click();
    await expect(page.locator('[data-screen=reveal]')).toBeVisible();
    await expect(page.locator('[data-test=timed-out-away]')).toHaveText('Time ran out while you were away');
    for (const step of ['made', 'when', 'kept']) await expect(page.locator(`[data-test=row-${step}]`)).toHaveAttribute('data-status', 'timedout');
    await recorder.idle(page);
    expect(recorder.of('round_completed').map((e) => [e.properties.timed_out, e.properties.seconds_left])).toEqual([[3, 0]]);
  });

  test('a hidden tab keeps the clock running; returning after the deadline skips the hold and says time ran out while away [V12-43] [V12-50] [V12-51]', async ({ page }) => {
    await start(page);
    await clockRunning(page);
    await hide(page, true);
    await page.clock.fastForward(30_000);
    expect((await save(page))?.clock?.paused).toBe(false);
    await page.clock.fastForward(40_000);
    // expired while hidden: saved, but not yet a completed round
    await expect.poll(async () => (await save(page))?.phase).toBe('reveal');
    expect(revealShown(await save(page))).toBe(false);
    await hide(page, false);
    await expect(page.locator('[data-screen=reveal] [data-test=timed-out-away]')).toBeVisible();
    await expect.poll(async () => revealShown(await save(page))).toBe(true);
  });

  test('focus and pageshow re-check the saved deadline [V12-44]', async ({ page }) => {
    await start(page);
    await clockRunning(page);
    // a second ahead: under load more than 100 ms can pass before pauseAt, which cannot go back
    const now = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(now + 1_000);
    await page.clock.setSystemTime(now + 1_000 + ((await left(page)) ?? 0) + 5_000);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.locator('[data-screen=reveal] [data-test=timed-out-away]')).toBeVisible();
    await page.clock.resume();
    await page.locator('[data-test=next]').click();
    await clockRunning(page);
    const then = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(then + 1_000);
    await page.clock.setSystemTime(then + 1_000 + ((await left(page)) ?? 0) + 5_000);
    await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
    await expect(page.locator('[data-screen=reveal][data-round="2"] [data-test=timed-out-away]')).toBeVisible();
    await page.clock.resume();
  });

  test('round_completed carries the timer evidence and the per-game reference [V12-78] [V12-32]', async ({ page, recorder }) => {
    await start(page);
    await playRound(page);
    await page.locator('[data-test=next]').click();
    await recorder.idle(page);
    const rc = recorder.of('round_completed')[0]?.properties ?? {};
    expect(rc).toMatchObject({ timed_out: 0, skipped: false });
    expect(rc.seconds_left).toBeGreaterThan(0);
    expect(rc.seconds_left).toBeLessThanOrEqual(60);
    expect(rc.active_ms).toBeGreaterThan(0);
    expect(rc.ready_ms).toBeGreaterThanOrEqual(0);
    const ref = recorder.of('game_start')[0]?.properties.game_ref;
    expect(ref).toMatch(/^[A-Za-z0-9_-]{22}$/);
    for (const name of ['round_started', 'round_completed']) for (const e of recorder.of(name)) expect(e.properties.game_ref, name).toBe(ref);
  });
});

test.describe('[D2] time-up with overlays and a drag', () => {
  test.use({ reducedMotion: 'no-preference' });
  test.beforeEach(async ({ page }) => {
    await page.clock.install();
  });

  test('time-up closes the photo viewer through history, holds "Time\'s up", then focuses the reveal score; the viewer shows the cue before 0 [V12-49] [V12-59]', async ({ page }) => {
    await start(page);
    await expect(page.locator('[data-test=photo]')).toHaveAttribute('data-state', 'ready');
    await clockRunning(page);
    await page.locator('.photo__open').click();
    await expect(page.locator('.pswp')).toBeVisible();
    await jumpTo(page, 9_000);
    await page.clock.runFor(500);
    const cue = page.locator('.pswp [data-test=clock-cue]');
    await expect(cue).toBeVisible();
    await expect(cue).toHaveText(/^Hurry up · \d$/);
    await expect(page.locator('.pswp [data-test=clock-line]')).toHaveAttribute('data-warning', 'true');
    await jumpTo(page, 300);
    await page.clock.runFor(500);
    await expect(page.locator('.pswp')).toHaveCount(0);
    await expect(page.locator('[data-screen=round].round--timeup .topbar [data-test=clock-cue]')).toHaveText("Time's up");
    await expect(page.locator('[data-test=announcer]')).toHaveText("Time's up");
    await page.clock.runFor(1_000);
    await expect(page.locator('[data-screen=reveal]')).toBeVisible();
    await expect(page.locator('[data-test=round-score]')).toBeFocused();
    expect(await page.evaluate(() => history.state)).toBeNull();
  });

  test('time-up closes the menu and ends a pin drag; the placed pin counts and history keeps no overlay entry [V12-49] [V12-48]', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await start(page);
    await clockRunning(page);
    await placePin(page, 41.9, 12.5);
    await page.locator('[data-test=menu]').click();
    await jumpTo(page, 9_000);
    await page.clock.runFor(300);
    // the dialog header repeats the cue
    await expect(page.getByRole('dialog').locator('[data-test=clock-cue]')).toHaveText(/^Hurry up · \d$/);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // start dragging the placed pin, and let the time run out mid-drag
    const pin = await page.locator('.map .pin--guess-made').boundingBox();
    if (!pin) throw new Error('no pin');
    await page.mouse.move(pin.x + pin.width / 2, pin.y + pin.height - 4);
    await page.mouse.down();
    await page.mouse.move(pin.x + 60, pin.y + 40, { steps: 4 });
    await page.locator('[data-test=menu]').evaluate((b) => (b as HTMLButtonElement).click());
    await expect(page.getByRole('dialog')).toBeVisible();
    await jumpTo(page, 300);
    await page.clock.runFor(1_500);
    await page.mouse.up();
    await expect(page.locator('[data-screen=reveal]')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(() => history.state)).toBeNull();
    await expect(page.locator('[data-test=counted-made]')).toHaveText('Counted at time-up');
    await expect(page.locator('[data-test=row-when]')).toHaveAttribute('data-status', 'timedout');
    expect(errors).toEqual([]);
  });

  test('an invalid year edit shows the previous answer, which counts at time-up [V12-48] [V12-47]', async ({ page }) => {
    await start(page);
    await clockRunning(page);
    await placePin(page, 41.9, 12.5);
    await confirm(page);
    await enterYear(page, 1450);
    await confirm(page);
    await page.locator('[data-test=back]').click();
    await page.getByLabel('Year', { exact: true }).fill('0');
    await expect(page.locator('[data-test=previous-answer]')).toHaveText('Previous answer: 1450 CE, used if time runs out');
    // the empty edit is in the save while it is being edited, so another tab would see it
    await expect.poll(async () => (await page.evaluate(() => JSON.parse(localStorage.getItem('museumguessr:v1:save') ?? '{}').drafts))).toEqual({ when: null });
    await jumpTo(page, 300);
    await page.clock.runFor(1_500);
    await expect(page.locator('[data-screen=reveal]')).toBeVisible();
    await expect(page.locator('[data-test=counted-when]')).toBeVisible();
    await expect(page.locator('[data-test=row-kept]')).toHaveAttribute('data-status', 'timedout');
  });
});

test.describe('[M4] the test surface', () => {
  test('one test surface sets ten seconds, pauses and ends the round, marks the game, and the first time-up reveal shows the tip once [V12-57] [V12-55] [V12-63]', async ({ page, recorder }) => {
    await page.goto('./?test=1');
    await page.locator('[data-test=start]').click();
    await clockRunning(page);
    await page.locator('[data-test=test-badge]').click();
    await page.locator('[data-test=test-ten-seconds]').click();
    await expect(page.locator('.topbar [data-test=clock-cue]')).toHaveText(/^Hurry up · (10|9)$/);
    expect((await save(page))?.test_assisted).toBe(true);
    await page.locator('[data-test=test-badge]').click();
    await page.locator('[data-test=test-pause-clock]').click();
    await expect(page.locator('.topbar [data-test=clock-line]')).toHaveAttribute('data-state', 'paused');
    await page.evaluate(() => (window as unknown as { __mgTest: { pauseClock(): void } }).__mgTest.pauseClock());
    await expect(page.locator('.topbar [data-test=clock-line]')).toHaveAttribute('data-state', 'running');
    await page.evaluate(() => (window as unknown as { __mgTest: { expire(): void } }).__mgTest.expire());
    await expect(page.locator('[data-screen=reveal]')).toBeVisible();
    await expect(page.locator('[data-test=time-up-tip]')).toHaveText('Pins and years you place count when time runs out.');
    await page.locator('[data-test=next]').click();
    await clockRunning(page);
    await page.evaluate(() => (window as unknown as { __mgTest: { expire(): void } }).__mgTest.expire());
    await expect(page.locator('[data-screen=reveal][data-round="2"]')).toBeVisible();
    await expect(page.locator('[data-test=time-up-tip]')).toHaveCount(0);
    // the recap counts the timed-out questions; test provenance survives ?test=0
    await page.locator('[data-test=test-badge]').click();
    await page.locator('[data-test=test-finish]').click();
    await expect(page.locator('[data-screen=end]')).toBeVisible();
    await expect(page.locator('[data-test=recap-timed-out]').first()).toHaveText('Time ran out on 3 of 3');
    await page.goto('./?test=0');
    const last = await page.evaluate(() => JSON.parse(localStorage.getItem('museumguessr:v1:last') ?? '{}').test_assisted);
    expect(last).toBe(true);
    await recorder.idle(page, 500);
  });

  test('the development untimed switch is compiled out of the built site [V12-57]', async ({ page }) => {
    const dir = join(import.meta.dirname, '../../dist/assets');
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.js'))) expect(readFileSync(join(dir, f), 'utf8'), f).not.toContain('__mgDev clock=off');
    await start(page, '?clock=off');
    expect(page.url()).not.toContain('clock=');
    await clockRunning(page);
    expect((await save(page))?.clock?.limit_ms).toBe(60_000);
  });

  test('the cue replaces the counter text in its slot without moving the bar @layout [V12-60]', async ({ page }) => {
    await page.goto('./?test=1');
    await page.locator('[data-test=start]').click();
    await clockRunning(page);
    const slot = page.locator('[data-screen=round] .topbar__cluster');
    const total = page.locator('[data-test=total]');
    const before = [await slot.boundingBox(), await total.boundingBox()];
    await expect(page.locator('[data-screen=round] [role=timer]')).toHaveText(/^About (60|50) seconds left$/);
    await page.evaluate(() => (window as unknown as { __mgTest: { tenSeconds(): void } }).__mgTest.tenSeconds());
    await expect(page.locator('.topbar [data-test=clock-cue]')).toBeVisible();
    await expect(page.locator('.topbar__round')).toBeHidden();
    expect([await slot.boundingBox(), await total.boundingBox()]).toEqual(before);
    await expect(page.locator('[data-screen=round] [role=timer]')).toHaveText('About 10 seconds left');
    await expect(page.locator('[data-test=announcer]')).toHaveText('10 seconds left');
  });
});

test.describe('[E20] keyboard timing', () => {
  test('a keyboard-only round finishes well inside 60 s; time and keystrokes are recorded as an automation floor [V12-77]', async ({ page }) => {
    await start(page);
    await mapReady(page);
    await clockRunning(page);
    const keys: Record<string, number> = { made: 0, when: 0, kept: 0 };
    const press = async (step: string, key: string) => {
      keys[step] = (keys[step] ?? 0) + 1;
      await page.keyboard.press(key);
    };
    const tabTo = async (step: string, selector: string) => {
      for (let i = 0; i < 40; i++) {
        if (await page.evaluate((sel) => document.activeElement?.matches(sel) ?? false, selector)) return;
        await press(step, 'Tab');
      }
      throw new Error(`could not tab to ${selector}`);
    };
    const t0 = Date.now();
    for (const step of ['made', 'when', 'kept']) {
      await expect(page.locator(`[data-screen=round][data-step=${step}]`)).toBeVisible();
      if (step === 'when') {
        await tabTo(step, '.year__field');
        for (const k of '1450') await press(step, k);
      } else {
        await mapReady(page);
        await tabTo(step, '.map__canvas canvas');
        await press(step, 'Enter');
      }
      await tabTo(step, '[data-test=confirm]');
      await press(step, 'Enter');
    }
    await expect(page.locator('[data-screen=reveal]')).toBeVisible();
    const ms = Date.now() - t0;
    console.log(`E20 keyboard floor: ${ms} ms for three answers; keystrokes made ${keys.made}, when ${keys.when}, kept ${keys.kept}`);
    expect((await save(page))?.timed_out[0]).toBeNull();
    expect(ms).toBeLessThan(60_000);
  });
});
