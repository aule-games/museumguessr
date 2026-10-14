import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { confirm, enterYear, expect, placePin, playRound, start, test } from './fixtures';

const items = JSON.parse(readFileSync(join(import.meta.dirname, '../../data/items.json'), 'utf8')).items as {
  id: string;
  title: string;
  kept: { lat: number; lng: number; city: string };
  made: { lat: number; lng: number; place: string };
  when: { start: number; end: number };
}[];

test.describe('[E6] [DS8] [ENG14] resume', () => {
  test('a reload mid-round 2 lands on the same step with round 1 kept and no duplicate events', async ({ page, recorder }) => {
    await start(page);
    await playRound(page);
    const scoreAfter1 = await page.locator('[data-test=total]').textContent();
    await page.locator('[data-test=next]').click();
    await placePin(page, 40.7, -74);
    await confirm(page);
    await expect(page.locator('[data-screen=round][data-step=made][data-round="2"]')).toBeVisible();
    await recorder.idle(page);
    const before = recorder.events.filter((e) => e.event !== '$pageview' && e.event !== 'client_error').length;

    await page.reload();
    await expect(page.locator('[data-screen=round][data-step=made][data-round="2"]')).toBeVisible();
    await expect(page.locator('[data-test=total]')).toHaveText(scoreAfter1 ?? '');
    await recorder.idle(page);
    const after = recorder.events.filter((e) => e.event !== '$pageview' && e.event !== 'client_error').length;
    expect(after).toBe(before);
    const pv = recorder.of('$pageview');
    expect(pv).toHaveLength(2);
    expect(pv[1]?.properties.resumed).toBe(true);
    expect(pv[1]?.properties.landing).toBe(false);
  });

  test('a later visit sees Continue on the start screen; New game starts over [DS24]', async ({ context, page }) => {
    await start(page);
    await playRound(page);
    await page.locator('[data-test=next]').click();
    const later = await context.newPage();
    await later.goto('./');
    await expect(later.locator('[data-test=continue]')).toHaveText('Continue · Round 2 of 10');
    await later.locator('[data-test=continue]').click();
    await expect(later.locator('[data-screen=round][data-round="2"]')).toBeVisible();
    // the first tab lost the writer lock (ENG30)
    await expect(page.locator('[data-screen=frozen]')).toBeVisible();
    await page.locator('[data-test=take-over]').click();
    await expect(page.locator('[data-screen=round][data-round="2"]')).toBeVisible();
    await expect(later.locator('[data-screen=frozen]')).toBeVisible();
  });

  test('a corrupt save starts a new game and keeps the test flag', async ({ page }) => {
    await page.goto('./?test=1');
    await page.evaluate(() => localStorage.setItem('museumguessr:v1:save', '{broken'));
    await page.goto('./');
    await expect(page.locator('[data-test=start]')).toBeVisible();
    await expect(page.locator('[data-test=test-badge]')).toBeVisible();
  });
});

