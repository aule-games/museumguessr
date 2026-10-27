// E2E fixtures (PH9, DX28, ENG40). Every test gets:
// - a PostHog recorder at the browser-context level that decodes batched,
//   possibly gzip-compressed bodies; an unhandled PostHog request fails the test
// - every other non-local request denied (map tiles aborted, so the bundled
//   fallback map is used)
// - any /api/ request no test mocked, and any request to Turnstile's host,
//   fails the test (V12-128): board tests mock /api/ and stub Turnstile
// - navigator.webdriver false and a non-headless user agent, so posthog-js's
//   bot filter does not drop events

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { test as base, expect, type BrowserContext, type Page, type Request } from '@playwright/test';

export interface Captured {
  event: string;
  properties: Record<string, unknown>;
  url: string;
}

export class Recorder {
  events: Captured[] = [];
  requests = 0;
  unhandled: string[] = [];
  /** /api/ and Turnstile requests that reached the network: none may (V12-128). */
  unmocked: string[] = [];
  lastAt = 0;

  names(): string[] {
    return this.events.map((e) => e.event);
  }

  of(name: string): Captured[] {
    return this.events.filter((e) => e.event === name);
  }

  /** Wait until no PostHog request has arrived for `quietMs`. */
  async idle(page: Page, quietMs = 1000, maxMs = 15000) {
    const start = Date.now();
    await page.waitForTimeout(200);
    while (Date.now() - start < maxMs) {
      if (Date.now() - this.lastAt >= quietMs) return;
      await page.waitForTimeout(100);
    }
  }

  dump(): string {
    return JSON.stringify(this.events.map((e) => [e.event, e.properties]), null, 1);
  }
}

export function decodeBody(req: Request): Captured[] {
  const buf = req.postDataBuffer();
  if (!buf || buf.length === 0) return [];
  let text: string;
  if (buf[0] === 0x1f && buf[1] === 0x8b) text = gunzipSync(buf).toString('utf8');
  else text = buf.toString('utf8');
  if (text.startsWith('data=')) {
    const params = new URLSearchParams(text);
    text = Buffer.from(params.get('data') ?? '', 'base64').toString('utf8');
  }
  const json = JSON.parse(text) as unknown;
  const list = Array.isArray(json) ? json : ((json as { batch?: unknown[] }).batch ?? [json]);
  return (list as { event: string; properties?: Record<string, unknown> }[]).map((e) => ({
    event: e.event,
    properties: e.properties ?? {},
    url: req.url(),
  }));
}

const LOCAL_HOST = 'museumguessr.com';

const TEXT_TOKENS = (JSON.parse(readFileSync(join(import.meta.dirname, '../../src/design/tokens.json'), 'utf8')) as { text: Record<string, string> }).text;

/**
 * 200% text (V1-26): every text token doubled, as a reader's text-size
 * setting enlarges it. Set through the CSSOM on <html> before the page's
 * first layout (the site's CSP refuses inline <style>), so fitted lines
 * measure the enlarged text.
 */
export const LARGE_TEXT: Record<string, string> = Object.fromEntries(
  Object.entries(TEXT_TOKENS).map(([k, v]) => [`--text-${k}`, `${parseFloat(v) * 2}px`]),
);

/** Apply LARGE_TEXT to every page of a context, before any script runs. */
export async function largeText(context: BrowserContext) {
  await context.addInitScript((vars) => {
    const apply = () => {
      const root = document.documentElement;
      if (!root) return false;
      for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v, 'important');
      root.dataset.largeText = 'on';
      return true;
    };
    if (!apply()) document.addEventListener('readystatechange', apply, { once: true });
  }, LARGE_TEXT);
}

export const test = base.extend<{ recorder: Recorder; blockImages: boolean; freshVisitor: boolean; tourFlag: void }>({
  blockImages: [false, { option: true }],
  /** A first-time visitor sees the game tour; every other test starts as a returning player. */
  freshVisitor: [false, { option: true }],
  tourFlag: [
    async ({ context, freshVisitor }, use) => {
      if (!freshVisitor) await context.addInitScript(() => localStorage.setItem('museumguessr:v1:tour', 'done'));
      await use();
    },
    { auto: true },
  ],
  recorder: async ({ context }, use, testInfo) => {
    const rec = new Recorder();
    // The deploy build carries the board; outside the board's own tests the
    // Worker answers as production does while the board is off (docs/api.md).
    const boardOff = !/board\.spec\.ts$/.test(testInfo.file);
    // Registered first so it runs last: deny everything that is not the local site.
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (boardOff && url.hostname === LOCAL_HOST && url.pathname === '/api/v1/board' && route.request().method() === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Cache-Control': 'private, no-store' }, body: '{"disabled":true}' });
      }
      if (url.hostname === LOCAL_HOST && url.pathname.startsWith('/api/')) {
        rec.unmocked.push(`${route.request().method()} ${url.pathname}`);
        return route.abort('blockedbyclient');
      }
      if (url.hostname === LOCAL_HOST) return route.continue();
      if (url.hostname === 'challenges.cloudflare.com') rec.unmocked.push(url.href);
      return route.abort('blockedbyclient');
    });
    await context.route(/^https:\/\/tiles\.openfreemap\.org\//, (route) => route.abort('connectionrefused'));
    await context.route(/^https:\/\/eu\.i\.posthog\.com\//, async (route) => {
      rec.requests += 1;
      rec.lastAt = Date.now();
      try {
        rec.events.push(...decodeBody(route.request()));
      } catch (e) {
        rec.unhandled.push(`undecodable: ${route.request().url()} ${(e as Error).message}`);
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":1}' });
    });
    context.on('requestfailed', (req) => {
      if (/eu\.i\.posthog\.com/.test(req.url())) rec.unhandled.push(`failed: ${req.url()}`);
    });
    await context.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
      const brands = [
        { brand: 'Chromium', version: '153' },
        { brand: 'Google Chrome', version: '153' },
        { brand: 'Not?A_Brand', version: '99' },
      ];
      if ('userAgentData' in navigator) {
        Object.defineProperty(Navigator.prototype, 'userAgentData', {
          get: () => ({ brands, mobile: false, platform: 'macOS', getHighEntropyValues: async () => ({ brands }) }),
        });
      }
    });
    await use(rec);
    expect(rec.unhandled, `unhandled PostHog requests:\n${rec.unhandled.join('\n')}`).toEqual([]);
    expect(rec.unmocked, `unmocked API or Turnstile requests:\n${rec.unmocked.join('\n')}`).toEqual([]);
  },
});

