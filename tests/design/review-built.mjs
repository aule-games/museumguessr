// Built-screen capture matrix (V1-26, V1-31; V12-160 to V12-162). Run after
// `npm run build:e2e`, which builds dist/ and the board-test dist-board/, in an
// environment where Chromium may launch. Uses only local assets and isolated
// browser data; the board build's /api/ requests are answered by a scripted
// mock and Turnstile is a stand-in (tests/design/review-fixtures.mjs).
// Time comes from Playwright's clock: every capture freezes it while it
// measures and shoots, so a slow machine cannot run a round's 60 s out.
// REVIEW_ONLY=390x844,1280x800 and REVIEW_PARTS=v1,timer,rules,text200,board
// narrow the matrix while working on it; the default runs everything.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { preview } from 'vite';
import { placePin, enterYear, confirm, largeText } from '../e2e/fixtures.ts';
import { RULES_VERSION } from '../../src/challenge/link.ts';
import { flowGeometryIssues, measureFlow } from './flow-geometry.mjs';
import { phoneGeometryIssues } from './phone-geometry.mjs';
import { creditFixtures } from './map-credit-fixtures.mjs';
import { measureV12, v12GeometryIssues } from './v12-geometry.mjs';
import { boardStates, ruleStates, text200States, timerStates } from './review-v12.mjs';
import { CHECKLIST } from './review-checklist.mjs';

const out = new URL('../../test-results/visual/', import.meta.url);
mkdirSync(out, { recursive: true });
const VIEWPORTS = [[390, 844], [1280, 800], [375, 667], [844, 390], [390, 664]]
  .filter(([w, h]) => !process.env.REVIEW_ONLY || process.env.REVIEW_ONLY.split(',').includes(`${w}x${h}`));
const PARTS = new Set((process.env.REVIEW_PARTS || 'v1,timer,rules,text200,board').split(','));
const BOARD_DIST = new URL('../../dist-board/index.html', import.meta.url);
// REVIEW_CHROMIUM_PATH runs the matrix in another Chrome for Testing build.
const browser = await chromium.launch({ executablePath: process.env.REVIEW_CHROMIUM_PATH || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let server;
let boardServer;
let url;
let boardUrl;
const records = [];

// ---------- the clock ----------

/** Contexts whose clock this script has paused. */
const frozen = new WeakSet();

/** Pause the page's clock where it stands (its context's pages share one clock). */
async function freeze(page) {
  if (frozen.has(page.context())) return;
  for (let i = 0; ; i++) {
    const now = await page.evaluate(() => Date.now());
    try {
      await page.clock.pauseAt(now + 25);
      break;
    } catch (err) {
      // a check ran between reading the time and pausing: read it again
      if (i >= 5 || !/past/.test(String(err.message))) throw err;
    }
  }
  frozen.add(page.context());
}

async function thaw(page) {
  if (!frozen.has(page.context())) return;
  await page.clock.resume();
  frozen.delete(page.context());
}

/** A context on one origin: every other request is refused; the clock is Playwright's. */
async function newContext(width, height, { origin = url, text200 = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
  const own = new URL(origin).origin;
  await context.route('**/*', (route) => new URL(route.request().url()).origin === own ? route.continue() : route.abort());
  if (text200) await largeText(context);
  await context.clock.install();
  return context;
}

// ---------- the camera ----------

/** Resolve with `promise`, or after `ms` of real time (page evaluations have no timeout of their own). */
const within = (promise, ms) => Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms))]);

const settled = () => {
  const host = document.querySelector('.map__canvas')?.getBoundingClientRect();
  const canvas = document.querySelector('.maplibregl-canvas')?.getBoundingClientRect();
  return !host || !canvas || (Math.abs(host.width - canvas.width) < 1 && Math.abs(host.height - canvas.height) < 1);
};

/**
 * Measure and shoot the page as it stands. A section that froze the clock to
 * hold a moment (a cue, the time-up hold) gets that moment; otherwise the
 * page settles with time running and the clock is frozen for the shot.
 * `fold`: the screen as it opens, so the V12-162 fold rules apply (default:
 * normal-size text, no expanded row, open name field or chooser).
 * `keyboard`: a keyboard is simulated (V12-71). `clip`: shoot that region.
 */
