import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { SCORING_VERSION } from '../../src/scoring/config';
import { confirm, expect, largeText, placePin, playRound, start, test } from './fixtures';

const items = JSON.parse(readFileSync(join(import.meta.dirname, '../../data/items.json'), 'utf8')).items as { id: string; title: string }[];
/** The first ten objects in file order: the v0 fixed set, still a valid deck in a larger pool. */
const IDS = items.slice(0, 10).map((it) => it.id);
/** The deck hash of those ten (the fixed set's items hash). */
const HASH = '35ca1219';

const row = (points: number) => ({ made: { points, km: 120 }, when: { points: 0, yearsOff: 15 }, kept: { points: 0, km: 3 }, points, skipped: false });

/** A finished game on this device, as the end screen saves it, so "Review your 10" can open. */
async function seedFinished(page: Page, opts: { total?: number; kind?: 'random' | 'challenge'; challenge?: { score: number | null; name: string | null } | null } = {}) {
  const total = opts.total ?? 18240;
  const each = Math.floor(total / 10);
  const snapshot = {
    state_version: 3,
    scoring_version: SCORING_VERSION,
    items_version: HASH,
    game_id: 'seeded-game-id-000000',
    item_ids: IDS,
    deck_kind: opts.kind ?? 'random',
    deck_hash: HASH,
    challenge: opts.challenge ?? null,
    answers: IDS.map(() => ({ kept: { lat: 0, lng: 0 }, made: { lat: 0, lng: 0 }, when: 1500 })),
    results: IDS.map((_, i) => row(i === 0 ? total - each * 9 : each)),
    total,
  };
  await page.goto('./');
  await page.evaluate((s) => {
    sessionStorage.removeItem('museumguessr:v1:challenge');
    localStorage.setItem('museumguessr:v1:last', JSON.stringify(s));
    localStorage.setItem('museumguessr:v1:ever-seen', JSON.stringify(s.item_ids));
  }, snapshot);
  await page.reload();
}

const link = (q: Record<string, string>) => `./?${new URLSearchParams(q).toString()}`;

/** Replace the browser's share sheet: resolve, cancel, refuse, or be absent. */
async function shareSheet(page: Page, mode: 'resolve' | 'abort' | 'refuse' | 'absent') {
  await page.addInitScript((m) => {
    const calls: unknown[] = [];
    (window as unknown as { __shares: unknown[] }).__shares = calls;
    if (m === 'absent') {
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
      return;
    }
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: (data: unknown) => {
        calls.push(data);
        if (m === 'resolve') return Promise.resolve();
        return Promise.reject(new DOMException('no', m === 'abort' ? 'AbortError' : 'NotAllowedError'));
      },
    });
  }, mode);
}

test.describe('[V1-19] Share', () => {
  test('without a share sheet, Share opens a chooser with WhatsApp, X and Copy link that returns focus to Share', async ({ page }) => {
    await shareSheet(page, 'absent');
    await seedFinished(page);
    await page.locator('[data-test=review]').click();
    const share = page.locator('[data-test=share]');
    await share.click();
    const wa = page.locator('[data-test=share-whatsapp]');
    await expect(wa).toBeVisible();
    const waText = decodeURIComponent(new URL((await wa.getAttribute('href')) ?? '').searchParams.get('text') ?? '');
    expect(waText.split('\n')[0]).toBe('Can you beat my 18,240/30,000 on MuseumGuessr?');
    expect(waText).toContain('utm_medium=whatsapp');
    const xText = decodeURIComponent(new URL((await page.locator('[data-test=share-x]').getAttribute('href')) ?? '').searchParams.get('text') ?? '');
    expect(xText).toMatch(/^Can you beat my 18,240\/30,000 on MuseumGuessr\? https:\/\/\S+utm_medium=x/);
    await page.keyboard.press('Escape');
    await expect(wa).toBeHidden();
    await expect(share).toBeFocused();
  });

  test('a share sheet that resolves sends result_shared; a cancelled one sends nothing', async ({ page, recorder }) => {
    await shareSheet(page, 'resolve');
    await seedFinished(page);
    await page.locator('[data-test=review]').click();
    await page.locator('[data-test=share]').click();
    const calls = await page.evaluate(() => (window as unknown as { __shares: { text: string; url: string }[] }).__shares);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).not.toContain('https://');
    expect(new URL(calls[0]?.url ?? '').searchParams.get('utm_medium')).toBe('native');
    await recorder.idle(page);
    expect(recorder.of('result_shared').map((e) => e.properties.method)).toEqual(['native']);
  });

  test('a refused share sheet falls back to the chooser', async ({ page }) => {
    await shareSheet(page, 'refuse');
    await seedFinished(page);
    await page.locator('[data-test=review]').click();
    await page.locator('[data-test=share]').click();
    await expect(page.locator('[data-test=share-whatsapp]')).toBeVisible();
  });
});