export { expect };

// ---------- game helpers ----------

const merc = (lat: number) => {
  const φ = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return (1 - Math.log(Math.tan(φ) + 1 / Math.cos(φ)) / Math.PI) / 2;
};
const WORLD = { w: -170, e: 190, s: -58, n: 75 };

/** Screen position of a lat/lng right after "World" (fitBounds to WORLD with 8 px padding). */
export async function worldPixel(page: Page, lat: number, lng: number) {
  const box = await page.locator('.map__canvas').boundingBox();
  if (!box) throw new Error('no map');
  const x0 = (WORLD.w + 180) / 360;
  const x1 = (WORLD.e + 180) / 360;
  const y0 = merc(WORLD.n);
  const y1 = merc(WORLD.s);
  const z = Math.max(0, Math.min(Math.log2((box.width - 16) / (512 * (x1 - x0))), Math.log2((box.height - 16) / (512 * (y1 - y0)))));
  const scale = 512 * 2 ** z;
  let cy = (y0 + y1) / 2;
  const half = box.height / 2 / scale;
  cy = Math.min(1 - half, Math.max(half, cy));
  const cx = (x0 + x1) / 2;
  let x = (lng + 180) / 360;
  if (x < cx - 0.5) x += 1;
  return { x: box.x + box.width / 2 + (x - cx) * scale, y: box.y + box.height / 2 + (merc(lat) - cy) * scale };
}

export async function mapReady(page: Page) {
  await expect(page.locator('.map')).toHaveAttribute('data-state', /ready|fallback/, { timeout: 15000 });
}

/** Place the pin near lat/lng; `zoom` double-clicks zoom in around the point first. */
export async function placePin(page: Page, lat: number, lng: number, zoom = 0) {
  await mapReady(page);
  await page.getByRole('button', { name: 'World' }).click();
  await page.waitForTimeout(150);
  const p = await worldPixel(page, lat, lng);
  for (let i = 0; i < zoom; i++) {
    await page.mouse.dblclick(p.x, p.y);
    await page.waitForTimeout(350);
  }
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('.map__label')).not.toBeEmpty();
}

export async function enterYear(page: Page, year: number) {
  await page.getByRole('button', { name: year < 0 ? 'BCE' : 'CE', exact: true }).click();
  await page.getByLabel('Year', { exact: true }).fill(String(Math.abs(year)));
}

export async function confirm(page: Page) {
  const btn = page.locator('[data-test=confirm]');
  await expect(btn).toBeEnabled();
  await btn.click();
}

/** Answer one round with rough guesses, in question order: Made, When, Kept (DS35). */
export async function playRound(page: Page, guess = { kept: [48.86, 2.35], made: [41.9, 12.5], year: 1500 }) {
  await expect(page.locator('[data-screen=round][data-step=made]')).toBeVisible();
  await placePin(page, guess.made[0] as number, guess.made[1] as number);
  await confirm(page);
  await expect(page.locator('[data-screen=round][data-step=when]')).toBeVisible();
  await enterYear(page, guess.year);
  await confirm(page);
  await expect(page.locator('[data-screen=round][data-step=kept]')).toBeVisible();
  await placePin(page, guess.kept[0] as number, guess.kept[1] as number);
  await confirm(page);
  await expect(page.locator('[data-screen=reveal]')).toBeVisible();
}

/** The ids of the game in progress, in round order, as the save holds them (random from 30 objects up). */
export async function deckIds(page: Page): Promise<string[]> {
  const raw = await page.evaluate(() => localStorage.getItem('museumguessr:v1:save'));
  const ids = (JSON.parse(raw ?? '{}') as { item_ids?: string[] }).item_ids;
  if (!ids || ids.length !== 10) throw new Error('no game in progress');
  return ids;
}

export async function start(page: Page, query = '') {
  await page.goto(query ? `./${query}` : './');
  const startBtn = page.locator('[data-test=start]');
  await expect(startBtn).toBeEnabled({ timeout: 10000 });
  await startBtn.click();
}