async function shoot(page, state, opts = {}) {
  const { width, height } = page.viewportSize();
  const geometryState = state.replace(/-credits-(production|long)$/, '');
  const held = frozen.has(page.context());
  const fold = opts.fold ?? !/(expanded|name-error|share-chooser|text200|keyboard|credits)/.test(state);
  // A leftover pointer must not turn a collapsed score capture into a hover explanation.
  await page.mouse.move(0, 0);
  if (/^reveal-(1|3)(-feedback-sent)?$/.test(geometryState) || (fold && !opts.keepScroll)) {
    await page.evaluate(() => {
      const body = document.querySelector('.reveal__scroll');
      if (body) body.scrollTop = 0;
      if (document.querySelector('[data-screen=end]')) scrollTo(0, 0);
    });
  }
  // Final state only: fonts ready and every image (lazy ones too) decoded; an image the
  // section holds back on purpose (the photo still loading) gives up after a few seconds.
  await within(page.evaluate(() => document.fonts.ready), 5000);
  await within(page.evaluate(() => Promise.all([...document.images].map((img) => {
    img.loading = 'eager';
    return img.decode().catch(() => {});
  }))), 5000);
  if (held) {
    // The clock stays where the section put it: let its frames run in small steps, then give
    // the browser a few real frames for resize observers and layout, which no clock drives.
    for (let i = 0; i < 20 && !(await page.evaluate(settled)); i++) await page.clock.runFor(50);
    await page.clock.runFor(50);
    await page.waitForTimeout(150);
  } else {
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    // MapLibre's resize observer is throttled. A smaller feedback footer can
    // resize the host before the canvas and fitted markers have caught up.
    await page.waitForFunction(settled);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await freeze(page);
  }
  try {
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
      if (badge && screen && badge.getBoundingClientRect().bottom > screen.getBoundingClientRect().top + 1) issues.push('badge overlaps screen');
      return issues;
    });
    issues.push(...await page.evaluate(phoneGeometryIssues, geometryState));
    issues.push(...flowGeometryIssues(await page.evaluate(measureFlow)));
    const v12 = await page.evaluate(measureV12);
    issues.push(...v12GeometryIssues(v12, { fold, keyboard: !!opts.keyboard }));
    const name = `${width}x${height}-${state}.png`;
    await page.screenshot({ path: new URL(name, out).pathname, ...(opts.clip ? { clip: opts.clip } : { fullPage: true }) });
    records.push({ width, height, state, image: name, issues, ...(opts.note ? { note: opts.note } : {}), ...(opts.keyboard ? { measured: { visual: v12.visual, year: v12.year } } : {}) });
  } finally {
    if (!held) await thaw(page);
  }
}

/** Run one state's steps; a state that cannot be reached is a finding, and the matrix goes on. */
async function attempt(page, state, fn, ms = 240_000) {
  try {
    await Promise.race([fn(), new Promise((_, reject) => setTimeout(() => reject(new Error(`no result after ${ms / 1000} s`)), ms).unref())]);
  } catch (err) {
    const { width, height } = page.viewportSize();
    records.push({ width, height, state, image: null, issues: [`[V12-160] the state could not be reached: ${String(err?.message ?? err).split('\n')[0]}`] });
    await thaw(page).catch(() => {});
  }
}

// ---------- the v1 states ----------

