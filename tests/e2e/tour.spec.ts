import type { Page } from '@playwright/test';
import { expect, start, test } from './fixtures';

const progress = (page: Page) => page.locator('[data-test=tour-progress]');

async function cardOnScreen(page: Page) {
  const box = await page.locator('.tour__card').boundingBox();
  const vp = page.viewportSize();
  expect(box && vp).toBeTruthy();
  if (!box || !vp) return;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 0.5);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 0.5);
}

test.describe('[DS34] the first-visit tour', () => {
  test.use({ freshVisitor: true });

  test('opens on round 1, lights up each part of the screen in turn, and Let’s start begins the game', async ({ page, recorder }) => {
    await start(page);
    const tour = page.locator('[data-test=tour]');
    await expect(tour).toBeVisible();
    await expect(progress(page)).toHaveText('Step 1 of 7');
    await cardOnScreen(page);
    for (let i = 2; i <= 7; i++) {
      await page.locator('[data-test=tour-next]').click();
      await expect(progress(page)).toHaveText(`Step ${i} of 7`);
      await cardOnScreen(page);
      if ((await tour.getAttribute('data-step')) === 'map') {
        const spot = await page.locator('.tour__spot').boundingBox();
        const map = await page.locator('[data-test=map-region]').boundingBox();
        expect(spot && map && spot.x <= map.x && spot.y <= map.y && spot.x + spot.width >= map.x + map.width).toBeTruthy();
      }
    }
    await expect(page.locator('[data-test=tour-next]')).toHaveText('Let’s start');
    await page.locator('[data-test=tour-next]').click();
    await expect(tour).toHaveCount(0);
    await expect(page.locator('[data-screen=round][data-step=made]')).toBeVisible();
    await recorder.idle(page);
    expect(recorder.of('tour_ended').map((e) => [e.properties.outcome, e.properties.step, e.properties.replay])).toEqual([['done', 7, false]]);
  });

  test('Back returns to the previous step', async ({ page }) => {
    await start(page);
    await page.locator('[data-test=tour-next]').click();
    await page.locator('[data-test=tour-next]').click();
    await expect(progress(page)).toHaveText('Step 3 of 7');
    await page.locator('[data-test=tour-back]').click();
    await expect(progress(page)).toHaveText('Step 2 of 7');
  });

  test('Skip closes it as skipped, and it does not come back after a reload', async ({ page, recorder }) => {
    await start(page);
    await page.locator('[data-test=tour-next]').click();
    await page.locator('[data-test=tour-skip]').click();
    await expect(page.locator('[data-test=tour]')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('[data-screen=round][data-step=made]')).toBeVisible();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-test=tour]')).toHaveCount(0);
    await recorder.idle(page);
    expect(recorder.of('tour_ended').map((e) => [e.properties.outcome, e.properties.step])).toEqual([['skipped', 2]]);
  });

  test('Escape and the browser Back button close it without leaving the round', async ({ page }) => {
    await start(page);
    await expect(page.locator('[data-test=tour]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-test=tour]')).toHaveCount(0);
    await page.locator('[data-test=menu]').click();
    await page.locator('[data-test=menu-tour]').click();
    await expect(page.locator('[data-test=tour]')).toBeVisible();
    await page.goBack();
    await expect(page.locator('[data-test=tour]')).toHaveCount(0);
    await expect(page.locator('[data-screen=round][data-step=made]')).toBeVisible();
  });
});

test.describe('[DS34] the tour for returning players', () => {
  test('stays closed, and the menu offers it on the round screen', async ({ page, recorder }) => {
    await start(page);
    await page.waitForTimeout(300);
    await expect(page.locator('[data-test=tour]')).toHaveCount(0);
    await page.locator('[data-test=menu]').click();
    await page.locator('[data-test=menu-tour]').click();
    await expect(progress(page)).toHaveText('Step 1 of 7');
    await page.locator('[data-test=tour-skip]').click();
    await recorder.idle(page);
    expect(recorder.of('tour_ended').map((e) => [e.properties.outcome, e.properties.replay])).toEqual([['skipped', true]]);
  });
});
