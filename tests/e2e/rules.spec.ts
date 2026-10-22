// v1.2 rules in the browser: the early year stop, the difficulty label,
// "hard ones nailed" and challenge rules versions. Relative URLs only, so the
// suite runs under any base path.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { coreOf } from '../../scripts/lib/items-core.mjs';
import type { CoreItem } from '../../src/content/items';
import { itemsVersion } from '../../src/content/version';
import { SCORING_VERSION } from '../../src/scoring/config';
import { STATE_VERSION } from '../../src/state/schema';
import { confirm, expect, largeText, placePin, start, test } from './fixtures';

const items = JSON.parse(readFileSync(join(import.meta.dirname, '../../data/items.json'), 'utf8')).items as { id: string; difficulty: number }[];
/** The first ten objects in file order, a valid deck. */
const TEN = items.slice(0, 10);
const IDS = TEN.map((it) => it.id);
const HASH = itemsVersion(TEN.map((it) => coreOf(it) as CoreItem));

const row = (points: number) => ({ made: { points: Math.min(1000, points), km: 1 }, when: { points: Math.max(0, Math.min(1000, points - 1000)), yearsOff: 0 }, kept: { points: Math.max(0, points - 2000), km: 1 }, points, skipped: false });

/** A finished game on this device, as the end screen saves it, with these per-round points. */
async function seedFinished(page: Page, points: number[]) {
  const snapshot = {
    state_version: STATE_VERSION,
    scoring_version: SCORING_VERSION,
    items_version: HASH,
    game_id: 'seeded-rules-game-0000',
    item_ids: IDS,
    deck_kind: 'random',
    deck_hash: HASH,
    challenge: null,
    answers: IDS.map(() => ({ kept: { lat: 0, lng: 0 }, made: { lat: 0, lng: 0 }, when: 1500 })),
    results: points.map(row),
    total: points.reduce((a, b) => a + b, 0),
  };
  await page.goto('./');
  await page.evaluate((s) => {
    localStorage.setItem('museumguessr:v1:last', JSON.stringify(s));
    localStorage.setItem('museumguessr:v1:ever-seen', JSON.stringify(s.item_ids));
  }, snapshot);
  await page.reload();
}

/** Play round 1's Made question and open When. */
async function openWhen(page: Page) {
  await start(page);
  await placePin(page, 41.9, 12.5);
  await confirm(page);
  await expect(page.locator('[data-screen=round][data-step=when]')).toBeVisible();
}

test.describe('the year stop', () => {
  test('the keyboard reaches the stop with Home and Left, leaves it with Right, and the answer survives Back [V12-70]', async ({ page }) => {
    await openWhen(page);
    const slider = page.getByRole('slider');
    const readout = page.locator('[data-test=year-readout]');
    await slider.focus();
    await page.keyboard.press('Home');
    await expect(readout).toHaveText('4000 BCE or earlier');
    await expect(slider).toHaveAttribute('aria-valuetext', '4000 BCE or earlier');
    await expect(page.getByLabel('Year', { exact: true })).toHaveValue('4000');
    await expect(page.locator('[data-test=year-suffix]')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(readout).toHaveText('3999 BCE');
    await page.keyboard.press('ArrowLeft');
    await expect(readout).toHaveText('4000 BCE or earlier');
    await confirm(page);
    await expect(page.locator('[data-screen=round][data-step=kept]')).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('museumguessr:v1:save') ?? '{}').answers[0].when)).toBe(-4001);
    await page.locator('[data-test=back]').click();
    await expect(readout).toHaveText('4000 BCE or earlier');
    await page.getByRole('button', { name: 'CE', exact: true }).click();
    await expect(readout).toHaveText('—');
    await expect(page.getByLabel('Year', { exact: true })).toHaveValue('');
    await expect(page.locator('[data-test=confirm]')).toBeDisabled();
  });

  test('typing 5000 BCE selects the stop, and with the phone keyboard open the field, era switch and Confirm stay on screen [V12-70] [V12-71]', async ({ page }) => {
    await openWhen(page);
    const field = page.getByLabel('Year', { exact: true });
    await page.getByRole('button', { name: 'BCE', exact: true }).click();
    await field.fill('5000');
    await expect(page.locator('[data-test=year-readout]')).toHaveText('4000 BCE or earlier');
    await expect(field).toHaveValue('4000');
    await field.focus();
    // A simulated on-screen keyboard: the visual viewport loses its lower 336 px.
    const size = page.viewportSize() ?? { width: 390, height: 844 };
    const visible = size.height - 336;
    await page.setViewportSize({ width: size.width, height: visible });
    await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--app-height'))).toBe(`${visible}px`);
    for (const target of [field, page.getByRole('button', { name: /^BCE/ }), page.getByRole('button', { name: 'CE', exact: true }), page.locator('[data-test=confirm]')]) {
      const box = await target.boundingBox();
      expect(box, String(target)).not.toBeNull();
      expect(box!.y, String(target)).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height, String(target)).toBeLessThanOrEqual(visible + 0.5);
    }
    await expect(page.locator('[data-test=confirm]')).toBeEnabled();
  });
});

test.describe('the difficulty label', () => {
  test('round 1 reads Round 1/10 · Easy with three pips [V12-64]', async ({ page }) => {
    await start(page);
    const cluster = page.locator('[data-screen=round] .topbar');
    await expect(cluster.locator('.topbar__round')).toHaveText('Round 1/10');
    await expect(cluster.locator('[data-test=difficulty]')).toHaveText('· Easy');
    await expect(cluster.locator('.difficulty__pip')).toHaveCount(3);
    await expect(cluster.locator('.difficulty__pips')).toBeVisible();
  });

  test('at 200% text the word and the round stay and the pips hide [V12-64]', async ({ page, context }) => {
    await largeText(context);
    await start(page);
    const cluster = page.locator('[data-screen=round] .topbar');
    await expect(cluster.locator('.topbar__round')).toBeVisible();
    await expect(cluster.locator('.difficulty__word')).toBeVisible();
    await expect(cluster.locator('.difficulty__word')).toHaveText('· Easy');
    await expect(cluster.locator('.difficulty__pips')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
});

test.describe('hard ones nailed', () => {
  test('the end summary counts them and the share hook carries the plural tag [V12-65] [V12-66]', async ({ page }) => {
    await page.addInitScript(() => {
      const calls: unknown[] = [];
      (window as unknown as { __shares: unknown[] }).__shares = calls;
      Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
      Object.defineProperty(navigator, 'share', { configurable: true, value: (data: unknown) => (calls.push(data), Promise.resolve()) });
    });
    const hard = TEN.map((it, i) => (it.difficulty === 3 ? i : -1)).filter((i) => i >= 0).slice(0, 2);
    expect(hard).toHaveLength(2);
    await seedFinished(page, IDS.map((_, i) => (hard.includes(i) ? 2500 : 1200)));
    await page.locator('[data-test=review]').click();
    await expect(page.locator('.end__head [data-test=hard-count]')).toHaveText('2 hard ones nailed');
    await page.locator('[data-test=share]').click();
    const calls = await page.evaluate(() => (window as unknown as { __shares: { text: string }[] }).__shares);
    expect(calls[0]?.text).toBe('Can you beat my 14,600/30,000 on MuseumGuessr? · 2 hard ones nailed ⭐');
  });
});