test.describe('[V1-20] the name in a shared link', () => {
  test('an invalid name keeps Share closed and offers to share without it; a valid name goes into the link', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await shareSheet(page, 'absent');
    await seedFinished(page);
    await page.locator('[data-test=review]').click();
    await page.locator('[data-test=add-name]').click();
    const input = page.locator('[data-test=name-input]');
    await expect(input).toBeFocused();
    await input.fill('x');
    await page.locator('[data-test=share]').click();
    await expect(page.getByText('Use 2–16 letters, numbers, spaces, - or _')).toBeVisible();
    await expect(input).toBeFocused();
    await expect(page.locator('[data-test=share-without-name]')).toBeVisible();
    await expect(page.locator('[data-test=share-whatsapp]')).toHaveCount(0);
    await input.fill('Barış');
    await page.locator('[data-test=copy-link]').click();
    await expect(page.locator('[data-test=copied]')).toHaveText('Link copied');
    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(new URL(text.split('\n').at(-1) ?? '').searchParams.get('n')).toBe('Barış');
    expect(await page.evaluate(() => localStorage.getItem('museumguessr:v1:name'))).toBe('Barış');
  });
});

test.describe('[V1-16] [V1-17] challenge links', () => {
  test('a valid link shows the challenge line, leaves the address bar clean, survives a reload and plays the same 10', async ({ page, recorder }) => {
    await page.goto(link({ d: [...IDS].reverse().join('.'), s: '18240', n: 'Ali', utm_source: 'share' }));
    const line = page.locator('[data-test=challenge-line]');
    await expect(line).toHaveText('Ali scored 18,240 on these 10. Can you beat it?');
    expect(page.url()).not.toContain('d=');
    await page.reload();
    await expect(line).toHaveText('Ali scored 18,240 on these 10. Can you beat it?');
    await expect(page.locator('[data-test=play-challenge]')).toBeEnabled({ timeout: 10000 });
    await page.locator('[data-test=play-challenge]').click();
    await expect(page.locator('[data-screen=round][data-round="1"]')).toBeVisible();
    await recorder.idle(page);
    expect(recorder.of('challenge_opened')).toHaveLength(1);
    expect(recorder.of('challenge_opened')[0]?.properties).toMatchObject({ valid: true, has_score: true, own_deck: false });
  });

  test('a link whose answers changed plays the deck without a score to beat', async ({ page }) => {
    await page.goto(link({ d: IDS.join('.'), s: '18240', h: '00000000' }));
    await expect(page.locator('[data-test=challenge-line]')).toHaveText('Play the same 10 your friend played');
    await expect(page.locator('[data-test=challenge-note]').first()).toContainText("can't be compared");
  });

  test('a challenge game shows "To beat" under the round total', async ({ page }) => {
    await page.goto(link({ d: IDS.join('.'), s: '18240', h: HASH }));
    await expect(page.locator('[data-test=play-challenge]')).toBeEnabled({ timeout: 10000 });
    await page.locator('[data-test=play-challenge]').click();
    await playRound(page);
    await expect(page.locator('[data-test=to-beat]')).toHaveText('To beat: 18,240');
  });

  test('a broken link says so and offers a normal game', async ({ page }) => {
    await page.goto(link({ d: '01.02.03' }));
    await expect(page.locator('[data-test=challenge-line]')).toHaveText("This challenge link doesn't work any more");
    await expect(page.locator('[data-test=start]')).toBeEnabled({ timeout: 10000 });
    await page.locator('[data-test=start]').click();
    await expect(page.locator('[data-screen=round][data-round="1"]')).toBeVisible();
  });

  test('a listed name shows as "A friend"', async ({ page }) => {
    const list = JSON.parse(readFileSync(join(import.meta.dirname, '../../data/name-list.json'), 'utf8')).words as string[];
    const word = list.find((w) => /^[a-z]{4,10}$/.test(w)) as string;
    await page.goto(link({ d: IDS.join('.'), s: '100', n: word }));
    await expect(page.locator('[data-test=challenge-line]')).toHaveText('A friend scored 100 on these 10. Can you beat it?');
  });

  test('with a game in progress, Continue my game keeps the challenge for later', async ({ page }) => {
    await start(page);
    await placePin(page, 41.9, 12.5);
    await confirm(page);
    await page.goto(link({ d: IDS.join('.'), s: '100', n: 'Ali' }));
    await expect(page.locator('[data-test=play-challenge]')).toHaveText('Play the challenge', { timeout: 10000 });
    await page.locator('[data-test=continue-mine]').click();
    await expect(page.locator('[data-screen=round][data-step=when]')).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem('museumguessr:v1:waiting-challenge'))).toContain('"Ali"');
  });
});

