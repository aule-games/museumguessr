import type { Page } from '@playwright/test';
import { expect, start, test } from './fixtures';

// Lazy screens (V1-02, src/ui/lazy.ts): a chunk that cannot load leaves the
// game running; a screen that must show falls back to the error screen.

/** Make a lazy chunk fail to load, as on a lost connection. */
async function breakChunk(page: Page, name: string) {
  await page.route(new RegExp(`/assets/${name}-[\\w-]{8}\\.js$`), (route) => route.abort('connectionrefused'));
}

/** The reload-once handler has checked the build id after a failed chunk. */
const buildChecked = (page: Page) => page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/build.txt'));

test.describe('[V1-02] screens that load on demand', () => {
  test('About & privacy whose chunk cannot load stays closed and the game goes on [V1-02]', async ({ page }) => {
    await breakChunk(page, 'misc');
    await page.goto('./');
    await expect(page.locator('[data-test=start]')).toBeEnabled({ timeout: 10000 });
    const checked = buildChecked(page);
    await page.getByRole('button', { name: 'About & privacy' }).click();
    await checked;
    await page.waitForTimeout(300);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('[data-screen=error]')).toHaveCount(0);
    await page.locator('[data-test=start]').click();
    await expect(page.locator('[data-screen=round][data-step=made]')).toBeVisible();
  });

  test('an end screen whose chunk cannot load shows the error screen [V1-02]', async ({ page }) => {
    await breakChunk(page, 'end');
    await start(page, '?test=1');
    await expect(page.locator('[data-screen=round][data-step=made]')).toBeVisible();
    await page.evaluate(() => (window as unknown as { __mgTest: { finish(): void } }).__mgTest.finish());
    await expect(page.locator('[data-screen=error]')).toBeVisible();
    await expect(page.locator('[data-test=error-ref]')).toContainText('Ref Error');
  });
});

test.describe('[V1-02] a first visit whose tour cannot load', () => {
  test.use({ freshVisitor: true });

  test('a tour whose chunk cannot load leaves the round playable with its clock running [V1-02]', async ({ page }) => {
    await breakChunk(page, 'tour');
    await start(page);
    await expect(page.locator('[data-screen=round][data-step=made]')).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem('museumguessr:v1:save') ?? 'null') as { clock: { paused: boolean } | null } | null)?.clock?.paused), {
        timeout: 15_000,
      })
      .toBe(false);
    await expect(page.locator('[data-test=tour]')).toHaveCount(0);
    await expect(page.locator('[data-screen=error]')).toHaveCount(0);
  });
});