async function v1Flow(width, height) {
  const context = await newContext(width, height);
  let page = await context.newPage();
  const capture = (state, opts) => shoot(page, state, opts);
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
      // the year control's end cap selected (V12-68); when-set shows it unselected
      await enterYear(page, -5000);
      await expect(page.locator('[data-test=year-cap]')).toHaveAttribute('data-selected', 'true');
      await capture('when-early-stop');
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
  await page.goto(`${url}?d=${deck}&s=19000&n=Bea&h=${last.deck_hash}&r=${RULES_VERSION}`);
  await expect(page.locator('[data-test=challenge-line]')).toContainText('Bea');
  await capture('challenge-reply');
  await page.goto(`${url}?d=${[...last.item_ids].reverse().join('.')}&s=18240&n=Barış&r=${RULES_VERSION}`);
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

  // 200% text (V1-26, V1-31): the new v1 states with every text token doubled.
  const large = await newContext(width, height, { text200: true });
  await large.addInitScript(() => localStorage.setItem('museumguessr:v1:tour', 'done'));
  page = await large.newPage();
  await page.goto(url);
  await expect(page.locator('[data-test=start]')).toBeEnabled();
  await capture('start-new-text200');
  await page.goto(`${url}?d=${[...last.item_ids].reverse().join('.')}&s=18240&n=Barış&r=${RULES_VERSION}`);
  await expect(page.locator('[data-test=challenge-line]')).toContainText('Barış');
  await capture('challenge-text200');
  await page.locator('[data-test=play-challenge]').click();
  await expect(page.locator('[data-screen=round][data-step=made]')).toBeVisible();
  await capture('round-made-text200');
  try {
    await placePin(page, 41.9, 12.5);
    await confirm(page);
    await enterYear(page, 1500);
    await confirm(page);
    await placePin(page, 48.86, 2.35);
    await confirm(page);
    await expect(page.locator('.map')).toHaveAttribute('data-reveal', 'drawn', { timeout: 8000 });
    await capture('reveal-to-beat-text200');
  } catch (err) {
    // Record the failure as a finding rather than stopping the matrix.
    records.push({ width, height, state: 'reveal-to-beat-text200', image: null, issues: [`[V1-26] a round cannot be played at 200% text: ${String(err.message).split('\n')[0]}`] });
  }
  await page.goto(`${url}?d=01.02`);
  await expect(page.locator('[data-test=challenge-line]')).toBeVisible();
  await capture('challenge-broken-text200');
  // A finished game on this device, and no challenge link left in the tab.
  const finish = (snap) => page.evaluate((s) => {
    sessionStorage.removeItem('museumguessr:v1:challenge');
    localStorage.removeItem('museumguessr:v1:save');
    localStorage.setItem('museumguessr:v1:last', JSON.stringify(s));
  }, snap);
  await finish(last);
  await page.goto(`${url}?d=${last.item_ids.join('.')}&s=19000&n=Bea&h=${last.deck_hash}&r=${RULES_VERSION}`);
  await expect(page.locator('[data-test=challenge-line]')).toContainText('Bea');
  await capture('challenge-reply-text200');
  await finish(last);
  await page.goto(url);
  await page.locator('[data-test=review]').click();
  await capture('end-text200');
  await page.locator('[data-test=add-name]').click();
  await page.locator('[data-test=name-input]').fill('x');
  await page.locator('[data-test=share]').click();
  await capture('end-name-error-text200');
  await page.locator('[data-test=name-input]').fill('Barış');
  await page.evaluate(() => Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }));
  await page.locator('[data-test=share]').click();
  await expect(page.locator('[data-test=share-whatsapp]')).toBeVisible();
  await capture('share-chooser-text200');
  await page.keyboard.press('Escape');
  await finish({ ...last, deck_kind: 'challenge', challenge: { score: 17000, name: 'İpek' } });
  await page.goto(url);
  await page.locator('[data-test=review]').click();
  await expect(page.locator('[data-test=share]')).toHaveText('Send your score back');
  await capture('end-send-back-text200');
  await large.close();
}

try {
  server = await preview({ preview: { host: '127.0.0.1', port: 4183, strictPort: false } });
  url = server.resolvedUrls.local[0];
  if (PARTS.has('board')) {
    if (existsSync(BOARD_DIST)) {
      boardServer = await preview({ build: { outDir: 'dist-board' }, preview: { host: '127.0.0.1', port: 4283, strictPort: false } });
      boardUrl = boardServer.resolvedUrls.local[0];
    } else {
      records.push({ width: 0, height: 0, state: 'board', image: null, issues: ['[V12-160] dist-board/ is missing: run `npm run build:e2e` first'] });
    }
  }
  const kit = { get url() { return url; }, get boardUrl() { return boardUrl; }, newContext, shoot, attempt, freeze, thaw };
  for (const [width, height] of VIEWPORTS) {
    if (PARTS.has('v1')) await v1Flow(width, height);
    if (PARTS.has('timer')) await timerStates(kit, width, height);
    if (PARTS.has('rules')) await ruleStates(kit, width, height);
    if (PARTS.has('text200')) await text200States(kit, width, height);
    if (PARTS.has('board') && boardUrl) {
      await boardStates(kit, width, height);
      if (PARTS.has('text200')) await boardStates(kit, width, height, { text200: true });
    }
  }
} finally {
  const shot = new Set(records.filter((r) => r.image).map((r) => r.state));
  const checklist = CHECKLIST.map(({ item, states }) => ({ item, states, missing: states.filter((s) => !shot.has(s)) }));
  writeFileSync(new URL('report.json', out), JSON.stringify({ browser: browser.version(), viewports: VIEWPORTS.map(([w, h]) => `${w}x${h}`), parts: [...PARTS], checklist, records }, null, 2) + '\n');
  await browser.close();
  for (const s of [server, boardServer]) if (s) await new Promise((resolve) => s.httpServer.close(resolve));
}
const issues = records.flatMap((r) => r.issues.map((issue) => `${r.width}×${r.height}/${r.state}: ${issue}`));
writeFileSync(new URL('issues.txt', out), issues.join('\n') + (issues.length ? '\n' : ''));
console.log(`Captured ${records.filter((r) => r.image).length} states. Inspect test-results/visual/*.png; geometry checks are not visual approval.`);
if (issues.length) { console.error(issues.join('\n')); process.exitCode = 1; }
