// Built-screen capture matrix. Run after `npm run build`, in an environment
// where Chromium may launch. Uses only local assets and isolated browser data.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { preview } from 'vite';
import { placePin, enterYear, confirm } from '../e2e/fixtures.ts';
import { flowGeometryIssues, measureFlow } from './flow-geometry.mjs';
import { phoneGeometryIssues } from './phone-geometry.mjs';
import { creditFixtures } from './map-credit-fixtures.mjs';
const out = new URL('../../test-results/visual/', import.meta.url);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let server;
const records = [];
try {
  server = await preview({ preview: { host: '127.0.0.1', port: 4183, strictPort: false } });
  const url = server.resolvedUrls.local[0];
  for (const [width, height] of [[390, 844], [1280, 800], [375, 667], [844, 390], [390, 664]]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
    await context.route('**/*', (route) => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort());
    let page = await context.newPage();
    const capture = async (state) => {
      const geometryState = state.replace(/-credits-(production|long)$/, '');
      // A leftover pointer must not turn a collapsed score capture into a hover explanation.
      await page.mouse.move(0, 0);
      if (/^reveal-(1|3)(-feedback-sent)?$/.test(geometryState)) {
        await page.locator('.reveal__scroll').evaluate((node) => { node.scrollTop = 0; });
      }
      await page.evaluate(() => document.fonts.ready);
      // Final state only: every image (lazy ones too) decoded, two settled frames.
      await page.evaluate(async () => {
        await Promise.all([...document.images].map((img) => {
          img.loading = 'eager';
          return img.decode().catch(() => {});
        }));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      // MapLibre's resize observer is throttled. A smaller feedback footer can
      // resize the host before the canvas and fitted markers have caught up.
      await page.waitForFunction(() => {
        const host = document.querySelector('.map__canvas')?.getBoundingClientRect();
        const canvas = document.querySelector('.maplibregl-canvas')?.getBoundingClientRect();
        return !host || !canvas || (Math.abs(host.width - canvas.width) < 1 && Math.abs(host.height - canvas.height) < 1);
      });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const issues = await page.evaluate(() => {
        const issues = [];
        if (document.documentElement.scrollWidth > innerWidth + 1) issues.push('horizontal page overflow');
        const round = document.querySelector('.round');
        if (round && document.documentElement.scrollHeight > innerHeight + 1) issues.push('round page scrolls');
        for (const node of document.querySelectorAll('[data-test="confirm"], [data-test="next"]')) {
          const r = node.getBoundingClientRect();
          if (r.top < 0 || r.bottom > innerHeight + 1) issues.push('forward action outside viewport');
        }
        for (const node of document.querySelectorAll('button,input:not([type="hidden"])')) {
          const r = node.getBoundingClientRect();
          if (r.width && r.height && (r.width < 44 || r.height < 44)) issues.push(`small target: ${node.getAttribute('data-test') || node.className}`);
        }
        const badge = document.querySelector('.badge');
        const screen = document.querySelector('[data-screen]');
        if (badge && badge.getBoundingClientRect().bottom > screen.getBoundingClientRect().top + 1) issues.push('badge overlaps screen');
        return issues;
      });
      issues.push(...await page.evaluate(phoneGeometryIssues, geometryState));
      issues.push(...flowGeometryIssues(await page.evaluate(measureFlow)));
      const name = `${width}x${height}-${state}.png`;
      await page.screenshot({ path: new URL(name, out).pathname, fullPage: true });
      records.push({ width, height, state, image: name, issues });
    };
    const captureCredits = async (state) => {
      const inner = page.locator('.maplibregl-ctrl-attrib-inner');
      await expect(inner).toBeVisible();
      // Keep real nodes (including links) so the original credit is restored.
      // Only the text changes: production's ResizeObserver must handle re-fit.
      const original = await inner.evaluateHandle((node) => [...node.childNodes]);
      try {
        for (const [name, text] of Object.entries(creditFixtures)) {
          await inner.evaluate((node, text) => { node.textContent = text; }, text);
          await capture(`${state}-credits-${name}`);
          await expect(inner).toHaveText(text);
        }
      } finally {
        await inner.evaluate((node, children) => node.replaceChildren(...children), original);
        await original.dispose();
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      }
    };
    const close = async () => {
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(page.locator('dialog')).toHaveCount(0);
    };
    await page.goto(url);
    await expect(page.locator('[data-test=start]')).toBeEnabled();
    await capture('start-new');
    await page.locator('[data-test=start]').click();
    // the first-visit tour opens on round 1: capture every step, then start
    await expect(page.locator('[data-test=tour]')).toBeVisible();
    for (let i = 1; i <= 7; i++) {
      await capture(`tour-${i}`);
      await page.locator('[data-test=tour-next]').click();
    }
    await expect(page.locator('[data-test=tour]')).toHaveCount(0);
    for (let round = 1; round <= 10; round++) {
      if (round === 1) {
        // Made first (DS35): empty, the photo lightbox, menu and dialogs, zoomed, placed
        await expect(page.locator('.map')).toHaveAttribute('data-state', /ready|fallback/);
        await capture('made-empty');
        await captureCredits('made-empty');
        await page.locator('.photo__open').click();
        await expect(page.locator('.pswp')).toBeVisible();
        await capture('photo-lightbox');
        await page.keyboard.press('Escape');
        await expect(page.locator('.pswp')).toHaveCount(0);
        await page.locator('[data-test=menu]').click();
        await capture('menu');
        await close();
        for (const dialog of ['how', 'credits', 'about', 'new']) {
          await page.locator('[data-test=menu]').click();
          await page.locator(`[data-test=menu-${dialog}]`).click();
          await expect(page.locator('dialog:not(.dialog--menu)')).toBeVisible();
          await capture(`dialog-${dialog}`);
          await close();
        }
        await placePin(page, 41.9, 12.5, 2);
        await capture('made-zoomed');
        await placePin(page, 41.9, 12.5);
        await capture('made-placed');
        await confirm(page);
        await capture('when-empty');
        await enterYear(page, 0);
        await capture('when-invalid');
        await expect(page.locator('[data-test=confirm]')).toBeDisabled();
        await enterYear(page, 1500);
        await expect(page.locator('[data-test=confirm]')).toBeEnabled();
        await expect(page.locator('.year__thumb')).toHaveCSS('opacity', '1');
        await capture('when-set');
        await confirm(page);
        await expect(page.locator('.map')).toHaveAttribute('data-state', /ready|fallback/);
        await capture('kept-empty');
        await captureCredits('kept-empty');
        // Back reopens When with its year in place (DS36), then returns to Kept
        await page.locator('[data-test=back]').click();
        await expect(page.locator('[data-screen=round][data-step=when]')).toBeVisible();
        await capture('when-back');
        await confirm(page);
        await placePin(page, 48.86, 2.35);
        await capture('kept-placed');
        await confirm(page);
      } else {
        await capture(`round-${round}-made`);
        await placePin(page, 41.9, 12.5);
        await confirm(page);
        await capture(`round-${round}-when`);
        await enterYear(page, 1500);
        await confirm(page);
        await expect(page.locator('.map')).toHaveAttribute('data-state', /ready|fallback/);
        await capture(`round-${round}-kept`);
        await placePin(page, 48.86, 2.35);
        await confirm(page);
      }
      if (round === 1 || round === 3) {
        // capture only once the reveal layers (veil, countries, lines) have rendered
        await expect(page.locator('.map')).toHaveAttribute('data-reveal', 'drawn', { timeout: 8000 });
        await capture(`reveal-${round}`);
        await captureCredits(`reveal-${round}`);
        await page.locator('[data-test=row-when]').click();
        await capture(`reveal-${round}-expanded`);
        await page.locator('[data-test=row-when]').click();
      }
      if (round === 3) {
        await page.locator('[data-test=pulse-about_right]').click();
        await expect(page.locator('.pulse .chip')).toHaveCount(0);
        // Recheck the map fit after the footer shrinks, not only with feedback present.
        await capture('reveal-3-feedback-sent');
        await captureCredits('reveal-3-feedback-sent');
      }
      if (round === 1) {
        await page.close();
        page = await context.newPage();
        await page.goto(url);
        await expect(page.locator('[data-test=continue]')).toBeVisible();
        await capture('start-continue');
        await page.locator('[data-test=continue]').click();
      }
      await page.locator('[data-test=next]').click();
    }
    await capture('end');
    // v1 share and challenge states (V1-31)
    await page.locator('[data-test=add-name]').click();
    await page.locator('[data-test=name-input]').fill('x');
    await page.locator('[data-test=share]').click();
    await capture('end-name-error');
    await page.locator('[data-test=name-input]').fill('Barış');
    await page.evaluate(() => Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }));
    await page.locator('[data-test=share]').click();
    await expect(page.locator('[data-test=share-whatsapp]')).toBeVisible();
    await capture('share-chooser');
    await page.keyboard.press('Escape');
    const last = await page.evaluate(() => JSON.parse(localStorage.getItem('museumguessr:v1:last') ?? '{}'));
    const deck = last.item_ids.join('.');
    await page.goto(`${url}?d=${deck}&s=19000&n=Bea&h=${last.deck_hash}`);
    await expect(page.locator('[data-test=challenge-line]')).toContainText('Bea');
    await capture('challenge-reply');
    await page.goto(`${url}?d=${[...last.item_ids].reverse().join('.')}&s=18240&n=Barış`);
    await expect(page.locator('[data-test=challenge-line]')).toContainText('Barış');
    await capture('challenge');
    // A challenge game: "To beat" sits under the round total on the reveal.
    await page.locator('[data-test=play-challenge]').click();
    await placePin(page, 41.9, 12.5);
    await confirm(page);
    await enterYear(page, 1500);
    await confirm(page);
    await placePin(page, 48.86, 2.35);
    await confirm(page);
    await expect(page.locator('.map')).toHaveAttribute('data-reveal', 'drawn', { timeout: 8000 });
    await expect(page.locator('[data-test=to-beat]')).toBeVisible();
    await capture('reveal-to-beat');
    // A finished challenge game: the result line and "Send your score back", with a Turkish name.
    await page.evaluate((snap) => {
      localStorage.removeItem('museumguessr:v1:save');
      localStorage.setItem('museumguessr:v1:last', JSON.stringify({ ...snap, deck_kind: 'challenge', challenge: { score: 17000, name: 'İpek' } }));
    }, last);
    await page.goto(url);
    await page.locator('[data-test=review]').click();
    await expect(page.locator('[data-test=share]')).toHaveText('Send your score back');
    await capture('end-send-back');
    await page.goto(`${url}?d=01.02`);
    await expect(page.locator('[data-test=challenge-line]')).toBeVisible();
    await capture('challenge-broken');
    await page.close();
    page = await context.newPage();
    await page.goto(`${url}?test=1`);
    await expect(page.locator('[data-test=play-another]')).toBeVisible();
    await capture('start-finished-test-badge');
    await page.locator('[data-test=play-another]').click();
    await placePin(page, 41.9, 12.5);
    await confirm(page);
    await capture('when-test-badge');
    await page.locator('[data-test=test-badge]').click();
    await capture('test-inspector-open');
    await page.locator('[data-test=test-badge]').click();
    // Exercise the built chunk-recovery boundary without altering application code.
    await page.evaluate(() => window.dispatchEvent(new Event('vite:preloadError', { cancelable: true })));
    await expect(page.locator('[data-screen=error]')).toBeVisible();
    await capture('error-saved');
    await context.close();
  }
} finally {
  writeFileSync(new URL('report.json', out), JSON.stringify({ browser: browser.version(), records }, null, 2) + '\n');
  await browser.close();
  if (server) await new Promise((resolve) => server.httpServer.close(resolve));
}
const issues = records.flatMap((r) => r.issues.map((issue) => `${r.width}×${r.height}/${r.state}: ${issue}`));
console.log(`Captured ${records.length} states. Inspect test-results/visual/*.png; geometry checks are not visual approval.`);
if (issues.length) { console.error(issues.join('\n')); process.exitCode = 1; }
