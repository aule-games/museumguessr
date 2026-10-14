// Built-screen capture matrix. Run after `npm run build`, in an environment
// where Chromium may launch. Uses only local assets and isolated browser data.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { preview } from 'vite';
import { placePin, enterYear, confirm, playRound } from '../e2e/fixtures.ts';
import { phoneGeometryIssues } from './phone-geometry.mjs';
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
      // A leftover pointer must not turn a collapsed score capture into a hover explanation.
      await page.mouse.move(0, 0);
      if (/^reveal-(1|3)(-feedback-sent)?$/.test(state)) {
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
      issues.push(...await page.evaluate(phoneGeometryIssues, state));
      const name = `${width}x${height}-${state}.png`;
      await page.screenshot({ path: new URL(name, out).pathname, fullPage: true });
      records.push({ width, height, state, image: name, issues });
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
        for (const step of ['kept', 'made']) {
          await expect(page.locator('.map')).toHaveAttribute('data-state', /ready|fallback/);
          await capture(`${step}-empty`);
          if (step === 'kept') {
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
            await placePin(page, 48.86, 2.35, 2);
            await capture('kept-zoomed');
          }
          await placePin(page, 48.86, 2.35);
          await capture(`${step}-placed`);
          await confirm(page);
        }
        await capture('when-empty');
        await enterYear(page, 0);
        await capture('when-invalid');
        await expect(page.locator('[data-test=confirm]')).toBeDisabled();
        await enterYear(page, 1500);
        await expect(page.locator('[data-test=confirm]')).toBeEnabled();
        await expect(page.locator('.year__thumb')).toHaveCSS('opacity', '1');
        await capture('when-set');
        await confirm(page);
      } else await playRound(page);
      if (round === 1 || round === 3) {
        // capture only once the reveal layers (veil, countries, lines) have rendered
        await expect(page.locator('.map')).toHaveAttribute('data-reveal', 'drawn', { timeout: 8000 });
        await capture(`reveal-${round}`);
        await page.locator('[data-test=row-when]').click();
        await capture(`reveal-${round}-expanded`);
        await page.locator('[data-test=row-when]').click();
      }
      if (round === 3) {
        await page.locator('[data-test=pulse-about_right]').click();
        await expect(page.locator('.pulse .chip')).toHaveCount(0);
        // Recheck the map fit after the footer shrinks, not only with feedback present.
        await capture('reveal-3-feedback-sent');
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
    await page.close();
    page = await context.newPage();
    await page.goto(`${url}?test=1`);
    await expect(page.locator('[data-test=play-again]')).toBeVisible();
    await capture('start-finished-test-badge');
    await page.locator('[data-test=play-again]').click();
    for (let i = 0; i < 2; i++) { await placePin(page, 48.86, 2.35); await confirm(page); }
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