test.describe('[DS23] [R1] image and map readiness', () => {
  test('a blocked photo: Start waits at most 4 s, Confirm stays disabled, retry, then skip after 3 failures', async ({ page, recorder, context }) => {
    const first = items[0]?.id;
    await context.route(new RegExp(`/assets/${first}-[^/]+\\.jpg`), (r) => r.abort('connectionrefused'));
    await page.goto('./');
    const startBtn = page.locator('[data-test=start]');
    await expect(startBtn).toBeEnabled({ timeout: 6000 });
    await startBtn.click();
    await expect(page.locator('[data-test=photo]')).toHaveAttribute('data-state', 'failed');
    await placePin(page, 48.86, 2.35);
    await expect(page.locator('[data-test=confirm]')).toBeDisabled();
    for (let i = 0; i < 3; i++) {
      await page.locator('[data-test=retry-image]').click();
      await expect(page.locator('[data-test=photo]')).toHaveAttribute('data-state', 'failed');
    }
    await page.locator('[data-test=skip]').click();
    await expect(page.locator('[data-screen=reveal]')).toBeVisible();
    await recorder.idle(page);
    expect(recorder.of('round_completed')[0]?.properties).toMatchObject({ round: 1, skipped: true, answered_count: 0 });
  });

  test('[ENG1] no WebGL: the start screen says so and one client_error is sent', async ({ page, recorder }) => {
    await page.addInitScript(() => {
      const orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (type === 'webgl2' || type === 'webgl') return null;
        return (orig as (...a: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof orig;
    });
    await page.goto('./');
    await expect(page.getByRole('alert')).toContainText('WebGL is off');
    await recorder.idle(page);
    expect(recorder.of('client_error').map((e) => e.properties.name)).toEqual(['webgl_unavailable']);
  });

  test('[DS11] [ENG32] blocked tiles switch to the bundled map and pins still work', async ({ page }) => {
    await start(page);
    await expect(page.locator('.map')).toHaveAttribute('data-state', 'fallback', { timeout: 6000 });
    await placePin(page, 48.86, 2.35);
    await expect(page.locator('.map__label')).toContainText('Near');
  });

  test('[PH2] map error reports carry no web addresses', async ({ page, recorder }) => {
    await start(page);
    await expect(page.locator('.map')).toHaveAttribute('data-state', 'fallback', { timeout: 6000 });
    await expect.poll(() => recorder.of('client_error').length, { timeout: 6000 }).toBeGreaterThan(0);
    for (const e of recorder.of('client_error')) expect(String(e.properties.message)).not.toMatch(/:\/\/|\?/);
  });
});

test.describe('[A1] [DS6] no answer before the reveal', () => {
  test('round text and alt attributes carry no title; the reveal does', async ({ page }) => {
    await start(page);
    const item = items[0];
    if (!item) throw new Error('no items');
    const titleWords = item.title.split(/\W+/).filter((w) => w.length > 4);
    const roundText = (await page.locator('main').innerText()).toLowerCase();
    const alts = (await page.locator('img').evaluateAll((els) => els.map((e) => (e as HTMLImageElement).alt + ' ' + (e as HTMLImageElement).src))).join(' ').toLowerCase();
    for (const w of titleWords) {
      expect(roundText).not.toContain(w.toLowerCase());
      expect(alts).not.toContain(w.toLowerCase());
    }
    const saved = await page.evaluate(() => localStorage.getItem('museumguessr:v1:save') ?? '');
    for (const w of titleWords) expect(saved.toLowerCase()).not.toContain(w.toLowerCase());
    await playRound(page);
    await expect(page.locator('[data-test=reveal-title]')).toHaveText(item.title);
  });
});

test.describe('[DS15] [V4] [DS7] [DS25] a full game', () => {
  test('ten rounds end on the results screen; Copy result copies the template; replay starts over', async ({ page, context, recorder }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await start(page);
    for (let r = 0; r < 10; r++) {
      const it = items[r];
      if (!it) throw new Error('missing item');
      await playRound(page, { kept: [it.kept.lat, it.kept.lng], made: [it.made.lat, it.made.lng], year: it.when.start });
      await page.locator('[data-test=next]').click();
    }
    await expect(page.locator('[data-screen=end]')).toBeVisible();
    await expect(page.locator('[data-test=recap] li')).toHaveCount(10);
    await page.locator('[data-test=copy]').click();
    await expect(page.locator('[data-test=copied]')).toHaveText('Copied');
    const text = await page.evaluate(() => navigator.clipboard.readText());
    const lines = text.split('\n');
    expect(lines[0]).toMatch(/^MuseumGuessr [\d,]+\/30,000$/);
    for (let r = 1; r <= 10; r++) expect(lines[r]).toMatch(new RegExp(`^R${r} [\\d,]+ · kept [\\d,]+ km · made [\\d,]+ km · [\\d,]+ yrs$`));
    expect(lines[11]).toBe('Same 10 objects for everyone');
    expect(lines[12]).toBe('https://aule-games.github.io/museumguessr/?utm_source=share&utm_medium=share');
    await recorder.idle(page);
    expect(recorder.of('game_completed')).toHaveLength(1);
    expect(recorder.of('result_copied')[0]?.properties.method).toBe('clipboard');

    await page.locator('[data-test=replay]').click();
    await expect(page.locator('[data-screen=round][data-round="1"]')).toBeVisible();
    await recorder.idle(page);
    expect(recorder.of('game_start')).toHaveLength(2);

    // ENG37: a finished game can be reviewed later
    await page.reload();
    await page.goto('./');
  });
});

test.describe('[V2] [DS17] [DS31] reveal details', () => {
  test('the difficulty row shows after round 3 only; Next works at once and stays visible', async ({ page, recorder }) => {
    await start(page);
    for (let r = 0; r < 3; r++) {
      await playRound(page);
      if (r < 2) {
        await expect(page.locator('[data-test=pulse]')).toHaveCount(0);
        await page.locator('[data-test=next]').click();
      }
    }
    await expect(page.locator('[data-test=pulse]')).toBeVisible();
    const next = await page.locator('[data-test=next]').boundingBox();
    const vh = page.viewportSize()?.height ?? 0;
    expect((next?.y ?? 0) + (next?.height ?? 0)).toBeLessThanOrEqual(vh);
    await page.locator('[data-test=pulse-about_right]').click();
    await page.locator('[data-test=pulse-about_right]').count();
    await page.locator('[data-test=next]').click();
    await expect(page.locator('[data-screen=round][data-round="4"]')).toBeVisible();
    await recorder.idle(page);
    expect(recorder.of('feedback').map((e) => [e.properties.q, e.properties.a])).toEqual([['difficulty', 'about_right']]);
  });

  test('the reveal shows the journey fact, three score rows and a credit line', async ({ page }) => {
    await start(page);
    await playRound(page);
    await expect(page.locator('[data-test=journey]')).toBeVisible();
    for (const s of ['kept', 'made', 'when']) await expect(page.locator(`[data-test=row-${s}]`)).toBeVisible();
    await page.locator('[data-test=row-when]').click();
    await expect(page.locator('.timeline')).toBeVisible();
    await expect(page.locator('.reveal__credit')).toContainText('Photo:');
  });
});

test.describe('[DS13] [ENG17] [DS27] overlays and history', () => {
  test('Back closes the photo lightbox and keeps the round', async ({ page }) => {
    await start(page);
    await expect(page.locator('[data-test=photo]')).toHaveAttribute('data-state', 'ready');
    for (let i = 0; i < 3; i++) {
      await page.locator('.photo__open').click();
      await expect(page.locator('.pswp')).toBeVisible();
      await page.goBack();
      await expect(page.locator('.pswp')).toHaveCount(0);
    }
    await expect(page.locator('[data-screen=round]')).toBeVisible();
  });

  test('the menu opens How to play, Credits (one row per photo) and About & privacy', async ({ page }) => {
    await start(page);
    for (const [item, check] of [
      ['menu-how', 'How to play'],
      ['menu-credits', 'Credits'],
      ['menu-about', 'About & privacy'],
    ] as const) {
      await page.locator('[data-test=menu]').click();
      await page.locator(`[data-test=${item}]`).click();
      await expect(page.getByRole('dialog')).toContainText(check);
      if (item === 'menu-credits') await expect(page.locator('[data-test=credits] li')).toHaveCount(11);
      if (item === 'menu-about') await expect(page.locator('[data-test=events] li')).toHaveCount(10);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
  });

  test('New game from the menu asks first', async ({ page, recorder }) => {
    await start(page);
    await page.locator('[data-test=menu]').click();
    await page.locator('[data-test=menu-new]').click();
    await page.locator('[data-test=confirm-new]').click();
    await expect(page.locator('[data-screen=round][data-round="1"]')).toBeVisible();
    await recorder.idle(page);
    expect(recorder.of('game_start')).toHaveLength(2);
  });
});

test.describe('[DS5] [DS28] year control', () => {
  test('enters a BCE year and rejects year 0', async ({ page }) => {
    await start(page);
    await placePin(page, 48.86, 2.35);
    await confirm(page);
    await placePin(page, 41.9, 12.5);
    await confirm(page);
    await page.getByLabel('Year', { exact: true }).fill('0');
    await expect(page.locator('.year__message')).toHaveText("There's no year 0. Try 1 BCE or 1 CE.");
    await expect(page.locator('[data-test=confirm]')).toBeDisabled();
    await enterYear(page, -420);
    await expect(page.locator('.year__readout')).toHaveText('420 BCE');
    const slider = page.getByRole('slider');
    await slider.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.year__readout')).toHaveText('419 BCE');
    await page.keyboard.press('PageUp');
    await expect(page.locator('.year__readout')).toHaveText('319 BCE');
    await confirm(page);
    await expect(page.locator('[data-screen=reveal]')).toBeVisible();
  });
});

test.describe('[DS19] [DS1] layout @layout', () => {
  test('the round screen never scrolls and Confirm stays on screen', async ({ page }) => {
    await start(page);
    await expect(page.locator('[data-screen=round]')).toBeVisible();
    for (const step of ['kept', 'made', 'when']) {
      const fits = await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1);
      expect(fits, `page scrolls on ${step}`).toBe(true);
      const box = await page.locator('[data-test=confirm]').boundingBox();
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(page.viewportSize()?.height ?? 0);
      if (step === 'when') break;
      await placePin(page, 48.86, 2.35);
      await confirm(page);
    }
  });

  test('the reveal reads top to bottom: top bar, wall label, map, then Next on screen', async ({ page }) => {
    await start(page);
    await playRound(page);
    const vw = page.viewportSize()?.width ?? 0;
    const vh = page.viewportSize()?.height ?? 0;
    const bar = await page.locator('[data-screen=reveal] .topbar').boundingBox();
    const title = await page.locator('[data-test=reveal-title]').boundingBox();
    const map = await page.locator('[data-test=reveal-map]').boundingBox();
    const next = await page.locator('[data-test=next]').boundingBox();
    if (!bar || !title || !map || !next) throw new Error('reveal region missing');
    expect(bar.y, 'top bar at the top').toBeLessThanOrEqual(1);
    expect(title.y, 'wall label below the top bar').toBeGreaterThanOrEqual(bar.y + bar.height - 1);
    expect(title.y + title.height, 'wall label in the top half').toBeLessThanOrEqual(vh / 2);
    expect(title.x + title.width, 'wall label inside the viewport').toBeLessThanOrEqual(vw + 1);
    expect(map.width, 'map uses at least 40% of the width').toBeGreaterThanOrEqual(vw * 0.4);
    expect(next.y, 'Next below the wall label').toBeGreaterThan(title.y + title.height);
    expect(next.y + next.height, 'Next on screen').toBeLessThanOrEqual(vh);
  });
});