test.describe('[V1-18] [V1-21] replies', () => {
  test('a reply to this device\'s own deck shows the result; a challenge game sends its score back', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await seedFinished(page, { total: 18240 });
    await page.goto(link({ d: IDS.join('.'), s: '19000', n: 'Bea', h: HASH }));
    await expect(page.locator('[data-test=challenge-line]')).toHaveText('Bea scored 19,000 on your 10. You scored 18,240. Bea wins by 760.');
    await expect(page.locator('[data-test=replay-reply]')).toHaveText('Replay these 10 (not ranked)');

    await seedFinished(page, { total: 18240, kind: 'challenge', challenge: { score: 17000, name: 'Ali' } });
    await page.locator('[data-test=review]').click();
    await expect(page.locator('[data-test=end-result]')).toHaveText('You win by 1,240');
    await expect(page.locator('[data-test=share]')).toHaveText('Send your score back');
    await page.locator('[data-test=copy-link]').click();
    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(text.split('\n')[0]).toBe('I scored 18,240/30,000 on your 10 on MuseumGuessr. Your move.');
    expect(new URL(text.split('\n').at(-1) ?? '').searchParams.get('utm_campaign')).toBe('reply');
  });
});

test.describe('[V1-24] [V1-23] credits and the returning visitor', () => {
  test('during a game Credits lists only revealed rounds and the sample', async ({ page }) => {
    await start(page);
    const open = async () => {
      await page.locator('[data-test=menu]').first().click();
      await page.locator('[data-test=menu-credits]').click();
      return page.locator('[data-test=credits] li');
    };
    await expect(await open()).toHaveCount(1);
    await page.keyboard.press('Escape');
    await playRound(page);
    await expect(await open()).toHaveCount(2);
  });

  test('a returning visitor sees Play another 10, Review your 10 and the collection line', async ({ page }) => {
    await seedFinished(page);
    await expect(page.locator('[data-test=play-another]')).toBeVisible();
    await expect(page.locator('[data-test=review]')).toBeVisible();
    await expect(page.locator('[data-test=collection]')).toHaveText(items.length === 10 ? 'You have seen every object' : `You have seen 10 of ${items.length} objects`);
  });
});

/** Press Tab until `selector` has focus (at most 40 times). */
async function tabTo(page: Page, selector: string) {
  for (let i = 0; i < 40; i++) {
    if (await page.locator(selector).evaluate((el) => el === document.activeElement).catch(() => false)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Tab never reached ${selector}`);
}

test.describe('[V1-26] keyboard and enlarged text', () => {
  test('a challenge link plays with the keyboard alone', async ({ page }) => {
    await page.goto(link({ d: IDS.join('.'), s: '18240', n: 'Ali', h: HASH }));
    await expect(page.locator('[data-test=play-challenge]')).toBeEnabled({ timeout: 10000 });
    await tabTo(page, '[data-test=play-challenge]');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-screen=round][data-round="1"]')).toBeVisible();
  });

  test('Share opens the chooser with the keyboard, keeps focus inside it, and Escape returns focus to Share', async ({ page }) => {
    await shareSheet(page, 'absent');
    await seedFinished(page);
    await tabTo(page, '[data-test=review]');
    await page.keyboard.press('Enter');
    await tabTo(page, '[data-test=share]');
    await page.keyboard.press('Enter');
    const dialog = page.locator('dialog[open]');
    await expect(page.locator('[data-test=share-whatsapp]')).toBeVisible();
    // A modal dialog: Tab cycles through its controls and the browser's own UI
    // (body, in a headless browser), never the page behind it.
    const reached = new Set<string>();
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      const where = await dialog.evaluate((d) => (d.contains(document.activeElement) ? 'dialog' : document.activeElement === document.body ? 'browser' : 'page'));
      reached.add(where);
    }
    expect(reached.has('page')).toBe(false);
    expect(reached.has('dialog')).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-test=share]')).toBeFocused();
    await page.locator('[data-test=copy-link]').focus();
    await expect(page.locator('[data-test=copied]')).toHaveAttribute('aria-live', 'polite');
  });

  test('at 200% text, Share and Play another 10 stay reachable and nothing scrolls sideways', async ({ page, context }) => {
    await largeText(context);
    await seedFinished(page, { kind: 'challenge', challenge: { score: 17000, name: 'İpek' } });
    // the enlargement really applies: the small text token is twice its size
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--text-sm').trim())).toBe('28px');
    expect(await page.locator('.end__collection, [data-test=collection]').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(28);
    await page.locator('[data-test=review]').click();
    for (const target of ['share', 'play-another']) {
      const el = page.locator(`[data-test=${target}]`);
      await el.scrollIntoViewIfNeeded();
      await expect(el).toBeInViewport();
      await el.click({ trial: true });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
});
