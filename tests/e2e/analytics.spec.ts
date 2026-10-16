import { confirm, expect, placePin, playRound, start, test } from './fixtures';

test.describe('[PH9] [E5] [PH6] events reach PostHog with the right properties', () => {
  test('three rounds send the KPI funnel events with project_id and src', async ({ page, recorder }) => {
    await start(page, '?utm_source=webgames&utm_medium=social');
    for (let r = 0; r < 3; r++) {
      await playRound(page);
      await page.locator('[data-test=next]').click();
    }
    await expect(page.locator('[data-screen=round][data-round="4"]')).toBeVisible();
    await recorder.idle(page);

    const names = recorder.names();
    expect(recorder.of('$pageview'), recorder.dump()).toHaveLength(1);
    expect(recorder.of('game_start')).toHaveLength(1);
    expect(recorder.of('round_started').map((e) => e.properties.round)).toEqual([1, 2, 3, 4]);
    expect(recorder.of('step_completed')).toHaveLength(9);
    const rc = recorder.of('round_completed').map((e) => [e.properties.round, e.properties.skipped, e.properties.answered_count]);
    expect(rc).toEqual([
      [1, false, 1],
      [2, false, 2],
      [3, false, 3],
    ]);
    for (const e of recorder.events) {
      expect(e.properties.project_id, `${e.event} lacks project_id`).toBe('museumguessr');
      if (e.event !== 'client_error') expect(e.properties.src, e.event).toBe('webgames');
    }
    const pv = recorder.of('$pageview')[0];
    expect(pv?.properties.landing).toBe(true);
    expect(pv?.properties.resumed).toBe(false);
    // PH2: only utm_* survive in the URL
    expect(String(pv?.properties.$current_url)).toBe('https://aule-games.github.io/museumguessr/?utm_source=webgames&utm_medium=social');
    expect(names).not.toContain('$autocapture');
    expect(names).not.toContain('$pageleave');
  });

  test('a hostile utm_source becomes other; no utm becomes none [PH3]', async ({ page, recorder }) => {
    await start(page, '?utm_source=%3Cscript%3E&fbclid=abc&x=y');
    await placePin(page, 48.86, 2.35);
    await confirm(page);
    await recorder.idle(page);
    for (const e of recorder.events.filter((x) => x.event !== 'client_error')) expect(e.properties.src, e.event).toBe('other');
    const pv = recorder.of('$pageview')[0];
    expect(String(pv?.properties.$current_url)).not.toContain('fbclid');
    expect(JSON.stringify(recorder.events)).not.toContain('abc');
  });
});

test.describe('[G1] [DX3] [DX29] [ENG38] test mode', () => {
  test('?test=1 sends nothing, shows the badge and lists the payloads', async ({ page, recorder }) => {
    await page.goto('./?test=1&utm_source=smoke');
    await expect(page.locator('[data-test=test-badge]')).toBeVisible();
    // ENG38: test is removed from the address bar
    expect(page.url()).not.toContain('test=');
    await page.locator('[data-test=start]').click();
    await placePin(page, 48.86, 2.35);
    await confirm(page);
    await page.locator('[data-test=test-badge]').click();
    await expect(page.locator('[data-test=badge-panel]')).toContainText('step_completed');
    await expect(page.locator('[data-test=badge-panel]')).toContainText('"src":"smoke"');
    await recorder.idle(page, 1500);
    expect(recorder.requests).toBe(0);
  });

  test('[V1-32] in test mode, Jump to the end finishes a game with random answers and opens the end screen, sending nothing', async ({ page, recorder }) => {
    await page.goto('./?test=1');
    await expect(page.locator('[data-test=start]')).toBeEnabled({ timeout: 10000 });
    await page.locator('[data-test=test-badge]').click();
    await page.locator('[data-test=test-finish]').click();
    await expect(page.locator('[data-screen=end]')).toBeVisible();
    await expect(page.locator('[data-test=recap] li')).toHaveCount(10);
    await expect(page.locator('[data-test=end-total]')).toContainText('/ 30,000');
    await expect(page.locator('[data-test=share]')).toBeVisible();
    await recorder.idle(page, 1000);
    expect(recorder.requests).toBe(0);
  });

  test('the flag persists in this browser and ?test=0 clears it', async ({ page, recorder }) => {
    await page.goto('./?test=1');
    await page.goto('./');
    await expect(page.locator('[data-test=test-badge]')).toBeVisible();
    await page.goto('./?test=0');
    await expect(page.locator('[data-test=test-badge]')).toHaveCount(0);
    await recorder.idle(page);
    expect(recorder.of('$pageview').length).toBeGreaterThanOrEqual(1);
  });
});
