// Boot sequence. Order matters: the test flag is read before anything can
// send; the PostHog chunk loads only after the first screen has painted.

import './styles/fonts.css';
import './styles/tokens.css';
import './styles/app.css';
import { createAnalytics } from './analytics/core.ts';
import { EVENTS } from './analytics/events.ts';
import { App } from './app.ts';
import { ANALYTICS_HOSTS, BASE_URL, BUILD_ID, POSTHOG_TOKEN } from './config.ts';
import { bootStarting, bootSucceeded, isOurs, toReport } from './errors/boundary.ts';
import { devClockOff } from './game/dev.ts';
import { createLock } from './game/lock.ts';
import { cleanedUrl, readSession } from './game/session.ts';
import { KEYS } from './state/schema.ts';
import { local, session } from './storage/guarded.ts';
import { initOverlayHistory } from './ui/overlay.ts';

async function boot() {
  const url = new URL(location.href);
  // read before the address bar is cleaned; always false in production builds (M4)
  const clockOff = devClockOff(url.searchParams);
  const tab = readSession(url, session);
  const cleaned = cleanedUrl(url);
  if (cleaned) history.replaceState(history.state, '', cleaned);
  initOverlayHistory();

  const analytics = createAnalytics({
    token: POSTHOG_TOKEN,
    hosts: ANALYTICS_HOSTS,
    buildId: BUILD_ID,
    dev: import.meta.env.DEV,
    hostname: location.hostname,
    href: url.href,
    testParam: tab.testParam,
    webdriver: navigator.webdriver === true,
    storage: local,
    log: (line) => console.info(line),
    loadProvider: (superProps) => import('./analytics/posthog.ts').then((m) => m.startPostHog(POSTHOG_TOKEN, superProps)),
    now: () => new Date(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
  });

  const root = document.getElementById('app') as HTMLElement;
  const lock = createLock();
  await lock.acquire(false);
  const app = new App({
    root,
    analytics,
    local,
    session,
    lock,
    tab,
    params: url.searchParams,
    devClockOff: clockOff,
    // the one test surface, test mode only (M4)
    exposeTest: (surface) => {
      (window as unknown as { __mgTest?: unknown }).__mgTest = surface;
    },
  });

  // The saved deadline is re-checked whenever the page may have been away (ENG7); edits are saved before it goes.
  document.addEventListener('visibilitychange', () => app.clockEvent(document.visibilityState === 'hidden' ? 'hidden' : 'visible'));
  window.addEventListener('pageshow', () => app.clockEvent('pageshow'));
  window.addEventListener('focus', () => app.clockEvent('focus'));
  window.addEventListener('pagehide', () => app.clockEvent('pagehide'));

  // Telemetry only: the error screen comes from game-code boundaries (ENG11).
  const bundlePrefix = new URL(import.meta.env.DEV ? BASE_URL : `${BASE_URL}assets/`, location.origin).href;
  window.addEventListener('error', (e) => {
    if (isOurs(e.filename, String(e.message ?? ''), bundlePrefix)) app.telemetry(toReport(e.error ?? e.message));
  });
  window.addEventListener('unhandledrejection', (e) => {
    const err = e.reason;
    const stack = err instanceof Error ? err.stack : undefined;
    const url = stack?.match(/(https?:\/\/[^\s)]+):\d+:\d+/)?.[1];
    if (url && isOurs(url, String(err?.message ?? ''), bundlePrefix)) app.telemetry(toReport(err));
  });

  // A redeploy can remove old chunks: reload once if the build changed (ENG33).
  window.addEventListener('vite:preloadError', (e) => {
    e.preventDefault();
    void fetch(`${BASE_URL}build.txt`, { cache: 'no-store' })
      .then((r) => r.text())
      .then((id) => {
        if (id.trim() !== BUILD_ID && !session.get(KEYS.chunkReload)) {
          session.set(KEYS.chunkReload, '1');
          location.reload();
        } else app.fail(new Error('chunk load failed'));
      })
      .catch(() => app.fail(new Error('chunk load failed')));
  });

  window.addEventListener('storage', (e) => {
    if (e.key === KEYS.test) analytics.testFlagChanged();
  });

  // Keep Confirm above the on-screen keyboard (DS20).
  const vv = window.visualViewport;
  const setHeight = () => document.documentElement.style.setProperty('--app-height', `${Math.round(vv?.height ?? innerHeight)}px`);
  vv?.addEventListener('resize', setHeight);
  setHeight();

  if (bootStarting(session) >= 2) app.discardSave();
  let resumed = false;
  try {
    resumed = app.boot().resumed;
  } catch (err) {
    app.fail(err);
  }

  // After the first paint: count the page view, then load the provider (PH1, PH2).
  requestAnimationFrame(() =>
    setTimeout(() => {
      bootSucceeded(session);
      analytics.track(EVENTS.pageview, { src: tab.src, landing: tab.landing, resumed });
      analytics.start();
    }, 0),
  );
}

void boot();
