#!/usr/bin/env node
// Run where Chromium is permitted. Writes only ignored .cache/design-review/.
// No screenshots are committed or used as composition assets.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = `${root}.cache/design-review/`;
mkdirSync(output, { recursive: true });
mkdirSync(`${root}.cache/browser/`, { recursive: true });
process.env.TMPDIR = `${root}.cache/browser/`;
const browser = await chromium.launch({ headless: true,
  ...(process.env.MG_BROWSER_EXECUTABLE ? { executablePath: process.env.MG_BROWSER_EXECUTABLE } : {}),
});
const records = [];
try {
  const page = await browser.newPage({ viewport: { width: 1820, height: 1220 }, deviceScaleFactor: 1 });
  const failed = [];
  page.on('requestfailed', (request) => failed.push(request.url()));
  page.on('pageerror', (error) => failed.push(error.message));
  for (const direction of ['a', 'b']) for (const screen of ['start', 'round-kept', 'round-when', 'reveal', 'end']) {
    await page.goto(pathToFileURL(`${root}docs/design/directions/${direction}/${screen}.html`).href);
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('.frame').count(), 2);
    for (const [device, width, height] of [['phone', 390, 844], ['desktop', 1280, 800]]) {
      const frame = page.locator(`.frame.${device}`);
      const box = await frame.boundingBox();
      assert.equal(box.width, width);
      assert.equal(box.height, height);
      const issues = await frame.evaluate((element) => {
        const issues = [];
        const frame = element.getBoundingClientRect();
        for (const node of element.querySelectorAll('*')) {
          if (node.closest('svg')) continue;
          const style = getComputedStyle(node);
          const box = node.getBoundingClientRect();
          if (!box.width || !box.height || style.position === 'absolute') continue;
          if (box.left < frame.left - 1 || box.right > frame.right + 1) issues.push(`horizontal overflow: ${node.className || node.tagName}`);
        }
        for (const node of element.querySelectorAll('button, a, summary, input:not([type="radio"])')) {
          const box = node.getBoundingClientRect();
          if (!box.width || !box.height || node.closest('details:not([open]) nav')) continue;
          if (box.width < 44 || box.height < 44) issues.push(`target below 44px: ${node.textContent || node.ariaLabel || node.tagName} (${box.width} × ${box.height})`);
        }
        for (const node of element.querySelectorAll('.legend, .hint, h1, .game-length, .recap-label, .year-controls')) {
          if (node.scrollWidth > node.clientWidth + 1) issues.push(`text/control overflow: ${node.className || node.tagName}`);
        }
        if (element.classList.contains('round-kept') || element.classList.contains('round-when')) {
          if (element.scrollHeight > element.clientHeight) issues.push('round scrolls vertically');
          const action = element.querySelector('.actionbar').getBoundingClientRect();
          if (action.bottom > frame.bottom + 1) issues.push('Confirm is below the frame');
        }
        if (element.classList.contains('reveal')) {
          for (const selector of ['.wall-label', '.journey', '.reveal-map-region', '.score-block', '.credit', '.actionbar']) {
            const box = element.querySelector(selector).getBoundingClientRect();
            if (box.bottom > frame.bottom + 1 || box.top < frame.top - 1) issues.push(`reveal not above fold: ${selector}`);
          }
        }
        return issues;
      });
      await frame.screenshot({ path: `${output}${direction}-${screen}-${device}.png` });
      records.push({ direction, screen, device, width, height, issues });
    }
    if (screen === 'reveal') {
      await page.locator('.phone .score-row').last().locator('summary').click();
      assert.equal(await page.locator('.phone .reason-timeline').isVisible(), true);
      await page.locator('.phone .score-row').last().locator('summary').click();
    }
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), 'solid');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('.phone .primary').evaluate((node) => getComputedStyle(node).animationName), 'none');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  }
  const report = { browser: browser.version(), records, failed };
  writeFileSync(`${output}report.json`, `${JSON.stringify(report, null, 2)}\n`);
  assert.deepEqual(failed, [], 'asset request or page errors');
  const issues = records.flatMap((record) => record.issues.map((issue) => `${record.direction}/${record.screen}/${record.device}: ${issue}`));
  assert.deepEqual(issues, [], 'layout / touch-target issues');
  console.log(`Passed 20 fixed-frame layout checks. Review screenshots in .cache/design-review/.`);
} finally {
  await browser.close();
}
